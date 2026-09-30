/**
 * VynorAI Plan Manager — Live Plan Configuration (Zero Restart)
 * --------------------------------------------------------------
 * Plans can be overridden in SQLite at runtime.
 * Falls back to hardcoded PLANS from config.ts if no DB override exists.
 *
 * Admin API: PUT /admin/plans/:id  → updates a plan field immediately
 * Cache TTL: 30 seconds
 */

import { dbGet, dbAll, dbRun, db } from "../db.js";
import { PLANS, PlanDefinition } from "../config.js";

// ─── Schema ───────────────────────────────────────────────────────────────────
export async function ensurePlanOverrideTable(): Promise<void> {
  return new Promise((resolve, reject) => {
    db.run(
      `CREATE TABLE IF NOT EXISTS plan_overrides (
        plan_id               TEXT PRIMARY KEY,
        display_name          TEXT,
        monthly_tokens        INTEGER,
        monthly_requests      INTEGER,
        price_lkr             REAL,
        price_usd             REAL,
        discount_pct          INTEGER DEFAULT 0,
        context_window        INTEGER,
        default_chat_model    TEXT,
        default_autocomplete_model TEXT,
        allowed_models        TEXT,   -- JSON array string
        features              TEXT,   -- JSON array string
        payhere_item_id       TEXT,
        upgrade_url           TEXT,
        is_active             INTEGER DEFAULT 1,
        updated_at            DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,
      (err) => { if (err) reject(err); else resolve(); }
    );
  });
}

// ─── In-memory cache (TTL 30s) ────────────────────────────────────────────────
let _cache: Record<string, PlanDefinition> | null = null;
let _cacheTime = 0;
const CACHE_TTL = 30_000;

export function invalidatePlanCache(): void { _cache = null; _cacheTime = 0; }

export async function getEffectivePlans(): Promise<Record<string, PlanDefinition>> {
  const now = Date.now();
  if (_cache && now - _cacheTime < CACHE_TTL) return _cache;

  // Start with hardcoded defaults
  const plans: Record<string, PlanDefinition> = JSON.parse(JSON.stringify(PLANS));

  try {
    const overrides = await dbAll<any>("SELECT * FROM plan_overrides WHERE is_active = 1");
    for (const row of overrides) {
      if (!plans[row.plan_id]) continue;
      const p = plans[row.plan_id];
      if (row.display_name)           p.displayName              = row.display_name;
      if (row.monthly_tokens)         p.monthlyTokens            = row.monthly_tokens;
      if (row.monthly_requests)       p.monthlyRequests          = row.monthly_requests;
      if (row.price_lkr != null)      p.priceLKR                 = row.price_lkr;
      if (row.price_usd != null)      p.priceUSD                 = row.price_usd;
      if (row.discount_pct != null)   p.discountPct              = row.discount_pct;
      if (row.context_window)         p.contextWindow            = row.context_window;
      if (row.default_chat_model)     p.defaultChatModel         = row.default_chat_model;
      if (row.default_autocomplete_model) p.defaultAutocompleteModel = row.default_autocomplete_model;
      if (row.allowed_models)         p.allowedModels            = JSON.parse(row.allowed_models);
      if (row.features)               p.features                 = JSON.parse(row.features);
      if (row.payhere_item_id)        p.payhereItemId            = row.payhere_item_id;
      if (row.upgrade_url)            p.upgradeUrl               = row.upgrade_url;
    }
  } catch { /* table may not exist yet */ }

  _cache = plans;
  _cacheTime = now;
  return plans;
}

export async function getEffectivePlan(planId: string): Promise<PlanDefinition> {
  const plans = await getEffectivePlans();
  return plans[planId] || plans["free"];
}

// ─── Upsert a plan override field ─────────────────────────────────────────────
export async function updatePlanField(
  planId: string,
  fields: Partial<{
    display_name: string;
    monthly_tokens: number;
    monthly_requests: number;
    price_lkr: number;
    price_usd: number;
    discount_pct: number;
    context_window: number;
    default_chat_model: string;
    default_autocomplete_model: string;
    allowed_models: string[];
    features: string[];
    payhere_item_id: string;
    upgrade_url: string;
    is_active: number;
  }>
): Promise<void> {
  const sets = Object.entries(fields)
    .map(([k]) => `${k} = ?`)
    .join(", ");
  const vals = Object.entries(fields).map(([k, v]) =>
    Array.isArray(v) ? JSON.stringify(v) : v
  );

  await dbRun(
    `INSERT INTO plan_overrides (plan_id, ${Object.keys(fields).join(", ")})
     VALUES (?, ${Object.keys(fields).map(() => "?").join(", ")})
     ON CONFLICT(plan_id) DO UPDATE SET ${sets}, updated_at = CURRENT_TIMESTAMP`,
    [planId, ...vals, ...vals]
  );
  invalidatePlanCache();
}

// ─── Reset a plan to defaults ──────────────────────────────────────────────────
export async function resetPlanToDefault(planId: string): Promise<void> {
  await dbRun("DELETE FROM plan_overrides WHERE plan_id = ?", [planId]);
  invalidatePlanCache();
}

// ─── Init ─────────────────────────────────────────────────────────────────────
export async function initPlanManager(): Promise<void> {
  await ensurePlanOverrideTable();
  await getEffectivePlans(); // warm cache
}
