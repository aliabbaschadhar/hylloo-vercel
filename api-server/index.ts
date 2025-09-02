import express from "express"
import { generateSlug } from "random-word-slugs"
import * as k8s from "@kubernetes/client-node"


const app = express()
const PORT = 9000


app.use(express.json())

app.post("/project", async (req, res) => {
  const { gitUrl } = req.body
  const projectSlug = generateSlug()

  // Kubernetes client setup
  const kc = new k8s.KubeConfig()
  kc.loadFromDefault()
  const k8sApi = kc.makeApiClient(k8s.CoreV1Api)

  // Pod manifest with env vars 
  const podManifest = {
    metadata: { name: `build-${projectSlug}` },
    spec: {
      containers: [{
        name: "build-server",
        image: "aliabbaschadhar003/build-server:latest",
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

  await k8sApi.createNamespacedPod({
    namespace: "default",
    body: podManifest
  })

  res.json({ slug: projectSlug, status: "build started" })
})

app.listen(PORT, () => {
  console.log(`Api server listening on: ${PORT}`)
  console.log(generateSlug())
})