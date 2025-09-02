import path from "path"
import { exec, execSync } from "child_process"
import fs from "fs"
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3"
import * as mime from "mime-types" // To check the type of file.


const accessKeyId = process.env.S3_ACCESS_KEY_ID;
const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;
const endpoint = process.env.S3_ENDPOINT;
const bucket = process.env.BUCKET;
const gitUrl = process.env.GIT_REPOSITORY_URL;
const projectId = process.env.PROJECT_SLUG

if (!accessKeyId || !secretAccessKey || !endpoint || !projectId || !bucket || !gitUrl) {
  throw new Error("Missing AWS credentials in environment variables.");
}
console.log(`Access key ID: ${accessKeyId} \n Secret Access Key: ${secretAccessKey} \n Endpoint: ${endpoint} \n Bucket: ${bucket} \n Git URL: ${gitUrl} \n Project ID: ${projectId}`);

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

  const outDirPath = path.join(__dirname, "output")
  execSync(`rm -rf ${outDirPath}`)
  execSync(`git clone ${gitUrl} ${outDirPath}`)

  // Install and build 
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
    const distFolderContents = fs.readdirSync(distFolderPath, { recursive: true })

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

      await s3Client.send(command)
      console.log("File uploaded:", `__outputs/${projectId}/${file}`)
    }
    console.log("Upload done")
  })
}

init()