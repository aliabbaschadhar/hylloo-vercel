import express from "express"
import { generateSlug } from "random-word-slugs"


const app = express()
const PORT = 9000


app.use(express.json())

app.post("/project", (req, res) => {
  const { gitUrl } = req.body
  const projectSlug = generateSlug()
})

app.listen(PORT, () => {
  console.log(`Api server listening on: ${PORT}`)
  console.log(generateSlug())
})