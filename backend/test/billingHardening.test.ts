/**
 * Billing hardening (audit phase 2): forged IPNs with an empty merchant secret, stacking of
 * concurrent paid IPNs, late success after failure, the personal ledger's claim-by-delete
 * (no double refund after the stale sweep), NaN-safe settle, chargeback arithmetic, fail-closed
 * expiry and the test-activate / checkout guards. Same throwaway-database scaffold as
 * paymentIpn.test.ts: modules are imported after chdir/env setup.
 */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

const MERCHANT_ID = "1200000";
const MERCHANT_SECRET = "test-secret";
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vynor-billing-hard-"));
const originalCwd = process.cwd();

let baseUrl = "";
let server: import("node:http").Server;
let dbm: typeof import("../src/db.js");
let quota: typeof import("../src/services/monthlyQuota.js");
let payhere: typeof import("../src/services/payhere.js");
let cfg: typeof import("../src/config.js");
let PLANS: typeof import("../src/config.js").PLANS;

const md5 = (s: string) =>
  crypto.createHash("md5").update(s).digest("hex").toUpperCase();
const sha256 = (s: string) =>
  crypto.createHash("sha256").update(s).digest("hex");
const today = () => new Date().toISOString().slice(0, 10);

before(async () => {
  process.chdir(tmpDir);
  process.env.PAYHERE_MERCHANT_ID = MERCHANT_ID;
  process.env.PAYHERE_MERCHANT_SECRET = MERCHANT_SECRET;

  dbm = await import("../src/db.js");
  await dbm.initDb();
  quota = await import("../src/services/monthlyQuota.js");
  payhere = await import("../src/services/payhere.js");
  cfg = await import("../src/config.js");
  PLANS = cfg.PLANS;

  const express = (await import("express")).default;
  const { paymentRouter } = await import("../src/routes/payment.js");
  const app = express();
  app.use(express.urlencoded({ extended: true }));
  app.use(express.json());
  app.use("/api/payment", paymentRouter);
  server = app.listen(0);
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  server?.close();
  if (dbm.db) {
    await new Promise<void>((resolve) => dbm.db!.close(() => resolve()));
  } else {
    await (await import("../src/services/pgDriver.js")).closePostgres();
  }
  process.chdir(originalCwd);
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 3 });
  } catch {
    // Windows can hold the SQLite WAL briefly after close.
  }
});

let userSeq = 0;
async function createUser(apiKey?: string): Promise<string> {
  const id = `bh-user-${++userSeq}`;
  await dbm.dbRun(
    "INSERT INTO users (id, email, password_hash, api_key, api_key_hash) VALUES (?, ?, 'x', ?, ?)",
    [
      id,
      `${id}@example.com`,
      apiKey || `key-${id}`,
      apiKey ? sha256(apiKey) : `hash-${id}`,
    ],
  );
  return id;
}

async function createOrder(userId: string, planId: string): Promise<string> {
  const plan = PLANS[planId];
  const orderId = `order-${crypto.randomUUID()}`;
  await dbm.dbRun(
    `INSERT INTO subscriptions (id, user_id, plan_name, status, order_id, amount_minor, amount, currency, valid_until)
     VALUES (?, ?, ?, 'pending', ?, ?, ?, 'LKR', ?)`,
    [
      crypto.randomUUID(),
      userId,
      planId,
      orderId,
      Math.round(plan.priceLKR * 100),
      plan.priceLKR,
      new Date().toISOString(),
    ],
  );
  return orderId;
}

async function sendIpn(
  orderId: string,
  amount: string,
  statusCode = "2",
  secretForSig = MERCHANT_SECRET,
): Promise<number> {
  const sig = md5(
    `${MERCHANT_ID}${orderId}${amount}LKR${statusCode}${md5(secretForSig)}`,
  );
  const body = new URLSearchParams({
    merchant_id: MERCHANT_ID,
    order_id: orderId,
    payment_id: `pay-${orderId}`,
    payhere_amount: amount,
    payhere_currency: "LKR",
    status_code: statusCode,
    md5sig: sig,
  });
  const res = await fetch(`${baseUrl}/api/payment/notify`, {
    method: "POST",
    body,
  });
  return res.status;
}

const orderStatus = async (orderId: string) =>
  (
    await dbm.dbGet<{ status: string }>(
      "SELECT status FROM subscriptions WHERE order_id = ?",
      [orderId],
    )
  )?.status;

const cycleRow = (userId: string) =>
  dbm.dbGet<any>(
    "SELECT * FROM monthly_usage WHERE user_id = ? AND period_end >= ? ORDER BY period_end DESC LIMIT 1",
    [userId, today()],
  );

// ─── 1. PayHere configuration and forged IPNs ───────────────────────────────

test("an IPN signed with the public md5('') key is rejected when the secret is empty", async () => {
  const userId = await createUser();
  const orderId = await createOrder(userId, "starter");
  const original = cfg.config.payhere.merchantSecret;
  cfg.config.payhere.merchantSecret = "";
  try {
    const forged = md5(`${MERCHANT_ID}${orderId}1850.00LKR2${md5("")}`);
    assert.equal(
      payhere.verifyPayhereIpn({
        merchant_id: MERCHANT_ID,
        order_id: orderId,
        payhere_amount: "1850.00",
        payhere_currency: "LKR",
        status_code: "2",
        md5sig: forged,
      }),
      false,
    );
    // The same forgery through the HTTP route never activates the order.
    assert.equal(await sendIpn(orderId, "1850.00", "2", ""), 400);
  } finally {
    cfg.config.payhere.merchantSecret = original;
  }
  assert.equal(await orderStatus(orderId), "pending");
  assert.equal(await quota.getActiveSubscription(userId), undefined);
});

test("a correctly signed IPN still activates once the secret is configured", async () => {
  const userId = await createUser();
  const orderId = await createOrder(userId, "starter");
  assert.equal(await sendIpn(orderId, "1850.00"), 200);
  assert.equal(await orderStatus(orderId), "active");
});

test("assertPayhereConfig refuses a merchant id without a secret and live mode without both", () => {
  assert.throws(
    () =>
      payhere.assertPayhereConfig({
        merchantId: "123",
        merchantSecret: "",
        env: "sandbox",
      }),
    /MERCHANT_SECRET/,
  );
  assert.throws(
    () =>
      payhere.assertPayhereConfig({
        merchantId: "",
        merchantSecret: "",
        env: "live",
      }),
    /live/,
  );
  assert.doesNotThrow(() =>
    payhere.assertPayhereConfig({
      merchantId: "123",
      merchantSecret: "s",
      env: "live",
    }),
  );
  assert.doesNotThrow(() =>
    payhere.assertPayhereConfig({
      merchantId: "",
      merchantSecret: "",
      env: "sandbox",
    }),
  );
});

// ─── 2. Replays, concurrency, late success ──────────────────────────────────

test("a replayed top-up IPN credits once", async () => {
  const userId = await createUser();
  await sendIpn(await createOrder(userId, "starter"), "1850.00");
  const topupId = await createOrder(userId, "topup5m");
  assert.equal(await sendIpn(topupId, "650.00"), 200);
  assert.equal(await sendIpn(topupId, "650.00"), 200);
  const cycle = await cycleRow(userId);
  assert.equal(cycle.bonus_tokens, PLANS.topup5m.monthlyTokens);
});

test("two concurrent paid IPNs for the same tier extend twice (they stack)", async () => {
  const userId = await createUser();
  const a = await createOrder(userId, "starter");
  const b = await createOrder(userId, "starter");
  const [ra, rb] = await Promise.all([
    sendIpn(a, "1850.00"),
    sendIpn(b, "1850.00"),
  ]);
  assert.deepEqual([ra, rb], [200, 200]);
  assert.equal(await orderStatus(a), "active");
  assert.equal(await orderStatus(b), "active");

  const rows = await dbm.dbAll<{ valid_until: string }>(
    "SELECT valid_until FROM subscriptions WHERE user_id = ? AND status = 'active' ORDER BY valid_until",
    [userId],
  );
  assert.equal(rows.length, 2);
  const days = (iso: string) => (Date.parse(iso) - Date.now()) / 86_400_000;
  // First payment ~30 days out, the second stacks on top of it (~60), never both ~30.
  assert.ok(Math.abs(days(rows[0].valid_until) - 30) < 1);
  assert.ok(Math.abs(days(rows[1].valid_until) - 60) < 1);
});

test("a valid success IPN after a failure notification still activates the order", async () => {
  const userId = await createUser();
  const orderId = await createOrder(userId, "starter");
  assert.equal(await sendIpn(orderId, "1850.00", "-2"), 200);
  assert.equal(await orderStatus(orderId), "failed");
  assert.equal(await sendIpn(orderId, "1850.00", "2"), 200);
  assert.equal(await orderStatus(orderId), "active");
  assert.equal(
    (await quota.getActiveSubscription<{ plan_name: string }>(userId))
      ?.plan_name,
    "starter",
  );
});

test("a chargedback order cannot be reactivated by a later success IPN", async () => {
  const userId = await createUser();
  const orderId = await createOrder(userId, "starter");
  await sendIpn(orderId, "1850.00", "2");
  await sendIpn(orderId, "1850.00", "-3");
  assert.equal(await orderStatus(orderId), "chargedback");
  await sendIpn(orderId, "1850.00", "2");
  assert.equal(await orderStatus(orderId), "chargedback");
});

test("switching tier starts the new cycle first and then retires the old plan", async () => {
  const userId = await createUser();
  const first = await createOrder(userId, "starter");
  await sendIpn(first, "1850.00");
  const second = await createOrder(userId, "pro");
  assert.equal(await sendIpn(second, "3850.00"), 200);
  assert.equal(await orderStatus(first), "superseded");
  assert.equal(await orderStatus(second), "active");
  const cycle = await cycleRow(userId);
  assert.equal(cycle.plan_name, "pro");
  assert.equal(cycle.used_tokens, 0);
});

test("startPaidCycle survives a cycle row created by a concurrent request (upsert)", async () => {
  const userId = await createUser();
  // A concurrent request already created today's row...
  await quota.getOrInitMonthlyUsage(userId, "free");
  // ...and an activation on the same day reuses it instead of failing on UNIQUE(user, period_start).
  await quota.startPaidCycle(userId, "pro", new Date(Date.now() + 30 * 864e5));
  const rows = await dbm.dbAll<any>(
    "SELECT * FROM monthly_usage WHERE user_id = ?",
    [userId],
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].plan_name, "pro");
});

// ─── 3. Personal ledger: claim-by-delete ────────────────────────────────────

async function backdateHold(id: string) {
  await dbm.dbRun("UPDATE quota_reservations SET created_at = ? WHERE id = ?", [
    new Date(Date.now() - quota.STALE_RESERVATION_MS - 60_000).toISOString(),
    id,
  ]);
}

test("release after the stale sweep does not refund a second time", async () => {
  const userId = await createUser();
  await quota.getOrInitMonthlyUsage(userId, "starter");
  const hold = await quota.reserveQuotaAtomic(userId, "starter", 5_000);
  assert.ok(hold?.id);
  assert.equal((await cycleRow(userId)).used_tokens, 5_000);

  await backdateHold(hold!.id!);
  assert.ok((await quota.reconcileStaleReservations()) >= 1);
  assert.equal((await cycleRow(userId)).used_tokens, 0);

  // Another request's credits must not be eaten by the late release.
  const other = await quota.reserveQuotaAtomic(userId, "starter", 3_000);
  assert.ok(other);
  await quota.releaseQuotaReservation(hold!);
  assert.equal((await cycleRow(userId)).used_tokens, 3_000);
});

test("settle after the stale sweep charges the actual cost once", async () => {
  const userId = await createUser();
  await quota.getOrInitMonthlyUsage(userId, "starter");
  const hold = await quota.reserveQuotaAtomic(userId, "starter", 5_000);
  await backdateHold(hold!.id!);
  await quota.reconcileStaleReservations();
  assert.equal((await cycleRow(userId)).used_tokens, 0);

  await quota.settleQuotaReservation(hold!, 1_200);
  const after = await cycleRow(userId);
  assert.equal(after.used_tokens, 1_200);
  assert.equal(after.used_requests, 1);

  // Settling again is a no-op.
  await quota.settleQuotaReservation(hold!, 1_200);
  assert.equal((await cycleRow(userId)).used_tokens, 1_200);
});

test("a hold that was swept cannot be grown by a top-up", async () => {
  const userId = await createUser();
  await quota.getOrInitMonthlyUsage(userId, "starter");
  const hold = await quota.reserveQuotaAtomic(userId, "starter", 5_000);
  await backdateHold(hold!.id!);
  await quota.reconcileStaleReservations();
  assert.equal(await quota.topUpReservation(hold!, 1_000), false);
  assert.equal((await cycleRow(userId)).used_tokens, 0);
});

test("a normal hold still settles and tops up", async () => {
  const userId = await createUser();
  await quota.getOrInitMonthlyUsage(userId, "starter");
  const hold = await quota.reserveQuotaAtomic(userId, "starter", 5_000);
  assert.equal(await quota.topUpReservation(hold!, 1_000), true);
  assert.equal((await cycleRow(userId)).used_tokens, 6_000);
  await quota.settleQuotaReservation(hold!, 2_000);
  assert.equal((await cycleRow(userId)).used_tokens, 2_000);
  const left = await dbm.dbGet<any>(
    "SELECT COUNT(*) AS n FROM quota_reservations WHERE user_id = ?",
    [userId],
  );
  assert.equal(Number(left.n), 0);
});

test("a non-finite actual cost settles at the reserved amount and never writes NULL", async () => {
  for (const bad of [NaN, Infinity, -Infinity]) {
    const userId = await createUser();
    await quota.getOrInitMonthlyUsage(userId, "starter");
    const hold = await quota.reserveQuotaAtomic(userId, "starter", 4_000);
    await quota.settleQuotaReservation(hold!, bad);
    const row = await cycleRow(userId);
    assert.equal(row.used_tokens, 4_000, `value ${bad}`);
    assert.notEqual(row.used_requests, null);
  }
});

// ─── 4. Chargeback arithmetic and fail-closed expiry ────────────────────────

test("reverseTopup takes from the plan allowance only what it removes from the bonus", async () => {
  const userId = await createUser();
  const cycle = await quota.getOrInitMonthlyUsage(userId, "starter");
  await dbm.dbRun(
    "UPDATE monthly_usage SET bonus_tokens = 100, max_tokens = max_tokens + 100 WHERE id = ?",
    [cycle.id],
  );
  const before = await cycleRow(userId);
  await quota.reverseTopup(userId, 1_000, 0);
  const after = await cycleRow(userId);
  assert.equal(after.bonus_tokens, 0);
  assert.equal(after.max_tokens, before.max_tokens - 100);
  assert.equal(after.max_tokens, PLANS.starter.monthlyTokens);
});

test("a malformed or past expiry never counts as an active subscription", async () => {
  const userId = await createUser();
  for (const [i, until] of ["garbage", "9999", "not-a-date"].entries()) {
    const insert = dbm.dbRun(
      `INSERT INTO subscriptions (id, user_id, plan_name, status, order_id, amount_minor, amount, currency, valid_until)
       VALUES (?, ?, 'pro', 'active', ?, 0, 0, 'LKR', ?)`,
      [crypto.randomUUID(), userId, `bad-${userId}-${i}`, until],
    );
    // PostgreSQL's TIMESTAMPTZ column refuses a malformed expiry outright; SQLite stores the text,
    // so there the read path has to fail closed on it.
    if (dbm.usingPostgres) await assert.rejects(insert);
    else await insert;
  }
  assert.equal(await quota.getActiveSubscription(userId), undefined);
  // A real future expiry next to them is still found.
  await dbm.dbRun(
    `INSERT INTO subscriptions (id, user_id, plan_name, status, order_id, amount_minor, amount, currency, valid_until)
     VALUES (?, ?, 'starter', 'active', ?, 0, 0, 'LKR', ?)`,
    [
      crypto.randomUUID(),
      userId,
      `good-${userId}`,
      new Date(Date.now() + 864e5).toISOString(),
    ],
  );
  assert.equal(
    (await quota.getActiveSubscription<{ plan_name: string }>(userId))
      ?.plan_name,
    "starter",
  );
});

// ─── 5. Checkout and test-activate guards, abandoned orders ─────────────────

test("test-activate is unavailable in production even with the right admin secret", async () => {
  const apiKey = `vynor_live_${crypto.randomBytes(16).toString("hex")}`;
  await createUser(apiKey);
  process.env.ADMIN_SECRET = "a".repeat(40);
  const originalEnv = cfg.config.nodeEnv;
  (cfg.config as any).nodeEnv = "production";
  try {
    const res = await fetch(`${baseUrl}/api/payment/test-activate`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "x-admin-secret": "a".repeat(40),
        "content-type": "application/json",
      },
      body: JSON.stringify({ plan: "pro" }),
    });
    assert.equal(res.status, 404);
  } finally {
    (cfg.config as any).nodeEnv = originalEnv;
  }
});

test("test-activate needs the exact admin secret outside development", async () => {
  const apiKey = `vynor_live_${crypto.randomBytes(16).toString("hex")}`;
  await createUser(apiKey);
  process.env.ADMIN_SECRET = "b".repeat(40);
  const originalEnv = cfg.config.nodeEnv;
  (cfg.config as any).nodeEnv = "test";
  try {
    const call = (secret?: string) =>
      fetch(`${baseUrl}/api/payment/test-activate`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          ...(secret ? { "x-admin-secret": secret } : {}),
          "content-type": "application/json",
        },
        body: JSON.stringify({ plan: "starter" }),
      });
    assert.equal((await call()).status, 403);
    assert.equal((await call("b".repeat(39) + "c")).status, 403);
    assert.equal((await call("b".repeat(40))).status, 200);
  } finally {
    (cfg.config as any).nodeEnv = originalEnv;
  }
});

test("checkout refuses more than the pending-order cap per account", async () => {
  const apiKey = `vynor_live_${crypto.randomBytes(16).toString("hex")}`;
  const userId = await createUser(apiKey);
  for (let i = 0; i < 10; i += 1) await createOrder(userId, "starter");
  const res = await fetch(`${baseUrl}/api/payment/checkout`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ plan: "starter" }),
  });
  assert.equal(res.status, 429);
});

test("abandoned pending orders age to failed and old unpaid failed orders are removed", async () => {
  const userId = await createUser();
  const old = await createOrder(userId, "starter");
  const ancient = await createOrder(userId, "starter");
  const fresh = await createOrder(userId, "starter");
  const daysAgo = (d: number) => new Date(Date.now() - d * 864e5).toISOString();
  await dbm.dbRun(
    "UPDATE subscriptions SET created_at = ? WHERE order_id = ?",
    [daysAgo(2), old],
  );
  await dbm.dbRun(
    "UPDATE subscriptions SET created_at = ?, status = 'failed' WHERE order_id = ?",
    [daysAgo(40), ancient],
  );
  await quota.reapStalePendingOrders();
  assert.equal(await orderStatus(old), "failed");
  assert.equal(await orderStatus(ancient), undefined);
  assert.equal(await orderStatus(fresh), "pending");
  // The aged order can still be paid late (a valid IPN claims a failed order).
  assert.equal(await sendIpn(old, "1850.00"), 200);
  assert.equal(await orderStatus(old), "active");
});
