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
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vynor-m365-analysis-"));
const originalCwd = process.cwd();
const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", {
  modulusLength: 2048,
});

let dbm: typeof import("../src/db.js");
let analysis: typeof import("../src/services/m365Analysis.js");
let registry: typeof import("../src/services/m365TenantRegistry.js");
let appServer: http.Server;
let jwksServer: http.Server;
let baseUrl = "";
let runnerCalls: Array<Array<{ role: string; content: string }>> = [];
let runnerAnswer = "";

function token(scope = "m365.excel.read m365.excel.write", oid = objectId) {
  return jwt.sign(
    {
      ver: "2.0",
      tid: tenantId,
      oid,
      scp: scope,
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

const column = (over: Record<string, unknown>) => ({
  index: 0,
  name: "Region",
  inferredType: "text",
  roleHint: "category",
  nonBlank: 10,
  blank: 0,
  containsPersonalData: false,
  distinct: 3,
  duplicateValues: 7,
  topShares: [0.5, 0.3, 0.2],
  ...over,
});
function summary(columns?: unknown[]) {
  const cols = columns ?? [
    column({}),
    column({
      index: 1,
      name: "Revenue",
      inferredType: "number",
      roleHint: "measure",
      distinct: 10,
      duplicateValues: 0,
      topShares: undefined,
      numeric: { min: 1, max: 99 },
    }),
    column({
      index: 2,
      name: "Customer ID",
      inferredType: "text",
      roleHint: "identifier",
      distinct: undefined,
      duplicateValues: undefined,
      topShares: undefined,
    }),
  ];
  return {
    contractVersion: "2026-10-15.excel-analysis.v1",
    rowCount: 10,
    columnCount: cols.length,
    headerRowCount: 1,
    blankCells: 0,
    columns: cols,
  };
}
const goodAnswer = {
  summary: "Sales by region with a revenue measure.",
  columns: [
    {
      index: 0,
      name: "ignored",
      inferredType: "text",
      role: "category",
      confidence: 0.9,
      reason: "Few repeated labels.",
    },
    {
      index: 1,
      name: "ignored",
      inferredType: "number",
      role: "measure",
      confidence: 0.95,
      reason: "Numeric with a wide range.",
    },
  ],
  dataQuality: [
    { severity: "info", message: "No blanks found.", confidence: 0.8 },
  ],
  recommendations: [
    {
      kind: "chart",
      title: "Revenue by region",
      columns: [0, 1],
      chartType: "column",
      confidence: 0.85,
      reason: "One category and one measure.",
    },
    {
      kind: "pivot-table",
      title: "Pivot by customer",
      columns: [2, 1],
      confidence: 0.7,
      reason: "Groups revenue.",
    },
  ],
};

async function post(body: unknown, bearer = token()) {
  const response = await fetch(`${baseUrl}/v1/m365/excel/analyze`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${bearer}`,
      "x-correlation-id": "corr-test-0001",
    },
    body: JSON.stringify(body),
  });
  return {
    status: response.status,
    json: (await response.json()) as any,
    headers: response.headers,
  };
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
    ["user-analysis", "owner@example.com", "key-analysis", "hash-analysis"],
  );
  await dbm.dbRun(
    "INSERT INTO m365_identity_links (tenant_id, object_id, user_id, enabled) VALUES (?, ?, ?, 1)",
    [tenantId, objectId, "user-analysis"],
  );
});

beforeEach(async () => {
  runnerCalls = [];
  runnerAnswer = JSON.stringify(goodAnswer);
  analysis.resetAnalysisRateLimitForTests();
  analysis.setM365AnalysisRunnerForTests(async (_user, messages) => {
    runnerCalls.push(messages);
    return runnerAnswer;
  });
  await registry.upsertM365Tenant({
    tenantId,
    status: "enabled",
    allowedScopes: ["m365.excel.read", "m365.excel.write"],
    consentedAt: "2026-10-15T00:00:00.000Z",
  });
});

after(async () => {
  analysis?.setM365AnalysisRunnerForTests();
  appServer?.close();
  jwksServer?.close();
  if (dbm?.db)
    await new Promise<void>((resolve) => dbm.db!.close(() => resolve()));
  process.chdir(originalCwd);
  fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 3 });
});

test("analysis requires explicit consent and never reaches the model without it", async () => {
  for (const consent of [undefined, false, "true", 1]) {
    const { status, json } = await post({ summary: summary(), consent });
    assert.equal(status, 403);
    assert.equal(json.error.code, "AI_CONSENT_REQUIRED");
  }
  assert.equal(runnerCalls.length, 0);
});

test("analysis enforces tenant, scope and identity policy before any model call", async () => {
  await registry.upsertM365Tenant({
    tenantId,
    status: "disabled",
    allowedScopes: ["m365.excel.read"],
  });
  let result = await post({ summary: summary(), consent: true });
  assert.equal(result.status, 403);
  assert.equal(result.json.error.code, "tenant_disabled");

  await registry.upsertM365Tenant({
    tenantId,
    status: "enabled",
    allowedScopes: ["m365.excel.write"],
  });
  result = await post({ summary: summary(), consent: true });
  assert.equal(result.json.error.code, "tenant_scope_disabled");

  await registry.upsertM365Tenant({
    tenantId,
    status: "enabled",
    allowedScopes: ["m365.excel.read", "m365.excel.write"],
  });
  result = await post(
    { summary: summary(), consent: true },
    token("m365.excel.write"),
  );
  assert.equal(result.json.error.code, "insufficient_scope");

  result = await post(
    { summary: summary(), consent: true },
    token(undefined, "99999999-9999-4999-8999-999999999999"),
  );
  assert.equal(result.json.error.code, "M365_IDENTITY_NOT_LINKED");

  result = await post({ summary: summary(), consent: true }, "not-a-token");
  assert.equal(result.status, 401);
  assert.equal(runnerCalls.length, 0);
});

test("successful analysis is advisory, uses local column names and keeps audit metadata-only", async () => {
  const { status, json, headers } = await post({
    summary: summary(),
    consent: true,
  });
  assert.equal(status, 200);
  assert.equal(json.advisoryOnly, true);
  assert.equal(headers.get("x-correlation-id"), "corr-test-0001");
  assert.deepEqual(
    json.result.columns.map((entry: any) => entry.name),
    ["Region", "Revenue"],
  );
  // The pivot over an identifier column is dropped; the chart stays.
  assert.deepEqual(
    json.result.recommendations.map((rec: any) => rec.kind),
    ["chart"],
  );
  assert.equal(runnerCalls.length, 1);
  const sent = JSON.stringify(runnerCalls[0]);
  assert.match(sent, /Revenue/);
  assert.doesNotMatch(sent, /owner@example\.com/);

  const events = await dbm.dbAll<{ event_type: string; details: string }>(
    "SELECT event_type, details FROM security_audit_logs WHERE event_type LIKE 'M365_EXCEL_ANALYSIS_%'",
  );
  const completed = events.find(
    (event) => event.event_type === "M365_EXCEL_ANALYSIS_COMPLETED",
  );
  assert.ok(completed);
  const details = JSON.parse(completed!.details);
  assert.equal(details.correlationId, "corr-test-0001");
  assert.equal(details.droppedRecommendations, 1);
  assert.doesNotMatch(completed!.details, /Revenue|Region|Customer/);
});

test("model output that is not the strict contract fails closed", async () => {
  const bad: Array<[string, string]> = [
    ["prose", "Sure! Here is the analysis you asked for."],
    ["truncated", '{"summary": "x", "columns": ['],
    ["extra key", JSON.stringify({ ...goodAnswer, operations: ["delete"] })],
    [
      "workbook operation kind",
      JSON.stringify({
        ...goodAnswer,
        recommendations: [
          {
            kind: "delete-rows",
            title: "x",
            columns: [],
            confidence: 1,
            reason: "y",
          },
        ],
      }),
    ],
    [
      "unknown column",
      JSON.stringify({
        ...goodAnswer,
        recommendations: [
          {
            kind: "filter",
            title: "x",
            columns: [42],
            confidence: 1,
            reason: "y",
          },
        ],
      }),
    ],
    [
      "confidence out of range",
      JSON.stringify({
        ...goodAnswer,
        columns: [{ ...goodAnswer.columns[0], confidence: 4 }],
      }),
    ],
  ];
  for (const [label, answer] of bad) {
    runnerAnswer = answer;
    analysis.resetAnalysisRateLimitForTests();
    const { status, json } = await post({ summary: summary(), consent: true });
    assert.equal(status, 502, label);
    assert.equal(json.error.code, "AI_ANALYSIS_INVALID", label);
  }
  runnerAnswer = "```json\n" + JSON.stringify(goodAnswer) + "\n```";
  assert.equal((await post({ summary: summary(), consent: true })).status, 200);
});

test("summaries that expose values of identifier or personal-data columns are refused", async () => {
  const leaking = summary([
    column({
      name: "Customer ID",
      roleHint: "identifier",
      numeric: { min: 1000, max: 9999 },
    }),
  ]);
  const refused = await post({ summary: leaking, consent: true });
  assert.equal(refused.status, 422);
  assert.equal(refused.json.error.code, "AI_SUMMARY_NOT_PRIVATE");

  const withValues = summary([column({ rows: [["a", "b"]] })]);
  const extra = await post({ summary: withValues, consent: true });
  assert.equal(extra.status, 422);
  assert.equal(extra.json.error.code, "AI_SUMMARY_INVALID");
  assert.equal(runnerCalls.length, 0);
});

test("personal data in a header is masked by the shared PII shield before the model", async () => {
  const sentSummary = summary([
    column({ name: "owner@example.com" }),
    column({
      index: 1,
      name: "Revenue",
      inferredType: "number",
      roleHint: "measure",
      distinct: 10,
      duplicateValues: 0,
      topShares: undefined,
      numeric: { min: 1, max: 9 },
    }),
  ]);
  runnerAnswer = JSON.stringify({ ...goodAnswer, recommendations: [] });
  const { status } = await post({ summary: sentSummary, consent: true });
  assert.equal(status, 200);
  assert.doesNotMatch(JSON.stringify(runnerCalls[0]), /owner@example\.com/);
  assert.match(JSON.stringify(runnerCalls[0]), /__PII_EMAIL_1__/);
});

test("analysis is rate limited per user", async () => {
  for (let index = 0; index < 6; index += 1)
    assert.equal(
      (await post({ summary: summary(), consent: true })).status,
      200,
    );
  const limited = await post({ summary: summary(), consent: true });
  assert.equal(limited.status, 429);
  assert.equal(limited.json.error.code, "AI_ANALYSIS_RATE_LIMITED");
});

test("the production runner refuses before any provider call when credits are exhausted", async () => {
  const quota = await import("../src/services/monthlyQuota.js");
  const usage = await quota.getOrInitMonthlyUsage("user-analysis", "free");
  await dbm.dbRun(
    "UPDATE monthly_usage SET used_tokens = max_tokens WHERE user_id = ?",
    ["user-analysis"],
  );
  await assert.rejects(
    () =>
      analysis.proxyAnalysisRunner(
        {
          id: "user-analysis",
          email: "owner@example.com",
          hasActiveSubscription: false,
          subscriptionPlan: "free",
        },
        [{ role: "user", content: "x" }],
        1000,
      ),
    (error: any) => error.code === "CREDITS_EXHAUSTED" && error.status === 403,
  );
  assert.ok(usage);
});

test("a Sinhala request and language reach the model as data and the call succeeds", async () => {
  const { status, json } = await post({
    summary: summary(),
    language: "si",
    request: "කලාප අනුව විකුණුම් වල සාරාංශයක් සාදන්න",
    consent: true,
  });
  assert.equal(status, 200, JSON.stringify(json));
  const system = String(runnerCalls[0][0].content);
  assert.match(system, /Sinhala/);
  assert.match(system, /කලාප අනුව/);
});
