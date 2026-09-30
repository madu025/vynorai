import express from "express";
import cors from "cors";
import path from "path";
import { config, MODEL_ALIASES } from "./config.js";
import { initDb, initModelRegistry } from "./db.js";
import { initCacheTable } from "./services/cacheEngine.js";
import { startHealthMonitor } from "./services/healthMonitor.js";
import { authRouter } from "./routes/auth.js";
import { paymentRouter } from "./routes/payment.js";
import { proxyRouter } from "./routes/proxy.js";
import { adminRouter } from "./routes/admin.js";
import { memoryRouter } from "./routes/memory.js";

import { securityHeadersMiddleware } from "./middleware/security.js";

// ─── Main API App (Port: config.port) ─────────────────────────────────────────
const app = express();

app.use(securityHeadersMiddleware);
app.use(cors({ origin: "*" }));
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.resolve(process.cwd(), "public"), { extensions: ["html"] }));

// Serve login page for clean URLs and VS Code extension OAuth / callback flow
app.get(["/login", "/signin", "/register", "/signup"], (_req, res) => {
  res.sendFile(path.resolve(process.cwd(), "public", "login.html"));
});

// Public health check — no auth required
app.get("/health", (_req, res) => {
  const activeProviders = Object.entries(config.aiKeys)
    .filter(([k, v]) => k !== "ollama" && v)
    .map(([k]) => k);

  res.json({
    status: "ok",
    service: "VynorAI Cloud API",
    version: "2.0.0",
    payhereEnv: config.payhere.env,
    activeProviders: activeProviders.length ? activeProviders : ["ollama (local)"],
    supportedModels: Object.keys(MODEL_ALIASES).length,
    features: ["multi-provider-routing", "circuit-breaker", "l1-l2-cache", "anthropic-prompt-caching", "agentic-tools", "quota-guard"],
    timestamp: new Date().toISOString(),
  });
});

app.use("/api/auth",    authRouter);
app.use("/api/payment", paymentRouter);
app.use("/v1",          proxyRouter);
app.use("/v1/memory",   memoryRouter);

// Customer portal host-check: if request arrives on admin.vynor.lk, serve admin.html directly
app.use((req, res, next) => {
  const host = (req.headers.host || "").toLowerCase();
  if (host.startsWith("admin.") && (req.path === "/" || req.path === "/admin")) {
    return res.sendFile(path.resolve(process.cwd(), "public", "admin.html"));
  }
  next();
});

// Customer portal /admin redirect to dedicated admin portal
app.get("/admin", (_req, res) => {
  res.redirect("https://admin.vynor.lk");
});

// ─── Admin App (Separate Port: config.adminPort) ───────────────────────────────
const adminApp = express();

// Restrict admin CORS to same-origin / configured admin origin only
const adminOrigin = process.env.ADMIN_ORIGIN || false; // false = same-origin only
adminApp.use(securityHeadersMiddleware);
adminApp.use(cors({
  origin: adminOrigin,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
}));
adminApp.use(express.json({ limit: "2mb" }));
adminApp.use(express.urlencoded({ extended: true }));

// Root routes for admin portal (https://admin.vynor.lk/)
adminApp.get("/", (_req, res) => {
  res.sendFile(path.resolve(process.cwd(), "public", "admin.html"));
});

adminApp.get("/admin", (_req, res) => {
  res.sendFile(path.resolve(process.cwd(), "public", "admin.html"));
});

// Serve admin static UI without serving index.html on root
adminApp.use(express.static(path.resolve(process.cwd(), "public"), { index: false }));

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

// ─── Boot ─────────────────────────────────────────────────────────────────────
async function start() {
  await initDb();
  await initCacheTable();
  await initModelRegistry();

  const activeKeys = Object.entries(config.aiKeys)
    .filter(([k, v]) => k !== "ollama" && v)
    .map(([k]) => k.toUpperCase());

  // Start background health monitor (probes providers every 60s)
  startHealthMonitor(60_000);

  // ── Main API server ──────────────────────────────────────────────────────────
  const server = app.listen(config.port, () => {
    console.log(`
╔══════════════════════════════════════════════════════════╗
║         ⚡ VynorAI Cloud API v2.0 Running!               ║
╠══════════════════════════════════════════════════════════╣
║  Dashboard  → http://localhost:${config.port}                     ║
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
  const gracefulShutdown = (signal: string) => {
    console.log(`\n[${signal}] Signal received. Commencing graceful shutdown...`);

    let closed = 0;
    const onClose = () => {
      closed++;
      if (closed === 2) {
        console.log("Both servers closed. Exiting safely.");
        process.exit(0);
      }
    };

    server.close(onClose);
    adminServer.close(onClose);

    setTimeout(() => {
      console.error("Forced process termination after 8s timeout.");
      process.exit(1);
    }, 8000).unref();
  };

  process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
  process.on("SIGINT",  () => gracefulShutdown("SIGINT"));
}

start().catch((err) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});
