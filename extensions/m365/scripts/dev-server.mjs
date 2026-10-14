import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.M365_DEV_PORT || 3000);
const backendPort = Number(process.env.VYNORAI_BACKEND_PORT || 3333);
const contentTypes = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".xml": "application/xml", ".svg": "image/svg+xml" };

function proxy(request, response) {
  const upstream = http.request({ hostname: "127.0.0.1", port: backendPort, path: request.url, method: request.method, headers: { ...request.headers, host: `localhost:${backendPort}` } }, (upstreamResponse) => {
    response.writeHead(upstreamResponse.statusCode || 502, upstreamResponse.headers);
    upstreamResponse.pipe(response);
  });
  upstream.on("error", () => { if (!response.headersSent) response.writeHead(502); response.end("Backend unavailable"); });
  request.pipe(upstream);
}

const server = https.createServer({
  cert: fs.readFileSync(path.join(root, "localhost.crt")),
  key: fs.readFileSync(path.join(root, "localhost.key")),
}, (request, response) => {
  if (request.url?.startsWith("/v1/")) return proxy(request, response);
  const requested = new URL(request.url || "/", "https://localhost").pathname;
  const relative = requested === "/" ? "taskpane.html" : requested.replace(/^\//, "");
  const file = relative === "icon-32.png" || relative === "icon-80.png"
    ? path.resolve(root, "../../docs/images/logo.png")
    : path.resolve(root, relative);
  const isLocalIcon = relative === "icon-32.png" || relative === "icon-80.png";
  if ((!isLocalIcon && !file.startsWith(root + path.sep)) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    response.writeHead(404); return response.end("Not found");
  }
  response.setHeader("content-type", contentTypes[path.extname(file)] || "image/png");
  fs.createReadStream(file).pipe(response);
});

server.listen(port, "127.0.0.1", () => console.log(`M365 HTTPS dev server: https://localhost:${port}`));
