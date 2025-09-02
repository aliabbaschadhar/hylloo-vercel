import "dotenv/config"
import express from "express"
import httpProxy from "http-proxy"

const app = express()
const PORT = 8000
const BASE_PATH = process.env.BASE_PATH
const proxy = httpProxy.createProxyServer()


app.use((req, res) => {
  const host = req.hostname;
  const projectId = host.split(".")[0];

  // If the request is for root, rewrite to /index.html
  if (req.path === "/") {
    // req.path  // It is a readonly property
    req.url = "/index.html";
  }

  const resolvesTo = `${BASE_PATH}/${projectId}`;
  return proxy.web(req, res, { target: resolvesTo, changeOrigin: true });
});


app.listen(PORT, () => {
  console.log(`Reverse Proxy is running... ${PORT}`);
})