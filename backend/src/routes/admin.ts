import { Router, Request, Response } from "express";
import { getAllCircuitStats, resetCircuit } from "../services/circuitBreaker.js";
import { config, MODEL_ALIASES, PLANS } from "../config.js";
import { ProviderID } from "../config.js";
import { getEffectivePlans, updatePlanField, resetPlanToDefault, invalidatePlanCache } from "../services/planManager.js";

export const adminRouter = Router();

// Simple admin secret check (set ADMIN_SECRET in .env)
function requireAdmin(req: Request, res: Response, next: Function) {
  const secret = req.headers["x-admin-secret"] || req.query.secret;
  const expected = process.env.ADMIN_SECRET || "vynorai_admin_2026";
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
import { dbAll } from "../db.js";
import {
  getAllModels,
  upsertModel,
  disableModel,
  enableModel,
  invalidateModelCache,
  PLAN_CONTEXT_LIMITS,
} from "../services/modelRegistry.js";

adminRouter.get("/stats", requireAdmin, async (_req: Request, res: Response) => {
  const yesterday = new Date(Date.now() - 24 * 3600 * 1000).toISOString();

  const [totalUsers, activeUsers, topModels, recentErrors] = await Promise.all([
    dbAll("SELECT COUNT(*) as count FROM users"),
    dbAll("SELECT COUNT(DISTINCT user_id) as count FROM usage_logs WHERE created_at >= ?", [yesterday]),
    dbAll(`SELECT model, COUNT(*) as requests, SUM(tokens_used) as tokens
           FROM usage_logs WHERE created_at >= ?
           GROUP BY model ORDER BY requests DESC LIMIT 10`, [yesterday]),
    dbAll(`SELECT model, COUNT(*) as count FROM usage_logs
           WHERE created_at >= ? GROUP BY model`, [yesterday]),
  ]);

  res.json({
    totalUsers:    totalUsers[0]?.count || 0,
    activeUsers24h: activeUsers[0]?.count || 0,
    topModels24h:  topModels,
    requestsByModel24h: recentErrors,
    timestamp: new Date().toISOString(),
  });
});

/**
 * GET /admin/users
 * List all users with active subscription plan and token usage
 */
adminRouter.get("/users", requireAdmin, async (_req: Request, res: Response) => {
  const users = await dbAll<any>(`
    SELECT u.id, u.email, u.name, u.api_key, u.created_at,
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
