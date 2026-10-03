/**
 * VynorAI Dynamic Model Registry — Zero-Downtime Hot Reload
 * ----------------------------------------------------------
 * Models are stored in SQLite (model_registry table).
 * Admin can add/update/disable models via API — NO server restart needed.
 * Falls back to hardcoded defaults if DB is empty.
 *
 * Also defines per-plan context window limits:
 *   Free/Starter  →  32k tokens
 *   Pro           → 128k tokens
 *   Ultra         → 256k tokens
 */

import { dbGet, dbAll, dbRun, db } from "../db.js";
import { v4 as uuidv4 } from "uuid";
import { getPlan } from "../config.js";

// ─── Plan Context Limits ──────────────────────────────────────────────────────
export const PLAN_CONTEXT_LIMITS: Record<string, number> = {
  free: 32_000,
  starter: 32_000,
  pro: 128_000,
  enterprise: 256_000,
  ultra: 256_000, // legacy alias
  pro_monthly: 128_000,
  pro_yearly: 128_000,
};

export function getContextLimitForPlan(planId: string): number {
  return PLAN_CONTEXT_LIMITS[planId] ?? 32_000;
}

// ─── Model Registry Types ─────────────────────────────────────────────────────
export interface ModelEntry {
  id: string; // internal alias e.g. "deepseek-v3"
  openrouter_id: string; // full OpenRouter model ID
  display_name: string;
  context_window: number; // actual model context in tokens
  min_plan: string; // minimum plan required: free|starter|pro|ultra
  is_default_chat: number; // 1 = use as default chat model
  is_default_autocomplete: number;
  enabled: number; // 1 = live, 0 = disabled (instant kill switch)
  created_at?: string;
  updated_at?: string;
}

// ─── In-memory cache (TTL: 60s) ──────────────────────────────────────────────
let _cache: ModelEntry[] | null = null;
let _cacheTime = 0;
const CACHE_TTL_MS = 60_000; // reload every 60s automatically

export async function getAllModels(
  forceRefresh = false,
): Promise<ModelEntry[]> {
  const now = Date.now();
  if (!forceRefresh && _cache && now - _cacheTime < CACHE_TTL_MS) return _cache;

  try {
    const rows = await dbAll<ModelEntry>(
      "SELECT * FROM model_registry WHERE enabled = 1 ORDER BY min_plan ASC, id ASC",
    );
    if (rows.length > 0) {
      _cache = rows;
      _cacheTime = now;
      return rows;
    }
  } catch {
    // table may not exist yet on first boot — seed below
  }

  // Fallback: seed from defaults
  await seedDefaultModels();
  const rows = await dbAll<ModelEntry>(
    "SELECT * FROM model_registry WHERE enabled = 1 ORDER BY min_plan ASC, id ASC",
  );
  _cache = rows;
  _cacheTime = now;
  return rows;
}

/** Force invalidate cache — called after admin updates */
export function invalidateModelCache(): void {
  _cache = null;
  _cacheTime = 0;
}

// ─── Look up a single model by alias or full ID ──────────────────────────────
export async function resolveModel(alias: string): Promise<ModelEntry | null> {
  const { resolveModelId } = await import("../config.js");
  const canonical = resolveModelId(alias);
  const models = await getAllModels();
  return (
    models.find((m) => m.id === alias || m.id === canonical) ||
    models.find(
      (m) => m.openrouter_id === alias || m.openrouter_id === canonical,
    ) ||
    null
  );
}

/** Get default chat model from registry */
export async function getDefaultChatModel(): Promise<string> {
  const models = await getAllModels();
  const def = models.find((m) => m.is_default_chat === 1);
  return def?.openrouter_id ?? "deepseek/deepseek-chat-v3-0324";
}

/** Get default autocomplete model from registry */
export async function getDefaultAutocompleteModel(): Promise<string> {
  const models = await getAllModels();
  const def = models.find((m) => m.is_default_autocomplete === 1);
  return def?.openrouter_id ?? "deepseek/deepseek-coder-v2";
}

/** Check if plan can access model */
export async function canPlanUseModel(
  planId: string,
  modelAlias: string,
): Promise<boolean> {
  const { getPlan, resolveModelId } = await import("../config.js");
  const { isAutoModel } = await import("./autoRouter.js");
  // Auto is always allowed; the router only picks models the plan can use.
  if (isAutoModel(modelAlias)) return true;
  const plan = getPlan(planId);
  if (plan.allowedModels.includes("*")) return true;
  if (plan.allowedModels.includes(modelAlias)) return true;
  const canonical = resolveModelId(modelAlias);
  if (plan.allowedModels.includes(canonical)) return true;

  const model =
    (await resolveModel(modelAlias)) || (await resolveModel(canonical));
  if (!model) return false;

  const planOrder = ["free", "starter", "pro", "enterprise", "ultra"];
  const userIdx = planOrder.indexOf(planId.replace(/_monthly|_yearly/, ""));
  const modelIdx = planOrder.indexOf(model.min_plan);
  return userIdx >= modelIdx;
}

// ─── DB Schema: create model_registry table ──────────────────────────────────
export async function ensureModelRegistryTable(): Promise<void> {
  return new Promise((resolve, reject) => {
    db.run(
      `CREATE TABLE IF NOT EXISTS model_registry (
        id                      TEXT PRIMARY KEY,
        openrouter_id           TEXT NOT NULL,
        display_name            TEXT NOT NULL,
        context_window          INTEGER NOT NULL DEFAULT 32000,
        min_plan                TEXT NOT NULL DEFAULT 'free',
        is_default_chat         INTEGER DEFAULT 0,
        is_default_autocomplete INTEGER DEFAULT 0,
        enabled                 INTEGER DEFAULT 1,
        created_at              DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at              DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,
      (err) => {
        if (err) reject(err);
        else resolve();
      },
    );
  });
}

// ─── Default model seed ───────────────────────────────────────────────────────
const DEFAULT_MODELS: Omit<ModelEntry, "created_at" | "updated_at">[] = [
  // ── DeepSeek V4 (direct API): one hybrid model, thinking toggled per request ─
  {
    id: "deepseek-flash",
    openrouter_id: "deepseek/deepseek-flash",
    display_name: "DeepSeek V4.1 Flash",
    context_window: 1_000_000,
    min_plan: "free",
    is_default_chat: 0,
    is_default_autocomplete: 0,
    enabled: 1,
  },
  {
    id: "deepseek-v4-pro",
    openrouter_id: "deepseek/deepseek-v4-pro",
    display_name: "DeepSeek V4 Pro",
    context_window: 1_000_000,
    min_plan: "pro",
    is_default_chat: 0,
    is_default_autocomplete: 0,
    enabled: 1,
  },

  // ── Free tier (32k) ──────────────────────────────────────────────────────
  {
    id: "deepseek-v3",
    openrouter_id: "deepseek/deepseek-chat-v3-0324",
    display_name: "DeepSeek V3 (Free)",
    context_window: 64_000,
    min_plan: "free",
    is_default_chat: 1,
    is_default_autocomplete: 0,
    enabled: 1,
  },

  // ── Starter tier — Primary: Qwen 2.5 Coder 32B (32k, fastest, cheapest) ─
  {
    id: "qwen-2.5-coder-32b",
    openrouter_id: "qwen/qwen-2.5-coder-32b-instruct",
    display_name: "Qwen 2.5 Coder 32B ⭐ Starter",
    context_window: 32_000,
    min_plan: "starter",
    is_default_chat: 1,
    is_default_autocomplete: 1,
    enabled: 1,
  },
  {
    id: "deepseek-coder",
    openrouter_id: "deepseek/deepseek-coder-v2",
    display_name: "DeepSeek Coder V2",
    context_window: 64_000,
    min_plan: "starter",
    is_default_chat: 0,
    is_default_autocomplete: 0,
    enabled: 1,
  },

  // ── Pro tier — Primary: DeepSeek Coder V2/V3 (128k, 90% cache discount) ─
  {
    id: "deepseek-coder-v2",
    openrouter_id: "deepseek/deepseek-coder-v2",
    display_name: "DeepSeek Coder V2 ⭐ Pro (128k)",
    context_window: 128_000,
    min_plan: "pro",
    is_default_chat: 1,
    is_default_autocomplete: 1,
    enabled: 1,
  },
  {
    id: "deepseek-r1",
    openrouter_id: "deepseek/deepseek-r1",
    display_name: "DeepSeek R1 (Reasoning)",
    context_window: 128_000,
    min_plan: "pro",
    is_default_chat: 0,
    is_default_autocomplete: 0,
    enabled: 1,
  },
  {
    id: "deepseek-r1-distill",
    openrouter_id: "deepseek/deepseek-r1-distill-qwen-32b",
    display_name: "DeepSeek R1 Distill 32B",
    context_window: 128_000,
    min_plan: "pro",
    is_default_chat: 0,
    is_default_autocomplete: 0,
    enabled: 1,
  },
  {
    id: "llama-3.3-70b",
    openrouter_id: "meta-llama/llama-3.3-70b-instruct",
    display_name: "Llama 3.3 70B",
    context_window: 128_000,
    min_plan: "pro",
    is_default_chat: 0,
    is_default_autocomplete: 0,
    enabled: 1,
  },
  {
    id: "gemini-2.5-flash",
    openrouter_id: "google/gemini-2.5-flash",
    display_name: "Gemini 2.5 Flash (128k)",
    context_window: 128_000,
    min_plan: "pro",
    is_default_chat: 0,
    is_default_autocomplete: 0,
    enabled: 1,
  },

  // ── Enterprise tier — Primary: Qwen 72B (256k full project scan) ─────────
  {
    id: "qwen-2.5-coder-72b",
    openrouter_id: "qwen/qwen-2.5-coder-72b-instruct",
    display_name: "Qwen 2.5 Coder 72B ⭐ Enterprise (256k)",
    context_window: 256_000,
    min_plan: "enterprise",
    is_default_chat: 1,
    is_default_autocomplete: 0,
    enabled: 1,
  },
  {
    id: "gemini-2.5-pro",
    openrouter_id: "google/gemini-2.5-pro",
    display_name: "Gemini 2.5 Pro (256k)",
    context_window: 256_000,
    min_plan: "enterprise",
    is_default_chat: 0,
    is_default_autocomplete: 0,
    enabled: 1,
  },
  {
    id: "claude-3-7-sonnet",
    openrouter_id: "anthropic/claude-3.7-sonnet",
    display_name: "Claude 3.7 Sonnet (200k)",
    context_window: 200_000,
    min_plan: "enterprise",
    is_default_chat: 0,
    is_default_autocomplete: 0,
    enabled: 1,
  },
  {
    id: "claude-sonnet-4-6",
    openrouter_id: "anthropic/claude-sonnet-4-6",
    display_name: "Claude Sonnet 4.6",
    context_window: 200_000,
    min_plan: "enterprise",
    is_default_chat: 0,
    is_default_autocomplete: 0,
    enabled: 1,
  },
];

/** Add newly shipped default models to an existing registry without touching admin edits. */
export async function syncDefaultModels(): Promise<void> {
  await seedDefaultModels();
  invalidateModelCache();
}

async function seedDefaultModels(): Promise<void> {
  await ensureModelRegistryTable();
  for (const m of DEFAULT_MODELS) {
    await dbRun(
      `INSERT OR IGNORE INTO model_registry
        (id, openrouter_id, display_name, context_window, min_plan,
         is_default_chat, is_default_autocomplete, enabled)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        m.id,
        m.openrouter_id,
        m.display_name,
        m.context_window,
        m.min_plan,
        m.is_default_chat,
        m.is_default_autocomplete,
        m.enabled,
      ],
    ).catch(() => {}); // ignore duplicate key
  }
}

// ─── Admin CRUD ───────────────────────────────────────────────────────────────

/** Add or update a model (admin only) */
export async function upsertModel(
  entry: Omit<ModelEntry, "created_at" | "updated_at">,
): Promise<void> {
  await dbRun(
    `INSERT INTO model_registry
       (id, openrouter_id, display_name, context_window, min_plan,
        is_default_chat, is_default_autocomplete, enabled)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       openrouter_id           = excluded.openrouter_id,
       display_name            = excluded.display_name,
       context_window          = excluded.context_window,
       min_plan                = excluded.min_plan,
       is_default_chat         = excluded.is_default_chat,
       is_default_autocomplete = excluded.is_default_autocomplete,
       enabled                 = excluded.enabled,
       updated_at              = CURRENT_TIMESTAMP`,
    [
      entry.id,
      entry.openrouter_id,
      entry.display_name,
      entry.context_window,
      entry.min_plan,
      entry.is_default_chat,
      entry.is_default_autocomplete,
      entry.enabled,
    ],
  );
  invalidateModelCache();
}

/** Disable a model instantly (kill switch) without deleting */
export async function disableModel(id: string): Promise<void> {
  await dbRun(
    "UPDATE model_registry SET enabled = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    [id],
  );
  invalidateModelCache();
}

/** Enable a previously disabled model */
export async function enableModel(id: string): Promise<void> {
  await dbRun(
    "UPDATE model_registry SET enabled = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    [id],
  );
  invalidateModelCache();
}
