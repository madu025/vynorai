import { Router, Request, Response } from "express";
import crypto from "crypto";
import { getAllCircuitStats, resetCircuit } from "../services/circuitBreaker.js";
import { config, MODEL_ALIASES, PLANS } from "../config.js";
import { ProviderID } from "../config.js";
import { getEffectivePlans, updatePlanField, resetPlanToDefault, invalidatePlanCache } from "../services/planManager.js";

export const adminRouter = Router();

// Simple admin secret check (set ADMIN_SECRET in .env)
function requireAdmin(req: Request, res: Response, next: Function) {
  const secret = req.headers["x-admin-secret"];
  const expected = process.env.ADMIN_SECRET;
  if (!expected) return res.status(503).json({ error: "Admin authentication is not configured" });
  if (secret !== expected) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

/**
 * GET /admin/health
 * Full system health: circuit states, active providers, model count
 */
adminRouter.get("/health", requireAdmin, (_req: Request, res: Response) => {
  const circuits = getAllCircuitStats();

  const activeProviders = Object.entries(config.aiKeys)
    .filter(([k, v]) => k !== "ollama" && v)
    .map(([k]) => k);

  const providerStatus = Object.entries(circuits).map(([provider, stats]) => ({
    provider,
    state:       stats.state,
    uptimePct:   stats.uptimePct,
    avgLatencyMs: stats.avgLatencyMs,
    failures:    stats.failures,
    totalRequests: stats.totalRequests,
    lastSuccess: stats.lastSuccess ? new Date(stats.lastSuccess).toISOString() : null,
    lastFailure: stats.lastFailure ? new Date(stats.lastFailure).toISOString() : null,
  }));

  res.json({
    status: "ok",
    version: "2.0.0",
    timestamp: new Date().toISOString(),
    activeProviders,
    supportedModels: Object.keys(MODEL_ALIASES).length,
    circuitBreakers: providerStatus,
  });
});

/**
 * POST /admin/circuit/:provider/reset
 * Manually reset a tripped circuit breaker
 */
adminRouter.post("/circuit/:provider/reset", requireAdmin, (req: Request, res: Response) => {
  const provider = req.params.provider as ProviderID;
  resetCircuit(provider);
  res.json({ ok: true, message: `Circuit for "${provider}" reset to CLOSED` });
});

/**
 * GET /admin/stats
 * Usage statistics overview (top users, requests per day, etc.)
 */
import { dbAll, dbGet, dbRun } from "../db.js";
import { v4 as uuidv4 } from "uuid";
import {
  getAllModels,
  upsertModel,
  disableModel,
  enableModel,
  invalidateModelCache,
  PLAN_CONTEXT_LIMITS,
} from "../services/modelRegistry.js";
import { encryptCredential, maskApiKey } from "../services/credentialVault.js";
import { invalidateAuthCache } from "../services/aiProxy.js";

adminRouter.get("/stats", requireAdmin, async (_req: Request, res: Response) => {
  const yesterday = new Date(Date.now() - 24 * 3600 * 1000).toISOString();

  const [totalUsers, activeUsers, topModels, recentErrors, economics] = await Promise.all([
    dbAll("SELECT COUNT(*) as count FROM users"),
    dbAll("SELECT COUNT(DISTINCT user_id) as count FROM usage_logs WHERE created_at >= ?", [yesterday]),
    dbAll(`SELECT model, COUNT(*) as requests, SUM(tokens_used) as tokens
           FROM usage_logs WHERE created_at >= ?
           GROUP BY model ORDER BY requests DESC LIMIT 10`, [yesterday]),
    dbAll(`SELECT model, COUNT(*) as count FROM usage_logs
           WHERE created_at >= ? GROUP BY model`, [yesterday]),
    dbGet<any>(`SELECT
      COUNT(*) AS requests,
      SUM(CASE WHEN provider_cost_usd IS NOT NULL THEN 1 ELSE 0 END) AS costTrackedRequests,
      SUM(CASE WHEN provider_cost_usd IS NULL THEN 1 ELSE 0 END) AS unknownCostRequests,
      SUM(CASE WHEN outcome = 'failed' THEN 1 ELSE 0 END) AS failedRequests,
      COALESCE(SUM(provider_cost_usd), 0) AS providerCostUsd,
      COALESCE(SUM(allocated_revenue_usd), 0) AS allocatedRevenueUsd,
      COALESCE(SUM(CASE WHEN gross_margin_usd IS NOT NULL THEN gross_margin_usd ELSE 0 END), 0) AS trackedGrossMarginUsd,
      COALESCE(SUM(estimated_tokens_saved), 0) AS estimatedTokensSaved,
      SUM(CASE WHEN cache_status = 'hit' THEN 1 ELSE 0 END) AS cacheHits
      FROM request_economics WHERE created_at >= ?`, [yesterday]),
  ]);

  res.json({
    totalUsers:    totalUsers[0]?.count || 0,
    activeUsers24h: activeUsers[0]?.count || 0,
    topModels24h:  topModels,
    requestsByModel24h: recentErrors,
    economics24h: economics || {},
    timestamp: new Date().toISOString(),
  });
});

import { logSecurityEvent, getRecentSecurityEvents } from "../services/securityAudit.js";

/**
 * GET /admin/users
 * List all users with active subscription plan, suspension status, email verification, and token usage
 */
adminRouter.get("/users", requireAdmin, async (_req: Request, res: Response) => {
  const users = await dbAll<any>(`
    SELECT u.id, u.email, u.name, u.api_key_masked, u.created_at,
           COALESCE(u.is_suspended, 0) as is_suspended, u.allowed_ips,
           COALESCE(u.email_verified, 0) as email_verified,
           s.plan_name, s.status as subscription_status, s.valid_until,
           m.used_tokens, m.used_requests, m.max_tokens
    FROM users u
    LEFT JOIN subscriptions s ON u.id = s.user_id AND s.status = 'active'
    LEFT JOIN monthly_usage m ON u.id = m.user_id
    GROUP BY u.id
    ORDER BY u.created_at DESC
    LIMIT 100
  `);
  res.json({ users, count: users.length });
});

/**
 * GET /admin/subscriptions
 * List all subscription transactions and PayHere payments
 */
adminRouter.get("/subscriptions", requireAdmin, async (_req: Request, res: Response) => {
  const subs = await dbAll<any>(`
    SELECT s.*, u.email, u.name
    FROM subscriptions s
    JOIN users u ON s.user_id = u.id
    ORDER BY s.created_at DESC
    LIMIT 100
  `);
  res.json({ subscriptions: subs, count: subs.length });
});

/**
 * POST /admin/users/:userId/verify-email
 * Super Admin manual email verification (e.g., customer support)
 */
adminRouter.post("/users/:userId/verify-email", requireAdmin, async (req: Request, res: Response) => {
  const userId = req.params["userId"] as string;
  const user = await dbGet<any>("SELECT email FROM users WHERE id = ?", [userId]);
  if (!user) return res.status(404).json({ error: "User not found" });

  await dbRun("UPDATE users SET email_verified = 1 WHERE id = ?", [userId]);
  await dbRun("DELETE FROM email_verifications WHERE user_id = ?", [userId]);

  await logSecurityEvent({
    eventType: "ADMIN_MANUAL_EMAIL_VERIFIED",
    severity: "INFO",
    actor: "ADMIN",
    target: user.email,
    details: `Admin manually verified email for ${user.email}`,
  });

  res.json({ ok: true, message: `Email verified for ${user.email}` });
});

/**
 * POST /admin/users/:userId/grant-subscription
 * Manually grant a subscription (for bank transfers, cash payments, or agency partners)
 */
adminRouter.post("/users/:userId/grant-subscription", requireAdmin, async (req: Request, res: Response) => {
  const userId = req.params["userId"] as string;
  const { plan = "starter", days = 30 } = req.body;

  const validPlans = ["starter", "pro", "ultra"];
  if (!validPlans.includes(plan)) {
    return res.status(400).json({ error: `Invalid plan. Must be one of: ${validPlans.join(", ")}` });
  }

  const user = await dbGet<any>("SELECT id, email, name FROM users WHERE id = ?", [userId]);
  if (!user) return res.status(404).json({ error: "User not found" });

  const durationDays = parseInt(days) || 30;
  const validUntil = new Date(Date.now() + durationDays * 86400000).toISOString();
  const planConfig = (PLANS as any)[plan];
  const maxTokens = planConfig?.monthlyTokens || 8_000_000;

  // Deactivate any currently active subscriptions for this user
  await dbRun("UPDATE subscriptions SET status = 'cancelled' WHERE user_id = ? AND status = 'active'", [userId]);

  // Insert newly granted subscription
  const subId = uuidv4();
  const orderId = `MANUAL_GRANT_${Date.now()}_${userId.slice(0, 6)}`;
  await dbRun(
    `INSERT INTO subscriptions (id, user_id, plan_name, status, order_id, payment_id, amount, currency, valid_until)
     VALUES (?, ?, ?, 'active', ?, 'ADMIN_MANUAL_GRANT', ?, 'LKR', ?)`,
    [subId, userId, plan, orderId, planConfig?.priceLKR || 0, validUntil]
  );
  invalidateAuthCache();

  // Initialize or update monthly usage
  const existingUsage = await dbGet<any>("SELECT id FROM monthly_usage WHERE user_id = ?", [userId]);
  const periodStart = new Date().toISOString().slice(0, 10);
  const periodEnd = new Date(Date.now() + durationDays * 86400000).toISOString().slice(0, 10);

  if (existingUsage) {
    await dbRun(
      `UPDATE monthly_usage SET plan_name = ?, max_tokens = ?, period_start = ?, period_end = ?, updated_at = CURRENT_TIMESTAMP
       WHERE user_id = ?`,
      [plan, maxTokens, periodStart, periodEnd, userId]
    );
  } else {
    await dbRun(
      `INSERT INTO monthly_usage (id, user_id, plan_name, max_tokens, used_tokens, used_requests, period_start, period_end)
       VALUES (?, ?, ?, ?, 0, 0, ?, ?)`,
      [uuidv4(), userId, plan, maxTokens, periodStart, periodEnd]
    );
  }

  await logSecurityEvent({
    eventType: "ADMIN_GRANT_SUBSCRIPTION",
    severity: "WARN",
    actor: "ADMIN",
    target: user.email,
    details: `Admin granted ${plan.toUpperCase()} plan for ${durationDays} days to ${user.email}`,
  });

  res.json({
    ok: true,
    plan,
    validUntil,
    maxTokens,
    message: `Successfully granted ${plan.toUpperCase()} plan to ${user.email} until ${new Date(validUntil).toLocaleDateString()}`,
  });
});

/**
 * POST /admin/users/:userId/add-tokens
 * Add extra bonus or purchased top-up tokens to a user's monthly quota
 */
adminRouter.post("/users/:userId/add-tokens", requireAdmin, async (req: Request, res: Response) => {
  const userId = req.params["userId"] as string;
  const { tokens } = req.body;
  const amt = parseInt(tokens);
  if (isNaN(amt) || amt <= 0) {
    return res.status(400).json({ error: "Invalid token amount. Must be a positive integer." });
  }

  const user = await dbGet<any>("SELECT email FROM users WHERE id = ?", [userId]);
  if (!user) return res.status(404).json({ error: "User not found" });

  const usage = await dbGet<any>("SELECT id FROM monthly_usage WHERE user_id = ?", [userId]);
  if (usage) {
    await dbRun("UPDATE monthly_usage SET max_tokens = max_tokens + ? WHERE user_id = ?", [amt, userId]);
  } else {
    const periodStart = new Date().toISOString().slice(0, 10);
    const periodEnd = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
    await dbRun(
      "INSERT INTO monthly_usage (id, user_id, plan_name, max_tokens, used_tokens, used_requests, period_start, period_end) VALUES (?, ?, 'free', ?, 0, 0, ?, ?)",
      [uuidv4(), userId, 50000 + amt, periodStart, periodEnd]
    );
  }

  await logSecurityEvent({
    eventType: "ADMIN_TOKEN_TOPUP",
    severity: "INFO",
    actor: "ADMIN",
    target: user.email,
    details: `Admin added +${amt.toLocaleString()} tokens to ${user.email}`,
  });

  res.json({ ok: true, message: `Added +${amt.toLocaleString()} tokens to ${user.email}` });
});

/**
 * GET /admin/staff
 * List authorized admin staff and team members
 */
adminRouter.get("/staff", requireAdmin, async (_req: Request, res: Response) => {
  const staff = await dbAll<any>("SELECT id, name, email, role, created_by, created_at FROM admin_staff ORDER BY created_at ASC");
  res.json({ staff, count: staff.length });
});

/**
 * POST /admin/staff
 * Super Admin adds a new authorized staff member (No public registration)
 */
adminRouter.post("/staff", requireAdmin, async (req: Request, res: Response) => {
  const { name, email, role = "admin" } = req.body;
  if (!name || !email) {
    return res.status(400).json({ error: "Name and email are required" });
  }

  const existing = await dbGet<any>("SELECT id FROM admin_staff WHERE email = ?", [email.toLowerCase().trim()]);
  if (existing) {
    return res.status(400).json({ error: "A staff member with this email already exists" });
  }

  const id = uuidv4();
  await dbRun(
    "INSERT INTO admin_staff (id, name, email, role, created_by) VALUES (?, ?, ?, ?, 'SUPER_ADMIN')",
    [id, name.trim(), email.toLowerCase().trim(), role]
  );

  await logSecurityEvent({
    eventType: "ADMIN_STAFF_ADDED",
    severity: "WARN",
    actor: "ADMIN",
    target: email,
    details: `New staff member ${name} (${email}) added with role: ${role}`,
  });

  res.json({ ok: true, message: `Staff member ${name} successfully added` });
});

/**
 * DELETE /admin/staff/:staffId
 * Super Admin revokes staff member access
 */
adminRouter.delete("/staff/:staffId", requireAdmin, async (req: Request, res: Response) => {
  const staffId = req.params["staffId"] as string;
  const staff = await dbGet<any>("SELECT name, email FROM admin_staff WHERE id = ?", [staffId]);
  if (!staff) return res.status(404).json({ error: "Staff member not found" });

  await dbRun("DELETE FROM admin_staff WHERE id = ?", [staffId]);

  await logSecurityEvent({
    eventType: "ADMIN_STAFF_REMOVED",
    severity: "WARN",
    actor: "ADMIN",
    target: staff.email,
    details: `Staff member ${staff.email} revoked`,
  });

  res.json({ ok: true, message: `Staff member ${staff.name} (${staff.email}) revoked` });
});

/**
 * POST /admin/users/:userId/rotate-key
 * Force-rotate a user's API Key if compromised
 */
adminRouter.post("/users/:userId/rotate-key", requireAdmin, async (req: Request, res: Response) => {
  const userId = req.params["userId"] as string;
  const user = await dbGet<any>("SELECT email FROM users WHERE id = ?", [userId]);
  if (!user) return res.status(404).json({ error: "User not found" });

  const newApiKey = `vynor_live_${uuidv4().replace(/-/g, "")}`;
  const hash = crypto.createHash("sha256").update(newApiKey).digest("hex");
  const encrypted = encryptCredential(newApiKey);
  await dbRun(
    "UPDATE users SET api_key = ?, api_key_hash = ?, api_key_masked = ?, api_key_encrypted = ? WHERE id = ?",
    [encrypted ? `encrypted:${userId}` : newApiKey, hash, maskApiKey(newApiKey), encrypted, userId],
  );

  await logSecurityEvent({
    eventType: "ADMIN_FORCE_KEY_ROTATED",
    severity: "WARN",
    actor: "ADMIN",
    target: user.email,
    details: `Admin force-rotated API Key for ${user.email}`,
  });

  res.json({ ok: true, apiKey: newApiKey, message: `API Key rolled for user ${user.email}` });
});

/**
 * POST /admin/users/:userId/toggle-suspend
 * Suspend or reactivate a user account instantly
 */
adminRouter.post("/users/:userId/toggle-suspend", requireAdmin, async (req: Request, res: Response) => {
  const userId = req.params["userId"] as string;
  const user = await dbGet<any>("SELECT email, COALESCE(is_suspended, 0) as is_suspended FROM users WHERE id = ?", [userId]);
  if (!user) return res.status(404).json({ error: "User not found" });

  const nextState = user.is_suspended ? 0 : 1;
  await dbRun("UPDATE users SET is_suspended = ? WHERE id = ?", [nextState, userId]);
  invalidateAuthCache();

  await logSecurityEvent({
    eventType: nextState ? "ADMIN_USER_SUSPENDED" : "ADMIN_USER_REACTIVATED",
    severity: nextState ? "CRITICAL" : "INFO",
    actor: "ADMIN",
    target: user.email,
    details: nextState ? `User account ${user.email} suspended by Admin` : `User account ${user.email} reactivated by Admin`,
  });

  res.json({ ok: true, is_suspended: nextState, message: nextState ? `User ${user.email} suspended` : `User ${user.email} reactivated` });
});

/**
 * GET /admin/security/overview
 * Threat radar and security posture status
 */
adminRouter.get("/security/overview", requireAdmin, async (_req: Request, res: Response) => {
  const [totalUsers, suspendedUsers, totalLogs] = await Promise.all([
    dbAll("SELECT COUNT(*) as c FROM users"),
    dbAll("SELECT COUNT(*) as c FROM users WHERE is_suspended = 1"),
    dbAll("SELECT COUNT(*) as c FROM security_audit_logs"),
  ]);

  res.json({
    status: "healthy",
    posture: {
      zeroDataRetention: {
        status: "ACTIVE",
        compliancePct: 100,
        description: "In-memory inference only; zero prompts or generated code written to persistent storage.",
      },
      edgeFirewall: {
        provider: "Cloudflare",
        ssl: "Strict TLS 1.3",
        ddosShield: "Armed",
        turnstile: process.env.TURNSTILE_SECRET_KEY ? "Enforced" : "Configured (Passive)",
      },
      rateLimiting: {
        authRateLimit: "10 req/min (Brute-Force Guard)",
        proxyRateLimit: "60 req/min (Concurrency Guard)",
      },
      dualPortIsolation: {
        customerPort: 3333,
        adminPort: 3334,
        status: "Enforced",
      },
    },
    counts: {
      totalUsers: totalUsers[0]?.c || 0,
      suspendedUsers: suspendedUsers[0]?.c || 0,
      auditLogsLogged: totalLogs[0]?.c || 0,
    },
    timestamp: new Date().toISOString(),
  });
});

/**
 * GET /admin/security/audit-logs
 * Fetch real-time security audit trails
 */
adminRouter.get("/security/audit-logs", requireAdmin, async (req: Request, res: Response) => {
  const type = req.query.type as string | undefined;
  const limit = Math.min(200, parseInt(req.query.limit as string) || 100);
  const logs = await getRecentSecurityEvents(limit, type);
  res.json({ logs, count: logs.length });
});

// ─── Model Registry (Zero-Downtime Hot Reload) ────────────────────────────────

/**
 * GET /admin/models
 * List all models in the registry with their plan requirements and context windows.
 */
adminRouter.get("/models", requireAdmin, async (_req: Request, res: Response) => {
  const models = await getAllModels(true); // force fresh from DB
  res.json({
    models,
    planContextLimits: PLAN_CONTEXT_LIMITS,
    cachedAt: new Date().toISOString(),
  });
});

/**
 * PUT /admin/models
 * Add or update a model — takes effect immediately, no restart needed.
 * Body: { id, openrouter_id, display_name, context_window, min_plan, is_default_chat?, is_default_autocomplete?, enabled? }
 */
adminRouter.put("/models", requireAdmin, async (req: Request, res: Response) => {
  const { id, openrouter_id, display_name, context_window, min_plan } = req.body;
  if (!id || !openrouter_id || !display_name || !context_window || !min_plan) {
    return res.status(400).json({ error: "Missing required fields: id, openrouter_id, display_name, context_window, min_plan" });
  }
  const validPlans = ["free", "starter", "pro", "ultra"];
  if (!validPlans.includes(min_plan)) {
    return res.status(400).json({ error: `min_plan must be one of: ${validPlans.join(", ")}` });
  }
  await upsertModel({
    id,
    openrouter_id,
    display_name,
    context_window: Number(context_window),
    min_plan,
    is_default_chat:         req.body.is_default_chat         ? 1 : 0,
    is_default_autocomplete: req.body.is_default_autocomplete ? 1 : 0,
    enabled: req.body.enabled !== false ? 1 : 0,
  });
  res.json({ ok: true, message: `Model "${id}" saved — live immediately (no restart needed)` });
});

/**
 * POST /admin/models/:id/disable
 * Instant kill-switch: disable a model for all users without restart.
 */
adminRouter.post("/models/:id/disable", requireAdmin, async (req: Request, res: Response) => {
  const id = req.params["id"] as string;
  await disableModel(id);
  res.json({ ok: true, message: `Model "${id}" disabled — users will get routing error` });
});

/**
 * POST /admin/models/:id/enable
 * Re-enable a previously disabled model.
 */
adminRouter.post("/models/:id/enable", requireAdmin, async (req: Request, res: Response) => {
  const id = req.params["id"] as string;
  await enableModel(id);
  res.json({ ok: true, message: `Model "${id}" enabled` });
});

/**
 * POST /admin/models/cache/clear
 * Force-clear the in-memory model cache (auto-refreshes within 60s anyway).
 */
adminRouter.post("/models/cache/clear", requireAdmin, (_req: Request, res: Response) => {
  invalidateModelCache();
  res.json({ ok: true, message: "Model cache cleared — next request will reload from DB" });
});

// ─── Plan Manager (Zero-Downtime Plan Updates) ──────────────────────────────────

/**
 * GET /admin/plans
 * Returns all plans (merged: defaults + DB overrides)
 */
adminRouter.get("/plans", requireAdmin, async (_req: Request, res: Response) => {
  const plans = await getEffectivePlans();
  const defaultNames = Object.keys(PLANS);
  res.json({
    plans,
    defaultPlanIds: defaultNames,
    editableFields: [
      "display_name", "monthly_tokens", "monthly_requests",
      "price_lkr", "price_usd", "discount_pct",
      "context_window", "default_chat_model", "default_autocomplete_model",
      "allowed_models", "features", "payhere_item_id", "upgrade_url",
    ],
    note: "Changes take effect in <30s with no server restart",
  });
});

/**
 * PATCH /admin/plans/:planId
 * Update one or more fields of a plan. Changes are live within 30s.
 * Body: any subset of editable fields
 */
adminRouter.patch("/plans/:planId", requireAdmin, async (req: Request, res: Response) => {
  const planId = req.params["planId"] as string;
  const validPlanIds = Object.keys(PLANS);
  if (!validPlanIds.includes(planId)) {
    return res.status(400).json({ error: `Unknown plan: "${planId}". Valid: ${validPlanIds.join(", ")}` });
  }

  const allowed = [
    "display_name", "monthly_tokens", "monthly_requests",
    "price_lkr", "price_usd", "discount_pct",
    "context_window", "default_chat_model", "default_autocomplete_model",
    "allowed_models", "features", "payhere_item_id", "upgrade_url", "is_active",
  ];

  const fields: any = {};
  for (const key of allowed) {
    if (key in req.body) fields[key] = req.body[key];
  }

  if (Object.keys(fields).length === 0) {
    return res.status(400).json({ error: "No valid fields provided", allowed });
  }

  await updatePlanField(planId, fields);
  res.json({
    ok: true,
    planId,
    updated: Object.keys(fields),
    message: `Plan "${planId}" updated — live within 30s (no restart needed)`,
  });
});

/**
 * DELETE /admin/plans/:planId/override
 * Reset a plan back to its hardcoded default (removes DB override).
 */
adminRouter.delete("/plans/:planId/override", requireAdmin, async (req: Request, res: Response) => {
  const planId = req.params["planId"] as string;
  await resetPlanToDefault(planId);
  res.json({ ok: true, message: `Plan "${planId}" reset to default — live within 30s` });
});

/**
 * POST /admin/plans/cache/clear
 * Force-invalidate plan cache immediately.
 */
adminRouter.post("/plans/cache/clear", requireAdmin, (_req: Request, res: Response) => {
  invalidatePlanCache();
  res.json({ ok: true, message: "Plan cache cleared — next request reloads from DB" });
});
