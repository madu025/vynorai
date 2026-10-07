import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";

const publicDir = path.resolve(process.cwd(), "public");
const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "vynor-browser-"));
const adminSecret = "browser-smoke-admin-secret";

const app = express();
app.use(express.json());
app.get("/admin", (_req, res) =>
  res.sendFile(path.join(publicDir, "admin.html")),
);
app.get("/api/auth/google/config", (_req, res) => res.json({ enabled: false }));
app.get("/api/auth/turnstile-config", (_req, res) => res.json({ siteKey: "" }));
app.post("/api/auth/forgot-password", (_req, res) =>
  res.json({
    success: true,
    message:
      "If that email belongs to a VynorAI account, a reset link has been sent.",
  }),
);
app.get("/api/payment/plans", (_req, res) =>
  res.json({
    paymentMode: "sandbox",
    checkoutAvailable: false,
    backgroundEnabled: false,
    plans: [
      {
        id: "free",
        name: "Free Trial",
        priceLKR: 0,
        features: ["100,000 credits/month", "300 requests/month"],
        topup: false,
        yearly: false,
      },
      {
        id: "pro",
        name: "Pro",
        priceLKR: 3850,
        features: ["25 million credits/month", "7,500 requests/month"],
        topup: false,
        yearly: false,
      },
    ],
  }),
);
const requireAdmin = (req, res, next) =>
  req.headers["x-admin-secret"] === adminSecret
    ? next()
    : res.status(401).json({ error: "Unauthorized" });
app.get("/admin/health", requireAdmin, (_req, res) =>
  res.json({
    status: "ok",
    activeProviders: ["deepseek"],
    supportedModels: 2,
    circuitBreakers: [],
    payment: { environment: "sandbox", checkoutAvailable: false },
    backgroundEnabled: false,
  }),
);
app.get("/admin/stats", requireAdmin, (_req, res) =>
  res.json({ totalUsers: 25, activeUsers24h: 3 }),
);
app.get("/admin/routing", requireAdmin, (_req, res) =>
  res.json({ prompts: 0, likelyMisrouted: 0, misroutePct: 0, tiers: [] }),
);
app.get("/admin/economics", requireAdmin, (_req, res) =>
  res.json({
    totals: {
      requests: 2,
      credits: 11000,
      costUsd: 0.65,
      deepSeekCostUsd: 0.25,
      providerReportedCostUsd: 0.4,
      publishedRateCostUsd: 0.25,
      deepSeekRequests: 1,
      deepSeekPricedRequests: 1,
      revenueUsd: 1.1,
      marginUsd: 0.45,
      marginPct: 40.9,
      costPerMillionCredits: 59.09,
    },
    payments: {
      netCollectedLkr: 3850,
      successfulOrders: 1,
      pendingOrders: 0,
      failedOrCancelledOrders: 0,
      chargebackLkr: 0,
    },
    paymentDaily: [{ day: "2026-10-06", netCollectedLkr: 3850 }],
    daily: [
      {
        day: "2026-10-06",
        requests: 2,
        credits: 11000,
        costUsd: 0.65,
        deepSeekCostUsd: 0.25,
        revenueUsd: 1.1,
        marginUsd: 0.45,
        marginPct: 40.9,
      },
    ],
    users: [
      {
        userId: "user-1",
        email: "user@example.com",
        planId: "pro",
        requests: 1,
        credits: 5000,
        deepSeekCostUsd: 0.25,
        costUsd: 0.25,
        netCollectedLkr: 3850,
        revenueUsd: 0.5,
        marginUsd: 0.25,
        marginPct: 50,
      },
    ],
    negativeMarginUsers: 0,
    deepSeekPricing: {
      method: "Recorded tokens multiplied by the published tariff",
      verifiedAt: "2026-10-06",
      sourceUrl: "https://api-docs.deepseek.com/quick_start/pricing/",
      note: "Browser smoke fixture",
    },
  }),
);
app.use(express.static(publicDir, { extensions: ["html"] }));

const server = app.listen(0, "127.0.0.1");
await new Promise((resolve) => server.once("listening", resolve));
const port = server.address().port;
const origin = `http://127.0.0.1:${port}`;

function chromePath() {
  const candidates = [
    process.env.CHROME_PATH,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
  ].filter(Boolean);
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) throw new Error("Chrome executable not found; set CHROME_PATH");
  return found;
}

const chrome = spawn(
  chromePath(),
  [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--remote-debugging-port=0",
    `--user-data-dir=${profileDir}`,
    "about:blank",
  ],
  { stdio: "ignore", windowsHide: true },
);

const activePortFile = path.join(profileDir, "DevToolsActivePort");
for (let i = 0; i < 100 && !fs.existsSync(activePortFile); i++)
  await new Promise((resolve) => setTimeout(resolve, 100));
if (!fs.existsSync(activePortFile))
  throw new Error("Chrome DevTools did not start");
const debugPort = fs.readFileSync(activePortFile, "utf8").split(/\r?\n/)[0];
const targets = await (
  await fetch(`http://127.0.0.1:${debugPort}/json/list`)
).json();
const pageTarget = targets.find((target) => target.type === "page");
assert.ok(pageTarget?.webSocketDebuggerUrl, "Chrome page target is available");

const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.addEventListener("open", resolve, { once: true });
  ws.addEventListener("error", reject, { once: true });
});
let commandId = 0;
const pending = new Map();
const browserErrors = [];
ws.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    return message.error
      ? reject(new Error(message.error.message))
      : resolve(message.result);
  }
  if (message.method === "Runtime.exceptionThrown")
    browserErrors.push(message.params.exceptionDetails.text);
});
const cdp = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++commandId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
await cdp("Page.enable");
await cdp("Runtime.enable");

async function evaluate(expression, awaitPromise = false) {
  const result = await cdp("Runtime.evaluate", {
    expression,
    awaitPromise,
    returnByValue: true,
  });
  if (result.exceptionDetails)
    throw new Error(
      result.exceptionDetails.exception?.description ||
        "Browser evaluation failed",
    );
  return result.result.value;
}

async function navigate(pathname) {
  await cdp("Page.navigate", { url: origin + pathname });
  for (let i = 0; i < 100; i++) {
    if ((await evaluate("document.readyState")) === "complete") break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  await new Promise((resolve) => setTimeout(resolve, 250));
}

try {
  await navigate("/");
  const landing = await evaluate(`({
    text: document.body.innerText,
    payment: document.getElementById('paymentAvailability')?.innerText,
    paidDisabled: document.querySelector('#pricingGrid button')?.disabled
  })`);
  assert.match(landing.text, /clear monthly limits/i);
  assert.doesNotMatch(landing.text, /unlimited AI coding power/i);
  assert.match(landing.payment, /temporarily unavailable/i);
  assert.equal(landing.paidDisabled, true);

  await navigate("/login");
  await evaluate(
    `document.getElementById('inp-email').value='browser@example.com'; handleForgot({preventDefault(){}})`,
    true,
  );
  assert.match(
    await evaluate("document.getElementById('alert-success-text').innerText"),
    /If that email belongs/i,
  );

  await navigate(`/login?reset=${"a".repeat(64)}`);
  assert.equal(
    await evaluate("document.getElementById('auth-title').innerText"),
    "Choose a new password",
  );

  await navigate("/support");
  assert.match(await evaluate("document.body.innerText"), /Account & billing/);

  await navigate("/admin");
  await evaluate(
    `document.getElementById('adminSecretInput').value=${JSON.stringify(adminSecret)}; handleAdminLogin()`,
    true,
  );
  await evaluate("showPage('economics')", true);
  for (let i = 0; i < 50; i++) {
    if (
      /Net cash collected/i.test(
        await evaluate("document.getElementById('econCards').innerText"),
      )
    )
      break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const economics = await evaluate(
    "document.getElementById('page-economics').innerText",
  );
  assert.match(economics, /Net cash collected/i);
  assert.match(economics, /LKR 3,850.00/);
  assert.match(economics, /DeepSeek cost/i);
  assert.match(economics, /Official pricing source/);
  assert.deepEqual(browserErrors, []);
  console.log("Browser smoke: 5 pages/flows passed in real headless Chrome");
} finally {
  ws.close();
  chrome.kill();
  await new Promise((resolve) => server.close(resolve));
  try {
    fs.rmSync(profileDir, { recursive: true, force: true, maxRetries: 3 });
  } catch {}
}
