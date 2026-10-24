import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { after, before, beforeEach, test } from "node:test";
import express from "express";

/**
 * Managed Python sandbox foundation: fail-closed dispatch, approval, ownership, quota,
 * cancellation, expiry and redacted audit. No Python is run anywhere in these tests.
 */

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vynor-m365-sbx-"));
const originalCwd = process.cwd();

let dbm: typeof import("../src/db.js");
let sbx: typeof import("../src/services/m365Sandbox.js");
let routes: typeof import("../src/routes/m365Sandbox.js");

const dispatched: Array<{
  jobId: string;
  script: string;
  rows: unknown[][];
  columns: string[];
}> = [];
const cancelled: string[] = [];
let dispatchShouldFail = false;

const fakeWorker = {
  async dispatch(job: any) {
    if (dispatchShouldFail) throw new Error("worker down secret-detail");
    dispatched.push({
      jobId: job.jobId,
      script: job.script,
      rows: job.rows,
      columns: job.columns,
    });
  },
  async cancel(jobId: string) {
    cancelled.push(jobId);
  },
};

const tenantA = "11111111-1111-4111-8111-111111111111";
const tenantB = "99999999-9999-4999-8999-999999999999";
const alice = {
  tenantId: tenantA,
  objectId: "obj-alice",
  userId: "user-alice",
};

function request(tag = "a", extra: Record<string, unknown> = {}) {
  return {
    contractVersion: "2026-10-24.python-sandbox.v1",
    purpose: `Forecast ${tag}`,
    language: "en",
    script: `result = rows_${tag}`,
    input: {
      columns: ["Month", "Sales"],
      rows: [
        ["Jan", 10],
        ["Feb", 20],
      ],
    },
    network: false,
    timeoutSeconds: 20,
    ...extra,
  };
}

async function approvedSubmit(
  caller = alice,
  body = request("a"),
  now = Date.now(),
) {
  const preview = await sbx.previewSandboxJob(caller, body, now);
  return sbx.submitSandboxJob(
    caller,
    { request: body, approvalToken: preview.approvalToken },
    now,
  );
}

async function rejectCode(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    return (error as any).code;
  }
  return "NO_ERROR";
}

before(async () => {
  process.chdir(tempDir);
  Object.assign(process.env, {
    NODE_ENV: "test",
    JWT_SECRET: "m365-sandbox-test-secret-with-sufficient-length",
  });
  dbm = await import("../src/db.js");
  await dbm.initDb();
  sbx = await import("../src/services/m365Sandbox.js");
  routes = await import("../src/routes/m365Sandbox.js");
});

after(() => {
  process.chdir(originalCwd);
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch {
    // Windows keeps the SQLite file open until the process exits; the OS temp folder is disposable.
  }
});

beforeEach(async () => {
  dispatched.length = 0;
  cancelled.length = 0;
  dispatchShouldFail = false;
  sbx.registerSandboxWorker(null);
  await dbm.dbRun("DELETE FROM m365_sandbox_jobs");
  await dbm.dbRun("DELETE FROM m365_approval_uses");
  await dbm.dbRun("DELETE FROM security_audit_logs");
});

test("the backend limits equal the shared contract", async () => {
  const contract = await import("../../packages/m365-contracts/src/sandbox.ts");
  assert.equal(
    sbx.M365_SANDBOX_CONTRACT_VERSION,
    contract.M365_SANDBOX_CONTRACT_VERSION,
  );
  assert.deepEqual(
    { ...sbx.SANDBOX_LIMITS },
    { ...contract.M365_SANDBOX_LIMITS },
  );
  assert.deepEqual(
    [...sbx.SANDBOX_JOB_STATES],
    [...contract.M365_SANDBOX_JOB_STATES],
  );
  assert.deepEqual(
    [...sbx.SANDBOX_ERROR_CODES],
    [...contract.M365_SANDBOX_ERROR_CODES],
  );
});

test("without an isolated worker preview and submit fail closed and store nothing", async () => {
  assert.equal(sbx.sandboxAvailability().available, false);
  assert.equal(sbx.sandboxAvailability().code, "SANDBOX_UNAVAILABLE");
  assert.match(
    sbx.sandboxAvailability().guidance ?? "",
    /PYTHON_SANDBOX_DEPLOYMENT/,
  );
  assert.equal(
    await rejectCode(sbx.previewSandboxJob(alice, request())),
    "SANDBOX_UNAVAILABLE",
  );
  assert.equal(
    await rejectCode(
      sbx.submitSandboxJob(alice, {
        request: request(),
        approvalToken: "x".repeat(40),
      }),
    ),
    "SANDBOX_UNAVAILABLE",
  );
  const rows = await dbm.dbAll("SELECT job_id FROM m365_sandbox_jobs");
  assert.equal(rows.length, 0);
  assert.equal(
    (await dbm.dbAll("SELECT jti FROM m365_approval_uses")).length,
    0,
  );
});

test("no approval means no dispatch and no job row", async () => {
  sbx.registerSandboxWorker(fakeWorker);
  assert.equal(
    await rejectCode(sbx.submitSandboxJob(alice, { request: request() })),
    "SANDBOX_APPROVAL_REQUIRED",
  );
  assert.equal(dispatched.length, 0);
  assert.equal(
    (await dbm.dbAll("SELECT job_id FROM m365_sandbox_jobs")).length,
    0,
  );
});

test("an approval is bound to its exact input, its user and its single use", async () => {
  sbx.registerSandboxWorker(fakeWorker);
  const preview = await sbx.previewSandboxJob(alice, request("a"));
  // Different input than previewed.
  assert.equal(
    await rejectCode(
      sbx.submitSandboxJob(alice, {
        request: request("b"),
        approvalToken: preview.approvalToken,
      }),
    ),
    "SANDBOX_APPROVAL_INVALID",
  );
  // Another person cannot use it.
  const mallory = { ...alice, objectId: "obj-mallory", userId: "user-mallory" };
  assert.equal(
    await rejectCode(
      sbx.submitSandboxJob(mallory, {
        request: request("a"),
        approvalToken: preview.approvalToken,
      }),
    ),
    "SANDBOX_APPROVAL_INVALID",
  );
  assert.equal(
    await rejectCode(
      sbx.submitSandboxJob(alice, {
        request: request("a"),
        approvalToken: "not-a-real-token-value",
      }),
    ),
    "SANDBOX_APPROVAL_INVALID",
  );
  assert.equal(dispatched.length, 0);
  const job = await sbx.submitSandboxJob(alice, {
    request: request("a"),
    approvalToken: preview.approvalToken,
  });
  assert.equal(job.state, "queued");
  // Replay of the same approval is rejected even after the first job ends.
  await sbx.cancelSandboxJob(alice, job.jobId);
  assert.equal(
    await rejectCode(
      sbx.submitSandboxJob(alice, {
        request: request("a"),
        approvalToken: preview.approvalToken,
      }),
    ),
    "SANDBOX_APPROVAL_INVALID",
  );
  assert.equal(dispatched.length, 1);
});

test("the worker receives masked content and the database stores none of it", async () => {
  sbx.registerSandboxWorker(fakeWorker);
  const body = request("a", {
    purpose: "mail ann@example.com",
    script: "send = 'ann@example.com'",
    input: { columns: ["Email", "Sales"], rows: [["ann@example.com", 5]] },
  });
  const preview = await sbx.previewSandboxJob(alice, body);
  assert.ok(preview.maskedCells >= 1);
  const job = await sbx.submitSandboxJob(alice, {
    request: body,
    approvalToken: preview.approvalToken,
  });
  assert.equal(dispatched.length, 1);
  assert.ok(!JSON.stringify(dispatched[0]).includes("ann@example.com"));
  assert.match(dispatched[0].script, /__PII_EMAIL_1__/);
  const stored = JSON.stringify(
    await dbm.dbAll("SELECT * FROM m365_sandbox_jobs"),
  );
  assert.ok(!stored.includes("ann@example.com"));
  assert.ok(!stored.includes("send ="));
  assert.equal(job.rows, 1);
  assert.equal(job.columns, 2);
  assert.ok(!("script" in job) && !("input" in job));
});

test("oversize, unknown-field, token and network-on payloads are rejected before dispatch", async () => {
  sbx.registerSandboxWorker(fakeWorker);
  const bad: Array<[string, unknown]> = [
    [
      "graph token field",
      { ...request(), graphAccessToken: "eyJ.secret.token" },
    ],
    ["authorization field", { ...request(), authorization: "Bearer abc" }],
    ["workbook handle", { ...request(), workbook: { id: "x" } }],
    ["shell command", { ...request(), command: "ls" }],
    ["network on", { ...request(), network: true }],
    ["wrong contract version", { ...request(), contractVersion: "1999" }],
    [
      "unknown input key",
      { ...request(), input: { columns: ["a"], rows: [], handle: 1 } },
    ],
    [
      "ragged rows",
      { ...request(), input: { columns: ["a", "b"], rows: [[1]] } },
    ],
    [
      "too many columns",
      {
        ...request(),
        input: {
          columns: Array.from({ length: 51 }, (_, i) => `c${i}`),
          rows: [],
        },
      },
    ],
    [
      "too many rows",
      {
        ...request(),
        input: {
          columns: ["a"],
          rows: Array.from({ length: 5001 }, () => [1]),
        },
      },
    ],
    [
      "too many cells",
      {
        ...request(),
        input: {
          columns: Array.from({ length: 50 }, (_, i) => `c${i}`),
          rows: Array.from({ length: 2001 }, () => Array(50).fill(1)),
        },
      },
    ],
    [
      "cell too long",
      { ...request(), input: { columns: ["a"], rows: [["x".repeat(501)]] } },
    ],
    ["script too long", { ...request(), script: "x".repeat(20001) }],
    ["timeout too long", { ...request(), timeoutSeconds: 61 }],
    ["empty script", { ...request(), script: "" }],
  ];
  for (const [label, body] of bad) {
    assert.equal(
      await rejectCode(sbx.previewSandboxJob(alice, body)),
      "SANDBOX_INPUT_INVALID",
      label,
    );
    assert.equal(
      await rejectCode(
        sbx.submitSandboxJob(alice, {
          request: body,
          approvalToken: "x".repeat(40),
        }),
      ),
      "SANDBOX_INPUT_INVALID",
      label,
    );
  }
  // A token inside the submit envelope itself is also refused.
  assert.equal(
    await rejectCode(
      sbx.submitSandboxJob(alice, {
        request: request(),
        approvalToken: "x".repeat(40),
        accessToken: "t",
      }),
    ),
    "SANDBOX_INPUT_INVALID",
  );
  assert.equal(dispatched.length, 0);
  // The error detail names a field path, never a value.
  try {
    await sbx.previewSandboxJob(alice, {
      ...request(),
      graphAccessToken: "eyJ.secret.token",
    });
  } catch (error) {
    assert.ok(!String((error as any).detail).includes("secret"));
  }
});

test("jobs are owned by tenant and user; other tenants see 404", async () => {
  sbx.registerSandboxWorker(fakeWorker);
  const job = await approvedSubmit(alice);
  const sameTenantOtherUser = {
    ...alice,
    objectId: "obj-bob",
    userId: "user-bob",
  };
  const otherTenantSameObject = { ...alice, tenantId: tenantB };
  for (const stranger of [sameTenantOtherUser, otherTenantSameObject]) {
    assert.equal(
      await rejectCode(sbx.getSandboxJob(stranger, job.jobId)),
      "SANDBOX_JOB_NOT_FOUND",
    );
    assert.equal(
      await rejectCode(sbx.cancelSandboxJob(stranger, job.jobId)),
      "SANDBOX_JOB_NOT_FOUND",
    );
  }
  assert.equal((await sbx.getSandboxJob(alice, job.jobId)).state, "queued");
  assert.deepEqual(cancelled, []);
});

test("concurrency limits are enforced per user and per tenant and the metadata is recorded", async () => {
  sbx.registerSandboxWorker(fakeWorker);
  const first = await approvedSubmit(alice, request("one") as any);
  assert.equal(
    await rejectCode(approvedSubmit(alice, request("two") as any)),
    "SANDBOX_CONCURRENCY_LIMIT",
  );
  const row = await dbm.dbGet<any>(
    "SELECT * FROM m365_sandbox_jobs WHERE job_id = ?",
    [first.jobId],
  );
  assert.equal(row.row_count, 2);
  assert.equal(row.column_count, 2);
  assert.equal(row.timeout_seconds, 20);
  assert.equal(row.tenant_id, tenantA);
  assert.equal(row.user_id, "user-alice");
  assert.match(row.input_fingerprint, /^[0-9a-f]{64}$/);
  // Five users in one tenant fill the tenant limit; the sixth is refused.
  for (let n = 0; n < 4; n += 1)
    await approvedSubmit(
      { ...alice, objectId: `obj-${n}`, userId: `user-${n}` },
      request(`t${n}`) as any,
    );
  assert.equal(
    await rejectCode(
      approvedSubmit(
        { ...alice, objectId: "obj-x", userId: "user-x" },
        request("tx") as any,
      ),
    ),
    "SANDBOX_CONCURRENCY_LIMIT",
  );
  // The refused attempts left no active job behind and dispatched nothing extra.
  assert.equal(dispatched.length, 5);
  const active = await dbm.dbAll(
    "SELECT job_id FROM m365_sandbox_jobs WHERE state IN ('queued','running','cancel_requested')",
  );
  assert.equal(active.length, 5);
  // Another tenant is not affected by this tenant's load.
  const other = await approvedSubmit(
    { tenantId: tenantB, objectId: "obj-b", userId: "user-b" },
    request("b") as any,
  );
  assert.equal(other.state, "queued");
});

test("the hourly quota stops a user after the allowed number of jobs", async () => {
  sbx.registerSandboxWorker(fakeWorker);
  const now = Date.now();
  for (let n = 0; n < sbx.SANDBOX_LIMITS.maxJobsPerUserPerHour; n += 1)
    await dbm.dbRun(
      `INSERT INTO m365_sandbox_jobs (job_id, tenant_id, object_id, user_id, state, input_fingerprint, row_count, column_count, timeout_seconds, created_at_ms, updated_at_ms, expires_at_ms)
       VALUES (?, ?, ?, ?, 'succeeded', ?, 1, 1, 10, ?, ?, ?)`,
      [
        `sbx_old${n}`,
        tenantA,
        "obj-alice",
        "user-alice",
        "f".repeat(64),
        now - 1000,
        now - 1000,
        now + 100000,
      ],
    );
  assert.equal(
    await rejectCode(sbx.previewSandboxJob(alice, request(), now)),
    "SANDBOX_QUOTA_EXCEEDED",
  );
  assert.equal(
    await rejectCode(approvedSubmit(alice, request("q") as any, now)),
    "SANDBOX_QUOTA_EXCEEDED",
  );
  assert.equal(dispatched.length, 0);
});

test("cancellation: queued jobs stop at once, running jobs stay cancelled whatever the worker returns", async () => {
  sbx.registerSandboxWorker(fakeWorker);
  const queued = await approvedSubmit(alice, request("c1") as any);
  const done = await sbx.cancelSandboxJob(alice, queued.jobId);
  assert.equal(done.state, "cancelled");
  assert.deepEqual(cancelled, [queued.jobId]);
  assert.equal(
    await rejectCode(sbx.cancelSandboxJob(alice, queued.jobId)),
    "SANDBOX_NOT_CANCELLABLE",
  );

  const running = await approvedSubmit(alice, request("c2") as any);
  assert.equal(await sbx.markSandboxJobRunning(running.jobId), true);
  assert.equal(
    (await sbx.cancelSandboxJob(alice, running.jobId)).state,
    "cancel_requested",
  );
  // A late success from the worker cannot revive the job.
  const final = await sbx.completeSandboxJob(running.jobId, {
    result: { tables: [], metrics: { a: 1 }, notes: [] },
  });
  assert.equal(final, "cancelled");
  const view = await sbx.getSandboxJob(alice, running.jobId);
  assert.equal(view.state, "cancelled");
  assert.equal(view.result, undefined);
});

test("expiry is applied on read and by the sweep, and stored results are cleared", async () => {
  sbx.registerSandboxWorker(fakeWorker);
  const now = Date.now();
  const job = await approvedSubmit(alice, request("e1") as any, now);
  const later = now + sbx.SANDBOX_LIMITS.jobTtlSeconds * 1000 + 1;
  const view = await sbx.getSandboxJob(alice, job.jobId, later);
  assert.equal(view.state, "expired");
  assert.equal(view.errorCode, "SANDBOX_JOB_EXPIRED");
  assert.ok(cancelled.includes(job.jobId));
  // A new job is allowed once the expired one no longer counts as active.
  const second = await approvedSubmit(alice, request("e2") as any, later);
  assert.equal(await sbx.markSandboxJobRunning(second.jobId, later), true);
  await sbx.completeSandboxJob(
    second.jobId,
    { result: { tables: [], metrics: { total: 3 }, notes: ["ok"] } },
    later,
  );
  assert.equal(
    (await sbx.getSandboxJob(alice, second.jobId, later)).result?.metrics.total,
    3,
  );
  const swept = await sbx.sweepSandboxJobs(
    later + sbx.SANDBOX_LIMITS.jobTtlSeconds * 1000 + 5,
  );
  assert.ok(swept.cleared >= 1);
  const row = await dbm.dbGet<any>(
    "SELECT result_json FROM m365_sandbox_jobs WHERE job_id = ?",
    [second.jobId],
  );
  assert.equal(row.result_json, null);
  const purge = await sbx.sweepSandboxJobs(later + 8 * 24 * 3600 * 1000);
  assert.ok(purge.deleted >= 2);
  assert.equal(
    await rejectCode(sbx.getSandboxJob(alice, job.jobId)),
    "SANDBOX_JOB_NOT_FOUND",
  );
});

test("the sweep expires overdue active jobs", async () => {
  sbx.registerSandboxWorker(fakeWorker);
  const now = Date.now();
  const job = await approvedSubmit(alice, request("s1") as any, now);
  const result = await sbx.sweepSandboxJobs(
    now + sbx.SANDBOX_LIMITS.jobTtlSeconds * 1000 + 1,
  );
  assert.equal(result.expired, 1);
  assert.equal(
    (
      await dbm.dbGet<any>(
        "SELECT state FROM m365_sandbox_jobs WHERE job_id = ?",
        [job.jobId],
      )
    ).state,
    "expired",
  );
});

test("worker results must be result-only and bounded", async () => {
  sbx.registerSandboxWorker(fakeWorker);
  const withExtra = await approvedSubmit(alice, request("r1") as any);
  assert.equal(
    await sbx.completeSandboxJob(withExtra.jobId, {
      result: { tables: [], metrics: {}, notes: [], workbookRange: "A1" },
    }),
    "failed",
  );
  assert.equal(
    (await sbx.getSandboxJob(alice, withExtra.jobId)).errorCode,
    "SANDBOX_RUN_FAILED",
  );
  const big = await approvedSubmit(
    { ...alice, objectId: "o2", userId: "u2" },
    request("r2") as any,
  );
  assert.equal(
    await sbx.completeSandboxJob(big.jobId, {
      result: {
        tables: [
          {
            name: "t",
            columns: ["a"],
            rows: Array.from({ length: 1001 }, () => [1]),
          },
        ],
        metrics: {},
        notes: [],
      },
    }),
    "failed",
  );
  const ok = await approvedSubmit(
    { ...alice, objectId: "o3", userId: "u3" },
    request("r3") as any,
  );
  assert.equal(
    await sbx.completeSandboxJob(ok.jobId, {
      result: {
        tables: [
          { name: "Forecast", columns: ["m", "v"], rows: [["Mar", 30]] },
        ],
        metrics: { mape: 0.1 },
        notes: [],
      },
    }),
    "succeeded",
  );
  const view = await sbx.getSandboxJob(
    { ...alice, objectId: "o3", userId: "u3" },
    ok.jobId,
  );
  assert.equal(view.result?.tables[0].rows[0][1], 30);
  // A finished job cannot be overwritten by a second report.
  assert.equal(
    await sbx.completeSandboxJob(ok.jobId, { errorCode: "SANDBOX_RUN_FAILED" }),
    "failed",
  );
  assert.equal(
    (
      await sbx.getSandboxJob(
        { ...alice, objectId: "o3", userId: "u3" },
        ok.jobId,
      )
    ).state,
    "succeeded",
  );
});

test("a worker that refuses the job fails the job closed without leaking its error", async () => {
  sbx.registerSandboxWorker(fakeWorker);
  dispatchShouldFail = true;
  const body = request("d1") as any;
  const preview = await sbx.previewSandboxJob(alice, body);
  try {
    await sbx.submitSandboxJob(alice, {
      request: body,
      approvalToken: preview.approvalToken,
    });
    assert.fail("expected a rejection");
  } catch (error) {
    assert.equal((error as any).code, "SANDBOX_UNAVAILABLE");
    assert.ok(!String((error as any).detail).includes("secret-detail"));
  }
  const row = await dbm.dbGet<any>(
    "SELECT state, error_code FROM m365_sandbox_jobs",
  );
  assert.equal(row.state, "failed");
  assert.equal(row.error_code, "SANDBOX_UNAVAILABLE");
});

test("audit records hold only codes, states and counts", async () => {
  sbx.registerSandboxWorker(fakeWorker);
  const body = request("au", {
    purpose: "secret purpose ann@example.com",
    script: "secret_script = 'ann@example.com'",
    input: { columns: ["SecretHeader"], rows: [["secret-cell-value"]] },
  }) as any;
  const job = await approvedSubmit(alice, body);
  await sbx.cancelSandboxJob(alice, job.jobId);
  await rejectCode(
    sbx.submitSandboxJob(alice, {
      request: body,
      approvalToken: "bad-token-bad-token-bad",
    }),
  );
  const logs = await dbm.dbAll<any>(
    "SELECT * FROM security_audit_logs WHERE event_type LIKE 'M365_SANDBOX_%'",
  );
  assert.ok(logs.length >= 4);
  const flat = JSON.stringify(logs);
  for (const secret of [
    "secret purpose",
    "secret_script",
    "ann@example.com",
    "SecretHeader",
    "secret-cell-value",
    "eyJ",
  ])
    assert.ok(!flat.includes(secret), secret);
  const allowed = new Set([
    "code",
    "state",
    "rows",
    "columns",
    "maskedCells",
    "timeoutSeconds",
  ]);
  for (const log of logs)
    for (const key of Object.keys(JSON.parse(log.details || "{}")))
      assert.ok(allowed.has(key), key);
});

// ─── HTTP routes with a stub identity gate ────────────────────────────────────

function serve(
  auth: express.RequestHandler,
): Promise<{ url: string; close: () => void }> {
  const app = express();
  app.use(express.json({ limit: "10mb" }));
  app.use("/sandbox", routes.createSandboxRouter(auth));
  return new Promise((resolve) => {
    const server = http.createServer(app).listen(0, "127.0.0.1", () => {
      const { port } = server.address() as { port: number };
      resolve({
        url: `http://127.0.0.1:${port}/sandbox`,
        close: () => server.close(),
      });
    });
  });
}

const stubAuth =
  (who: {
    tenantId: string;
    objectId: string;
    userId: string;
  }): express.RequestHandler =>
  (req, _res, next) => {
    (req as any).m365Identity = {
      tenantId: who.tenantId,
      objectId: who.objectId,
      scopes: [],
    };
    (req as any).user = { id: who.userId };
    next();
  };

async function call(url: string, method: string, body?: unknown) {
  const res = await fetch(url, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as any };
}

test("routes fail closed with 503 and the administrator guidance when no worker exists", async () => {
  const app = await serve(stubAuth(alice));
  try {
    const availability = await call(`${app.url}/availability`, "GET");
    assert.equal(availability.json.available, false);
    const preview = await call(`${app.url}/preview`, "POST", {
      request: request(),
    });
    assert.equal(preview.status, 503);
    assert.equal(preview.json.error.code, "SANDBOX_UNAVAILABLE");
    assert.match(preview.json.error.message, /isolated sandbox worker/);
    const submit = await call(`${app.url}/jobs`, "POST", {
      request: request(),
      approvalToken: "x".repeat(40),
    });
    assert.equal(submit.status, 503);
  } finally {
    app.close();
  }
});

test("routes: approval required, ownership 404 and cancellation work end to end", async () => {
  sbx.registerSandboxWorker(fakeWorker);
  const owner = await serve(stubAuth(alice));
  const stranger = await serve(
    stubAuth({
      tenantId: tenantB,
      objectId: alice.objectId,
      userId: alice.userId,
    }),
  );
  try {
    const noApproval = await call(`${owner.url}/jobs`, "POST", {
      request: request(),
    });
    assert.equal(noApproval.status, 400);
    assert.equal(noApproval.json.error.code, "SANDBOX_APPROVAL_REQUIRED");
    assert.equal(dispatched.length, 0);
    const preview = await call(`${owner.url}/preview`, "POST", {
      request: request(),
    });
    assert.equal(preview.status, 200);
    assert.equal(preview.json.network, false);
    const submitted = await call(`${owner.url}/jobs`, "POST", {
      request: request(),
      approvalToken: preview.json.approvalToken,
    });
    assert.equal(submitted.status, 202);
    const id = submitted.json.jobId as string;
    assert.equal((await call(`${stranger.url}/jobs/${id}`, "GET")).status, 404);
    assert.equal(
      (await call(`${stranger.url}/jobs/${id}/cancel`, "POST")).status,
      404,
    );
    assert.equal(
      (await call(`${owner.url}/jobs/not-an-id`, "GET")).status,
      404,
    );
    assert.equal(
      (await call(`${owner.url}/jobs/${id}`, "GET")).json.state,
      "queued",
    );
    const cancel = await call(`${owner.url}/jobs/${id}/cancel`, "POST");
    assert.equal(cancel.json.state, "cancelled");
    assert.equal(
      (await call(`${owner.url}/jobs/${id}/cancel`, "POST")).status,
      409,
    );
    const tooBig = await fetch(`${owner.url}/preview`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": "5000000",
      },
      body: "{}",
    }).catch(() => undefined);
    if (tooBig) assert.ok([413, 400].includes(tooBig.status));
  } finally {
    owner.close();
    stranger.close();
  }
});

test("security review: a running job past its expiry never becomes a result", async () => {
  sbx.registerSandboxWorker(fakeWorker);
  const now = Date.now();
  const job = await approvedSubmit(alice, request("x1") as any, now);
  assert.equal(await sbx.markSandboxJobRunning(job.jobId, now), true);
  const later = now + sbx.SANDBOX_LIMITS.jobTtlSeconds * 1000 + 1;
  const state = await sbx.completeSandboxJob(
    job.jobId,
    { result: { tables: [], metrics: { total: 1 }, notes: [] } },
    later,
  );
  assert.equal(state, "expired");
  const view = await sbx.getSandboxJob(alice, job.jobId, later);
  assert.equal(view.state, "expired");
  assert.equal(view.result, undefined);
  assert.ok(cancelled.includes(job.jobId));
});

test("security review: a stored result is unreadable after expiry even before the sweep", async () => {
  sbx.registerSandboxWorker(fakeWorker);
  const now = Date.now();
  const job = await approvedSubmit(alice, request("x2") as any, now);
  await sbx.markSandboxJobRunning(job.jobId, now);
  await sbx.completeSandboxJob(
    job.jobId,
    { result: { tables: [], metrics: { total: 2 }, notes: [] } },
    now,
  );
  assert.equal(
    (await sbx.getSandboxJob(alice, job.jobId, now)).result?.metrics.total,
    2,
  );
  const later = now + sbx.SANDBOX_LIMITS.jobTtlSeconds * 1000 + 1;
  const view = await sbx.getSandboxJob(alice, job.jobId, later);
  assert.equal(view.result, undefined);
});

test("security review: a chunked body without content-length is still capped", async () => {
  sbx.registerSandboxWorker(fakeWorker);
  const app = await serve(stubAuth(alice));
  try {
    const big = JSON.stringify({
      request: { ...request(), script: "x".repeat(1_500_000) },
    });
    const url = new URL(`${app.url}/preview`);
    const status = await new Promise<number>((resolve, reject) => {
      const req = http.request(
        {
          hostname: url.hostname,
          port: url.port,
          path: url.pathname,
          method: "POST",
          headers: { "content-type": "application/json" },
        },
        (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        },
      );
      req.on("error", reject);
      req.write(big.slice(0, 700_000));
      req.write(big.slice(700_000));
      req.end();
    });
    assert.equal(status, 413);
    assert.equal(dispatched.length, 0);
  } finally {
    app.close();
  }
});

test("security review: the sandbox sweep is scheduled at start-up", () => {
  const index = fs.readFileSync(
    path.join(originalCwd, "src", "index.ts"),
    "utf8",
  );
  assert.match(index, /scheduleSandboxSweep\(\)/);
  assert.equal(typeof sbx.scheduleSandboxSweep, "function");
});

test("security review: tokens and credentials in any field are rejected before dispatch", async () => {
  sbx.registerSandboxWorker(fakeWorker);
  const jwt =
    "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.c2lnbmF0dXJlLXZhbHVl";
  const bad = [
    request("t1", { script: `token = "${jwt}"` }),
    request("t2", { purpose: "use Bearer abcdefghijklmnopqrstuvwxyz0123" }),
    request("t3", {
      input: {
        columns: ["Month", "Sales"],
        rows: [["access_token=abcdef123456", 1]],
      },
    }),
    request("t4", {
      input: {
        columns: ["client_secret: abcdefghijk", "Sales"],
        rows: [["Jan", 1]],
      },
    }),
  ];
  for (const body of bad)
    assert.equal(
      await rejectCode(sbx.previewSandboxJob(alice, body as any)),
      "SANDBOX_INPUT_INVALID",
    );
  assert.equal(dispatched.length, 0);
  // Ordinary text that merely mentions the words is accepted.
  const ok = await sbx.previewSandboxJob(
    alice,
    request("t5", { purpose: "Explain what a bearer is" }) as any,
  );
  assert.equal(ok.requiresApproval, true);
});
