/**
 * The Microsoft 365 tenant subscription and the personal (VS Code) subscription are billed on
 * separate ledgers. M365 credits live in m365_tenant_usage / m365_quota_reservations keyed by tenant
 * and Entra object id; VS Code keeps subscriptions, monthly_usage and quota_reservations. These tests
 * prove neither side can read, write or refund the other's rows.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { before, test } from "node:test";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vynor-m365-quota-"));
let dbm: typeof import("../src/db.js");
let quota: typeof import("../src/services/monthlyQuota.js");
let ledger: typeof import("../src/services/m365QuotaLedger.js");
let registry: typeof import("../src/services/m365TenantRegistry.js");
let entitlements: typeof import("../src/services/m365Entitlements.js");
let analysis: typeof import("../src/services/m365Analysis.js");
let diagnostics: typeof import("../src/services/m365Diagnostics.js");
let getPlan: typeof import("../src/config.js").getPlan;

const DAY = 86_400_000;
let counter = 0;

before(async () => {
  process.chdir(tmpDir);
  process.env.NODE_ENV = "test";
  dbm = await import("../src/db.js");
  await dbm.initDb();
  quota = await import("../src/services/monthlyQuota.js");
  ledger = await import("../src/services/m365QuotaLedger.js");
  registry = await import("../src/services/m365TenantRegistry.js");
  entitlements = await import("../src/services/m365Entitlements.js");
  analysis = await import("../src/services/m365Analysis.js");
  diagnostics = await import("../src/services/m365Diagnostics.js");
  ({ getPlan } = await import("../src/config.js"));
});

/** A real user (so every foreign key holds) with an optional personal subscription. */
async function newUser(plan: string) {
  const id = `u-${++counter}-${Math.random().toString(36).slice(2, 8)}`;
  await dbm.dbRun(
    "INSERT INTO users (id, email, password_hash, api_key, api_key_hash) VALUES (?, ?, 'x', ?, ?)",
    [id, `${id}@example.com`, `key-${id}`, `hash-${id}`],
  );
  if (plan !== "free")
    await dbm.dbRun(
      `INSERT INTO subscriptions (id, user_id, plan_name, status, order_id, payment_id, amount, currency, valid_until)
       VALUES (?, ?, ?, 'active', ?, 'T', 0, 'LKR', ?)`,
      [
        `s-${id}`,
        id,
        plan,
        `o-${id}`,
        new Date(Date.now() + 30 * DAY).toISOString(),
      ],
    );
  await quota.getOrInitMonthlyUsage(id, plan);
  return id;
}

async function newTenant(options: {
  planId?: string | null;
  seatLimit?: number;
  validUntil?: string | null;
}) {
  const tenantId = `tenant-${++counter}-${Math.random().toString(36).slice(2, 8)}`;
  await registry.upsertM365Tenant({
    tenantId,
    status: "enabled",
    allowedScopes: ["m365.excel.read", "m365.excel.write"],
    planId: options.planId ?? null,
    seatLimit: options.seatLimit ?? 5,
    subscriptionValidUntil: options.validUntil ?? null,
  });
  return tenantId;
}

async function link(tenantId: string, objectId: string, userId: string) {
  await dbm.dbRun(
    "INSERT INTO m365_identity_links (tenant_id, object_id, user_id, enabled) VALUES (?, ?, ?, 1)",
    [tenantId, objectId, userId],
  );
}

/** The user object the M365 route builds: tenant-selected plan, billed to the tenant seat. */
async function m365User(userId: string, tenantId: string, objectId: string) {
  const entitlement = await entitlements.resolveM365Entitlement(
    tenantId,
    objectId,
  );
  return {
    id: userId,
    email: `${userId}@example.com`,
    hasActiveSubscription: false,
    subscriptionPlan: entitlement.planId,
    m365Quota: { tenantId, objectId, planSource: entitlement.source },
  };
}

const personalRows = async (userId: string) =>
  JSON.stringify({
    subscriptions: await dbm.dbAll(
      "SELECT * FROM subscriptions WHERE user_id = ? ORDER BY id",
      [userId],
    ),
    usage: await dbm.dbAll(
      "SELECT * FROM monthly_usage WHERE user_id = ? ORDER BY period_start",
      [userId],
    ),
    holds: await dbm.dbAll(
      "SELECT * FROM quota_reservations WHERE user_id = ? ORDER BY id",
      [userId],
    ),
  });
const tenantRows = async (tenantId: string) =>
  JSON.stringify({
    usage: await dbm.dbAll(
      "SELECT * FROM m365_tenant_usage WHERE tenant_id = ? ORDER BY object_id",
      [tenantId],
    ),
    holds: await dbm.dbAll(
      "SELECT * FROM m365_quota_reservations WHERE tenant_id = ? ORDER BY id",
      [tenantId],
    ),
  });
const seatUsage = (tenantId: string, objectId: string) =>
  dbm.dbGet<any>(
    "SELECT * FROM m365_tenant_usage WHERE tenant_id = ? AND object_id = ?",
    [tenantId, objectId],
  );
const personalUsage = (userId: string) =>
  dbm.dbGet<any>("SELECT * FROM monthly_usage WHERE user_id = ?", [userId]);

test("1. VS Code Pro and M365 Starter use their own plan limits and independent ledgers", async () => {
  const userId = await newUser("pro");
  const tenantId = await newTenant({
    planId: "starter",
    validUntil: "2099-01-01T00:00:00.000Z",
  });
  await link(tenantId, "obj-1", userId);

  const personal = await quota.reserveQuotaAtomic(userId, "pro", 2_000);
  assert.ok(personal);
  const user = await m365User(userId, tenantId, "obj-1");
  assert.equal(user.subscriptionPlan, "starter");
  const tenantHold = await analysis.reserveM365ForUser(user, 5_000);
  assert.ok(tenantHold);

  const vs = await personalUsage(userId);
  const m365 = await seatUsage(tenantId, "obj-1");
  assert.equal(vs.plan_name, "pro");
  assert.equal(vs.max_tokens, getPlan("pro").monthlyTokens);
  assert.equal(vs.used_tokens, 2_000);
  assert.equal(m365.plan_name, "starter");
  assert.equal(m365.plan_source, "tenant");
  assert.equal(m365.max_tokens, getPlan("starter").monthlyTokens);
  assert.equal(m365.used_tokens, 5_000);
  assert.equal(m365.user_id, userId);

  await quota.settleQuotaReservation(personal!, 1_500);
  assert.equal((await personalUsage(userId)).used_tokens, 1_500);
  assert.equal((await seatUsage(tenantId, "obj-1")).used_tokens, 5_000);
  await quota.settleQuotaReservation(tenantHold!, 4_000);
  assert.equal((await seatUsage(tenantId, "obj-1")).used_tokens, 4_000);
  assert.equal((await personalUsage(userId)).used_tokens, 1_500);
});

test("2. VS Code Free and M365 Pro: VS Code stays Free, M365 uses Pro tenant limits", async () => {
  const userId = await newUser("free");
  const tenantId = await newTenant({
    planId: "pro",
    validUntil: "2099-01-01T00:00:00.000Z",
  });
  await link(tenantId, "obj-2", userId);
  const hold = await analysis.reserveM365ForUser(
    await m365User(userId, tenantId, "obj-2"),
    3_000,
  );
  assert.ok(hold);
  assert.equal(
    (await seatUsage(tenantId, "obj-2")).max_tokens,
    getPlan("pro").monthlyTokens,
  );
  const vs = await personalUsage(userId);
  assert.equal(vs.plan_name, "free");
  assert.equal(vs.max_tokens, getPlan("free").monthlyTokens);
  assert.equal(vs.used_tokens, 0);
  assert.equal(
    await dbm.dbGet("SELECT id FROM subscriptions WHERE user_id = ?", [userId]),
    undefined,
  );
});

test("3. an M365 request never changes subscriptions or the user's monthly_usage", async () => {
  const userId = await newUser("starter");
  const tenantId = await newTenant({
    planId: "pro",
    validUntil: "2099-01-01T00:00:00.000Z",
  });
  await link(tenantId, "obj-3", userId);
  const before = await personalRows(userId);
  const user = await m365User(userId, tenantId, "obj-3");

  const a = await analysis.reserveM365ForUser(user, 4_000);
  assert.ok(await quota.topUpReservation(a!, 1_000));
  await quota.settleQuotaReservation(a!, 2_500);
  const b = await analysis.reserveM365ForUser(user, 4_000);
  await quota.releaseQuotaReservation(b!);
  const c = await analysis.reserveM365ForUser(user, 4_000);
  await quota.settleQuotaReservation(c!, 0);
  await quota.reconcileStaleReservations(new Date(Date.now() + 2 * DAY));

  assert.equal(await personalRows(userId), before);
  const row = await seatUsage(tenantId, "obj-3");
  assert.equal(row.used_tokens, 2_500);
  assert.equal(row.used_requests, 1);
});

test("4. a VS Code request never changes the M365 usage ledger", async () => {
  const userId = await newUser("pro");
  const tenantId = await newTenant({
    planId: "starter",
    validUntil: "2099-01-01T00:00:00.000Z",
  });
  await link(tenantId, "obj-4", userId);
  const held = await analysis.reserveM365ForUser(
    await m365User(userId, tenantId, "obj-4"),
    1_000,
  );
  assert.ok(held);
  const before = await tenantRows(tenantId);

  const hold = await quota.reserveQuotaAtomic(userId, "pro", 7_000);
  assert.ok(await quota.topUpReservation(hold!, 500));
  await quota.settleQuotaReservation(hold!, 6_000);
  const failed = await quota.reserveQuotaAtomic(userId, "pro", 3_000);
  await quota.releaseQuotaReservation(failed!);
  await quota.reconcileStaleReservations();

  assert.equal(await tenantRows(tenantId), before);
  assert.equal((await personalUsage(userId)).used_tokens, 6_000);
});

test("5. an expired or missing tenant plan falls back safely, and only the M365 row follows", async () => {
  const userId = await newUser("starter");
  const tenantId = await newTenant({
    planId: "pro",
    validUntil: new Date(Date.now() + 5 * DAY).toISOString(),
  });
  await link(tenantId, "obj-5", userId);
  const active = await m365User(userId, tenantId, "obj-5");
  assert.equal(active.subscriptionPlan, "pro");
  await analysis.reserveM365ForUser(active, 1_000);
  assert.equal((await seatUsage(tenantId, "obj-5")).plan_name, "pro");

  // The tenant subscription expires: M365 falls back to the user's own plan for limits (read only).
  await dbm.dbRun(
    "UPDATE m365_tenants SET subscription_valid_until = ? WHERE tenant_id = ?",
    [new Date(Date.now() - DAY).toISOString(), tenantId],
  );
  const personalBefore = await personalRows(userId);
  const expired = await m365User(userId, tenantId, "obj-5");
  assert.equal(expired.m365Quota.planSource, "user");
  assert.equal(expired.subscriptionPlan, "starter");
  await analysis.reserveM365ForUser(expired, 1_000);
  const row = await seatUsage(tenantId, "obj-5");
  assert.equal(row.plan_name, "starter");
  assert.equal(row.plan_source, "user");
  assert.equal(row.max_tokens, getPlan("starter").monthlyTokens);
  assert.equal(await personalRows(userId), personalBefore);

  // Without any subscription it falls back to Free.
  const lonely = await newUser("free");
  await link(tenantId, "obj-5b", lonely);
  const free = await m365User(lonely, tenantId, "obj-5b");
  assert.equal(free.subscriptionPlan, "free");
  assert.equal(free.m365Quota.planSource, "free");
});

test("6. tenant seat limits still work and never touch personal quota", async () => {
  const first = await newUser("pro");
  const second = await newUser("pro");
  const tenantId = await newTenant({
    planId: "pro",
    seatLimit: 1,
    validUntil: "2099-01-01T00:00:00.000Z",
  });
  const before = await personalRows(first);
  await entitlements.assertM365SeatAvailable(tenantId, "obj-6a");
  await link(tenantId, "obj-6a", first);
  await entitlements.assertM365SeatAvailable(tenantId, "obj-6a");
  await assert.rejects(
    () => entitlements.assertM365SeatAvailable(tenantId, "obj-6b"),
    /m365_seat_limit_reached/,
  );
  assert.ok(second);
  assert.equal(await personalRows(first), before);
});

test("7. concurrent M365 reservations are atomic and never exceed the plan", async () => {
  const userId = await newUser("free");
  const tenantId = await newTenant({
    planId: "free",
    validUntil: "2099-01-01T00:00:00.000Z",
  });
  await link(tenantId, "obj-7", userId);
  const user = await m365User(userId, tenantId, "obj-7");
  const results = await Promise.all(
    Array.from({ length: 12 }, () => analysis.reserveM365ForUser(user, 40_000)),
  );
  const granted = results.filter(Boolean);
  const row = await seatUsage(tenantId, "obj-7");
  assert.ok(granted.length >= 2 && granted.length < 12);
  assert.ok(row.used_tokens <= row.max_tokens, "never above the allowance");
  assert.equal(
    row.used_tokens,
    granted.reduce((sum, hold) => sum + hold!.reservedTokens, 0),
  );
  assert.equal(row.used_requests, granted.length);
  const holds = await dbm.dbAll(
    "SELECT id FROM m365_quota_reservations WHERE tenant_id = ?",
    [tenantId],
  );
  assert.equal(holds.length, granted.length);
  assert.equal((await personalUsage(userId)).used_tokens, 0);
});

test("8. a provider failure releases only the M365 reservation", async () => {
  const userId = await newUser("pro");
  const tenantId = await newTenant({
    planId: "starter",
    validUntil: "2099-01-01T00:00:00.000Z",
  });
  await link(tenantId, "obj-8", userId);
  const personal = await quota.reserveQuotaAtomic(userId, "pro", 9_000);
  const hold = await analysis.reserveM365ForUser(
    await m365User(userId, tenantId, "obj-8"),
    6_000,
  );
  assert.equal((await personalUsage(userId)).used_tokens, 9_000);
  assert.equal((await seatUsage(tenantId, "obj-8")).used_tokens, 6_000);

  await assert.rejects(
    analysis.failIfErrorResponse(
      { statusCode: 502, body: { error: { code: "PROVIDER" } } },
      hold!,
    ),
  );
  assert.equal(hold!.settled, true);
  const seat = await seatUsage(tenantId, "obj-8");
  assert.equal(seat.used_tokens, 0);
  assert.equal(seat.used_requests, 0);
  assert.equal(
    (
      await dbm.dbAll(
        "SELECT id FROM m365_quota_reservations WHERE tenant_id = ?",
        [tenantId],
      )
    ).length,
    0,
  );
  // The personal hold and its row are untouched.
  assert.equal((await personalUsage(userId)).used_tokens, 9_000);
  assert.equal(
    (
      await dbm.dbAll("SELECT id FROM quota_reservations WHERE user_id = ?", [
        userId,
      ])
    ).length,
    1,
  );
  await quota.releaseQuotaReservation(personal!);
  assert.equal((await personalUsage(userId)).used_tokens, 0);
});

test("9. stale-reservation recovery restores only the scope that holds the credits", async () => {
  const userId = await newUser("pro");
  const tenantId = await newTenant({
    planId: "starter",
    validUntil: "2099-01-01T00:00:00.000Z",
  });
  await link(tenantId, "obj-9", userId);
  await quota.reserveQuotaAtomic(userId, "pro", 8_000);
  const tenantHold = await analysis.reserveM365ForUser(
    await m365User(userId, tenantId, "obj-9"),
    5_000,
  );
  // Only the M365 hold is old; the personal hold is fresh and must stay.
  await dbm.dbRun(
    "UPDATE m365_quota_reservations SET created_at = ? WHERE id = ?",
    [new Date(Date.now() - 2 * 60 * 60_000).toISOString(), tenantHold!.id],
  );
  const released = await quota.reconcileStaleReservations();
  assert.equal(released, 1);
  assert.equal((await seatUsage(tenantId, "obj-9")).used_tokens, 0);
  assert.equal((await seatUsage(tenantId, "obj-9")).used_requests, 0);
  assert.equal((await personalUsage(userId)).used_tokens, 8_000);
  assert.equal(
    (
      await dbm.dbAll("SELECT id FROM quota_reservations WHERE user_id = ?", [
        userId,
      ])
    ).length,
    1,
  );
  // Now only the personal hold is old.
  await dbm.dbRun(
    "UPDATE quota_reservations SET created_at = ? WHERE user_id = ?",
    [new Date(Date.now() - 2 * 60 * 60_000).toISOString(), userId],
  );
  const other = await analysis.reserveM365ForUser(
    await m365User(userId, tenantId, "obj-9"),
    2_000,
  );
  assert.ok(other);
  await quota.reconcileStaleReservations();
  assert.equal((await personalUsage(userId)).used_tokens, 0);
  assert.equal((await seatUsage(tenantId, "obj-9")).used_tokens, 2_000);
  // A hold settled twice is a no-op (no double refund).
  await quota.releaseQuotaReservation(other!);
  await quota.releaseQuotaReservation(other!);
  assert.equal((await seatUsage(tenantId, "obj-9")).used_tokens, 0);
});

test("10. a reservation without its tenant seat is refused, never billed to the personal quota", async () => {
  const userId = await newUser("pro");
  const before = await personalRows(userId);
  await assert.rejects(
    () =>
      analysis.reserveM365ForUser(
        {
          id: userId,
          email: "x@example.com",
          hasActiveSubscription: true,
          subscriptionPlan: "pro",
        },
        1_000,
      ),
    (error: any) => error.code === "M365_QUOTA_SCOPE_MISSING",
  );
  assert.equal(await personalRows(userId), before);
  assert.throws(
    () => ledger.m365Scope({ tenantId: "", objectId: "o", userId }),
    /m365_quota_scope_incomplete/,
  );
});

test("11. usage never leaks across tenants, even for the same object id", async () => {
  const userA = await newUser("free");
  const userB = await newUser("free");
  const tenantA = await newTenant({
    planId: "pro",
    validUntil: "2099-01-01T00:00:00.000Z",
  });
  const tenantB = await newTenant({
    planId: "pro",
    validUntil: "2099-01-01T00:00:00.000Z",
  });
  await link(tenantA, "shared-oid", userA);
  await link(tenantB, "shared-oid", userB);
  const holdA = await analysis.reserveM365ForUser(
    await m365User(userA, tenantA, "shared-oid"),
    10_000,
  );
  const holdB = await analysis.reserveM365ForUser(
    await m365User(userB, tenantB, "shared-oid"),
    20_000,
  );
  assert.equal((await seatUsage(tenantA, "shared-oid")).used_tokens, 10_000);
  assert.equal((await seatUsage(tenantB, "shared-oid")).used_tokens, 20_000);
  assert.equal((await seatUsage(tenantA, "shared-oid")).user_id, userA);
  assert.equal((await seatUsage(tenantB, "shared-oid")).user_id, userB);
  await quota.releaseQuotaReservation(holdA!);
  assert.equal((await seatUsage(tenantA, "shared-oid")).used_tokens, 0);
  assert.equal((await seatUsage(tenantB, "shared-oid")).used_tokens, 20_000);
  const summaryA = await ledger.summarizeM365Quota(
    { tenantId: tenantA, objectId: "shared-oid" },
    { planId: "pro", source: "tenant" },
  );
  assert.equal(summaryA.usedCredits, 0);
  assert.ok(holdB);
});

test("12. an admin tenant plan update never alters a user's personal subscription or usage", async () => {
  const userId = await newUser("starter");
  const tenantId = await newTenant({
    planId: "starter",
    validUntil: "2099-01-01T00:00:00.000Z",
  });
  await link(tenantId, "obj-12", userId);
  await analysis.reserveM365ForUser(
    await m365User(userId, tenantId, "obj-12"),
    1_000,
  );
  const before = await personalRows(userId);
  await registry.upsertM365Tenant({
    tenantId,
    status: "enabled",
    allowedScopes: ["m365.excel.read", "m365.excel.write"],
    planId: "enterprise",
    seatLimit: 50,
    subscriptionValidUntil: "2099-06-01T00:00:00.000Z",
  });
  assert.equal(await personalRows(userId), before);
  // The next M365 request moves only the M365 row to the new tenant plan.
  await analysis.reserveM365ForUser(
    await m365User(userId, tenantId, "obj-12"),
    1_000,
  );
  assert.equal((await seatUsage(tenantId, "obj-12")).plan_name, "enterprise");
  assert.equal(await personalRows(userId), before);
});

test("13. diagnostics show the M365 quota scope without secrets or workbook data", async () => {
  const userId = await newUser("pro");
  const tenantId = await newTenant({
    planId: "starter",
    validUntil: "2099-01-01T00:00:00.000Z",
  });
  await link(tenantId, "obj-13", userId);
  await analysis.reserveM365ForUser(
    await m365User(userId, tenantId, "obj-13"),
    2_000,
  );
  const identity = {
    tenantId,
    objectId: "obj-13",
    scopes: ["m365.excel.read", "m365.excel.write"],
  };
  const capabilities = await diagnostics.getM365Capabilities(identity);
  assert.equal(capabilities.quota.scope, "m365_tenant");
  assert.equal(capabilities.quota.planId, "starter");
  assert.equal(capabilities.quota.planSource, "tenant");
  assert.equal(capabilities.quota.usedCredits, 2_000);
  assert.equal(capabilities.quota.maxCredits, getPlan("starter").monthlyTokens);
  const report = await diagnostics.diagnoseM365Identity(identity);
  const credits: any = report.stages.find((stage) => stage.name === "credits");
  assert.equal(credits.ok, true);
  assert.equal(credits.detail.scope, "m365_tenant");
  assert.equal(credits.detail.plan, "starter");
  const shown = JSON.stringify({ capabilities, report });
  assert.doesNotMatch(shown, /key-u-|hash-u-|@example\.com|password/i);
  assert.equal(
    shown.includes(userId),
    false,
    "no user id in the capability report",
  );
});

test("14. the M365 ledger and holds have their own tables; personal tables are unused by M365", async () => {
  const userId = await newUser("starter");
  const tenantId = await newTenant({
    planId: "pro",
    validUntil: "2099-01-01T00:00:00.000Z",
  });
  await link(tenantId, "obj-14", userId);
  const personalBefore = await personalRows(userId);
  const hold = await analysis.reserveM365ForUser(
    await m365User(userId, tenantId, "obj-14"),
    1_000,
  );
  assert.ok(hold!.id);
  assert.deepEqual(hold!.scope, {
    kind: "m365_tenant",
    tenantId,
    objectId: "obj-14",
  });
  assert.equal(hold!.userId, userId);
  assert.ok(
    await dbm.dbGet("SELECT id FROM m365_quota_reservations WHERE id = ?", [
      hold!.id,
    ]),
  );
  assert.equal(
    await dbm.dbGet("SELECT id FROM quota_reservations WHERE id = ?", [
      hold!.id,
    ]),
    undefined,
  );
  await quota.settleQuotaReservation(hold!, 700);
  assert.equal(await personalRows(userId), personalBefore);
});

const hourAgo = () => new Date(Date.now() - 2 * 60 * 60_000).toISOString();

async function freshSeat(objectId: string, tenantPlan = "starter") {
  const userId = await newUser("pro");
  const tenantId = await newTenant({
    planId: tenantPlan,
    validUntil: "2099-01-01T00:00:00.000Z",
  });
  await link(tenantId, objectId, userId);
  return { userId, tenantId, user: await m365User(userId, tenantId, objectId) };
}

test("15. releasing a hold the stale sweeper already refunded does not refund it twice", async () => {
  const { userId, tenantId, user } = await freshSeat("obj-15");
  const swept = await analysis.reserveM365ForUser(user, 5_000);
  const live = await analysis.reserveM365ForUser(user, 3_000);
  await dbm.dbRun(
    "UPDATE m365_quota_reservations SET created_at = ? WHERE id = ?",
    [hourAgo(), swept!.id],
  );
  assert.equal(await quota.reconcileStaleReservations(), 1);
  assert.equal((await seatUsage(tenantId, "obj-15")).used_tokens, 3_000);
  // The slow request finally fails: it must not eat into the live request's credits.
  await quota.releaseQuotaReservation(swept!);
  const row = await seatUsage(tenantId, "obj-15");
  assert.equal(row.used_tokens, 3_000);
  assert.equal(row.used_requests, 1);
  await quota.releaseQuotaReservation(live!);
  assert.equal((await seatUsage(tenantId, "obj-15")).used_tokens, 0);
  assert.equal((await personalUsage(userId)).used_tokens, 0);
});

test("16. settling a hold the sweeper already refunded charges the actual cost exactly once", async () => {
  const { tenantId, user } = await freshSeat("obj-16");
  const hold = await analysis.reserveM365ForUser(user, 5_000);
  await dbm.dbRun(
    "UPDATE m365_quota_reservations SET created_at = ? WHERE id = ?",
    [hourAgo(), hold!.id],
  );
  await quota.reconcileStaleReservations();
  assert.equal((await seatUsage(tenantId, "obj-16")).used_tokens, 0);
  await quota.settleQuotaReservation(hold!, 1_200);
  await quota.settleQuotaReservation(hold!, 1_200);
  const row = await seatUsage(tenantId, "obj-16");
  assert.equal(row.used_tokens, 1_200);
  assert.equal(row.used_requests, 1);
});

test("17. concurrent settle and release of one hold apply exactly once", async () => {
  const { tenantId, user } = await freshSeat("obj-17");
  const hold = await analysis.reserveM365ForUser(user, 4_000);
  await Promise.all([
    quota.releaseQuotaReservation(hold!),
    quota.releaseQuotaReservation(hold!),
    quota.settleQuotaReservation(hold!, 900),
  ]);
  const row = await seatUsage(tenantId, "obj-17");
  // Whichever call won, the ledger holds either 0 (released) or 900 (settled), never a double refund.
  assert.ok(
    row.used_tokens === 0 || row.used_tokens === 900,
    String(row.used_tokens),
  );
  assert.ok(row.used_tokens >= 0 && row.used_requests >= 0);
});

test("18. top-ups stay inside the allowance, and a swept hold cannot be grown", async () => {
  const { tenantId, user } = await freshSeat("obj-18", "free");
  const max = (await seatUsage(tenantId, "obj-18"))?.max_tokens;
  const hold = await analysis.reserveM365ForUser(user, 2_000);
  const row = await seatUsage(tenantId, "obj-18");
  const room = row.max_tokens - row.used_tokens;
  const results = await Promise.all(
    Array.from({ length: 6 }, () =>
      quota.topUpReservation(hold!, Math.ceil(room / 3)),
    ),
  );
  const after = await seatUsage(tenantId, "obj-18");
  assert.ok(after.used_tokens <= after.max_tokens, "never above the allowance");
  assert.ok(
    results.some((granted) => !granted),
    "some top-ups are refused",
  );
  const stored = await dbm.dbGet<any>(
    "SELECT tokens FROM m365_quota_reservations WHERE id = ?",
    [hold!.id],
  );
  assert.equal(
    stored.tokens,
    hold!.reservedTokens,
    "the hold row mirrors the grown hold",
  );
  assert.equal(after.used_tokens, hold!.reservedTokens);
  void max;
  // Sweep it: growing it afterwards is refused and changes nothing.
  await dbm.dbRun(
    "UPDATE m365_quota_reservations SET created_at = ? WHERE id = ?",
    [hourAgo(), hold!.id],
  );
  await quota.reconcileStaleReservations();
  assert.equal((await seatUsage(tenantId, "obj-18")).used_tokens, 0);
  assert.equal(await quota.topUpReservation(hold!, 500), false);
  assert.equal((await seatUsage(tenantId, "obj-18")).used_tokens, 0);
});
