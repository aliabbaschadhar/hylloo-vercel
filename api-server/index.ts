import "dotenv/config"
import express from "express"
import { generateSlug } from "random-word-slugs"
import * as k8s from "@kubernetes/client-node"

const app = express()
const PORT = 9000

app.use(express.json())

app.get("/health", (req, res) => {
  res.status(200).json({
    msg: "Ok"
  })
})

app.post("/project", async (req, res) => {
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
          image: "aliabbaschadhar003/build-server:v1.4",
          env: [
            { name: "GIT_REPOSITORY_URL", value: gitUrl },
            { name: "PROJECT_SLUG", value: projectSlug },
            { name: "S3_ACCESS_KEY_ID", value: process.env.S3_ACCESS_KEY_ID },
            { name: "S3_SECRET_ACCESS_KEY", value: process.env.S3_SECRET_ACCESS_KEY },
            { name: "S3_ENDPOINT", value: process.env.S3_ENDPOINT },
            { name: "BUCKET", value: process.env.BUCKET }
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
    res.json({ slug: projectSlug, status: "build started", url: `http://${projectSlug}.localhost:8000` })

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

        if (phase === "Succeeded" || phase === "Failed") {
          completed = true
          // Delete the pod
          await k8sApi.deleteNamespacedPod({
            name: podName,
            namespace: "default"
          })
          console.log(`Pod ${podName} completed with status: ${phase} and deleted`)
        } else {
          console.log(`Pod ${podName} status: ${phase}`)
          await new Promise(r => setTimeout(r, 5000))
        }
      } catch (error) {
        console.error(`Error checking pod status: ${error}`)
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

app.listen(PORT, () => {
  console.log(`Api server listening on: ${PORT}`)
})