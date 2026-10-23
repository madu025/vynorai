import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { after, before, beforeEach, test } from "node:test";
import jwt from "jsonwebtoken";
import {
  InvalidExcelRangeError,
  createServerExcelPreviewPlan,
} from "../src/services/m365ExcelPlan.js";
import { createExcelPreviewPlan } from "../../extensions/m365/src/excel.js";

/**
 * Adversarial tests for the Microsoft 365 backend: the chart plan builder, the agent route and
 * its quota, rate limit and audit behaviour.
 */

const tenantId = "11111111-1111-4111-8111-111111111111";
const objectId = "22222222-2222-4222-8222-222222222222";
const apiClientId = "33333333-3333-4333-8333-333333333333";
const callerClientId = "44444444-4444-4444-8444-444444444444";
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vynor-m365-hard-"));
const originalCwd = process.cwd();
const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", {
  modulusLength: 2048,
});

let dbm: typeof import("../src/db.js");
let analysis: typeof import("../src/services/m365Analysis.js");
let registry: typeof import("../src/services/m365TenantRegistry.js");
let agent: typeof import("../src/services/m365Agent.js");
let quota: typeof import("../src/services/monthlyQuota.js");
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

async function post(body: unknown, raw = false) {
  const response = await fetch(`${baseUrl}/v1/m365/excel/agent`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token()}`,
      "x-correlation-id": "corr-hard-0001",
    },
    body: raw ? (body as string) : JSON.stringify(body),
  });
  let json: any = null;
  try {
    json = await response.json();
  } catch {
    // A non-JSON error page is allowed for a malformed body.
  }
  return { status: response.status, json };
}
async function events(eventType: string) {
  return dbm.dbAll("SELECT * FROM security_audit_logs WHERE event_type = ?", [
    eventType,
  ]);
}
async function used() {
  return dbm.dbGet(
    "SELECT used_tokens, used_requests FROM monthly_usage WHERE user_id = ?",
    ["user-hard"],
  );
}
function captureConsole() {
  const logged: string[] = [];
  const original = { error: console.error, log: console.log, warn: console.warn };
  const sink = (...args: unknown[]) => {
    logged.push(args.map(String).join(" "));
  };
  console.error = sink;
  console.log = sink;
  console.warn = sink;
  return {
    logged,
    restore() {
      console.error = original.error;
      console.log = original.log;
      console.warn = original.warn;
    },
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
  agent = await import("../src/services/m365Agent.js");
  quota = await import("../src/services/monthlyQuota.js");
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
    ["user-hard", "hard@example.com", "key-hard", "hash-hard"],
  );
  await dbm.dbRun(
    "INSERT INTO m365_identity_links (tenant_id, object_id, user_id, enabled) VALUES (?, ?, ?, 1)",
    [tenantId, objectId, "user-hard"],
  );
  await quota.getOrInitMonthlyUsage("user-hard", "free");
});

beforeEach(async () => {
  agent.resetAgentRateLimitForTests();
  analysis.setM365AgentRunnerForTests();
  await dbm.dbRun("DELETE FROM security_audit_logs");
  await registry.upsertM365Tenant({
    tenantId,
    status: "enabled",
    allowedScopes: ["m365.excel.read", "m365.excel.write"],
    consentedAt: "2026-10-15T00:00:00.000Z",
    aiEnabled: true,
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

// ---------------------------------------------------------------------------------------------
// Chart plan builder fuzz
// ---------------------------------------------------------------------------------------------

const planInput = {
  workbookId: "book",
  worksheetName: "Sheet1",
  address: "Sheet1!A1:F9",
  hasHeaders: true,
  values: [
    ["Month", "Region", "Sales", "Cost", "Notes", "Mixed"],
    ["Jan", "North", 1200, 800, "a", 1],
    ["Feb", "South", 1500, 950, "b", "x"],
    ["Mar", "North", 1800, 1100, "c", 3],
    ["Apr", "East", 1350, 900, "d", 4],
    ["May", "West", 900, 700, "e", 5],
    ["Jun", "East", 1750, 1200, "f", 6],
    ["Jul", "South", 1650, 1000, "g", 7],
    ["Aug", "North", 1100, 750, "h", 8],
  ],
};

const CHART_TYPES = [
  "column",
  "line",
  "bar",
  "pie",
  "stacked-column",
  "stacked-bar",
  "area",
  "combo",
  "histogram",
  "waterfall",
] as const;
const AGGREGATIONS: unknown[] = [
  undefined,
  "sum",
  "count",
  "average",
  "min",
  "max",
  "median",
  null,
  5,
];
const TOP_NS: unknown[] = [undefined, 0, -1, 1, 100, 101, 1.5, "5", NaN, null];
const LOWEST: unknown[] = [undefined, true, false, "true", 1];
const PIVOT_RESULT: unknown[] = [undefined, true, false];
const COLUMNS: Array<[number, number, number[] | undefined]> = [
  [1, 2, undefined],
  [1, 2, [3]],
  [0, 2, undefined],
  [2, 2, undefined],
  [1, 4, undefined],
  [1, 5, undefined],
  [1, 9, undefined],
  [1, 2, [4]],
];

const VALID_AGG = ["sum", "count", "average", "min", "max"];
/** The documented contract, written independently of the implementation. */
function expectedChartOutcome(c: any): "ok" | "INVALID" | "NOT_NUMERIC" {
  const { category, value, chartType, extraValues } = c;
  const extra = extraValues ?? [];
  const inRange = (n: number) => Number.isInteger(n) && n >= 0 && n < 6;
  if (!inRange(category) || !inRange(value)) return "INVALID";
  if (
    category === value &&
    chartType !== "histogram" &&
    chartType !== "waterfall"
  )
    return "INVALID";
  // Sales(2) and Cost(3) are numeric; the others are not (Mixed has text).
  const numeric = (n: number) => n === 2 || n === 3;
  if (!numeric(value)) return "NOT_NUMERIC";
  if (
    extra.length > 0 &&
    (chartType === "histogram" ||
      chartType === "waterfall" ||
      extra.some((n: number) => !inRange(n) || n === category || n === value))
  )
    return "INVALID";
  if (extra.some((n: number) => !numeric(n))) return "NOT_NUMERIC";
  if (c.aggregation !== undefined && !VALID_AGG.includes(c.aggregation))
    return "INVALID";
  if (
    c.topN !== undefined &&
    (!Number.isInteger(c.topN) || c.topN < 1 || c.topN > 100)
  )
    return "INVALID";
  const grouping =
    Boolean(c.pivotResult) ||
    chartType === "histogram" ||
    chartType === "waterfall";
  if (
    grouping &&
    ((c.aggregation !== undefined && c.aggregation !== "sum") ||
      c.topN !== undefined ||
      c.lowest === true)
  )
    return "INVALID";
  if (c.lowest === true && c.topN === undefined) return "INVALID";
  if (c.topN !== undefined && ["line", "area", "combo"].includes(chartType))
    return "INVALID";
  return "ok";
}

function* chartSpecs() {
  for (const chartType of CHART_TYPES)
    for (const [category, value, extraValues] of COLUMNS)
      for (const pivotResult of PIVOT_RESULT)
        for (const aggregation of AGGREGATIONS)
          for (const topN of TOP_NS)
            for (const lowest of LOWEST) {
              const chart: any = { category, value, chartType };
              if (extraValues) chart.extraValues = extraValues;
              if (pivotResult !== undefined) chart.pivotResult = pivotResult;
              if (aggregation !== undefined) chart.aggregation = aggregation;
              if (topN !== undefined) chart.topN = topN;
              if (lowest !== undefined) chart.lowest = lowest;
              yield chart;
            }
}

test("fuzz: the server plan builder only returns a plan or a structured spec error, and matches the contract", () => {
  let accepted = 0;
  let rejected = 0;
  for (const chart of chartSpecs()) {
    const expected = expectedChartOutcome(chart);
    try {
      const plan = createServerExcelPreviewPlan(
        planInput,
        ["chart"],
        500,
        { chart } as any,
      );
      accepted++;
      assert.equal(
        expected,
        "ok",
        `server accepted a spec the contract rejects: ${JSON.stringify(chart)}`,
      );
      const spec = plan.actions[0].spec;
      assert.ok(spec.chartType);
      // A chart that does not group never carries the grouping options.
      if (chart.pivotResult || ["histogram", "waterfall"].includes(chart.chartType)) {
        assert.equal(spec.topN, undefined);
        assert.equal(spec.aggregation, undefined);
      }
      if (spec.lowest) assert.ok(spec.topN >= 1);
    } catch (error) {
      if (error instanceof assert.AssertionError) throw error;
      rejected++;
      assert.ok(
        error instanceof InvalidExcelRangeError,
        `unstructured error ${String(error)} for ${JSON.stringify(chart)}`,
      );
      const want = expected === "NOT_NUMERIC" ? "EXCEL_SPEC_VALUE_NOT_NUMERIC" : "EXCEL_SPEC_INVALID";
      assert.notEqual(
        expected,
        "ok",
        `server rejected a valid spec ${JSON.stringify(chart)}: ${(error as Error).message}`,
      );
      assert.equal(
        (error as InvalidExcelRangeError).code,
        want,
        JSON.stringify(chart),
      );
    }
  }
  assert.ok(accepted > 500 && rejected > 500, `${accepted} / ${rejected}`);
});

test("fuzz: a chart together with a PivotTable keeps the same contract", () => {
  const pivots: any[] = [
    { rows: 1, values: 2 },
    { rows: 1, values: 2, topN: 3, lowest: true },
    { rows: 1, values: 2, aggregation: "count" },
    { rows: 1, values: 4, aggregation: "count" },
    { rows: 1, values: 4 },
    { rows: 1, values: 2, topN: 0 },
    { rows: 1, values: 2, lowest: true },
  ];
  for (const pivot of pivots)
    for (const chartType of ["column", "line", "pie"] as const)
      for (const pivotResult of [undefined, true])
        for (const topN of [undefined, 3, 101]) {
          const chart: any = { category: 1, value: 2, chartType };
          if (pivotResult) chart.pivotResult = true;
          if (topN !== undefined) chart.topN = topN;
          try {
            createServerExcelPreviewPlan(
              planInput,
              ["chart", "pivot-table"],
              500,
              { chart, pivot } as any,
            );
          } catch (error) {
            assert.ok(
              error instanceof InvalidExcelRangeError,
              `${String(error)} ${JSON.stringify({ chart, pivot })}`,
            );
          }
        }
});

test("add-in vs server: every spec the add-in accepts but the server rejects is a documented gap", () => {
  const gaps = new Map<string, string>();
  for (const chart of chartSpecs()) {
    // Only values the route schema lets through can reach the planner.
    if (
      (chart.aggregation !== undefined &&
        !VALID_AGG.includes(chart.aggregation)) ||
      (chart.topN !== undefined &&
        (typeof chart.topN !== "number" || !Number.isInteger(chart.topN) || chart.topN < 1 || chart.topN > 100)) ||
      (chart.lowest !== undefined && typeof chart.lowest !== "boolean")
    )
      continue;
    let local = true;
    try {
      createExcelPreviewPlan(planInput as any, ["chart"], 500, { chart } as any);
    } catch {
      local = false;
    }
    let remote = true;
    try {
      createServerExcelPreviewPlan(planInput, ["chart"], 500, { chart } as any);
    } catch {
      remote = false;
    }
    // The server must never accept what the add-in refuses.
    assert.ok(!(remote && !local), `server accepts, add-in refuses: ${JSON.stringify(chart)}`);
    if (local && !remote) {
      const grouping =
        chart.pivotResult ||
        chart.chartType === "histogram" ||
        chart.chartType === "waterfall";
      const kind =
        chart.lowest === true && chart.topN === undefined
          ? "lowest-without-topN"
          : chart.topN !== undefined &&
              ["line", "area", "combo"].includes(chart.chartType)
            ? "topN-on-time-axis-chart"
            : grouping
              ? "grouping-option-on-non-grouping-chart"
              : "other";
      gaps.set(kind, JSON.stringify(chart));
    }
  }
  // Every known gap is a combination only the preview-card controls or the large-range
  // adapter can produce (the intent parser already avoids them); "other" would be a new bug.
  assert.equal(gaps.has("other"), false, gaps.get("other"));
  console.log(
    "[m365Hardening] add-in/server gaps:",
    JSON.stringify([...gaps.entries()]),
  );
});

// ---------------------------------------------------------------------------------------------
// Agent route
// ---------------------------------------------------------------------------------------------

const okRunner = async () => ({ content: "- ok", tool_calls: [] as any[] });

test("agent route: malformed bodies get a 4xx, never reach the model and leave no secret behind", async () => {
  let calls = 0;
  analysis.setM365AgentRunnerForTests(async () => {
    calls++;
    return okRunner();
  });
  const secret = "SECRET-HARD-PROMPT-424242";
  const user = { role: "user", content: secret };
  const call = (n: number, args = "{}") => ({
    id: `c${n}`,
    type: "function",
    function: { name: "get_workbook", arguments: args },
  });
  const cases: Array<[string, unknown, number]> = [
    ["huge tool arguments", { consent: true, messages: [user, { role: "assistant", content: null, tool_calls: [call(1, "x".repeat(12_001))] }, { role: "tool", tool_call_id: "c1", content: "r" }] }, 422],
    ["101 messages", { consent: true, messages: Array.from({ length: 101 }, () => user) }, 422],
    ["81 messages", { consent: true, messages: Array.from({ length: 81 }, () => user) }, 422],
    ["system role injection", { consent: true, messages: [{ role: "system", content: secret }, user] }, 422],
    ["system role as last", { consent: true, messages: [user, { role: "system", content: secret }] }, 422],
    ["developer role", { consent: true, messages: [{ role: "developer", content: secret }] }, 422],
    ["extra key on message", { consent: true, messages: [{ ...user, name: "x" }] }, 422],
    ["extra key on body", { consent: true, messages: [user], model: "gpt-9" }, 422],
    ["tool result without call", { consent: true, messages: [user, { role: "tool", tool_call_id: "zz", content: "r" }] }, 422],
    ["assistant first", { consent: true, messages: [{ role: "assistant", content: secret }] }, 422],
    ["ends with assistant", { consent: true, messages: [user, { role: "assistant", content: "a" }] }, 422],
    ["unknown tool", { consent: true, messages: [user, { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "rm_rf", arguments: "{}" } }] }, { role: "tool", tool_call_id: "c1", content: "r" }] }, 422],
    ["duplicate call ids", { consent: true, messages: [user, { role: "assistant", content: null, tool_calls: [call(1), call(1)] }, { role: "tool", tool_call_id: "c1", content: "r" }] }, 422],
    ["call without result", { consent: true, messages: [user, { role: "assistant", content: null, tool_calls: [call(1)] }, { role: "user", content: "again" }] }, 422],
    ["too many chars", { consent: true, messages: Array.from({ length: 41 }, (_, i) => ({ role: "tool", tool_call_id: `t${i}`, content: "y".repeat(10) })) }, 422],
    ["empty messages", { consent: true, messages: [] }, 422],
    ["messages not array", { consent: true, messages: secret }, 422],
    ["language not allowed", { consent: true, language: "xx", messages: [user] }, 422],
    ["consent as string", { consent: "true", messages: [user] }, 403],
    ["consent false", { consent: false, messages: [user] }, 403],
    ["no consent", { messages: [user] }, 403],
    ["body is an array", [secret], 403],
  ];
  const cap = captureConsole();
  try {
    for (const [label, body, status] of cases) {
      const response = await post(body);
      assert.equal(response.status, status, label);
      assert.ok(response.json?.error?.code, label);
      assert.doesNotMatch(JSON.stringify(response.json), /SECRET-HARD/, label);
    }
    // Not JSON at all, and a body of the wrong type.
    for (const raw of ["{not json", "", "\u0000", `"${secret}"`, "null", "12"]) {
      const response = await post(raw, true);
      assert.ok(
        response.status >= 400 && response.status < 500,
        `raw ${JSON.stringify(raw)} -> ${response.status}`,
      );
    }
  } finally {
    cap.restore();
  }
  assert.equal(calls, 0, "no malformed request reached the model");
  const rows = JSON.stringify(await dbm.dbAll("SELECT * FROM security_audit_logs"));
  assert.doesNotMatch(rows + cap.logged.join("\n"), /SECRET-HARD/);
  assert.equal((await used()).used_requests >= 0, true);
});

test("agent route: oversized payloads are a 4xx (413/422), not a crash", async () => {
  analysis.setM365AgentRunnerForTests(okRunner);
  const big = { consent: true, messages: [{ role: "user", content: "q".repeat(2_000_000) }] };
  const response = await post(big);
  assert.ok([413, 422].includes(response.status), String(response.status));
});

test("agent route: disabled tenant and a failing tenant lookup", async () => {
  let calls = 0;
  analysis.setM365AgentRunnerForTests(async () => {
    calls++;
    return okRunner();
  });
  const body = { consent: true, messages: [{ role: "user", content: "hi" }] };
  await registry.upsertM365Tenant({
    tenantId,
    status: "enabled",
    allowedScopes: ["m365.excel.read", "m365.excel.write"],
    aiEnabled: false,
  });
  const denied = await post(body);
  assert.equal(denied.status, 403);
  assert.equal(denied.json.error.code, "AI_DISABLED_BY_ADMIN");
  const rows = await events("M365_EXCEL_AGENT_DENIED");
  assert.equal(rows.length, 1);
  assert.equal(JSON.parse(rows[0].details).reason, "ai_disabled_by_admin");
  assert.equal(calls, 0);

  // The route's own lookup throws (database unavailable) after the auth middleware passed:
  // a 500 with a code, no model call, no hang.
  await registry.upsertM365Tenant({
    tenantId,
    status: "enabled",
    allowedScopes: ["m365.excel.read", "m365.excel.write"],
    aiEnabled: true,
  });
  const realGet = dbm.db!.get.bind(dbm.db!) as any;
  let tenantReads = 0;
  (dbm.db as any).get = (sql: string, params: any, cb: any) => {
    if (String(sql).includes("FROM m365_tenants") && ++tenantReads >= 2)
      return cb(new Error("SQLITE_BUSY secret-db-detail"));
    return realGet(sql, params, cb);
  };
  const cap = captureConsole();
  try {
    const failed = await post(body);
    assert.equal(failed.status, 500);
    assert.equal(failed.json.error.code, "M365_TENANT_LOOKUP_FAILED");
    assert.doesNotMatch(JSON.stringify(failed.json), /secret-db-detail/);
  } finally {
    cap.restore();
    (dbm.db as any).get = realGet;
  }
  assert.equal(calls, 0);
});

test("agent route: provider failures map to stable statuses and codes without leaking text", async () => {
  const secret = "LEAK-ME-9988";
  const body = { consent: true, messages: [{ role: "user", content: secret }] };
  const failures: Array<[unknown, number, string]> = [
    [new analysis.M365AnalysisError("CREDITS_EXHAUSTED", 403, secret), 403, "CREDITS_EXHAUSTED"],
    [new analysis.M365AnalysisError("AI_PROVIDER_UNAVAILABLE", 502, secret), 502, "AI_PROVIDER_UNAVAILABLE"],
    [new analysis.M365AnalysisError("AI_ANALYSIS_RATE_LIMITED", 429, secret), 429, "AI_ANALYSIS_RATE_LIMITED"],
    [new Error("upstream timeout " + secret), 500, "AI_AGENT_FAILED"],
    [Object.assign(new Error("ETIMEDOUT " + secret), { code: "ETIMEDOUT" }), 500, "AI_AGENT_FAILED"],
    ["a thrown string " + secret, 500, "AI_AGENT_FAILED"],
    [undefined, 500, "AI_AGENT_FAILED"],
    [null, 500, "AI_AGENT_FAILED"],
  ];
  for (const [thrown, status, code] of failures) {
    agent.resetAgentRateLimitForTests();
    await dbm.dbRun("DELETE FROM security_audit_logs");
    analysis.setM365AgentRunnerForTests(async () => {
      throw thrown;
    });
    const cap = captureConsole();
    let response;
    try {
      response = await post(body);
    } finally {
      cap.restore();
    }
    assert.equal(response.status, status, String(thrown));
    assert.equal(response.json.error.code, code);
    const failed = await events("M365_EXCEL_AGENT_FAILED");
    assert.equal(failed.length, 1);
    assert.doesNotMatch(
      JSON.stringify(failed) + cap.logged.join("\n") + JSON.stringify(response.json),
      /LEAK-ME/,
    );
  }
  // A runner that returns nonsense is cleaned, not crashed on.
  for (const garbage of [
    { content: 5, tool_calls: "nope" },
    { content: null, tool_calls: [null, 3, {}, { function: null }] },
    { content: "x".repeat(50_000), tool_calls: [] },
    {},
  ]) {
    agent.resetAgentRateLimitForTests();
    analysis.setM365AgentRunnerForTests(async () => garbage as any);
    const response = await post(body);
    assert.equal(response.status, 200, JSON.stringify(garbage).slice(0, 60));
    assert.ok(response.json.reply.content.length <= 8000);
    assert.deepEqual(response.json.reply.tool_calls, []);
  }
});

test("agent route: the audit event of a good turn carries counts only", async () => {
  const secret = "AUDIT-SECRET-5150";
  analysis.setM365AgentRunnerForTests(async () => ({
    content: "reply " + secret,
    tool_calls: [
      { id: "a", type: "function", function: { name: "get_workbook", arguments: `{"q":"${secret}"}` } },
    ],
  }));
  const response = await post({ consent: true, messages: [{ role: "user", content: secret }] });
  assert.equal(response.status, 200);
  const rows = await events("M365_EXCEL_AGENT_TURN");
  assert.equal(rows.length, 1);
  assert.doesNotMatch(JSON.stringify(rows), /AUDIT-SECRET/);
  assert.deepEqual(Object.keys(JSON.parse(rows[0].details)).sort(), ["correlationId", "messages", "toolCalls"]);
});

test("agent route: a provider answer with duplicate or colliding tool call ids stays usable on the next turn", async () => {
  analysis.setM365AgentRunnerForTests(async () => ({
    content: "",
    tool_calls: [
      { id: "dup", type: "function", function: { name: "get_workbook", arguments: "{}" } },
      { id: "dup", type: "function", function: { name: "get_details", arguments: "{}" } },
      { type: "function", function: { name: "get_workbook", arguments: "{}" } },
      { id: "call_2", type: "function", function: { name: "get_workbook", arguments: "{}" } },
    ],
  }));
  const first = await post({ consent: true, messages: [{ role: "user", content: "go" }] });
  assert.equal(first.status, 200);
  const calls = first.json.reply.tool_calls;
  assert.equal(new Set(calls.map((c: any) => c.id)).size, calls.length, "ids are unique");
  // The add-in answers every call and asks again: the server must accept its own output.
  const next = await post({
    consent: true,
    messages: [
      { role: "user", content: "go" },
      { role: "assistant", content: null, tool_calls: calls },
      ...calls.map((c: any) => ({ role: "tool", tool_call_id: c.id, content: "r" })),
    ],
  });
  assert.equal(next.status, 200, JSON.stringify(next.json));
});

test("agent: the credit estimate counts tool call arguments, tool definitions and output", async () => {
  const estimates: number[] = [];
  analysis.setM365AgentRunnerForTests(async (_u, _m, _t, estimate) => {
    estimates.push(estimate);
    return okRunner();
  });
  const u: any = { id: "est-user", subscriptionPlan: "pro" };
  const small = [{ role: "user", content: "hi" }];
  await agent.agentTurn(u, { consent: true, messages: small });
  const base = estimates[0];
  const tools = agent.agentToolTokenEstimate();
  const prompt = Math.ceil(
    (agent.AGENT_SYSTEM_PROMPT.length + 2 + 3 + 24) / 4,
  );
  assert.ok(base >= tools + 2500, "tools and the output cap are in the estimate");
  assert.ok(base >= tools + 2500 + prompt - 40, "the system prompt is in the estimate");
  // Twenty big tool calls (the cap is 29): their arguments are sent to the model, so they are paid for.
  const args = "a".repeat(11_000);
  const calls = Array.from({ length: 12 }, (_, i) => ({
    id: `c${i}`,
    type: "function" as const,
    function: { name: "write_formula", arguments: args },
  }));
  agent.resetAgentRateLimitForTests();
  await agent.agentTurn(u, {
    consent: true,
    messages: [
      ...small,
      { role: "assistant", content: null, tool_calls: calls },
      ...calls.map((c) => ({ role: "tool" as const, tool_call_id: c.id, content: "ok" })),
    ],
  });
  const withCalls = estimates[1];
  assert.ok(
    withCalls - base >= Math.floor((12 * 11_000) / 4) - 50,
    `arguments of ${12 * 11_000} chars are missing from the estimate (${withCalls - base} tokens added)`,
  );
});

test("agent: turn limit counts model turns since the latest person request", async () => {
  analysis.setM365AgentRunnerForTests(okRunner);
  const u: any = { id: "turn-user", subscriptionPlan: "pro" };
  const turn = (i: number) => [
    { role: "assistant" as const, content: null, tool_calls: [{ id: `t${i}`, type: "function" as const, function: { name: "get_workbook", arguments: "{}" } }] },
    { role: "tool" as const, tool_call_id: `t${i}`, content: "r" },
  ];
  const history = (n: number) => [
    { role: "user" as const, content: "go" },
    ...Array.from({ length: n }, (_, i) => turn(i)).flat(),
  ];
  await agent.agentTurn(u, { consent: true, messages: history(11) });
  await assert.rejects(
    agent.agentTurn(u, { consent: true, messages: history(12) }),
    (e: any) => e.code === "AGENT_TURN_LIMIT" && e.status === 429,
  );
  // A new request from the person starts a new count.
  await agent.agentTurn(u, {
    consent: true,
    messages: [...history(12), { role: "user", content: "next" }],
  });
});

test("agent: the rate limit sweep keeps active users and drops idle ones", () => {
  const t0 = 1_000_000_000_000;
  // User A uses the whole allowance in the first seconds of the window.
  for (let i = 0; i < 40; i++) agent.assertAgentRateLimit("active", t0 + i * 10);
  assert.throws(() => agent.assertAgentRateLimit("active", t0 + 500), (e: any) => e.status === 429);
  // 6000 other users arrive (the size guard forces sweeps) while A is still inside its window.
  for (let i = 0; i < 6000; i++) agent.assertAgentRateLimit(`bulk-${i}`, t0 + 1000 + i);
  assert.throws(
    () => agent.assertAgentRateLimit("active", t0 + 30_000),
    (e: any) => e.code === "AI_ANALYSIS_RATE_LIMITED",
    "an active user must still be limited after sweeps",
  );
  // Much later every record is idle and the map is emptied by the next call.
  agent.assertAgentRateLimit("late", t0 + 10 * 60_000);
  assert.ok(agent.agentRateLimitSizeForTests() <= 2, String(agent.agentRateLimitSizeForTests()));
  // The limiter is per user and recovers after the window.
  agent.assertAgentRateLimit("active", t0 + 10 * 60_000 + 1);
});

test("agent: a user's sliding window is not reset by the sweep running in the middle of a burst", () => {
  const t0 = 2_000_000_000_000;
  for (let i = 0; i < 39; i++) agent.assertAgentRateLimit("burst", t0 + i);
  // A sweep fires on another user's call once the window elapsed since the last sweep.
  agent.assertAgentRateLimit("other", t0 + 59_999);
  agent.assertAgentRateLimit("burst", t0 + 59_999); // the 40th inside the window
  assert.throws(() => agent.assertAgentRateLimit("burst", t0 + 59_999), (e: any) => e.status === 429);
});

// ---------------------------------------------------------------------------------------------
// Quota reservations through the real gateway runners
// ---------------------------------------------------------------------------------------------

test("quota: an in-process gateway failure releases the reservation exactly once (agent runner)", async () => {
  const before = await used();
  const cap = captureConsole();
  try {
    // No provider key in the test environment: the gateway answers with an error status or throws.
    const outcome = await analysis
      .proxyAgentRunner({ id: "user-hard", subscriptionPlan: "free" } as any, [{ role: "user", content: "hi" }], [], 800, 100)
      .then(() => "ok", (e: any) => e.code);
    assert.notEqual(outcome, "ok");
  } finally {
    cap.restore();
  }
  assert.deepEqual(await used(), before);
});

test("quota: an in-process gateway failure releases the reservation exactly once (analysis runner)", async () => {
  const before = await used();
  const cap = captureConsole();
  let leaked = "";
  try {
    const outcome = await analysis
      .proxyAnalysisRunner({ id: "user-hard", subscriptionPlan: "free" } as any, [{ role: "user", content: "hi" }], 800, 100)
      .then(
        () => "ok",
        (e: any) => {
          leaked = String(e.detail ?? "");
          return e.code;
        },
      );
    assert.notEqual(outcome, "ok");
  } finally {
    cap.restore();
  }
  assert.deepEqual(await used(), before, "credits and requests are back after a failed call");
  assert.equal(leaked, "", "provider error text is not kept in the error detail");
});

test("quota: an error status from the gateway (not a throw) also releases the reservation (analysis runner)", async () => {
  const before = await used();
  const cap = captureConsole();
  try {
    // An empty message list is refused by the gateway with a 4xx response.
    const outcome = await analysis
      .proxyAnalysisRunner({ id: "user-hard", subscriptionPlan: "free" } as any, [], 800, 100)
      .then(() => "ok", (e: any) => `${e.status}`);
    assert.match(outcome, /^(4|5)\d\d$/);
  } finally {
    cap.restore();
  }
  assert.deepEqual(await used(), before);
});

test("agent reply: oversized or odd tool call arguments are cut to what the next request may carry", () => {
  const reply = agent.cleanAgentReply({
    tool_calls: [
      { id: "a", function: { name: "get_workbook", arguments: { big: "x".repeat(20_000) } } },
      { id: "b".repeat(100), function: { name: "get_workbook", arguments: "z".repeat(20_000) } },
      { id: "b".repeat(100), function: { name: "get_workbook" } },
    ],
  });
  assert.equal(reply.tool_calls.length, 3);
  for (const call of reply.tool_calls) {
    assert.ok(call.function.arguments.length <= 12_000);
    assert.ok(call.id.length <= 64);
  }
  assert.equal(new Set(reply.tool_calls.map((c) => c.id)).size, 3);
});

test("quota: release is idempotent and never goes below zero", async () => {
  const start = await used();
  const reservation = await quota.reserveQuotaAtomic("user-hard", "free", 300);
  assert.ok(reservation);
  await analysis
    .failIfErrorResponse({ statusCode: 502 }, reservation!)
    .catch(() => undefined);
  await analysis
    .failIfErrorResponse({ statusCode: 502 }, reservation!)
    .catch(() => undefined);
  await quota.releaseQuotaReservation(reservation!);
  assert.deepEqual(await used(), start);
  // Status codes map to stable error codes.
  for (const [statusCode, status] of [[400, 400], [404, 404], [429, 429], [500, 502], [503, 502], [599, 502]] as const) {
    const r = await quota.reserveQuotaAtomic("user-hard", "free", 50);
    await assert.rejects(
      analysis.failIfErrorResponse({ statusCode, body: { error: { code: "bad code with spaces" } } }, r!),
      (e: any) => e.status === status && e.code === "AI_PROVIDER_UNAVAILABLE",
    );
  }
  assert.deepEqual(await used(), start);
});
