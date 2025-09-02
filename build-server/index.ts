import path from "path"
import { exec, execSync } from "child_process"
import fs from "fs"
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3"
import * as mime from "mime-types" // To check the type of file.
import Redis from "ioredis"


const accessKeyId = process.env.S3_ACCESS_KEY_ID;
const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;
const endpoint = process.env.S3_ENDPOINT;
const bucket = process.env.BUCKET;
const gitUrl = process.env.GIT_REPOSITORY_URL;
const projectId = process.env.PROJECT_SLUG
const publisher = new Redis("redis://localhost:2739")


if (!accessKeyId || !secretAccessKey || !endpoint || !projectId || !bucket || !gitUrl) {
  throw new Error("Missing AWS credentials in environment variables.");
}


// console.log(`Access key ID: ${accessKeyId} \n Secret Access Key: ${secretAccessKey} \n Endpoint: ${endpoint} \n Bucket: ${bucket} \n Git URL: ${gitUrl} \n Project ID: ${projectId}`);

interface LogPayload {
  log: string;
}

function publishLog(log: string): void {
  publisher.publish(`logs:${projectId}`, JSON.stringify({ log } as LogPayload));
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
  console.log("Executing build-server")
  publishLog("Build Started...")

  const outDirPath = path.join(__dirname, "output")
  publishLog("Removing last project from output folder...")
  execSync(`rm -rf ${outDirPath}`)

  publishLog("Cloning the project to output directory...")
  execSync(`git clone ${gitUrl} ${outDirPath}`)

  // Install and build 
  publishLog("Installing and build the project...")
  const process = exec(`cd ${outDirPath} && bun install && bun run build`)

  process.stdout?.on("data", (data: Buffer) => {
    console.log(data.toString())
    publishLog(data.toString())
  })

  process.stdout?.on("error", (data: Buffer) => {
    console.error("Error: ", data.toString())
    publishLog(`Error: ${data.toString()}`)
  })

  process.on("close", async () => {
    console.log("Build complete")

    publishLog("Build completed...")
    const distFolderPath = path.join(__dirname, "output", "dist")
    const distFolderContents = fs.readdirSync(distFolderPath, { recursive: true })
    publishLog("Reading the files/directories and their contents...")

    for (const file of distFolderContents) {
      const filePath = path.join(distFolderPath, file as string)
      if (fs.lstatSync(filePath).isDirectory()) {
        continue;
      }

      const fileSize = fs.statSync(filePath).size

      console.log(`Uploading ${filePath} (${fileSize} bytes)`)

      // Use readFileSync for small files (< 10MB), createReadStream for larger files
      const fileBody = fileSize < 10 * 1024 * 1024
        ? fs.readFileSync(filePath)
        : fs.createReadStream(filePath)

      const command = new PutObjectCommand({
        Bucket: bucket,
        Key: `__outputs/${projectId}/${file}`,
        Body: fileBody,
        ContentType: mime.lookup(filePath) || undefined
      })

      publishLog(`Uploading file: ${file}`)
      await s3Client.send(command)

      console.log("File uploaded:", `__outputs/${projectId}/${file}`)
      publishLog(`File upload done at __outputs/${projectId}/${file} `)
    }
    console.log("Upload done")
    publishLog("Upload done completely!")
  })
}

init()