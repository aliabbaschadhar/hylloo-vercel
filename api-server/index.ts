import "dotenv/config"
import express from "express"
import { generateSlug } from "random-word-slugs"
import * as k8s from "@kubernetes/client-node"
import { Server } from "socket.io"
import Redis from "ioredis"
import http from 'http'
import { PrismaClient } from "@prisma/client"
import { z } from "zod"
import { StatusCodes, ReasonPhrases } from "http-status-codes"


const app = express();
const PORT = 9000;
const redisUrl = process.env.REDIS_URL

const server = http.createServer(app);
const SOCKET_PORT = 9001;
const io = new Server(server, {
  cors: {
    origin: "*"
  }
});
const prisma = new PrismaClient();


if (!redisUrl) throw new Error("Redis url is not available")

const subscriber = new Redis(redisUrl)


app.use(express.json())


io.on("connection", (socket) => {
  socket.on("subscribe", (channel) => {
    io.to(channel).emit("message", `New socket with id ${socket.id} joined`)
    socket.join(channel)
    socket.emit("message", `Joined ${channel}`)
  })
})


async function initRedisSubscribe() {
  console.log("Subscribed to logs...")
  await subscriber.psubscribe("logs:*") // Subscribe to all messages which comes on logs:
  subscriber.on("pmessage", (pattern, channel, message) => {
    // In psubscribe or pmessage => p stands for pattern 
    io.to(channel).emit("message", message)
  })
}

initRedisSubscribe()

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
    const { gitUrl } = req.body

    if (!gitUrl) {
      return res.status(400).json({ error: "gitUrl is required" })
    }

    const projectSlug = generateSlug()
    console.log(projectSlug)

    // Kubernetes client setup with SSL verification disabled
    const kc = new k8s.KubeConfig()
    kc.loadFromDefault()

    // Disable SSL verification for DigitalOcean clusters
    // Set NODE_TLS_REJECT_UNAUTHORIZED=0 in your environment to disable SSL verification globally
    // Example: export NODE_TLS_REJECT_UNAUTHORIZED=0

    const k8sApi = kc.makeApiClient(k8s.CoreV1Api)

    // Pod manifest with env vars 
    const podManifest = {
      metadata: { name: `build-${projectSlug}` },
      spec: {
        containers: [{
          name: "build-server",
          image: "aliabbaschadhar003/build-server:v1.6.2",
          env: [
            { name: "GIT_REPOSITORY_URL", value: gitUrl },
            { name: "PROJECT_SLUG", value: projectSlug },
            { name: "S3_ACCESS_KEY_ID", value: process.env.S3_ACCESS_KEY_ID },
            { name: "S3_SECRET_ACCESS_KEY", value: process.env.S3_SECRET_ACCESS_KEY },
            { name: "S3_ENDPOINT", value: process.env.S3_ENDPOINT },
            { name: "BUCKET", value: process.env.BUCKET },
            { name: "REDIS_URL", value: process.env.REDIS_URL }
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
    res.json({ slug: `${projectSlug}`, status: "build started", url: `http://${projectSlug}.localhost:8000` })

    // Poll pod status in background
    const podName = `build-${projectSlug}`
    let completed = false
    let attempts = 0
    const maxAttempts = 120 // 10 minutes max (120 * 5 seconds)

    while (!completed && attempts < maxAttempts) {
      try {
        const podResponse = await k8sApi.readNamespacedPod({
          name: podName,
          namespace: "default"
        })
        const phase = podResponse.status?.phase
        const containerStatuses = podResponse.status?.containerStatuses

        console.log(`Pod ${podName} status: ${phase}`)

        // Check if container has terminated (regardless of pod phase)
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
    console.error("Error in /project endpoint:", error)
    res.status(500).json({ error: "Internal server error" })
  }
})



server.listen(SOCKET_PORT, () => {
  console.log(`Socket server: ${SOCKET_PORT}`)
})

app.listen(PORT, () => {
  console.log(`Api server listening on: ${PORT}`)
})