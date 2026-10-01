import cors from "cors";
import express from "express";
import { https } from "follow-redirects";

const PROXY_PORT = 65433;
const ALLOWED_PROXY_HOSTS = new Set(["vynor.lk"]);
const VYNORAI_WEB_ORIGIN = "https://vynor.lk";
const app = express();
app.use(cors({ origin: VYNORAI_WEB_ORIGIN }));

app.use((req, res, next) => {
  // Proxy the request
  const { origin, host, ...headers } = req.headers;
  const url = req.headers["x-continue-url"];
  if (typeof url !== "string") {
    res.status(400).send("Missing proxy destination");
    return;
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    res.status(400).send("Invalid proxy destination");
    return;
  }

  if (
    parsedUrl.protocol !== "https:" ||
    !ALLOWED_PROXY_HOSTS.has(parsedUrl.hostname.toLowerCase())
  ) {
    res.status(403).send("Proxy destination is not allowed");
    return;
  }

  const protocol = https;
  const proxy = protocol.request(url, {
    method: req.method,
    maxRedirects: 0,
    headers: {
      ...headers,
      host: parsedUrl.host,
    },
  });

  proxy.on("response", (response) => {
    res.status(response.statusCode || 500);
    for (let i = 1; i < response.rawHeaders.length; i += 2) {
      if (
        response.rawHeaders[i - 1].toLowerCase() ===
        "access-control-allow-origin"
      ) {
        continue;
      }
      res.setHeader(response.rawHeaders[i - 1], response.rawHeaders[i]);
    }
    response.pipe(res);
  });

  proxy.on("error", (error) => {
    console.error(error);
    res.sendStatus(500);
  });

  req.pipe(proxy);
});

// http-middleware-proxy
// app.use("/", (req, res, next) => {
//   // Extract the target from the request URL
//   const target = req.headers["x-continue-url"] as string;
//   const { origin, ...headers } = req.headers;

//   // Create a new proxy middleware for this request
//   const proxy = createProxyMiddleware({
//     target,
//     ws: true,
//     headers: {
//       origin: "",
//     },
//   });

//   // Call the middleware
//   proxy(req, res, next);
// });

export function startProxy() {
  const server = app.listen(PROXY_PORT, "127.0.0.1", () => {
    console.log(`Proxy server is running on port ${PROXY_PORT}`);
  });
  server.on("error", (e) => {
    // console.log("Proxy server already running on port 65433");
  });
}
