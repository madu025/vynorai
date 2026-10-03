/**
 * End-to-end PayHere IPN + quota ledger tests against a throwaway SQLite DB.
 * Modules are imported dynamically after chdir/env setup because db.ts and
 * config.ts read the working directory and environment at import time.
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
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vynor-ipn-"));
const originalCwd = process.cwd();

let baseUrl = "";
let server: import("node:http").Server;
let dbm: typeof import("../src/db.js");
let quota: typeof import("../src/services/monthlyQuota.js");
let policy: typeof import("../src/services/billingPolicy.js");
let PLANS: typeof import("../src/config.js").PLANS;

const md5 = (s: string) =>
  crypto.createHash("md5").update(s).digest("hex").toUpperCase();
const today = () => new Date().toISOString().slice(0, 10);
const daysFromNow = (d: number) => new Date(Date.now() + d * 86_400_000);

before(async () => {
  process.chdir(tmpDir);
  process.env.PAYHERE_MERCHANT_ID = MERCHANT_ID;
  process.env.PAYHERE_MERCHANT_SECRET = MERCHANT_SECRET;

  dbm = await import("../src/db.js");
  await dbm.initDb();
  quota = await import("../src/services/monthlyQuota.js");
  policy = await import("../src/services/billingPolicy.js");
  ({ PLANS } = await import("../src/config.js"));

  const express = (await import("express")).default;
  const { paymentRouter } = await import("../src/routes/payment.js");
  const app = express();
  app.use(express.urlencoded({ extended: true }));
  app.use("/api/payment", paymentRouter);
  server = app.listen(0);
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  server?.close();
  await new Promise<void>((resolve) => dbm.db.close(() => resolve()));
  process.chdir(originalCwd);
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 3 });
  } catch {
    // Windows can hold the SQLite WAL briefly after close; the OS temp dir is fine to leave.
  }
});

let userSeq = 0;
async function createUser(): Promise<string> {
  const id = `user-${++userSeq}`;
  await dbm.dbRun(
    "INSERT INTO users (id, email, password_hash, api_key, api_key_hash) VALUES (?, ?, 'x', ?, ?)",
    [id, `${id}@example.com`, `key-${id}`, `hash-${id}`],
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
  extra: Record<string, string> = {},
): Promise<number> {
  const sig = md5(
    `${MERCHANT_ID}${orderId}${amount}LKR${statusCode}${md5(MERCHANT_SECRET)}`,
  );
  const body = new URLSearchParams({
    merchant_id: MERCHANT_ID,
    order_id: orderId,
    payment_id: `pay-${orderId}`,
    payhere_amount: amount,
    payhere_currency: "LKR",
    status_code: statusCode,
    md5sig: sig,
    ...extra,
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
const activeCycle = (userId: string) =>
  quota.getOrInitMonthlyUsage(userId, "free");

test("plan comes from the stored order, not the tamperable custom_2 field", async () => {
  const userId = await createUser();
  const orderId = await createOrder(userId, "starter");

  assert.equal(
    await sendIpn(orderId, "1850.00", "2", {
      custom_1: "someone-else",
      custom_2: "enterprise",
    }),
    200,
  );

  const sub = await quota.getActiveSubscription<{
    plan_name: string;
    user_id: string;
  }>(userId);
  assert.equal(sub?.plan_name, "starter");
  assert.equal(await quota.getActiveSubscription("someone-else"), undefined);
});

test("underpaid orders are rejected and stay pending", async () => {
  const userId = await createUser();
  const orderId = await createOrder(userId, "enterprise");

  assert.equal(await sendIpn(orderId, "1850.00"), 400);
  assert.equal(await orderStatus(orderId), "pending");
  assert.equal(await quota.getActiveSubscription(userId), undefined);
});

test("replayed IPNs are processed once and never downgrade an active order", async () => {
  const userId = await createUser();
  const orderId = await createOrder(userId, "pro");

  assert.equal(await sendIpn(orderId, "3850.00"), 200);
  const first = await quota.getActiveSubscription<{ valid_until: string }>(
    userId,
  );
  assert.equal(await sendIpn(orderId, "3850.00"), 200);
  assert.equal(await sendIpn(orderId, "3850.00", "-2"), 200);

  assert.equal(await orderStatus(orderId), "active");
  const second = await quota.getActiveSubscription<{ valid_until: string }>(
    userId,
  );
  assert.equal(second?.valid_until, first?.valid_until);
});

test("top-ups add credits once and never become the user's plan", async () => {
  const userId = await createUser();
  await sendIpn(await createOrder(userId, "starter"), "1850.00");
  const topupId = await createOrder(userId, "topup5m");

  assert.equal(await sendIpn(topupId, "650.00"), 200);
  assert.equal(await sendIpn(topupId, "650.00"), 200);

  assert.equal(await orderStatus(topupId), "credited");
  const sub = await quota.getActiveSubscription<{ plan_name: string }>(userId);
  assert.equal(sub?.plan_name, "starter");
  const cycle = await quota.getOrInitMonthlyUsage(userId, "starter");
  assert.equal(cycle.bonus_tokens, PLANS.topup5m.monthlyTokens);
  assert.equal(
    cycle.max_tokens,
    PLANS.starter.monthlyTokens + PLANS.topup5m.monthlyTokens,
  );
  assert.equal(cycle.bonus_requests, PLANS.topup5m.monthlyRequests);
});

test("top-up credit survives a plan change but a chargeback removes it", async () => {
  const userId = await createUser();
  const topupId = await createOrder(userId, "topup5m");
  await sendIpn(topupId, "650.00");

  // Plan change mid-cycle (e.g. subscription expiry) keeps purchased credit.
  const changed = await quota.getOrInitMonthlyUsage(userId, "pro");
  assert.equal(
    changed.max_tokens,
    PLANS.pro.monthlyTokens + PLANS.topup5m.monthlyTokens,
  );

  assert.equal(await sendIpn(topupId, "650.00", "-3"), 200);
  assert.equal(await orderStatus(topupId), "chargedback");
  const reversed = await quota.getOrInitMonthlyUsage(userId, "pro");
  assert.equal(reversed.bonus_tokens, 0);
  assert.equal(reversed.max_tokens, PLANS.pro.monthlyTokens);
});

test("a paid activation starts a fresh cycle instead of inheriting a nearly-finished one", async () => {
  const userId = await createUser();
  const oldStart = daysFromNow(-29).toISOString().slice(0, 10);
  const oldEnd = daysFromNow(1).toISOString().slice(0, 10);
  await dbm.dbRun(
    `INSERT INTO monthly_usage (id, user_id, plan_name, max_tokens, used_tokens, used_requests, period_start, period_end)
     VALUES (?, ?, 'free', ?, 90000, 90, ?, ?)`,
    [crypto.randomUUID(), userId, PLANS.free.monthlyTokens, oldStart, oldEnd],
  );

  await sendIpn(await createOrder(userId, "pro"), "3850.00");

  const cycle = await quota.getOrInitMonthlyUsage(userId, "pro");
  assert.equal(cycle.period_start, today());
  assert.equal(cycle.used_tokens, 0);
  assert.equal(cycle.max_tokens, PLANS.pro.monthlyTokens);
  const cycles = await dbm.dbAll(
    "SELECT * FROM monthly_usage WHERE user_id = ? AND period_end >= ?",
    [userId, today()],
  );
  assert.equal(cycles.length, 1);
});

test("renewing early extends from the current expiry", async () => {
  const userId = await createUser();
  await sendIpn(await createOrder(userId, "pro"), "3850.00");
  const first = await quota.getActiveSubscription<{ valid_until: string }>(
    userId,
  );
  await sendIpn(await createOrder(userId, "pro"), "3850.00");
  const second = await quota.getActiveSubscription<{ valid_until: string }>(
    userId,
  );

  const gainedDays =
    (Date.parse(second!.valid_until) - Date.parse(first!.valid_until)) /
    86_400_000;
  assert.equal(Math.round(gainedDays), 30);
});

test("a reservation tops up for a pricier route, or reports it cannot", async () => {
  const userId = await createUser();
  const cycle = await activeCycle(userId);
  const reservation = await quota.reserveQuotaAtomic(userId, "free", 1000);

  assert.equal(await quota.topUpReservation(reservation!, 3000), true);
  assert.equal(reservation!.reservedTokens, 4000);
  assert.equal((await activeCycle(userId)).used_tokens, 4000);

  // More than the remaining allowance: nothing changes, caller falls back.
  assert.equal(
    await quota.topUpReservation(reservation!, cycle.max_tokens),
    false,
  );
  assert.equal(reservation!.reservedTokens, 4000);
  assert.equal((await activeCycle(userId)).used_tokens, 4000);
});

test("settlement charges model-weighted credits and failures refund the request", async () => {
  const userId = await createUser();
  await activeCycle(userId);

  const opus = await quota.reserveQuotaAtomic(userId, "free", 1000);
  await quota.settleQuotaReservation(
    opus!,
    policy.creditsFor("claude-opus-4-6", 100),
  );
  let cycle = await activeCycle(userId);
  assert.equal(cycle.used_tokens, 6400);
  assert.equal(cycle.used_requests, 1);

  const failed = await quota.reserveQuotaAtomic(userId, "free", 1000);
  await quota.releaseQuotaReservation(failed!);
  cycle = await activeCycle(userId);
  assert.equal(cycle.used_tokens, 6400);
  assert.equal(cycle.used_requests, 1);
});
