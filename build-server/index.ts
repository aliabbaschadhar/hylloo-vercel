import path from "path"
import { exec } from "child_process"
import fs from "fs"
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3"

const accessKeyId = process.env.ACCESS_KEY_ID;
const secretAccessKey = process.env.SECRET_ACCESS_KEY;

if (!accessKeyId || !secretAccessKey) {
  throw new Error("Missing AWS credentials in environment variables.");
}

const s3Client = new S3Client({
  region: "auto",
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

  process.on("close", () => {
    console.log("Build complete")
    const distFolderPath = path.join(__dirname, "output", "dist")
    // Finding the contents of dist folder

    const distFolderContents = fs.readdirSync(distFolderPath, { recursive: true }) // So that it finds the files from folders insides folders

    for (const filePath of distFolderContents) {
      if (fs.lstatSync(filePath).isDirectory()) {
        continue;
      }
    }
  })
}
