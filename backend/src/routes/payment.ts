import { Router, Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";
import { config, getPlan } from "../config.js";
import {
  billingGet as dbGet,
  billingRun as dbRun,
} from "../services/billingDb.js";
import { generatePayhereHash, verifyPayhereIpn } from "../services/payhere.js";
import { requireAuth } from "./auth.js";
import {
  creditTopup,
  getActiveSubscription,
  getOrInitMonthlyUsage,
  reverseTopup,
  startPaidCycle,
} from "../services/monthlyQuota.js";
import {
  isTopupPlan,
  planDurationDays,
  StoredOrder,
  validateIpnAgainstOrder,
} from "../services/billingPolicy.js";
import { invalidateAuthCache } from "../services/aiProxy.js";
import {
  getEffectivePlan,
  getEffectivePlans,
} from "../services/planManager.js";

export const paymentRouter = Router();

/** Plans offered on the website, in display order. */
const PUBLIC_PLAN_IDS = [
  "free",
  "starter",
  "pro",
  "ultra",
  "topup5m",
  "pro_yearly",
];

/**
 * GET /api/payment/plans — public price list for the website. Reads the same
 * effective plans (admin overrides included) that checkout charges.
 */
paymentRouter.get("/plans", async (_req: Request, res: Response) => {
  const plans = await getEffectivePlans();
  res.setHeader("Cache-Control", "public, max-age=60");
  res.json({
    creditUnit:
      "Credits follow real cost: new input 1, cached input 0.1, output 4 per token; other models use more credits",
    plans: PUBLIC_PLAN_IDS.filter((id) => plans[id]).map((id) => {
      const p = plans[id];
      return {
        id: p.id,
        name: p.displayName,
        priceLKR: p.priceLKR,
        priceUSD: p.priceUSD,
        monthlyCredits: p.monthlyTokens,
        monthlyRequests: p.monthlyRequests,
        contextWindow: p.contextWindow,
        features: p.features,
        topup: isTopupPlan(p.id),
        yearly: p.id.endsWith("_yearly"),
      };
    }),
  });
});

const DAY_MS = 24 * 60 * 60 * 1000;

interface OrderRow extends StoredOrder {
  id: string;
  order_id: string;
  valid_until: string;
}

/**
 * Activate a paid plan. Renewing the same plan extends from the current
 * expiry; switching plans supersedes the old one and starts a fresh cycle.
 */
async function activatePlan(order: OrderRow, paymentId: string): Promise<void> {
  const plan = getPlan(order.plan_name);
  const current = await getActiveSubscription<{
    id: string;
    plan_name: string;
    valid_until: string;
  }>(order.user_id);
  const isRenewal = current?.plan_name === plan.id;
  const startsAt = isRenewal ? new Date(current!.valid_until) : new Date();
  const validUntil = new Date(
    startsAt.getTime() + planDurationDays(plan.id) * DAY_MS,
  );

  const claimed = await dbRun(
    `UPDATE subscriptions SET status = 'active', payment_id = ?, valid_until = ?
     WHERE order_id = ? AND status = 'pending'`,
    [paymentId, validUntil.toISOString(), order.order_id],
  );
  if (claimed.changes === 0) return; // Already processed by a concurrent/retried IPN.

  try {
    if (isRenewal) {
      // Current cycle stays; the next cycle starts automatically when it ends.
      await getOrInitMonthlyUsage(order.user_id, plan.id);
    } else {
      await dbRun(
        `UPDATE subscriptions SET status = 'superseded'
         WHERE user_id = ? AND status = 'active' AND order_id != ? AND plan_name NOT LIKE 'topup%'`,
        [order.user_id, order.order_id],
      );
      await startPaidCycle(order.user_id, plan.id, validUntil);
    }
  } catch (err) {
    // Re-open the order so PayHere's retry can complete activation.
    await dbRun(
      "UPDATE subscriptions SET status = 'pending' WHERE order_id = ?",
      [order.order_id],
    );
    throw err;
  }
}

async function applyTopup(order: OrderRow, paymentId: string): Promise<void> {
  const plan = getPlan(order.plan_name);
  // Top-up orders end as 'credited', never 'active', so they cannot become a tier.
  const claimed = await dbRun(
    `UPDATE subscriptions SET status = 'credited', payment_id = ?
     WHERE order_id = ? AND status = 'pending'`,
    [paymentId, order.order_id],
  );
  if (claimed.changes === 0) return;

  try {
    await creditTopup(order.user_id, plan.monthlyTokens, plan.monthlyRequests);
  } catch (err) {
    await dbRun(
      "UPDATE subscriptions SET status = 'pending' WHERE order_id = ?",
      [order.order_id],
    );
    throw err;
  }
}

async function applyChargeback(order: OrderRow): Promise<void> {
  const reversed = await dbRun(
    `UPDATE subscriptions SET status = 'chargedback'
     WHERE order_id = ? AND status IN ('active', 'credited')`,
    [order.order_id],
  );
  if (reversed.changes > 0 && order.status === "credited") {
    const plan = getPlan(order.plan_name);
    await reverseTopup(order.user_id, plan.monthlyTokens, plan.monthlyRequests);
  }
}

/**
 * Create PayHere Checkout Session
 */
paymentRouter.post(
  "/checkout",
  requireAuth,
  async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      const { plan = "starter", phone, address, city } = req.body;

      // Same source as GET /plans, so the price shown is the price charged
      // (admin price overrides included).
      const planConfig = await getEffectivePlan(String(plan));
      if (!planConfig || planConfig.id === "free" || planConfig.id !== plan) {
        return res
          .status(400)
          .json({ error: "Invalid subscription plan selected for payment" });
      }

      const orderId = `vynor_${uuidv4().replace(/-/g, "")}`;
      const hash = generatePayhereHash(orderId, planConfig.priceLKR, "LKR");

      // Save pending order. valid_until is provisional; activation recomputes it.
      const tempValidUntil = new Date(
        Date.now() + planDurationDays(planConfig.id) * DAY_MS,
      ).toISOString();
      const amountMinor = Math.round(planConfig.priceLKR * 100);
      await dbRun(
        `INSERT INTO subscriptions
       (id, user_id, plan_name, status, order_id, amount_minor, amount, currency, valid_until)
       VALUES (?, ?, ?, 'pending', ?, ?, ?, 'LKR', ?)`,
        [
          uuidv4(),
          user.id,
          planConfig.id,
          orderId,
          amountMinor,
          planConfig.priceLKR,
          tempValidUntil,
        ],
      );

      res.json({
        success: true,
        checkoutUrl: config.payhere.checkoutUrl,
        params: {
          merchant_id: config.payhere.merchantId,
          return_url: config.payhere.returnUrl,
          cancel_url: config.payhere.cancelUrl,
          notify_url: config.payhere.notifyUrl,
          order_id: orderId,
          items: `VynorAI ${planConfig.displayName}`,
          currency: "LKR",
          amount: planConfig.priceLKR.toFixed(2),
          first_name: user.name || "Developer",
          last_name: "User",
          email: user.email,
          // PayHere requires a phone; prefer the customer's own number when supplied.
          phone:
            typeof phone === "string" && phone.trim()
              ? phone.trim()
              : "0771234567",
          address:
            typeof address === "string" && address.trim()
              ? address.trim()
              : "Sri Lanka",
          city:
            typeof city === "string" && city.trim() ? city.trim() : "Colombo",
          country: "Sri Lanka",
          hash: hash,
          // Informational only — the IPN handler never trusts these.
          custom_1: user.id,
          custom_2: planConfig.id,
        },
      });
    } catch (err: any) {
      console.error("PayHere checkout generation error:", err);
      res
        .status(500)
        .json({ error: "Failed to generate PayHere checkout parameters" });
    }
  },
);

/**
 * PayHere IPN Webhook (Instant Payment Notification)
 * PayHere calls this server-to-server endpoint when a payment succeeds or fails.
 * It may deliver the same notification more than once; every transition is
 * conditional on the order's current status, so replays are no-ops.
 */
paymentRouter.post("/notify", async (req: Request, res: Response) => {
  try {
    const body = req.body;
    const { order_id, payment_id, status_code } = body;
    console.log(`[PayHere IPN] order=${order_id} status=${status_code}`);

    if (!verifyPayhereIpn(body)) {
      console.warn("[PayHere IPN] Invalid MD5 signature received!");
      return res.status(400).send("Invalid signature");
    }

    const order = await dbGet<OrderRow>(
      "SELECT id, order_id, user_id, plan_name, status, amount_minor, currency, valid_until FROM subscriptions WHERE order_id = ?",
      [order_id],
    );
    const check = validateIpnAgainstOrder(
      body,
      order,
      config.payhere.merchantId,
    );
    if (!check.ok) {
      console.warn(`[PayHere IPN] Rejected order=${order_id}: ${check.reason}`);
      return res.status(400).send("Order mismatch");
    }

    // Status code: 2 = Success, 0 = Pending, -1 = Canceled, -2 = Failed, -3 = Chargeback
    switch (String(status_code)) {
      case "2":
        if (isTopupPlan(order!.plan_name)) await applyTopup(order!, payment_id);
        else await activatePlan(order!, payment_id);
        console.log(
          `[PayHere IPN] Paid order=${order_id} user=${order!.user_id} plan=${order!.plan_name}`,
        );
        break;
      case "-1":
      case "-2":
        await dbRun(
          "UPDATE subscriptions SET status = ? WHERE order_id = ? AND status = 'pending'",
          [String(status_code) === "-1" ? "cancelled" : "failed", order_id],
        );
        break;
      case "-3":
        await applyChargeback(order!);
        console.warn(
          `[PayHere IPN] Chargeback order=${order_id} user=${order!.user_id}`,
        );
        break;
      default:
        break; // "0" (pending) — wait for the final notification.
    }

    invalidateAuthCache();
    res.status(200).send("OK");
  } catch (err: any) {
    console.error("PayHere IPN processing error:", err);
    res.status(500).send("Server error");
  }
});

/**
 * Manual test endpoint to simulate PayHere activation in sandbox / test mode
 */
paymentRouter.post(
  "/test-activate",
  requireAuth,
  async (req: Request, res: Response) => {
    // Hardened security: Require ADMIN_SECRET or enforce development environment
    const adminSecret = req.headers["x-admin-secret"];
    const isDev = config.nodeEnv === "development";
    const configuredAdminSecret = process.env.ADMIN_SECRET;
    const isValidAdmin = Boolean(
      configuredAdminSecret &&
        adminSecret &&
        adminSecret === configuredAdminSecret,
    );

    if (!isDev && !isValidAdmin) {
      return res.status(403).json({
        error: "Access denied. Test activation is disabled in production.",
      });
    }

    const user = (req as any).user;
    const { plan = "pro" } = req.body;
    const planDef = getPlan(plan);

    const orderId = `test_${uuidv4().replace(/-/g, "")}`;
    const amountMinor = Math.round(planDef.priceLKR * 100);
    await dbRun(
      `INSERT INTO subscriptions
     (id, user_id, plan_name, status, order_id, amount_minor, amount, currency, valid_until)
     VALUES (?, ?, ?, 'pending', ?, ?, ?, 'LKR', ?)`,
      [
        uuidv4(),
        user.id,
        planDef.id,
        orderId,
        amountMinor,
        planDef.priceLKR,
        new Date().toISOString(),
      ],
    );
    const order = await dbGet<OrderRow>(
      "SELECT id, order_id, user_id, plan_name, status, amount_minor, currency, valid_until FROM subscriptions WHERE order_id = ?",
      [orderId],
    );

    // Exercise the same activation path as a real IPN.
    if (isTopupPlan(planDef.id)) await applyTopup(order!, "test_pay_id");
    else await activatePlan(order!, "test_pay_id");
    invalidateAuthCache();

    res.json({
      success: true,
      message: `Test order activated on "${planDef.displayName}"!`,
      plan: planDef,
    });
  },
);
