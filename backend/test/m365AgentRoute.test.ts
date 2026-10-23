import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { after, before, beforeEach, test } from "node:test";
import jwt from "jsonwebtoken";

const tenantId = "11111111-1111-4111-8111-111111111111";
const objectId = "22222222-2222-4222-8222-222222222222";
const apiClientId = "33333333-3333-4333-8333-333333333333";
const callerClientId = "44444444-4444-4444-8444-444444444444";
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vynor-m365-agent-"));
const originalCwd = process.cwd();
const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", {
  modulusLength: 2048,
});

let dbm: typeof import("../src/db.js");
let analysis: typeof import("../src/services/m365Analysis.js");
let registry: typeof import("../src/services/m365TenantRegistry.js");
let agent: typeof import("../src/services/m365Agent.js");
let appServer: http.Server;
let jwksServer: http.Server;
let baseUrl = "";

function token() {
  return jwt.sign(
    {
      ver: "2.0",
      tid: tenantId,
      oid: objectId,
      scp: "m365.excel.read m365.excel.write",
      azp: callerClientId,
    },
    privateKey,
    {
      algorithm: "RS256",
      keyid: "test-key",
      audience: apiClientId,
      issuer: `https://login.microsoftonline.com/${tenantId}/v2.0`,
      expiresIn: "5m",
    },
  );
}

async function agentPost(body: unknown) {
  const response = await fetch(`${baseUrl}/v1/m365/excel/agent`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token()}`,
      "x-correlation-id": "corr-agent-0001",
    },
    body: JSON.stringify(body),
  });
  return { status: response.status, json: (await response.json()) as any };
}
async function events(eventType: string) {
  return dbm.dbAll(
    "SELECT * FROM security_audit_logs WHERE event_type = ?",
    [eventType],
  );
}

before(async () => {
  process.chdir(tempDir);
  Object.assign(process.env, {
    NODE_ENV: "test",
    DB_DRIVER: "sqlite",
    M365_ENTRA_TENANT_ID: tenantId,
    M365_ENTRA_API_CLIENT_ID: apiClientId,
    M365_ENTRA_ALLOWED_CLIENT_IDS: callerClientId,
  });
  delete process.env.DATABASE_URL;
  delete process.env.M365_ENTRA_MULTI_TENANT;
  delete process.env.M365_ALLOWED_TENANT_IDS;
  delete process.env.M365_ALLOWED_TENANT_ID;
  jwksServer = http.createServer((_req, res) => {
    const jwk = publicKey.export({ format: "jwk" });
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({ keys: [{ ...jwk, kid: "test-key", use: "sig" }] }),
    );
  });
  await new Promise<void>((resolve) =>
    jwksServer.listen(0, "127.0.0.1", resolve),
  );
  process.env.M365_ENTRA_JWKS_URL = `http://127.0.0.1:${(jwksServer.address() as any).port}/keys`;
  dbm = await import("../src/db.js");
  await dbm.initDb();
  registry = await import("../src/services/m365TenantRegistry.js");
  analysis = await import("../src/services/m365Analysis.js");
  agent = await import("../src/services/m365Agent.js");
  const express = (await import("express")).default;
  const { m365Router } = await import("../src/routes/m365.js");
  const app = express();
  app.use(express.json());
  app.use("/v1/m365", m365Router);
  appServer = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => appServer.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${(appServer.address() as any).port}`;
  await dbm.dbRun(
    "INSERT INTO users (id, email, password_hash, api_key, api_key_hash) VALUES (?, ?, 'x', ?, ?)",
    ["user-agent", "agent@example.com", "key-agent", "hash-agent"],
  );
  await dbm.dbRun(
    "INSERT INTO m365_identity_links (tenant_id, object_id, user_id, enabled) VALUES (?, ?, ?, 1)",
    [tenantId, objectId, "user-agent"],
  );
});

beforeEach(async () => {
  agent.resetAgentRateLimitForTests();
  await registry.upsertM365Tenant({
    tenantId,
    status: "enabled",
    allowedScopes: ["m365.excel.read", "m365.excel.write"],
    consentedAt: "2026-10-15T00:00:00.000Z",
  });
});

after(async () => {
  analysis?.setM365AgentRunnerForTests();
  if (appServer)
    await new Promise<void>((resolve) => appServer.close(() => resolve()));
  if (jwksServer)
    await new Promise<void>((resolve) => jwksServer.close(() => resolve()));
  if (dbm?.db)
    await new Promise<void>((resolve) => dbm.db!.close(() => resolve()));
  process.chdir(originalCwd);
  try {
    await fs.promises.rm(tempDir, {
      recursive: true,
      force: true,
      maxRetries: 20,
      retryDelay: 250,
    });
  } catch {
    // A locked temp directory must not fail the run.
  }
});

test("denied and failed agent turns leave audit events with a code and correlation id, never the prompt", async () => {
  const secret = "SECRET-PROMPT-TEXT-98765";
  const messages = [{ role: "user", content: secret }];
  const denied = await agentPost({ messages, language: "en" });
  assert.equal(denied.status, 403);
  const deniedRows = await events("M365_EXCEL_AGENT_DENIED");
  assert.equal(deniedRows.length, 1);
  const deniedDetails = JSON.parse(deniedRows[0].details);
  assert.equal(deniedDetails.code, "AI_CONSENT_REQUIRED");
  assert.equal(deniedDetails.correlationId, "corr-agent-0001");

  analysis.setM365AgentRunnerForTests(async () => {
    throw new analysis.M365AnalysisError(
      "AI_PROVIDER_UNAVAILABLE",
      502,
      "PROVIDER-ECHO-" + secret,
    );
  });
  const logged: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => {
    logged.push(args.map(String).join(" "));
  };
  try {
    const failed = await agentPost({ messages, language: "en", consent: true });
    assert.equal(failed.status, 502);
  } finally {
    console.error = original;
    analysis.setM365AgentRunnerForTests();
  }
  const failedRows = await events("M365_EXCEL_AGENT_FAILED");
  assert.equal(failedRows.length, 1);
  const failedDetails = JSON.parse(failedRows[0].details);
  assert.equal(failedDetails.code, "AI_PROVIDER_UNAVAILABLE");
  assert.equal(failedDetails.correlationId, "corr-agent-0001");
  const everything =
    JSON.stringify(failedRows) + JSON.stringify(deniedRows) + logged.join("\n");
  assert.doesNotMatch(everything, /SECRET-PROMPT|PROVIDER-ECHO/);
  assert.match(logged.join("\n"), /AI_PROVIDER_UNAVAILABLE/);
});

test("an error response from the gateway releases the credit reservation", async () => {
  const quota = await import("../src/services/monthlyQuota.js");
  await quota.getOrInitMonthlyUsage("user-agent", "free");
  const used = () =>
    dbm.dbGet(
      "SELECT used_tokens, used_requests FROM monthly_usage WHERE user_id = ?",
      ["user-agent"],
    );
  const start = await used();
  const reservation = await quota.reserveQuotaAtomic("user-agent", "free", 500);
  assert.ok(reservation);
  assert.equal((await used()).used_tokens, start.used_tokens + 500);
  await assert.rejects(
    analysis.failIfErrorResponse(
      { statusCode: 403, body: { error: { code: "CREDITS_EXHAUSTED" } } },
      reservation!,
    ),
    (error: any) => error.code === "CREDITS_EXHAUSTED" && error.status === 403,
  );
  assert.deepEqual(await used(), start);
  assert.equal(reservation!.settled, true);
  // A success status is left alone for the gateway to settle.
  const kept = await quota.reserveQuotaAtomic("user-agent", "free", 100);
  await analysis.failIfErrorResponse({ statusCode: 200 }, kept!);
  assert.equal(kept!.settled, false);
  await quota.releaseQuotaReservation(kept!);
});
