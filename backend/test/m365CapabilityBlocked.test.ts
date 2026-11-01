import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";

// The capability report must say why a run is refused, the same way the ledger refuses it:
// a seat with less than one agent turn of credits left is exhausted, and a read-only tenant is
// not blocked by its missing write scope.
const previousDirectory = process.cwd();
const previousEnv = { ...process.env };
let db: typeof import("../src/db.js");
let registry: typeof import("../src/services/m365TenantRegistry.js");
let ledger: typeof import("../src/services/m365QuotaLedger.js");
let getM365Capabilities: typeof import("../src/services/m365Diagnostics.js").getM365Capabilities;
let minimumAgentTurnCredits: () => number;
const readOnly = {
  tenantId: "tenant-a",
  objectId: "object-a",
  scopes: ["m365.excel.read"],
};
const readWrite = {
  ...readOnly,
  scopes: ["m365.excel.read", "m365.excel.write"],
};
const free = { planId: "free", source: "free" as const };
const tenant = (
  status: "enabled" | "disabled",
  allowedScopes: Array<"m365.excel.read" | "m365.excel.write">,
) =>
  registry.upsertM365Tenant({
    tenantId: "tenant-a",
    status,
    allowedScopes,
    consentedAt: "2026-10-14T00:00:00.000Z",
  });
const scope = () =>
  ledger.m365Scope({
    tenantId: "tenant-a",
    objectId: "object-a",
    userId: "user-a",
  });
const setUsage = async (left: (max: number) => number, usedRequests = 0) => {
  const usage = await ledger.getOrInitM365Usage(scope(), free);
  await db.dbRun(
    "UPDATE m365_tenant_usage SET used_tokens = ?, used_requests = ? WHERE id = ?",
    [usage.max_tokens - left(usage.max_tokens), usedRequests, usage.id],
  );
};

before(async () => {
  process.chdir(fs.mkdtempSync(path.join(os.tmpdir(), "vynor-m365-blocked-")));
  Object.assign(process.env, {
    NODE_ENV: "test",
    M365_ENTRA_TENANT_ID: "tenant-a",
    M365_ENTRA_API_CLIENT_ID: "api-a",
    M365_ENTRA_CLIENT_ID: "client-a",
  });
  delete process.env.M365_ENTRA_MULTI_TENANT;
  delete process.env.M365_ALLOWED_TENANT_IDS;
  delete process.env.M365_ALLOWED_TENANT_ID;
  db = await import("../src/db.js");
  await db.initDb();
  registry = await import("../src/services/m365TenantRegistry.js");
  ledger = await import("../src/services/m365QuotaLedger.js");
  ({ getM365Capabilities } = await import(
    "../src/services/m365Diagnostics.js"
  ));
  ({ minimumAgentTurnCredits } = await import("../src/services/m365Agent.js"));
  await db.dbRun(
    "INSERT INTO users (id, email, password_hash, api_key, api_key_hash) VALUES (?, ?, 'x', ?, ?)",
    ["user-a", "owner@example.com", "key-a", "hash-a"],
  );
  await db.dbRun(
    "INSERT INTO m365_identity_links (tenant_id, object_id, user_id, enabled) VALUES (?, ?, ?, 1)",
    ["tenant-a", "object-a", "user-a"],
  );
});

after(() => {
  process.chdir(previousDirectory);
  process.env = previousEnv;
});

test("a registered but disabled tenant reports tenant_disabled", async () => {
  await tenant("disabled", ["m365.excel.read", "m365.excel.write"]);
  const disabled = await getM365Capabilities(readWrite);
  assert.equal(disabled.blockedReason, "tenant_disabled");
  assert.equal(disabled.excel.canInspect, false);
});

test("a read-only tenant with credits left can read and is not blocked", async () => {
  await tenant("enabled", ["m365.excel.read"]);
  for (const identity of [readOnly, readWrite]) {
    const ready = await getM365Capabilities(identity);
    assert.equal(ready.excel.canInspect, true);
    assert.equal(ready.excel.canApply, false);
    assert.equal(ready.blockedReason, undefined);
  }
});

test("a read-only tenant with no credits reports credits_exhausted, not a scope", async () => {
  await tenant("enabled", ["m365.excel.read"]);
  await setUsage(() => 0);
  for (const identity of [readOnly, readWrite]) {
    const exhausted = await getM365Capabilities(identity);
    assert.equal(exhausted.blockedReason, "credits_exhausted");
    assert.equal(exhausted.excel.canInspect, false);
  }
});

test("credits below one agent turn report credits_exhausted, as the ledger refuses", async () => {
  await tenant("enabled", ["m365.excel.read", "m365.excel.write"]);
  const minimum = minimumAgentTurnCredits();
  assert.ok(minimum > 1);
  await setUsage(() => minimum - 1);
  assert.equal(await ledger.reserveM365Quota(scope(), free, minimum), null);
  const almost = await getM365Capabilities(readWrite);
  assert.equal(almost.blockedReason, "credits_exhausted");
  assert.equal(almost.excel.canInspect, false);
  assert.equal(almost.excel.canApply, false);

  await setUsage(() => minimum);
  const oneTurn = await getM365Capabilities(readWrite);
  assert.equal(oneTurn.blockedReason, undefined);
  assert.equal(oneTurn.excel.canInspect, true);
  assert.equal(oneTurn.excel.canApply, true);
});

test("every request used reports credits_exhausted, as the ledger refuses", async () => {
  await tenant("enabled", ["m365.excel.read", "m365.excel.write"]);
  const { maxRequests } = await ledger.summarizeM365Quota(
    { tenantId: "tenant-a", objectId: "object-a" },
    free,
  );
  await setUsage((max) => max, maxRequests);
  assert.equal(
    await ledger.reserveM365Quota(scope(), free, minimumAgentTurnCredits()),
    null,
  );
  const noRequests = await getM365Capabilities(readWrite);
  assert.equal(noRequests.blockedReason, "credits_exhausted");
  assert.equal(noRequests.excel.canInspect, false);
});
