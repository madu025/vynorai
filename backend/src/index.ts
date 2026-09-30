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

const app = express();

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(cors({ origin: "*" }));
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.resolve(process.cwd(), "public")));

// ─── Routes ───────────────────────────────────────────────────────────────────
app.use("/api/auth",    authRouter);
app.use("/api/payment", paymentRouter);
app.use("/v1",          proxyRouter);
app.use("/v1/memory",   memoryRouter);
app.use("/admin",       adminRouter);

// ─── Public Health Check ──────────────────────────────────────────────────────
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

// ─── Boot ─────────────────────────────────────────────────────────────────────
async function start() {
  await initDb();
  await initCacheTable();
  await initModelRegistry();  // seeds model_registry table (zero-downtime hot reload)

  const activeKeys = Object.entries(config.aiKeys)
    .filter(([k, v]) => k !== "ollama" && v)
    .map(([k]) => k.toUpperCase());

  // Start background health monitor (probes providers every 60s)
  startHealthMonitor(60_000);

  const server = app.listen(config.port, () => {
    console.log(`
╔══════════════════════════════════════════════════════════╗
║         ⚡ VynorAI Cloud API v2.0 Running!               ║
╠══════════════════════════════════════════════════════════╣
║  Dashboard  → http://localhost:${config.port}                     ║
║  AI Gateway → http://localhost:${config.port}/v1                  ║
║  Admin      → http://localhost:${config.port}/admin/health        ║
║  Health     → http://localhost:${config.port}/health              ║
╠══════════════════════════════════════════════════════════╣
║  Env:      ${config.nodeEnv.padEnd(15)} PayHere: ${config.payhere.env.padEnd(12)}  ║
║  Providers: ${(activeKeys.join(", ") || "none – add API keys to .env").padEnd(45)} ║
║  Models:   ${String(Object.keys(MODEL_ALIASES).length).padEnd(3)} aliases via OpenRouter (300+ available)  ║
║  Features: circuit-breaker ✓ cache ✓ quota ✓ agents ✓   ║
╚══════════════════════════════════════════════════════════╝
    `);

    // Signal to process managers (like PM2) that the server is ready to accept connections
    if (typeof process.send === "function") {
      process.send("ready");
    }
  });

  // Graceful shutdown handling for zero-downtime reloads
  const gracefulShutdown = (signal: string) => {
    console.log(`\n[${signal}] Signal received. Commencing graceful shutdown...`);
    server.close(() => {
      console.log("HTTP server closed. Exiting process safely.");
      process.exit(0);
    });

    // Force exit if connections take too long to close
    setTimeout(() => {
      console.error("Forced process termination after 8s timeout.");
      process.exit(1);
    }, 8000).unref();
  };

  process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
  process.on("SIGINT", () => gracefulShutdown("SIGINT"));
}

start().catch((err) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});

