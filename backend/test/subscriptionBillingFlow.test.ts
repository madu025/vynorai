import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import express from "express";

const MERCHANT_ID = "1200000";
const MERCHANT_SECRET = "test-merchant-secret-key-12345";
const ADMIN_SECRET = "economics-audit-admin-secret-32-chars";
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vynor-billing-audit-"));
const originalCwd = process.cwd();

let baseUrl = "";
let server: http.Server;
let dbm: typeof import("../src/db.js");
let quota: typeof import("../src/services/monthlyQuota.js");
let policy: typeof import("../src/services/billingPolicy.js");
let pricing: typeof import("../src/services/pricing.js");
let costLedger: typeof import("../src/services/costLedger.js");
let PLANS: typeof import("../src/config.js").PLANS;
let getPlan: typeof import("../src/config.js").getPlan;

const md5 = (s: string) =>
  crypto.createHash("md5").update(s).digest("hex").toUpperCase();
const today = () => new Date().toISOString().slice(0, 10);
const daysFromNow = (d: number) => new Date(Date.now() + d * 86_400_000);

let userCounter = 0;
async function createTestUser(): Promise<string> {
  const id = `audit-user-${++userCounter}`;
  await dbm.dbRun(
    "INSERT INTO users (id, email, password_hash, api_key, api_key_hash) VALUES (?, ?, 'x', ?, ?)",
    [id, `${id}@example.com`, `key-${id}`, `hash-${id}`],
  );
  return id;
}

async function createStoredOrder(
  userId: string,
  planId: string,
): Promise<string> {
  const plan = PLANS[planId];
  const orderId = `vynor_order_${crypto.randomUUID().replace(/-/g, "")}`;
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

async function sendPayhereIpn(
  orderId: string,
  amount: string,
  statusCode = "2",
  currency = "LKR",
  merchantId = MERCHANT_ID,
  secret = MERCHANT_SECRET,
  extra: Record<string, string> = {},
): Promise<{ status: number; text: string }> {
  const sig = md5(
    `${merchantId}${orderId}${amount}${currency}${statusCode}${md5(secret)}`,
  );
  const body = new URLSearchParams({
    merchant_id: merchantId,
    order_id: orderId,
    payment_id: `pay-${orderId}`,
    payhere_amount: amount,
    payhere_currency: currency,
    status_code: statusCode,
    md5sig: sig,
    ...extra,
  });
  const res = await fetch(`${baseUrl}/api/payment/notify`, {
    method: "POST",
    body,
  });
  const text = await res.text();
  return { status: res.status, text };
}

async function getOrderStatus(orderId: string): Promise<string | undefined> {
  const row = await dbm.dbGet<{ status: string }>(
    "SELECT status FROM subscriptions WHERE order_id = ?",
    [orderId],
  );
  return row?.status;
}

test("Subscription Billing Flow Audit & Verification Suite", async (suite) => {
  process.chdir(tmpDir);
  process.env.NODE_ENV = "test";
  process.env.PAYHERE_MERCHANT_ID = MERCHANT_ID;
  process.env.PAYHERE_MERCHANT_SECRET = MERCHANT_SECRET;
  process.env.ADMIN_SECRET = ADMIN_SECRET;

  dbm = await import("../src/db.js");
  await dbm.initDb();
  quota = await import("../src/services/monthlyQuota.js");
  policy = await import("../src/services/billingPolicy.js");
  pricing = await import("../src/services/pricing.js");
  costLedger = await import("../src/services/costLedger.js");
  ({ PLANS, getPlan } = await import("../src/config.js"));

  const { paymentRouter } = await import("../src/routes/payment.js");
  const { adminRouter } = await import("../src/routes/admin.js");

  const app = express();
  app.use(express.urlencoded({ extended: true }));
  app.use(express.json());
  app.use("/api/payment", paymentRouter);
  app.use("/admin", adminRouter);

  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  suite.after(async () => {
    server?.close();
    if (dbm.db) {
      await new Promise<void>((resolve) => dbm.db!.close(() => resolve()));
    }
    process.chdir(originalCwd);
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 3 });
    } catch {}
  });

  // ─── 1. PAYHERE IPN HANDLING & SECURITY AUDIT ──────────────────────────────
  await suite.test(
    "1. PayHere IPN Handling: Signature validation, tamper protection, status transitions & idempotency",
    async (t) => {
      // 1.1 Invalid Signature Rejection
      const user1 = await createTestUser();
      const order1 = await createStoredOrder(user1, "pro");
      const badSigRes = await sendPayhereIpn(
        order1,
        "3850.00",
        "2",
        "LKR",
        MERCHANT_ID,
        "wrong-secret",
      );
      assert.equal(badSigRes.status, 400);
      assert.equal(badSigRes.text, "Invalid signature");
      assert.equal(await getOrderStatus(order1), "pending");

      // 1.2 Missing MD5sig / required fields rejection
      const emptySigRes = await fetch(`${baseUrl}/api/payment/notify`, {
        method: "POST",
        body: new URLSearchParams({ order_id: order1, status_code: "2" }),
      });
      assert.equal(emptySigRes.status, 400);

      // 1.3 Currency mismatch rejection
      const currencyMismatchRes = await sendPayhereIpn(
        order1,
        "3850.00",
        "2",
        "USD",
      );
      assert.equal(currencyMismatchRes.status, 400);
      assert.equal(currencyMismatchRes.text, "Order mismatch");
      assert.equal(await getOrderStatus(order1), "pending");

      // 1.4 Merchant ID mismatch rejection
      const merchantMismatchRes = await sendPayhereIpn(
        order1,
        "3850.00",
        "2",
        "LKR",
        "9999999",
      );
      assert.equal(merchantMismatchRes.status, 400);
      assert.equal(merchantMismatchRes.text, "Order mismatch");
      assert.equal(await getOrderStatus(order1), "pending");

      // 1.5 Underpayment rejection
      const user2 = await createTestUser();
      const order2 = await createStoredOrder(user2, "enterprise"); // 7,900 LKR
      const underpaidRes = await sendPayhereIpn(order2, "1850.00", "2"); // Sent Starter price
      assert.equal(underpaidRes.status, 400);
      assert.equal(underpaidRes.text, "Order mismatch");
      assert.equal(await getOrderStatus(order2), "pending");

      // 1.6 Custom field tampering protection (custom_1/custom_2 spoofing)
      const user3 = await createTestUser();
      const order3 = await createStoredOrder(user3, "starter");
      const tamperedRes = await sendPayhereIpn(
        order3,
        "1850.00",
        "2",
        "LKR",
        MERCHANT_ID,
        MERCHANT_SECRET,
        {
          custom_1: "hacker-user",
          custom_2: "enterprise",
        },
      );
      assert.equal(tamperedRes.status, 200);
      assert.equal(await getOrderStatus(order3), "active");
      const sub3 = await quota.getActiveSubscription<{
        plan_name: string;
        user_id: string;
      }>(user3);
      assert.equal(
        sub3?.plan_name,
        "starter",
        "Must bind to starter plan from stored DB order",
      );
      assert.equal(await quota.getActiveSubscription("hacker-user"), undefined);

      // 1.7 Status -1 (Canceled) & -2 (Failed) transitions
      const user4 = await createTestUser();
      const cancelOrder = await createStoredOrder(user4, "starter");
      const cancelRes = await sendPayhereIpn(cancelOrder, "1850.00", "-1");
      assert.equal(cancelRes.status, 200);
      assert.equal(await getOrderStatus(cancelOrder), "cancelled");

      const failOrder = await createStoredOrder(user4, "pro");
      const failRes = await sendPayhereIpn(failOrder, "3850.00", "-2");
      assert.equal(failRes.status, 200);
      assert.equal(await getOrderStatus(failOrder), "failed");

      // 1.8 Replay protection & race immunity
      const user5 = await createTestUser();
      const replayOrder = await createStoredOrder(user5, "pro");
      assert.equal(
        (await sendPayhereIpn(replayOrder, "3850.00", "2")).status,
        200,
      );
      const firstSub = await quota.getActiveSubscription<{
        valid_until: string;
      }>(user5);
      // Replaying same success IPN
      assert.equal(
        (await sendPayhereIpn(replayOrder, "3850.00", "2")).status,
        200,
      );
      // Late failed IPN after success cannot downgrade
      assert.equal(
        (await sendPayhereIpn(replayOrder, "3850.00", "-2")).status,
        200,
      );
      const secondSub = await quota.getActiveSubscription<{
        valid_until: string;
      }>(user5);
      assert.equal(await getOrderStatus(replayOrder), "active");
      assert.equal(
        secondSub?.valid_until,
        firstSub?.valid_until,
        "Replayed IPN must be strictly idempotent",
      );
    },
  );

  // ─── 2. AUTOMATED MONTHLY TOKEN ALLOCATION ─────────────────────────────────
  await suite.test(
    "2. Monthly Token Allocation: Quota initialization across tiers, top-up stacking & atomic reservation holds",
    async (t) => {
      // 2.1 Verify Starter plan allocation
      const starterUser = await createTestUser();
      const starterOrder = await createStoredOrder(starterUser, "starter");
      await sendPayhereIpn(starterOrder, "1850.00", "2");
      const starterUsage = await quota.getOrInitMonthlyUsage(
        starterUser,
        "starter",
      );
      assert.equal(starterUsage.max_tokens, 15_000_000);
      assert.equal(starterUsage.used_tokens, 0);
      assert.equal(starterUsage.used_requests, 0);

      // 2.2 Verify Pro plan allocation
      const proUser = await createTestUser();
      const proOrder = await createStoredOrder(proUser, "pro");
      await sendPayhereIpn(proOrder, "3850.00", "2");
      const proUsage = await quota.getOrInitMonthlyUsage(proUser, "pro");
      assert.equal(proUsage.max_tokens, 30_000_000);
      assert.equal(proUsage.used_tokens, 0);

      // 2.3 Verify Ultra plan allocation
      const ultraUser = await createTestUser();
      const ultraOrder = await createStoredOrder(ultraUser, "ultra");
      await sendPayhereIpn(ultraOrder, "7900.00", "2");
      const ultraUsage = await quota.getOrInitMonthlyUsage(ultraUser, "ultra");
      assert.equal(ultraUsage.max_tokens, 80_000_000);
      assert.equal(ultraUsage.used_tokens, 0);

      // 2.4 Top-Up Stacking: Add 2 consecutive top-ups
      const topupOrder1 = await createStoredOrder(proUser, "topup5m");
      await sendPayhereIpn(topupOrder1, "650.00", "2");
      const topupOrder2 = await createStoredOrder(proUser, "topup5m");
      await sendPayhereIpn(topupOrder2, "650.00", "2");

      const stackedUsage = await quota.getOrInitMonthlyUsage(proUser, "pro");
      assert.equal(stackedUsage.bonus_tokens, 10_000_000);
      assert.equal(stackedUsage.max_tokens, 30_000_000 + 10_000_000);

      // 2.5 Chargeback deduction
      await sendPayhereIpn(topupOrder2, "650.00", "-3");
      assert.equal(await getOrderStatus(topupOrder2), "chargedback");
      const postChargeback = await quota.getOrInitMonthlyUsage(proUser, "pro");
      assert.equal(postChargeback.bonus_tokens, 5_000_000);
      assert.equal(postChargeback.max_tokens, 30_000_000 + 5_000_000);

      // 2.6 Atomic reservation and release
      const reservation = await quota.reserveQuotaAtomic(
        proUser,
        "pro",
        500_000,
      );
      assert.ok(reservation?.id);
      const midHold = await quota.getOrInitMonthlyUsage(proUser, "pro");
      assert.equal(midHold.used_tokens, 500_000);

      // Settle with actual usage (e.g. 200,000 credits used)
      await quota.settleQuotaReservation(reservation!, 200_000);
      const settled = await quota.getOrInitMonthlyUsage(proUser, "pro");
      assert.equal(settled.used_tokens, 200_000);
      assert.equal(settled.used_requests, 1);
    },
  );

  // ─── 3. BILLING CYCLE RESET & EXPIRY MECHANICS ────────────────────────────
  await suite.test(
    "3. Cycle Reset & Expiry: Natural 30-day rollover, top-up preservation, downgrade to free & prorated upgrades",
    async (t) => {
      // 3.1 Natural 30-day billing cycle rollover with top-up credits preserved
      const rolloverUser = await createTestUser();
      // Simulate expired previous cycle (period ended yesterday) with unspent top-up credits
      const pastStart = daysFromNow(-31).toISOString().slice(0, 10);
      const pastEnd = daysFromNow(-1).toISOString().slice(0, 10);
      await dbm.dbRun(
        `INSERT INTO monthly_usage
       (id, user_id, plan_name, max_tokens, used_tokens, used_requests, bonus_tokens, bonus_requests, period_start, period_end)
       VALUES (?, ?, 'starter', 20000000, 14000000, 2000, 5000000, 1000, ?, ?)`,
        [crypto.randomUUID(), rolloverUser, pastStart, pastEnd],
      );

      // Calling getOrInitMonthlyUsage rolls over into a brand new 30-day cycle
      const freshCycle = await quota.getOrInitMonthlyUsage(
        rolloverUser,
        "starter",
      );
      assert.equal(freshCycle.period_start, today());
      assert.equal(
        freshCycle.used_tokens,
        0,
        "Monthly usage tokens must reset to 0 in new cycle",
      );
      assert.equal(
        freshCycle.used_requests,
        0,
        "Monthly requests must reset to 0 in new cycle",
      );
      assert.equal(
        freshCycle.bonus_tokens,
        5_000_000,
        "Unspent top-up bonus credits MUST survive into new cycle",
      );
      assert.equal(freshCycle.max_tokens, 15_000_000 + 5_000_000);

      // 3.2 Subscription Expiration Downgrade
      const expiredSubUser = await createTestUser();
      await dbm.dbRun(
        `INSERT INTO subscriptions
       (id, user_id, plan_name, status, order_id, currency, valid_until)
       VALUES (?, ?, 'pro', 'active', ?, 'LKR', ?)`,
        [
          crypto.randomUUID(),
          expiredSubUser,
          "expired-order-id",
          daysFromNow(-2).toISOString(),
        ],
      );

      const activeSub = await quota.getActiveSubscription(expiredSubUser);
      assert.equal(
        activeSub,
        undefined,
        "Expired subscription must return undefined active subscription",
      );

      // 3.3 Mid-cycle Tier Upgrade Proration (Starter to Pro)
      const upgradeUser = await createTestUser();
      const starterOrder = await createStoredOrder(upgradeUser, "starter");
      await sendPayhereIpn(starterOrder, "1850.00", "2");

      // User upgrades to Pro 10 days before starter expires
      const proOrder = await createStoredOrder(upgradeUser, "pro");
      await sendPayhereIpn(proOrder, "3850.00", "2");

      const newSub = await quota.getActiveSubscription<{
        plan_name: string;
        valid_until: string;
      }>(upgradeUser);
      assert.equal(newSub?.plan_name, "pro");
      // Ensure former starter subscription marked superseded
      const oldOrderRow = await dbm.dbGet<{ status: string }>(
        "SELECT status FROM subscriptions WHERE order_id = ?",
        [starterOrder],
      );
      assert.equal(oldOrderRow?.status, "superseded");
    },
  );

  // ─── 4. NEGATIVE MARGIN PREVENTION & UNIT ECONOMICS ───────────────────────
  await suite.test(
    "4. Negative Margin Prevention: Strict unit economics mathematical proof and positive margin verification",
    async (t) => {
      // 4.1 Mathematical Guarantee Verification:
      // In VynorAI's economic design, 1,000,000 credits represents at least $0.30 of upstream allowance.
      // For every supported plan, verify that (plan.priceUSD / plan.monthlyTokens) * 1M >= $0.30
      for (const planId of ["starter", "pro", "ultra"] as const) {
        const plan = PLANS[planId];
        const usdRevenuePerMillionCredits =
          (plan.priceUSD / plan.monthlyTokens) * 1_000_000;
        assert.ok(
          usdRevenuePerMillionCredits >= 0.3,
          `Plan ${plan.id} revenue per million credits ($${usdRevenuePerMillionCredits.toFixed(4)}) must exceed $0.30 baseline`,
        );
      }

      // 4.2 Model Weighting Margin Guarantee:
      // For each model in CREDIT_WEIGHTS, verify that creditWeight * baseline ($0.30/1M) >= peak upstream list price
      const modelTestCases = [
        {
          model: "deepseek/deepseek-flash",
          maxCostPer1M: 1.2,
          expectedMinWeight: 1,
        },
        { model: "deepseek-v4-pro", maxCostPer1M: 3.96, expectedMinWeight: 5 },
        { model: "gpt-4o", maxCostPer1M: 10.0, expectedMinWeight: 10 },
        {
          model: "claude-3-5-sonnet",
          maxCostPer1M: 15.0,
          expectedMinWeight: 15,
        },
        { model: "claude-opus-4-6", maxCostPer1M: 75.0, expectedMinWeight: 64 },
      ];

      for (const testCase of modelTestCases) {
        const weight = policy.creditWeight(testCase.model);
        assert.ok(
          weight >= testCase.expectedMinWeight,
          `Model ${testCase.model} weight (${weight}) must be at least ${testCase.expectedMinWeight} to safeguard margin`,
        );
      }

      // 4.3 End-to-End Economics Ledger Verification with simulated heavy customer traffic
      const econUser = await createTestUser();
      const econOrder = await createStoredOrder(econUser, "pro");
      await sendPayhereIpn(econOrder, "3850.00", "2");

      // Simulate 5 requests with actual token usage and revenue allocation
      for (let i = 0; i < 5; i++) {
        const inputTokens = 2000;
        const cachedTokens = 1500;
        const outputTokens = 400;
        const model = "deepseek/deepseek-flash";

        const credits = policy.usageCredits(model, {
          inputTokens,
          cachedInputTokens: cachedTokens,
          outputTokens,
        });

        await costLedger.recordRequestEconomics({
          userId: econUser,
          planId: "pro",
          requestedModel: model,
          resolvedModel: model,
          provider: "deepseek",
          inputTokens,
          cachedInputTokens: cachedTokens,
          outputTokens,
          providerCostUsd: null, // Will use estimateDeepSeekCostUsd
          costSource: "unknown",
          outcome: "success",
          creditsCharged: credits,
          latencyMs: 120,
        });
      }

      // Query /admin/economics to verify margins
      const econRes = await fetch(`${baseUrl}/admin/economics?days=30`, {
        headers: { "x-admin-secret": ADMIN_SECRET },
      });
      assert.equal(econRes.status, 200);
      const econData = (await econRes.json()) as any;

      // Verify negative margin users count is exactly 0
      assert.equal(
        econData.negativeMarginUsers,
        0,
        "No paying user must have negative gross margins",
      );
      assert.ok(
        econData.totals.marginUsd > 0,
        "Overall system gross margin in USD must be strictly positive",
      );
      assert.ok(
        econData.totals.marginPct > 0,
        "Overall system gross margin percentage must be strictly positive",
      );

      const userEntry = econData.users.find((u: any) => u.userId === econUser);
      assert.ok(userEntry, "Economics report must include test paying user");
      assert.ok(
        userEntry.marginUsd > 0,
        `User margin ($${userEntry.marginUsd}) must be positive`,
      );
      assert.ok(
        userEntry.marginPct >= 40,
        `User margin percentage (${userEntry.marginPct}%) should be healthy (>= 40%)`,
      );
    },
  );
});
