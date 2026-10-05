import dns from "dns/promises";
import http from "http";
import net from "net";

const port = Number(process.env.BG_EGRESS_PORT || 8080);
const modelTarget = new URL(
  process.env.BG_MODEL_RELAY_URL ||
    "http://vynor-backend:3333/internal/background/model/v1/chat/completions",
);
const allowedHosts = new Set(
  (
    process.env.BG_EGRESS_ALLOWLIST ||
    "registry.npmjs.org,npmjs.org,pypi.org,files.pythonhosted.org,repo.packagist.org,packagist.org,rubygems.org,api.rubygems.org,github.com,codeload.github.com,objects.githubusercontent.com"
  )
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean),
);

function hostAllowed(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  return [...allowedHosts].some(
    (allowed) => host === allowed || host.endsWith(`.${allowed}`),
  );
}

function privateAddress(address: string): boolean {
  return /^(127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1$|fc|fd|fe80)/i.test(
    address,
  );
}

async function resolvePublic(hostname: string): Promise<string> {
  const results = await dns.lookup(hostname, { all: true, verbatim: true });
  if (!results.length || results.some((item) => privateAddress(item.address)))
    throw new Error("PRIVATE_EGRESS_DENIED");
  return results[0]!.address;
}

const server = http.createServer((req, res) => {
  if (req.method !== "POST" || req.url !== "/model/v1/chat/completions") {
    res.writeHead(404).end();
    return;
  }
  const authorization = req.headers.authorization;
  if (!authorization?.startsWith("Bearer ")) {
    res.writeHead(401).end();
    return;
  }
  const upstream = http.request(
    {
      hostname: modelTarget.hostname,
      port: Number(modelTarget.port || 80),
      path: modelTarget.pathname,
      method: "POST",
      headers: {
        authorization,
        "content-type": "application/json",
        "x-vynor-client": "background-sandbox",
      },
    },
    (upstreamRes) => {
      res.writeHead(upstreamRes.statusCode || 502, {
        "content-type": String(
          upstreamRes.headers["content-type"] || "application/json",
        ),
        "cache-control": "no-store",
      });
      upstreamRes.pipe(res);
    },
  );
  let bytes = 0;
  req.on("data", (chunk: Buffer) => {
    bytes += chunk.length;
    if (bytes > 10 * 1024 * 1024)
      upstream.destroy(new Error("MODEL_REQUEST_TOO_LARGE"));
  });
  upstream.on("error", () => {
    if (!res.headersSent) res.writeHead(502);
    res.end();
  });
  req.pipe(upstream);
});

server.on("connect", async (req, client, head) => {
  try {
    const target = new URL(`https://${req.url}`);
    if (Number(target.port || 443) !== 443 || !hostAllowed(target.hostname))
      throw new Error("EGRESS_HOST_DENIED");
    const address = await resolvePublic(target.hostname);
    const upstream = net.connect(443, address, () => {
      client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length) upstream.write(head);
      upstream.pipe(client);
      client.pipe(upstream);
    });
    upstream.setTimeout(10 * 60_000, () => upstream.destroy());
    upstream.on("error", () => client.destroy());
  } catch {
    client.end("HTTP/1.1 403 Forbidden\r\n\r\n");
  }
});

server.listen(port, "0.0.0.0", () =>
  console.log(`[BackgroundEgress] listening on ${port}`),
);
