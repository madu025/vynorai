import cors from "cors";
import { warmUpLocalSlm } from "./services/localSlmRouter.js";
import { scheduleRetention } from "./services/retention.js";
import { scheduleReservationReconcile } from "./services/monthlyQuota.js";
import { releasesRouter } from "./routes/releases.js";
import express, { NextFunction, Request, Response } from "express";
import fs from "fs";
import path from "path";
import { config, MODEL_ALIASES } from "./config.js";
import { initDb, initModelRegistry } from "./db.js";
import { adminRouter } from "./routes/admin.js";
import { authRouter } from "./routes/auth.js";
import { googleAuthRouter } from "./routes/googleAuth.js";
import { memoryRouter } from "./routes/memory.js";
import { paymentRouter } from "./routes/payment.js";
import { proxyRouter } from "./routes/proxy.js";
import { backgroundRouter } from "./routes/background.js";
import { backgroundInternalRouter } from "./routes/backgroundInternal.js";
import { initCacheTable } from "./services/cacheEngine.js";
import { startHealthMonitor } from "./services/healthMonitor.js";
import { getRedis, redisStatus } from "./services/redisStore.js";
import { billingDbStatus } from "./services/billingDb.js";
import { loadProviderCredentials } from "./services/providerCredentials.js";
import { scheduleBackgroundReconciliation } from "./services/backgroundTasks.js";

import { securityHeadersMiddleware } from "./middleware/security.js";

const PUBLIC_DIR = path.resolve(process.cwd(), "public");
const LOGIN_PAGE = path.join(PUBLIC_DIR, "login.html");
const ADMIN_PAGE = path.join(PUBLIC_DIR, "admin.html");

// Clean-URL paths that must all serve the customer login/register page
const LOGIN_PATHS = [
  "/login",
  "/login/",
  "/login.html",
  "/signin",
  "/signin/",
  "/register",
  "/register/",
  "/signup",
  "/signup/",
];

// Only allow deep-link callbacks back into IDEs (prevents open redirects)
const ALLOWED_CALLBACK_PREFIXES = [
  "vscode://",
  "vscode-insiders://",
  "vscodium://",
  "antigravity://",
  "antigravity-ide://",
  "cursor://",
  "windsurf://",
  "trae://",
  "jetbrains://",
];

function isAllowedCallback(cb: unknown): boolean {
  if (typeof cb !== "string" || cb.length > 2048) return false;
  try {
    const parsed = new URL(cb);
    const prefix = `${parsed.protocol}//`.toLowerCase();
    return (
      ALLOWED_CALLBACK_PREFIXES.includes(prefix) &&
      ["vynorai.vynorai", "continue.continue"].includes(
        parsed.hostname.toLowerCase(),
      ) &&
      parsed.pathname === "/auth"
    );
  } catch {
    return false;
  }
}

// Shared handler: serves login.html for /login?source=vscode&callback=vscode://...
function serveLoginPage(req: Request, res: Response) {
  // Drop an untrusted callback instead of passing it on to the page
  if (
    req.query.callback !== undefined &&
    !isAllowedCallback(req.query.callback)
  ) {
    const params = new URLSearchParams(req.query as Record<string, string>);
    params.delete("callback");
    const qs = params.toString();
    return res.redirect(302, `/login${qs ? `?${qs}` : ""}`);
  }

  if (!fs.existsSync(LOGIN_PAGE)) {
    console.error(`[Login] Missing file: ${LOGIN_PAGE} (cwd=${process.cwd()})`);
    return res
      .status(500)
      .type("text/plain")
      .send(
        "Login page is temporarily unavailable. Please contact support@vynor.lk",
      );
  }

  res.setHeader("Cache-Control", "no-store");
  res.sendFile(LOGIN_PAGE);
}

// ─── Main API App (Port: config.port) ─────────────────────────────────────────
const app = express();

// Running behind nginx / Cloudflare: needed for correct req.ip + rate limiting
app.set("trust proxy", 1);

app.use(securityHeadersMiddleware);
const allowedOrigins = new Set([
  "https://vynor.lk",
  "https://admin.vynor.lk",
  ...(process.env.CORS_ORIGINS || "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean),
]);
app.use(
  cors({
    origin(origin, callback) {
      // Native IDE/CLI requests do not carry a browser Origin header.
      if (!origin || allowedOrigins.has(origin)) return callback(null, true);
      // Allow VS Code / IDE webviews and local dev origins
      if (
        origin.startsWith("vscode-webview://") ||
        origin.startsWith("vscode-file://") ||
        origin.startsWith("http://localhost:") ||
        origin.startsWith("https://localhost:") ||
        origin.endsWith(".vynor.lk")
      ) {
        return callback(null, true);
      }
      return callback(new Error("Origin not allowed"));
    },
  }),
);
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

// Login routes MUST be registered before static / 404 handling
app.get(LOGIN_PATHS, serveLoginPage);

// If request arrives on admin.vynor.lk, serve admin.html directly
app.use((req, res, next) => {
  const host = (req.headers.host || "").toLowerCase();
  if (
    host.startsWith("admin.") &&
    (req.path === "/" || req.path === "/admin")
  ) {
    return res.sendFile(ADMIN_PAGE);
  }
  next();
});

app.get("/favicon.ico", (_req, res) => res.redirect(301, "/favicon.svg"));
app.use(express.static(PUBLIC_DIR, { extensions: ["html"] }));

// Public health check — no auth required
app.get("/health", (_req, res) => {
  const activeProviders = Object.entries(config.aiKeys)
    .filter(([k, v]) => k !== "ollama" && v)
    .map(([k]) => k);

  const redis = redisStatus();
  const billing = billingDbStatus();
  res.json({
    status: "ok",
    service: "VynorAI Cloud API",
    version: "2.0.0",
    payhereEnv: config.payhere.env,
    checkoutAvailable:
      config.nodeEnv !== "production" ||
      (config.payhere.env === "live" &&
        Boolean(config.payhere.merchantId && config.payhere.merchantSecret)),
    backgroundEnabled: process.env.BG_ENABLED === "true",
    activeProviders: activeProviders.length
      ? activeProviders
      : ["ollama (local)"],
    supportedModels: Object.keys(MODEL_ALIASES).length,
    redis: { configured: redis.configured, ready: redis.ready },
    billing,
    features: [
      "multi-provider-routing",
      "circuit-breaker",
      "l1-l2-cache",
      "anthropic-prompt-caching",
      "agentic-tools",
      "quota-guard",
    ],
    timestamp: new Date().toISOString(),
  });
});

// Readiness is stricter than liveness. Coolify should stop routing new traffic
// when the billing store is unavailable, or when distributed IDE auth is
// explicitly required but Redis is degraded.
// Set on SIGTERM: /ready turns 503 so the load balancer stops sending new
// requests here while in-flight streams finish (rolling deploys, no downtime).
let draining = false;

app.get("/ready", (_req, res) => {
  if (draining)
    return res
      .status(503)
      .json({ status: "draining", timestamp: new Date().toISOString() });
  const redis = redisStatus();
  const billing = billingDbStatus();
  const ideAuthRequiresRedis = process.env.IDE_AUTH_REQUIRE_REDIS === "true";
  const ready = billing.ready && (!ideAuthRequiresRedis || redis.ready);

  return res.status(ready ? 200 : 503).json({
    status: ready ? "ready" : "not_ready",
    billing,
    redis: {
      configured: redis.configured,
      ready: redis.ready,
      requiredForIdeAuth: ideAuthRequiresRedis,
    },
    timestamp: new Date().toISOString(),
  });
});

app.use("/api/auth/google", googleAuthRouter);
app.use("/api/auth", authRouter);
app.use("/api/payment", paymentRouter);
// More specific mount first so the generic /v1 router can't swallow it
app.use("/v1/memory", memoryRouter);
app.use("/v1/background", backgroundRouter);
app.use("/internal/background", backgroundInternalRouter);
app.use("/v1", proxyRouter);
app.use(releasesRouter);

// Customer portal /admin redirect to dedicated admin portal
app.get("/admin", (_req, res) => {
  res.redirect("https://admin.vynor.lk");
});

// 404 fallback (JSON for API paths, plain text for pages)
app.use((req: Request, res: Response) => {
  if (req.path.startsWith("/api/") || req.path.startsWith("/v1")) {
    return res.status(404).json({ error: "Not found", path: req.path });
  }
  res.status(404).type("text/plain").send("Page not found");
});

// Error handler
app.use((err: any, req: Request, res: Response, _next: NextFunction) => {
  console.error(`[Error] ${req.method} ${req.originalUrl}:`, err);
  if (res.headersSent) return;
  if (req.path.startsWith("/api/") || req.path.startsWith("/v1")) {
    return res
      .status(err?.status || 500)
      .json({ error: "Internal server error" });
  }
  res
    .status(err?.status || 500)
    .type("text/plain")
    .send("Something went wrong");
});

// ─── Admin App (Separate Port: config.adminPort) ───────────────────────────────
const adminApp = express();
adminApp.set("trust proxy", 1);

// Restrict admin CORS to same-origin / configured admin origin only
const adminOrigin = process.env.ADMIN_ORIGIN || false; // false = same-origin only
adminApp.use(securityHeadersMiddleware);
adminApp.use(
  cors({
    origin: adminOrigin,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  }),
);
adminApp.use(express.json({ limit: "2mb" }));
adminApp.use(express.urlencoded({ extended: true }));

// Safety net: if customer login URLs ever reach the admin port
// (e.g. wrong proxy target), send them to the customer portal instead of 404.
adminApp.get(LOGIN_PATHS, (req, res) => {
  const qIndex = req.originalUrl.indexOf("?");
  const qs = qIndex >= 0 ? req.originalUrl.substring(qIndex) : "";
  res.redirect(302, `https://vynor.lk/login${qs}`);
});

// Root routes for admin portal (https://admin.vynor.lk/)
adminApp.get(["/", "/admin"], (_req, res) => {
  res.sendFile(ADMIN_PAGE);
});

// Serve admin static UI without serving index.html on root
adminApp.use(express.static(PUBLIC_DIR, { index: false }));

// Mount all admin API routes at /admin
adminApp.use("/admin", adminRouter);

// Admin health (no auth — just confirms admin server is alive)
adminApp.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "VynorAI Admin Portal",
    version: "2.0.0",
    timestamp: new Date().toISOString(),
  });
});

adminApp.use((req: Request, res: Response) => {
  if (req.path.startsWith("/admin")) {
    return res.status(404).json({ error: "Not found", path: req.path });
  }
  res.status(404).type("text/plain").send("Page not found");
});

adminApp.use((err: any, req: Request, res: Response, _next: NextFunction) => {
  console.error(`[AdminError] ${req.method} ${req.originalUrl}:`, err);
  if (res.headersSent) return;
  res.status(err?.status || 500).json({ error: "Internal server error" });
});

// ─── Boot ─────────────────────────────────────────────────────────────────────
async function start() {
  if (config.nodeEnv === "production") {
    if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
      throw new Error(
        "JWT_SECRET must be configured with at least 32 characters in production",
      );
    }
    if (!process.env.ADMIN_SECRET || process.env.ADMIN_SECRET.length < 32) {
      throw new Error(
        "ADMIN_SECRET must be configured with at least 32 characters in production",
      );
    }
    if (!process.env.DATA_ENCRYPTION_KEY) {
      throw new Error("DATA_ENCRYPTION_KEY must be configured in production");
    }
    if (process.env.BG_ENABLED === "true") {
      for (const name of [
        "BG_ARTIFACT_MASTER_KEY",
        "BG_QUOTE_SECRET",
        "BG_MODEL_TOKEN_SECRET",
        "BG_IP_HASH_SALT",
        "BG_PATCH_SIGNING_PRIVATE_KEY_BASE64",
        "BG_PATCH_SIGNING_PUBLIC_KEY_BASE64",
      ]) {
        if (!process.env[name] || process.env[name]!.length < 32)
          throw new Error(
            `${name} must be configured with at least 32 characters when Background Agents are enabled`,
          );
      }
    }
  }
  // Fail loudly at boot if the static pages are missing
  for (const f of [LOGIN_PAGE, ADMIN_PAGE]) {
    if (!fs.existsSync(f))
      console.warn(
        `[Boot] WARNING: missing static file ${f} (cwd=${process.cwd()})`,
      );
  }

  await initDb();
  await initCacheTable();
  const { initVaultStore } = await import("./services/vaultStore.js");
  await initVaultStore();
  await initModelRegistry();
  await loadProviderCredentials();
  await getRedis();

  const activeKeys = Object.entries(config.aiKeys)
    .filter(([k, v]) => k !== "ollama" && v)
    .map(([k]) => k.toUpperCase());

  // Start background health monitor (probes providers every 60s)
  startHealthMonitor(60_000);

  // Prime the local SLM so the first routed request does not time out.
  void warmUpLocalSlm();
  scheduleRetention();
  scheduleReservationReconcile();
  scheduleBackgroundReconciliation();

  // ── Main API server ──────────────────────────────────────────────────────────
  const server = app.listen(config.port, () => {
    console.log(`
╔══════════════════════════════════════════════════════════╗
║         ⚡ VynorAI Cloud API v2.0 Running!               ║
╠══════════════════════════════════════════════════════════╣
║  Dashboard  → http://localhost:${config.port}                     ║
║  Login      → http://localhost:${config.port}/login               ║
║  AI Gateway → http://localhost:${config.port}/v1                  ║
║  Health     → http://localhost:${config.port}/health              ║
╠══════════════════════════════════════════════════════════╣
║  Env:      ${config.nodeEnv.padEnd(15)} PayHere: ${config.payhere.env.padEnd(12)}  ║
║  Providers: ${(activeKeys.join(", ") || "none – add API keys to .env").padEnd(45)} ║
║  Models:   ${String(Object.keys(MODEL_ALIASES).length).padEnd(3)} aliases via OpenRouter (300+ available)  ║
║  Features: circuit-breaker ✓ cache ✓ quota ✓ agents ✓   ║
╚══════════════════════════════════════════════════════════╝
    `);

    if (typeof process.send === "function") process.send("ready");
  });

  // ── Admin server (separate port) ─────────────────────────────────────────────
  const adminServer = adminApp.listen(config.adminPort, () => {
    console.log(`
╔══════════════════════════════════════════════════════════╗
║         🔐 VynorAI Admin Portal Running!                 ║
╠══════════════════════════════════════════════════════════╣
║  Admin UI   → http://localhost:${config.adminPort}                    ║
║  Admin API  → http://localhost:${config.adminPort}/admin/health       ║
╠══════════════════════════════════════════════════════════╣
║  Secured by: ADMIN_SECRET header (X-Admin-Secret)        ║
║  CORS origin: ${String(adminOrigin || "same-origin").padEnd(42)} ║
╚══════════════════════════════════════════════════════════╝
    `);
  });

  // Graceful shutdown — closes both servers cleanly
  // Long agent responses stream for a minute or more; give them time to end.
  const drainMs = parseInt(process.env.SHUTDOWN_DRAIN_MS || "5000", 10);
  const shutdownTimeoutMs = parseInt(
    process.env.SHUTDOWN_TIMEOUT_MS || "60000",
    10,
  );

  const gracefulShutdown = (signal: string) => {
    if (draining) return;
    draining = true;
    console.log(
      `[${signal}] Draining: /ready is 503; closing in ${drainMs}ms, forced exit after ${shutdownTimeoutMs}ms.`,
    );

    let closed = 0;
    const onClose = () => {
      closed++;
      if (closed === 2) {
        console.log("Both servers closed. Exiting safely.");
        process.exit(0);
      }
    };

    // Keep accepting while the load balancer notices the 503, then stop
    // taking new connections and let in-flight requests finish.
    setTimeout(() => {
      server.close(onClose);
      adminServer.close(onClose);
      server.closeIdleConnections?.();
      adminServer.closeIdleConnections?.();
    }, drainMs).unref();

    setTimeout(() => {
      console.error(`Forced process termination after ${shutdownTimeoutMs}ms.`);
      process.exit(1);
    }, shutdownTimeoutMs).unref();
  };

  process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
  process.on("SIGINT", () => gracefulShutdown("SIGINT"));
}

start().catch((err) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});
