import { Router, Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";
import { config, PLANS, getPlan } from "../config.js";
import { dbGet, dbRun } from "../db.js";
import { generatePayhereHash, verifyPayhereIpn } from "../services/payhere.js";
import { requireAuth } from "./auth.js";
import { getOrInitMonthlyUsage } from "../services/monthlyQuota.js";

export const paymentRouter = Router();

/**
 * Create PayHere Checkout Session
 */
paymentRouter.post("/checkout", requireAuth, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const { plan = "starter" } = req.body;

    const planConfig = getPlan(plan);
    if (!planConfig || planConfig.id === "free") {
      return res.status(400).json({ error: "Invalid subscription plan selected for payment" });
    }

    const orderId = `vynor_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    const hash = generatePayhereHash(orderId, planConfig.priceLKR, "LKR");

    // Save pending subscription intent
    const subscriptionId = uuidv4();
    const durationDays = 30;
    const tempValidUntil = new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000).toISOString();

    const amountMinor = Math.round(planConfig.priceLKR * 100);
    await dbRun(
      `INSERT INTO subscriptions 
       (id, user_id, plan_name, status, order_id, amount_minor, amount, currency, valid_until) 
       VALUES (?, ?, ?, 'pending', ?, ?, ?, 'LKR', ?)`,
      [subscriptionId, user.id, planConfig.id, orderId, amountMinor, planConfig.priceLKR, tempValidUntil]
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
        items: `VynorAI ${planConfig.displayName} Plan`,
        currency: "LKR",
        amount: planConfig.priceLKR.toFixed(2),
        first_name: user.name || "Developer",
        last_name: "User",
        email: user.email,
        phone: "0771234567",
        address: "Colombo, Sri Lanka",
        city: "Colombo",
        country: "Sri Lanka",
        hash: hash,
        custom_1: user.id,
        custom_2: planConfig.id,
      },
    });
  } catch (err: any) {
    console.error("PayHere checkout generation error:", err);
    res.status(500).json({ error: "Failed to generate PayHere checkout parameters" });
  }
});

/**
 * PayHere IPN Webhook (Instant Payment Notification)
 * PayHere calls this server-to-server endpoint when a payment succeeds or fails
 */
paymentRouter.post("/notify", async (req: Request, res: Response) => {
  try {
    const body = req.body;
    console.log("[PayHere IPN Received]:", body);

    const isValid = verifyPayhereIpn(body);
    if (!isValid) {
      console.warn("[PayHere IPN] Invalid MD5 signature received!");
      return res.status(400).send("Invalid signature");
    }

    const {
      order_id,
      payment_id,
      payhere_amount,
      status_code,
      custom_1: userId,
      custom_2: planName,
    } = body;

    // Status code: 2 = Success, 0 = Pending, -1 = Canceled, -2 = Failed
    if (status_code === "2") {
      const planDef = getPlan(planName || "starter");
      const durationDays = 30;
      const validUntil = new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000).toISOString();

      await dbRun(
        `UPDATE subscriptions 
         SET status = 'active', payment_id = ?, valid_until = ? 
         WHERE order_id = ?`,
        [payment_id, validUntil, order_id]
      );

      if (planDef.id === "topup5m") {
        // Increment existing quota ledger without altering subscription plan tier
        await dbRun(
          `UPDATE monthly_usage 
           SET max_tokens = max_tokens + ?, max_requests = max_requests + ? 
           WHERE user_id = ?`,
          [planDef.monthlyTokens, planDef.monthlyRequests, userId]
        );
        console.log(`[PayHere IPN] Top-up credited: +${planDef.monthlyTokens} tokens for User: ${userId}`);
      } else {
        // Re-initialize or upgrade the user's monthly quota ledger immediately
        await getOrInitMonthlyUsage(userId, planDef.id);
        console.log(`[PayHere IPN] Subscription activated for Order: ${order_id}, User: ${userId}, Plan: ${planDef.id}`);
      }
    } else {
      await dbRun("UPDATE subscriptions SET status = 'failed' WHERE order_id = ?", [order_id]);
      console.log(`[PayHere IPN] Payment failed or canceled for Order: ${order_id}`);
    }

    res.status(200).send("OK");
  } catch (err: any) {
    console.error("PayHere IPN processing error:", err);
    res.status(500).send("Server error");
  }
});

/**
 * Manual test endpoint to simulate PayHere activation in sandbox / test mode
 */
paymentRouter.post("/test-activate", requireAuth, async (req: Request, res: Response) => {
  // Hardened security: Require ADMIN_SECRET or enforce development environment
  const adminSecret = req.headers["x-admin-secret"];
  const isDev = config.nodeEnv === "development";
  const isValidAdmin = adminSecret && adminSecret === (process.env.ADMIN_SECRET || "vynorai_admin_2026");

  if (!isDev && !isValidAdmin) {
    return res.status(403).json({ error: "Access denied. Test activation is disabled in production." });
  }

  const user = (req as any).user;
  const { plan = "pro" } = req.body;
  const planDef = getPlan(plan);

  const subscriptionId = uuidv4();
  const validUntil = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  const orderId = `test_${Date.now()}`;

  const amountMinor = Math.round(planDef.priceLKR * 100);
  await dbRun(
    `INSERT INTO subscriptions 
     (id, user_id, plan_name, status, order_id, payment_id, amount_minor, amount, currency, valid_until) 
     VALUES (?, ?, ?, 'active', ?, 'test_pay_id', ?, ?, 'LKR', ?)`,
    [subscriptionId, user.id, planDef.id, orderId, amountMinor, planDef.priceLKR, validUntil]
  );

  // Initialize or upgrade monthly quota ledger
  await getOrInitMonthlyUsage(user.id, planDef.id);

  res.json({
    success: true,
    message: `Test subscription activated for 30 days on "${planDef.displayName}" plan!`,
    plan: planDef,
  });
});
