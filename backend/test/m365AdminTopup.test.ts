/**
 * The admin top-up of the Microsoft 365 ledger: it adds credits (and the requests that go with them)
 * to the person's own active rows, never resets usage, and never touches another person, a pooled
 * organisation row or the VS Code monthly quota.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { before, test } from "node:test";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vynor-m365-topup-"));
let dbm: typeof import("../src/db.js");
let ledger: typeof import("../src/services/m365QuotaLedger.js");
let registry: typeof import("../src/services/m365TenantRegistry.js");
let quota: typeof import("../src/services/monthlyQuota.js");
let getPlan: typeof import("../src/config.js").getPlan;
let counter = 0;

before(async () => {
  process.chdir(tmpDir);
  process.env.NODE_ENV = "test";
  dbm = await import("../src/db.js");
  await dbm.initDb();
  ledger = await import("../src/services/m365QuotaLedger.js");
  registry = await import("../src/services/m365TenantRegistry.js");
  quota = await import("../src/services/monthlyQuota.js");
  ({ getPlan } = await import("../src/config.js"));
});

async function newUser() {
  const id = `u-${++counter}-${Math.random().toString(36).slice(2, 8)}`;
  await dbm.dbRun(
    "INSERT INTO users (id, email, password_hash, api_key, api_key_hash) VALUES (?, ?, 'x', ?, ?)",
    [id, `${id}@example.com`, `key-${id}`, `hash-${id}`],
  );
  return id;
}

async function seat(userId: string, objectId: string) {
  const tenantId = `tenant-${++counter}`;
  await registry.upsertM365Tenant({
    tenantId,
    status: "enabled",
    allowedScopes: ["m365.excel.read"],
    planId: null,
    seatLimit: 5,
    subscriptionValidUntil: null,
  });
  const scope = ledger.m365Scope({ tenantId, objectId, userId });
  const plan = { planId: "free", source: "free" as const };
  await ledger.getOrInitM365Usage(scope, plan);
  return { scope, plan };
}

async function exhaust(tenantId: string, objectId: string) {
  await dbm.dbRun(
    "UPDATE m365_tenant_usage SET used_tokens = max_tokens WHERE tenant_id = ? AND object_id = ?",
    [tenantId, objectId],
  );
}

test("a top-up reopens an exhausted seat and keeps the usage", async () => {
  const userId = await newUser();
  const { scope, plan } = await seat(userId, "obj-a");
  await exhaust(scope.tenantId, scope.objectId);
  const before = await ledger.summarizeM365Quota(scope, plan);
  assert.equal(before.usedCredits, before.maxCredits);

  const added = await ledger.addM365Credits(userId, 50_000);
  assert.equal(added.rows, 1);
  assert.ok(added.requests >= 1);

  const after = await ledger.summarizeM365Quota(scope, plan);
  assert.equal(after.maxCredits, before.maxCredits + 50_000);
  assert.equal(after.usedCredits, before.usedCredits);
  assert.equal(
    after.maxRequests,
    before.maxRequests + quota.proportionalRequests(getPlan("free").id, 50_000),
  );
  // The ledger accepts a turn again (the same atomic check a request goes through).
  const reservation = await ledger.reserveM365Quota(scope, plan, 1_000, 1);
  assert.ok(reservation);
});

test("another person, a pooled row and the VS Code quota are untouched", async () => {
  const mine = await newUser();
  const other = await newUser();
  const a = await seat(mine, "obj-mine");
  const b = await seat(other, "obj-other");
  const pooled = await seat(other, "__organization__");
  await quota.getOrInitMonthlyUsage(mine, "free");
  const vsBefore = await dbm.dbGet<any>(
    "SELECT max_tokens, bonus_tokens FROM monthly_usage WHERE user_id = ?",
    [mine],
  );
  const otherBefore = await ledger.summarizeM365Quota(b.scope, b.plan);
  const pooledBefore = await ledger.summarizeM365Quota(
    { tenantId: pooled.scope.tenantId, objectId: "__organization__" },
    pooled.plan,
  );

  await ledger.addM365Credits(mine, 10_000);

  assert.equal(
    (await ledger.summarizeM365Quota(a.scope, a.plan)).maxCredits,
    getPlan("free").monthlyTokens + 10_000,
  );
  assert.deepEqual(
    await ledger.summarizeM365Quota(b.scope, b.plan),
    otherBefore,
  );
  assert.deepEqual(
    await ledger.summarizeM365Quota(
      { tenantId: pooled.scope.tenantId, objectId: "__organization__" },
      pooled.plan,
    ),
    pooledBefore,
  );
  assert.deepEqual(
    await dbm.dbGet<any>(
      "SELECT max_tokens, bonus_tokens FROM monthly_usage WHERE user_id = ?",
      [mine],
    ),
    vsBefore,
  );
});

test("no active cycle changes nothing, and a bad amount is refused", async () => {
  const userId = await newUser();
  assert.deepEqual(await ledger.addM365Credits(userId, 1_000), {
    rows: 0,
    tokens: 0,
    requests: 0,
  });
  await assert.rejects(ledger.addM365Credits(userId, 0));
  await assert.rejects(ledger.addM365Credits(userId, -5));
  await assert.rejects(ledger.addM365Credits(userId, 1.5));
});
