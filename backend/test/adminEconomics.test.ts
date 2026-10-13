import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vynor-economics-"));
const originalCwd = process.cwd();
const adminSecret = "economics-test-admin-secret-32-characters";
let baseUrl = "";
let server: import("node:http").Server;
let dbm: typeof import("../src/db.js");

before(async () => {
  process.chdir(tmpDir);
  process.env.NODE_ENV = "test";
  process.env.ADMIN_SECRET = adminSecret;
  dbm = await import("../src/db.js");
  await dbm.initDb();

  for (const id of ["deepseek-user", "other-user"]) {
    await dbm.dbRun(
      `INSERT INTO users (id, email, password_hash, api_key, api_key_hash)
       VALUES (?, ?, 'x', ?, ?)`,
      [
        id,
        `${id}@example.com`,
        `key-${id}`,
        crypto.createHash("sha256").update(`key-${id}`).digest("hex"),
      ],
    );
  }
  await dbm.dbRun(
    `INSERT INTO request_economics
      (id, request_id, user_id, plan_id, requested_model, resolved_model, provider,
       input_tokens, output_tokens, cached_input_tokens, provider_cost_usd,
       estimated_cost_usd, cost_source, allocated_revenue_usd, gross_margin_usd,
       cache_status, outcome, credits_charged, task_scope)
     VALUES (?, ?, ?, 'pro', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'miss', 'success', ?, 'complex')`,
    [
      "econ-deepseek",
      "request-deepseek",
      "deepseek-user",
      "deepseek/deepseek-flash",
      "deepseek/deepseek-flash",
      "deepseek",
      1000,
      100,
      500,
      null,
      0.25,
      "unknown",
      0.5,
      0.25,
      5000,
    ],
  );
  await dbm.dbRun(
    `INSERT INTO request_economics
      (id, request_id, user_id, plan_id, requested_model, provider,
       input_tokens, output_tokens, provider_cost_usd, cost_source,
       allocated_revenue_usd, cache_status, outcome, request_kind,
       cache_policy, cache_bypass_reason)
     VALUES (?, ?, ?, 'pro', ?, 'deepseek', 120, 30, 0.01, 'provider',
       0.02, 'bypass', 'success', 'task_scope', 'bypass', 'task_scope')`,
    ["econ-scope", "request-scope", "deepseek-user", "deepseek/deepseek-flash"],
  );
  await dbm.dbRun(
    `INSERT INTO request_economics
      (id, request_id, user_id, plan_id, requested_model, resolved_model, provider,
       input_tokens, output_tokens, cached_input_tokens, provider_cost_usd,
       estimated_cost_usd, cost_source, allocated_revenue_usd, gross_margin_usd,
       cache_status, outcome, credits_charged)
     VALUES (?, ?, ?, 'pro', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'miss', 'success', ?)`,
    [
      "econ-other",
      "request-other",
      "other-user",
      "openrouter/model",
      "openrouter/model",
      "openrouter",
      2000,
      200,
      0,
      0.4,
      null,
      "provider",
      0.6,
      0.2,
      6000,
    ],
  );
  await dbm.dbRun(
    `INSERT INTO subscriptions
      (id, user_id, plan_name, status, order_id, payment_id, amount_minor, amount, currency, valid_until)
     VALUES (?, ?, 'pro', 'active', ?, ?, 385000, 3850, 'LKR', ?)`,
    [
      "paid-order",
      "deepseek-user",
      "order-paid",
      "payment-paid",
      new Date(Date.now() + 86_400_000).toISOString(),
    ],
  );

  const express = (await import("express")).default;
  const { adminRouter } = await import("../src/routes/admin.js");
  const app = express();
  app.use(express.json());
  app.use("/admin", adminRouter);
  server = app.listen(0);
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  server?.close();
  if (dbm.db)
    await new Promise<void>((resolve) => dbm.db!.close(() => resolve()));
  process.chdir(originalCwd);
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 3 });
  } catch {}
});

test("economics reports cash and DeepSeek cost by total and user", async () => {
  const response = await fetch(`${baseUrl}/admin/economics?days=30`, {
    headers: { "x-admin-secret": adminSecret },
  });
  assert.equal(response.status, 200);
  const data = (await response.json()) as any;
  assert.equal(data.totals.deepSeekCostUsd, 0.26);
  assert.equal(data.totals.costUsd, 0.66);
  assert.ok(Math.abs(data.totals.providerReportedCostUsd - 0.41) < 1e-9);
  assert.equal(data.totals.publishedRateCostUsd, 0.25);
  assert.equal(data.payments.netCollectedLkr, 3850);
  assert.equal(data.payments.successfulOrders, 1);
  const deepSeekUser = data.users.find(
    (user: any) => user.userId === "deepseek-user",
  );
  assert.equal(deepSeekUser.deepSeekCostUsd, 0.26);
  assert.equal(deepSeekUser.netCollectedLkr, 3850);
  const scope = data.requestKinds.find(
    (row: any) => row.requestKind === "task_scope",
  );
  assert.equal(scope.cachePolicy, "bypass");
  assert.equal(scope.cacheBypassReason, "task_scope");
  assert.equal(scope.requests, 1);
  assert.equal(scope.cacheBypasses, 1);
  const complex = data.taskScopes.find((row: any) => row.scope === "complex");
  assert.equal(complex.requests, 1);
  assert.match(
    data.deepSeekPricing.sourceUrl,
    /^https:\/\/api-docs\.deepseek\.com\//,
  );
});
