import "dotenv/config"
import express from "express"
import * as httpProxy from "http-proxy"

const app = express()
const PORT = 8000
const BASE_PATH = process.env.BASE_PATH
const proxy = httpProxy.createProxy()


app.use((req, res) => {
  const host = req.hostname;
  const projectId = host.split(".")[0]

  const resolvesTo = `${BASE_PATH}/${projectId}`

  return proxy.web(req, res, { target: resolvesTo, changeOrigin: true })
})

// Right now we have to add index.html in url 
// To avoid that we would use a configuration on our proxy.


app.listen(PORT, () => {
  console.log(`Reverse Proxy is running... ${PORT}`)
})