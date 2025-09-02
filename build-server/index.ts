import path from "path"
import { exec } from "child_process"
import fs from "fs"
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3"
import * as mime from "mime-types"


const accessKeyId = process.env.S3_ACCESS_KEY_ID;
const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;
const endpoint = process.env.S3_ENDPOINT
const projectId = process.env.PROJECT_ID
const bucket = process.env.BUCKET

if (!accessKeyId || !secretAccessKey || !endpoint || !projectId || !bucket) {
  throw new Error("Missing AWS credentials in environment variables.");
}

const s3Client = new S3Client({
  region: "auto",
  endpoint,
  credentials: {
    accessKeyId,
    secretAccessKey,
  }
})


async function init() {
  console.log("Executing index.js")

  const outDirPath = path.join(__dirname, "output")
  const process = exec(`cd ${outDirPath} && bun install && bun run build`)

  process.stdout?.on("data", (data: Buffer) => {
    console.log(data.toString())
  })

  process.stdout?.on("error", (data: Buffer) => {
    console.error("Error: ", data.toString())
  })

  process.on("close", async () => {
    console.log("Build complete")
    const distFolderPath = path.join(__dirname, "output", "dist")
    // Finding the contents of dist folder

    const distFolderContents = fs.readdirSync(distFolderPath, { recursive: true }) // So that it finds the files from folders insides folders

    for (const filePath of distFolderContents) {
      if (fs.lstatSync(filePath).isDirectory()) {
        continue;
      }
      console.log("Uploading...", filePath)

      const command = new PutObjectCommand({
        Bucket: bucket,
        Key: `__outputs/${projectId}/${filePath}`,
        Body: fs.createReadStream(filePath),
        ContentType: mime.lookup(filePath as string) as string
      })

      await s3Client.send(command)
      console.log("File uploaded:", `__outputs/${projectId}/${filePath}`)
    }
    console.log("Upload done")
  })
}

init()