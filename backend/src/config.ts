import dotenv from "dotenv";
dotenv.config();

export type ProviderID =
  | "openrouter"
  | "openai"
  | "anthropic"
  | "deepseek"
  | "gemini"
  | "groq"
  | "ollama";

// ─── Plan Definitions ──────────────────────────────────────────────────────────
/**
 * VynorAI 2026 Pricing — Sri Lanka Market
 *
 *  Free        → LKR 0      →  50K tokens  →  32k ctx  → Trial funnel
 *  Starter     → LKR 3,000  →  20M tokens  →  32k ctx  → Qwen 2.5 Coder 32B
 *  Pro         → LKR 8,500  →  80M tokens  → 128k ctx  → DeepSeek Coder V2 (+90% cache discount)
 *  Enterprise  → LKR 20,000 → 200M tokens  → 256k ctx  → Qwen 72B / DS long-context
 *
 * OpenRouter blended cost (70% input, 30% output):
 *   Qwen-32B   : .05/M  → LKR ~15/M   → 200x margin on Starter  ✅
 *   DeepSeek-V2: .14/M  → LKR ~42/M   → 112x margin on Pro      ✅ (+90% DS cache)
 *   Qwen-72B   : .40/M  → LKR ~120/M  →  83x margin on Enterprise✅
 */
export interface PlanDefinition {
  id: string;
  displayName: string;
  monthlyTokens: number;
  monthlyRequests: number;
  priceLKR: number;
  priceUSD: number;
  discountPct: number; // 0-100 promo discount applied to price
  contextWindow: number; // context limit in tokens
  defaultChatModel: string; // primary model for this plan
  defaultAutocompleteModel: string; // FIM model
  allowedModels: string[]; // ["*"] = all models
  features: string[];
  payhereItemId: string;
  upgradeUrl: string;
}

export const PLANS: Record<string, PlanDefinition> = {
  free: {
    id: "free",
    displayName: "Free Trial",
    monthlyTokens: 100_000,
    // Each agent tool round is a request; 100 ran out after a few tasks. A
    // free user's worst case is ~$0.03 of upstream cost (100K credits).
    monthlyRequests: 300,
    priceLKR: 0,
    priceUSD: 0,
    discountPct: 0,
    contextWindow: 32_000,
    defaultChatModel: "deepseek/deepseek-flash",
    defaultAutocompleteModel: "deepseek/deepseek-chat-v3-0324",
    allowedModels: [
      "deepseek/deepseek-flash",
      "deepseek-flash",
      "deepseek/deepseek-chat-v3-0324",
      "deepseek-v3",
      "deepseek-chat",
      "qwen/qwen-2.5-coder-32b-instruct",
      "qwen-2.5-coder",
    ],
    features: [
      "100,000 credits/month",
      "300 requests/month",
      "VynorAI Auto (DeepSeek V4.1 Flash)",
      "32k context window",
    ],
    payhereItemId: "",
    upgradeUrl: "https://vynor.lk/#pricing",
  },

  starter: {
    id: "starter",
    displayName: "Starter",
    monthlyTokens: 11_000_000,
    monthlyRequests: 2_500,
    priceLKR: 1_850,
    priceUSD: 5.99,
    discountPct: 0,
    contextWindow: 32_000,
    defaultChatModel: "deepseek/deepseek-flash",
    defaultAutocompleteModel: "qwen/qwen-2.5-coder-32b-instruct",
    allowedModels: [
      "deepseek/deepseek-flash",
      "deepseek-flash",
      "qwen/qwen-2.5-coder-32b-instruct",
      "qwen-2.5-coder",
      "deepseek/deepseek-chat-v3-0324",
      "deepseek-v3",
      "deepseek-chat",
      "deepseek/deepseek-coder-v2",
      "deepseek-coder",
    ],
    features: [
      "11 million credits/month",
      "2,500 requests/month",
      "VynorAI Auto (DeepSeek V4.1 Flash) + Qwen 2.5 Coder",
      "32k context window",
      "Tab autocomplete",
      "Repeated answers from cache cost 0 credits",
    ],
    payhereItemId: "vynorai_starter",
    upgradeUrl: "https://vynor.lk/#pricing",
  },

  pro: {
    id: "pro",
    displayName: "Pro",
    monthlyTokens: 25_000_000,
    monthlyRequests: 7_500,
    priceLKR: 3_850,
    priceUSD: 12.5,
    discountPct: 0,
    contextWindow: 128_000,
    defaultChatModel: "deepseek/deepseek-flash",
    defaultAutocompleteModel: "deepseek/deepseek-coder-v2",
    allowedModels: [
      "deepseek/deepseek-flash",
      "deepseek-flash",
      "deepseek/deepseek-v4-pro",
      "deepseek-v4-pro",
      "deepseek/deepseek-coder-v2",
      "deepseek-coder",
      "deepseek/deepseek-chat-v3-0324",
      "deepseek-v3",
      "deepseek-chat",
      "deepseek/deepseek-r1",
      "deepseek-r1",
      "qwen/qwen-2.5-coder-32b-instruct",
      "qwen-2.5-coder",
      "meta-llama/llama-3.3-70b-instruct",
      "llama-3.3-70b",
      "google/gemini-2.5-flash",
      "gemini-2.5-flash",
    ],
    features: [
      "25 million credits/month",
      "7,500 requests/month",
      "Auto uses DeepSeek V4 Pro for deep reasoning",
      "128k context window",
      "Llama 3.3 70B, Gemini 2.5 Flash and more in Advanced",
      "Full agent mode with subagents",
    ],
    payhereItemId: "vynorai_pro",
    upgradeUrl: "https://vynor.lk/#pricing",
  },

  enterprise: {
    id: "enterprise",
    displayName: "Ultra",
    monthlyTokens: 55_000_000,
    monthlyRequests: 20_000,
    priceLKR: 7_900,
    priceUSD: 25.5,
    discountPct: 0,
    contextWindow: 256_000,
    defaultChatModel: "deepseek/deepseek-flash",
    defaultAutocompleteModel: "deepseek/deepseek-coder-v2",
    allowedModels: ["*"],
    features: [
      "55 million credits/month",
      "20,000 requests/month",
      "Every model in the VynorAI catalog (credit-weighted)",
      "256k context window",
      "Multi-device support (up to 3 devices)",
      "Priority support",
    ],
    payhereItemId: "vynorai_ultra",
    upgradeUrl: "https://vynor.lk/#pricing",
  },

  // ── Legacy aliases ───────────────────────────────────────────────────────────
  ultra: {
    id: "ultra",
    displayName: "Ultra",
    monthlyTokens: 55_000_000,
    monthlyRequests: 20_000,
    priceLKR: 7_900,
    priceUSD: 25.5,
    discountPct: 0,
    contextWindow: 256_000,
    defaultChatModel: "deepseek/deepseek-flash",
    defaultAutocompleteModel: "deepseek/deepseek-coder-v2",
    allowedModels: ["*"],
    features: [
      "55 million credits/month",
      "20,000 requests/month",
      "Every model in the VynorAI catalog (credit-weighted)",
      "256k context window",
      "Multi-device support (up to 3 devices)",
      "Priority support",
    ],
    payhereItemId: "vynorai_ultra",
    upgradeUrl: "https://vynor.lk/#pricing",
  },
  topup5m: {
    id: "topup5m",
    displayName: "Top-Up Pack (5M)",
    monthlyTokens: 5_000_000,
    monthlyRequests: 1_500,
    priceLKR: 650,
    priceUSD: 2.1,
    discountPct: 0,
    contextWindow: 128_000,
    defaultChatModel: "deepseek/deepseek-flash",
    defaultAutocompleteModel: "deepseek/deepseek-coder-v2",
    // Top-ups credit the current cycle and are never an active tier.
    allowedModels: [],
    features: [
      "+5,000,000 Extra Credits",
      "1,500 Additional Requests",
      "Instant Credit to Active Plan",
    ],
    payhereItemId: "vynorai_topup_5m",
    upgradeUrl: "https://vynor.lk/#pricing",
  },
  pro_monthly: {
    id: "pro_monthly",
    displayName: "Pro Monthly",
    monthlyTokens: 25_000_000,
    monthlyRequests: 7_500,
    priceLKR: 3_850,
    priceUSD: 12.5,
    discountPct: 0,
    contextWindow: 128_000,
    defaultChatModel: "deepseek/deepseek-flash",
    defaultAutocompleteModel: "deepseek/deepseek-coder-v2",
    // Same price as Pro, so the same model list as Pro.
    allowedModels: [
      "deepseek/deepseek-flash",
      "deepseek-flash",
      "deepseek/deepseek-v4-pro",
      "deepseek-v4-pro",
      "deepseek/deepseek-coder-v2",
      "deepseek-coder",
      "deepseek/deepseek-chat-v3-0324",
      "deepseek-v3",
      "deepseek-chat",
      "deepseek/deepseek-r1",
      "deepseek-r1",
      "qwen/qwen-2.5-coder-32b-instruct",
      "qwen-2.5-coder",
      "meta-llama/llama-3.3-70b-instruct",
      "llama-3.3-70b",
      "google/gemini-2.5-flash",
      "gemini-2.5-flash",
    ],
    features: [
      "25 million credits/month",
      "128k context window",
      "Auto with DeepSeek V4 Pro reasoning",
    ],
    payhereItemId: "vynorai_pro",
    upgradeUrl: "https://vynor.lk/#pricing",
  },
  pro_yearly: {
    id: "pro_yearly",
    displayName: "Pro Yearly (2 months free)",
    monthlyTokens: 25_000_000,
    monthlyRequests: 7_500,
    priceLKR: 38_500,
    priceUSD: 125.0,
    discountPct: 17,
    contextWindow: 128_000,
    defaultChatModel: "deepseek/deepseek-flash",
    defaultAutocompleteModel: "deepseek/deepseek-coder-v2",
    allowedModels: [
      "deepseek/deepseek-flash",
      "deepseek-flash",
      "deepseek/deepseek-v4-pro",
      "deepseek-v4-pro",
      "deepseek/deepseek-coder-v2",
      "deepseek-coder",
      "deepseek/deepseek-chat-v3-0324",
      "deepseek-v3",
      "deepseek-chat",
      "deepseek/deepseek-r1",
      "deepseek-r1",
      "qwen/qwen-2.5-coder-32b-instruct",
      "qwen-2.5-coder",
      "meta-llama/llama-3.3-70b-instruct",
      "llama-3.3-70b",
      "google/gemini-2.5-flash",
      "gemini-2.5-flash",
    ],
    features: [
      "25 million credits/month",
      "128k context window",
      "Auto with DeepSeek V4 Pro reasoning",
      "2 months free (17% off)",
    ],
    payhereItemId: "vynorai_pro_yearly",
    upgradeUrl: "https://vynor.lk/#pricing",
  },
};

// Admin edits (plan_overrides) merged over PLANS by planManager. Quota,
// billing and checkout must all read the same numbers the pricing page shows.
let planOverlay: Record<string, PlanDefinition> | null = null;

export function setPlanOverlay(plans: Record<string, PlanDefinition> | null) {
  planOverlay = plans;
}

/** Get plan definition (fallback to free if unknown) */
export function getPlan(planId: string): PlanDefinition {
  const plans = planOverlay ?? PLANS;
  return plans[planId] || plans.free || PLANS.free;
}

/** Effective price after discount */
export function getEffectivePrice(plan: PlanDefinition): {
  lkr: number;
  usd: number;
} {
  const mul = (100 - plan.discountPct) / 100;
  return {
    lkr: Math.round(plan.priceLKR * mul),
    usd: Math.round(plan.priceUSD * mul * 100) / 100,
  };
}

/** Check if a requested model is accessible on user's plan */
export function isModelAllowedForPlan(
  planId: string,
  modelId: string,
): boolean {
  const plan = getPlan(planId);
  if (plan.allowedModels.includes("*")) return true;
  // Exact alias or canonical match only — substring matching let e.g.
  // "qwen-2.5-coder" unlock "qwen/qwen-2.5-coder-72b-instruct".
  return (
    plan.allowedModels.includes(modelId) ||
    plan.allowedModels.includes(resolveModelId(modelId))
  );
}

/** Suggest the next upgrade plan */
export function getUpgradePlan(currentPlanId: string): PlanDefinition | null {
  const ladder: string[] = ["free", "starter", "pro", "enterprise"];
  const normalized = currentPlanId
    .replace("_monthly", "")
    .replace("_yearly", "")
    .replace("ultra", "enterprise");
  const idx = ladder.indexOf(normalized);
  if (idx === -1 || idx >= ladder.length - 1) return null;
  return PLANS[ladder[idx + 1]];
}

// ─── OpenRouter Model Aliases ──────────────────────────────────────────────────
export function isOpenRouterModelId(model: string): boolean {
  return model.includes("/");
}

export const MODEL_ALIASES: Record<string, string> = {
  "claude-sonnet-4-6": "anthropic/claude-sonnet-4-6",
  "claude-3-7-sonnet": "anthropic/claude-3.7-sonnet",
  "claude-3-5-sonnet": "anthropic/claude-3.5-sonnet",
  "claude-3-haiku": "anthropic/claude-3-haiku",
  "claude-opus-4-6": "anthropic/claude-opus-4-6",
  "gpt-4o": "openai/gpt-4o",
  "gpt-4o-mini": "openai/gpt-4o-mini",
  o3: "openai/o3",
  "o3-mini": "openai/o3-mini",
  "deepseek-flash": "deepseek/deepseek-flash",
  "deepseek-v4-pro": "deepseek/deepseek-v4-pro",
  "deepseek-chat": "deepseek/deepseek-chat-v3-0324",
  "deepseek-coder": "deepseek/deepseek-coder-v2",
  "deepseek-v3": "deepseek/deepseek-chat-v3-0324",
  "deepseek-r1": "deepseek/deepseek-r1",
  "gemini-2.5-pro": "google/gemini-2.5-pro",
  "gemini-2.5-flash": "google/gemini-2.5-flash",
  "llama-3.3-70b": "meta-llama/llama-3.3-70b-instruct",
  "llama-3.1-8b": "meta-llama/llama-3.1-8b-instruct:free",
  "qwen-2.5-coder": "qwen/qwen-2.5-coder-32b-instruct",
  "qwen-2.5-coder-72b": "qwen/qwen-2.5-coder-72b-instruct",
};

export function resolveModelId(model: string): string {
  return MODEL_ALIASES[model] || model;
}

export const DEFAULT_CHAT_MODEL = "deepseek/deepseek-flash";
export const DEFAULT_AUTOCOMPLETE = "deepseek/deepseek-coder-v2";

// ─── Full Config ───────────────────────────────────────────────────────────────
export const config = {
  port: parseInt(process.env.PORT || "3000", 10),
  adminPort: parseInt(
    process.env.ADMIN_PORT ||
      String(parseInt(process.env.PORT || "3000", 10) + 1),
    10,
  ),
  nodeEnv: process.env.NODE_ENV || "development",
  baseUrl: process.env.BASE_URL || "http://localhost:3000",
  jwtSecret: process.env.JWT_SECRET || "vynorai_default_secret_2026",

  payhere: {
    merchantId: process.env.PAYHERE_MERCHANT_ID || "",
    merchantSecret: process.env.PAYHERE_MERCHANT_SECRET || "",
    env: (process.env.PAYHERE_ENV || "sandbox").toLowerCase(),
    returnUrl:
      process.env.PAYHERE_RETURN_URL ||
      "http://localhost:3000/dashboard.html?payment=success",
    cancelUrl:
      process.env.PAYHERE_CANCEL_URL ||
      "http://localhost:3000/dashboard.html?payment=cancel",
    notifyUrl:
      process.env.PAYHERE_NOTIFY_URL ||
      "http://localhost:3000/api/payment/notify",
    get checkoutUrl() {
      return this.env === "live"
        ? "https://www.payhere.lk/pay/checkout"
        : "https://sandbox.payhere.lk/pay/checkout";
    },
  },

  aiKeys: {
    openrouter: process.env.OPENROUTER_API_KEY || "",
    openai: process.env.OPENAI_API_KEY || "",
    anthropic: process.env.ANTHROPIC_API_KEY || "",
    deepseek: process.env.DEEPSEEK_API_KEY || "",
    groq: process.env.GROQ_API_KEY || "",
    gemini: process.env.GEMINI_API_KEY || "",
    ollama: process.env.OLLAMA_BASE_URL || "http://localhost:11434",
  },

  localSlm: {
    enabled: process.env.LOCAL_SLM_ENABLED === "true",
    url: process.env.LOCAL_SLM_URL || "http://localhost:8080/v1",
    model: process.env.LOCAL_SLM_MODEL || "qwen2.5-coder-1.5b-instruct",
    // One-letter classification on a 4-vCPU box: ~0.5-1.5s incl. prompt processing.
    timeoutMs: parseInt(process.env.LOCAL_SLM_TIMEOUT_MS || "1500", 10),
    // Match llama.cpp --parallel: more in flight only queues behind the timeout.
    maxInFlight: parseInt(process.env.LOCAL_SLM_MAX_INFLIGHT || "4", 10),
    compactionEnabled: process.env.LOCAL_SLM_COMPACTION !== "false",
  },

  semanticCache: {
    enabled: process.env.SEMANTIC_CACHE_ENABLED === "true",
    embedUrl: process.env.LOCAL_EMBED_URL || "http://localhost:8081/v1",
    embedModel: process.env.LOCAL_EMBED_MODEL || "bge-small-en-v1.5",
    timeoutMs: parseInt(process.env.LOCAL_EMBED_TIMEOUT_MS || "400", 10),
    threshold: parseFloat(process.env.SEMANTIC_CACHE_THRESHOLD || "0.95"),
    // "user" never shares answers across accounts; "global" shares generic Q&A only.
    scope: process.env.SEMANTIC_CACHE_SCOPE === "global" ? "global" : "user",
  },
};
