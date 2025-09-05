import "dotenv/config"
import express from "express"
import { generateSlug } from "random-word-slugs"
import * as k8s from "@kubernetes/client-node"
import http from 'http'
import { PrismaClient } from "@prisma/client"
import { z } from "zod"
import { StatusCodes } from "http-status-codes"
import { createClient } from "@clickhouse/client"
import { Kafka } from "kafkajs"
import fs from "fs"
import path from "path"
import { v4 as uuidv4 } from "uuid"


const app = express();
const PORT = 9000;
const kafkaBrokerUrl = process.env.KAFKA_BROKER_URL
const kafkaPassword = process.env.KAFKA_SASL_PASSWORD

if (!kafkaBrokerUrl || !kafkaPassword) {
  throw new Error("ENVIRONMENT VARIABLES ARE NOT AVAILABLE!")
}

const prisma = new PrismaClient();
const clickhouseClient = createClient({
  url: process.env.CLICKHOUSE_HOST, // Changed from 'host' to 'url'
  database: "default",
  username: "avnadmin",
  password: process.env.CLICKHOUSE_PASSWORD,
})
const kafka = new Kafka({
  clientId: `api-server`,
  brokers: [kafkaBrokerUrl],
  ssl: {
    ca: [fs.readFileSync(path.join(__dirname, 'kafka(ca).pem'), "utf-8")]
  },
  sasl: {
    username: "avnadmin",
    password: kafkaPassword,
    mechanism: "plain"
  },
  retry: {
    retries: 5, // Retry up to 5 times
    initialRetryTime: 300, // Start with 300ms retry delay
    maxRetryTime: 30000 // Maximum retry delay of 30 seconds
  },
  requestTimeout: 30000 // Set a 30-second timeout for requests
})
const consumer = kafka.consumer({ groupId: "api-server-logs-consumer" })

app.use(express.json())

async function initKafkaConsumer() {
  await consumer.connect()
    .catch(
      (err) => console.error('Error happened while connecting consumer : ', err)
    )
  await consumer.subscribe({ topics: ['container-logs'] })
    .catch(err => console.error("Unable to subscribe to topics: ", err))

  await consumer.run({
    autoCommit: false,
    eachBatch: async function ({ batch, heartbeat, commitOffsetsIfNecessary, resolveOffset }) {
      const messages = batch.messages;
      console.log(`Received ${messages.length} messages...`)

      for (const message of messages) {
        const stringMessage = message.value?.toString()
        if (!stringMessage) {
          console.warn(`Message doesn't exist`)
          continue;
        }

        // Fix the destructuring to match the actual message structure
        const { projectId, deploymentId, log } = JSON.parse(stringMessage)

        // Add to events to click house DB
        const { query_id } = await clickhouseClient.insert({
          table: 'log_events',
          values: [{ event_id: uuidv4(), deployment_id: deploymentId, log: log }],
          format: "JSONEachRow"
        })
        console.log(JSON.parse(stringMessage))
        // console.log(query_id)

        resolveOffset(message.offset)
        await commitOffsetsIfNecessary()
        await heartbeat()
      }
    }
  })
}

initKafkaConsumer()


app.get("/health", (req, res) => {
  res.status(200).json({
    msg: "Ok"
  })
})

app.post("/project", async (req, res) => {
  const schema = z.object({
    name: z.string(),
    gitURL: z.url()
  })

  const safeParseResult = schema.safeParse(req.body)

  if (safeParseResult.error) {
    return res.status(400).json({
      error: safeParseResult.error
    })
  }

  const { name, gitURL } = safeParseResult.data

  try {
    const project = await prisma.project.create({
      data: {
        name: name,
        gitURL: gitURL,
        subDomain: generateSlug()
      }
    })

    res.status(StatusCodes.CREATED).json({
      msg: "Project created!",
      data: { project }
    })
  } catch (error) {
    console.error("Error while creating project", error)
  }
})

app.post("/deploy", async (req, res) => {
  try {
    const { projectId } = req.body

    const project = await prisma.project.findUnique({ where: { id: projectId } })

    if (!project) {
      return res.status(StatusCodes.NOT_FOUND).json({ error: "Project doesn't exists!" })
    }

    let deployment;
    try {
      deployment = await prisma.deployment.create({
        data: {
          project: { connect: { id: projectId } },
          status: "QUEUED"
        }
      });
    } catch (error) {
      console.error("Error creating deployment:", error);
      return res.status(500).json({ error: "Failed to create deployment" });
    }

    const kc = new k8s.KubeConfig()
    kc.loadFromDefault()

    // Disable SSL verification for DigitalOcean clusters
    // Set NODE_TLS_REJECT_UNAUTHORIZED=0 in your environment to disable SSL verification globally
    // Example: export NODE_TLS_REJECT_UNAUTHORIZED=0

    const k8sApi = kc.makeApiClient(k8s.CoreV1Api)

    // Fix the pod name consistency
    const podName = `build-server-img-${deployment.id}`
    const podManifest = {
      metadata: { name: podName }, // Use the same variable
      spec: {
        containers: [{
          name: "build-server",
          image: "aliabbaschadhar003/build-server:v2",
          env: [
            { name: "GIT_REPOSITORY_URL", value: project.gitURL },
            { name: "PROJECT_ID", value: projectId },
            { name: "DEPLOYMENT_ID", value: deployment.id },
            { name: "S3_ACCESS_KEY_ID", value: process.env.S3_ACCESS_KEY_ID },
            { name: "S3_SECRET_ACCESS_KEY", value: process.env.S3_SECRET_ACCESS_KEY },
            { name: "S3_ENDPOINT", value: process.env.S3_ENDPOINT },
            { name: "BUCKET", value: process.env.BUCKET },
            { name: "KAFKA_BROKER_URL", value: kafkaBrokerUrl },
            { name: "KAFKA_SASL_PASSWORD", value: kafkaPassword }
          ]
        }],
        restartPolicy: "Never"
      }
    }

    console.log("Creating pod...")
    const response = await k8sApi.createNamespacedPod({
      namespace: "default",
      body: podManifest
    })
    console.log("Pod created successfully")

    // Send immediate response
    res.json({ status: "QUEUED", data: { deploymentId: deployment.id } })

    // Poll pod status in background - use the same podName variable
    let completed = false
    let attempts = 0
    const maxAttempts = 120

    while (!completed && attempts < maxAttempts) {
      try {
        const podResponse = await k8sApi.readNamespacedPod({
          name: podName, // Now using the correct variable
          namespace: "default"
        })
        const phase = podResponse.status?.phase
        const containerStatuses = podResponse.status?.containerStatuses

        console.log(`Pod ${podName} status: ${phase}`)

        const buildContainer = containerStatuses?.find(c => c.name === "build-server")
        const isTerminated = buildContainer?.state?.terminated

        if (phase === "Succeeded" || phase === "Failed" || isTerminated) {
          completed = true
          const exitCode = isTerminated?.exitCode
          const reason = isTerminated?.reason || phase

          console.log(`Pod ${podName} completed - Phase: ${phase}, Exit Code: ${exitCode}, Reason: ${reason}`)

          // Delete the pod
          try {
            await k8sApi.deleteNamespacedPod({
              name: podName,
              namespace: "default"
            })
            console.log(`Pod ${podName} deleted successfully`)
          } catch (deleteError) {
            console.error(`Error deleting pod: ${deleteError}`)
          }
        } else {
          await new Promise(r => setTimeout(r, 5000))
        }
      } catch (error) {
        console.error(`Error checking pod status: ${error}`)
        await new Promise(r => setTimeout(r, 5000))
      }
      attempts++
    }

    if (!completed) {
      console.log(`Pod ${podName} did not complete within timeout, attempting cleanup`)
      try {
        await k8sApi.deleteNamespacedPod({
          name: podName,
          namespace: "default"
        })
      } catch (error) {
        console.error(`Error cleaning up pod: ${error}`)
      }
    }

  } catch (error) {
    console.error("Error in /deploy endpoint:", error)
    res.status(500).json({ error: "Internal server error" })
  }
})

app.get("/logs/:id", async (req, res) => {
  const id = req.params.id;
  try {
    const logs = await clickhouseClient.query({
      query: `SELECT event_id, deployment_id, log, timestamp FROM log_events WHERE deployment_id = {deployment_id:String}`,
      query_params: {
        deployment_id: id
      },
      format: "JSONEachRow"
    });
    const rawLogs = await logs.json();
    return res.status(StatusCodes.OK).json({
      logs: rawLogs
    });
  } catch (error) {
    console.error("Error fetching logs:", error);
    return res.status(500).json({ error: "Failed to fetch logs" });
  }
});

app.listen(PORT, () => {
  console.log(`Api server listening on: ${PORT}`)
})