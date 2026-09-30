import dotenv from "dotenv";
dotenv.config();

export type ProviderID = "openrouter" | "openai" | "anthropic" | "deepseek" | "gemini" | "groq" | "ollama";

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
  id:                       string;
  displayName:              string;
  monthlyTokens:            number;
  monthlyRequests:          number;
  priceLKR:                 number;
  priceUSD:                 number;
  discountPct:              number;   // 0-100 promo discount applied to price
  contextWindow:            number;   // context limit in tokens
  defaultChatModel:         string;   // primary model for this plan
  defaultAutocompleteModel: string;   // FIM model
  allowedModels:            string[]; // ["*"] = all models
  features:                 string[];
  payhereItemId:            string;
  upgradeUrl:               string;
}

export const PLANS: Record<string, PlanDefinition> = {
  free: {
    id: "free", displayName: "Free Trial",
    monthlyTokens: 100_000, monthlyRequests: 100,
    priceLKR: 0, priceUSD: 0, discountPct: 0,
    contextWindow: 32_000,
    defaultChatModel:         "deepseek/deepseek-chat-v3-0324",
    defaultAutocompleteModel: "deepseek/deepseek-chat-v3-0324",
    allowedModels: ["deepseek/deepseek-chat-v3-0324","deepseek-v3","deepseek-chat","qwen/qwen-2.5-coder-32b-instruct","qwen-2.5-coder"],
    features: ["100,000 tokens/month (Free Onboarding)","100 requests/month","32k context window","DeepSeek V3 + Qwen 32B Code Engine","Standard Latency Queue"],
    payhereItemId: "", upgradeUrl: "https://vynor.lk/#pricing",
  },

  starter: {
    id: "starter", displayName: "Starter",
    monthlyTokens: 8_000_000, monthlyRequests: 2_500,
    priceLKR: 1_850, priceUSD: 5.99, discountPct: 0,
    contextWindow: 32_000,
    defaultChatModel:         "qwen/qwen-2.5-coder-32b-instruct",
    defaultAutocompleteModel: "qwen/qwen-2.5-coder-32b-instruct",
    allowedModels: [
      "qwen/qwen-2.5-coder-32b-instruct","qwen-2.5-coder",
      "deepseek/deepseek-chat-v3-0324","deepseek-v3","deepseek-chat",
      "deepseek/deepseek-coder-v2","deepseek-coder",
    ],
    features: [
      "8 Million Tokens/month (8M)","2,500 Fast Coding Requests/month","32k Context Window",
      "Qwen 2.5 Coder 32B & DeepSeek V3 (Lowest latency)",
      "Real-time Tab Autocomplete (FIM)","All 9 Slash Commands","Smart 0-Token Caching",
    ],
    payhereItemId: "vynorai_starter", upgradeUrl: "https://vynor.lk/#pricing",
  },

  pro: {
    id: "pro", displayName: "Pro",
    monthlyTokens: 25_000_000, monthlyRequests: 7_500,
    priceLKR: 3_850, priceUSD: 12.50, discountPct: 0,
    contextWindow: 128_000,
    defaultChatModel:         "deepseek/deepseek-coder-v2",
    defaultAutocompleteModel: "deepseek/deepseek-coder-v2",
    allowedModels: [
      "deepseek/deepseek-coder-v2","deepseek-coder",
      "deepseek/deepseek-chat-v3-0324","deepseek-v3","deepseek-chat",
      "deepseek/deepseek-r1","deepseek-r1",
      "qwen/qwen-2.5-coder-32b-instruct","qwen-2.5-coder",
      "meta-llama/llama-3.3-70b-instruct","llama-3.3-70b",
      "google/gemini-2.5-flash","gemini-2.5-flash",
    ],
    features: [
      "25 Million Tokens/month (25M)","7,500 High-Speed Requests/month","128k Context Window",
      "DeepSeek R1 (High-Precision Reasoning) + DeepSeek V3",
      "Llama 3.3 70B + Gemini 2.5 Flash",
      "Full Agent Mode (Multi-file auto edit)","Priority Fast-Track Queue",
    ],
    payhereItemId: "vynorai_pro", upgradeUrl: "https://vynor.lk/#pricing",
  },

  enterprise: {
    id: "enterprise", displayName: "Ultra",
    monthlyTokens: 60_000_000, monthlyRequests: 20_000,
    priceLKR: 7_900, priceUSD: 25.50, discountPct: 0,
    contextWindow: 256_000,
    defaultChatModel:         "qwen/qwen-2.5-coder-72b-instruct",
    defaultAutocompleteModel: "deepseek/deepseek-coder-v2",
    allowedModels: ["*"],
    features: [
      "60 Million Tokens/month (60M)","20,000 Agent Requests/month","256k Large Context Window",
      "All Premier Models Unlocked (Qwen 72B, DeepSeek R1, Llama 70B)",
      "Dedicated Low-Latency Pipeline","Multi-device Support (Up to 3 devices)","VIP Priority Support",
    ],
    payhereItemId: "vynorai_ultra", upgradeUrl: "https://vynor.lk/#pricing",
  },

  // ── Legacy aliases ───────────────────────────────────────────────────────────
  ultra: {
    id: "ultra", displayName: "Ultra",
    monthlyTokens: 60_000_000, monthlyRequests: 20_000,
    priceLKR: 7_900, priceUSD: 25.50, discountPct: 0,
    contextWindow: 256_000,
    defaultChatModel:         "qwen/qwen-2.5-coder-72b-instruct",
    defaultAutocompleteModel: "deepseek/deepseek-coder-v2",
    allowedModels: ["*"],
    features: [
      "60 Million Tokens/month (60M)","20,000 Agent Requests/month","256k Large Context Window",
      "All Premier Models Unlocked (Qwen 72B, DeepSeek R1, Llama 70B)",
      "Dedicated Low-Latency Pipeline","Multi-device Support (Up to 3 devices)","VIP Priority Support",
    ],
    payhereItemId: "vynorai_ultra", upgradeUrl: "https://vynor.lk/#pricing",
  },
  pro_monthly: {
    id: "pro_monthly", displayName: "Pro Monthly",
    monthlyTokens: 25_000_000, monthlyRequests: 7_500,
    priceLKR: 3_850, priceUSD: 12.50, discountPct: 0,
    contextWindow: 128_000,
    defaultChatModel:         "deepseek/deepseek-coder-v2",
    defaultAutocompleteModel: "deepseek/deepseek-coder-v2",
    allowedModels: ["*"],
    features: ["25M tokens/month","128k context","DeepSeek R1 + V3"],
    payhereItemId: "vynorai_pro", upgradeUrl: "https://vynor.lk/#pricing",
  },
  pro_yearly: {
    id: "pro_yearly", displayName: "Pro Yearly (2 months free)",
    monthlyTokens: 25_000_000, monthlyRequests: 7_500,
    priceLKR: 38_500, priceUSD: 125.00, discountPct: 17,
    contextWindow: 128_000,
    defaultChatModel:         "deepseek/deepseek-coder-v2",
    defaultAutocompleteModel: "deepseek/deepseek-coder-v2",
    allowedModels: ["*"],
    features: ["25M tokens/month","128k context","17% discount (2 months free)"],
    payhereItemId: "vynorai_pro_yearly", upgradeUrl: "https://vynor.lk/#pricing",
  },
};

/** Get plan definition (fallback to free if unknown) */
export function getPlan(planId: string): PlanDefinition {
  return PLANS[planId] || PLANS.free;
}

/** Effective price after discount */
export function getEffectivePrice(plan: PlanDefinition): { lkr: number; usd: number } {
  const mul = (100 - plan.discountPct) / 100;
  return { lkr: Math.round(plan.priceLKR * mul), usd: Math.round(plan.priceUSD * mul * 100) / 100 };
}

/** Check if a requested model is accessible on user's plan */
export function isModelAllowedForPlan(planId: string, modelId: string): boolean {
  const plan = getPlan(planId);
  if (plan.allowedModels.includes("*")) return true;
  return plan.allowedModels.some(
    (allowed) => allowed === modelId || modelId.toLowerCase().includes(allowed.toLowerCase())
  );
}

/** Suggest the next upgrade plan */
export function getUpgradePlan(currentPlanId: string): PlanDefinition | null {
  const ladder: string[] = ["free", "starter", "pro", "enterprise"];
  const normalized = currentPlanId.replace("_monthly", "").replace("_yearly", "").replace("ultra", "enterprise");
  const idx = ladder.indexOf(normalized);
  if (idx === -1 || idx >= ladder.length - 1) return null;
  return PLANS[ladder[idx + 1]];
}

// ─── OpenRouter Model Aliases ──────────────────────────────────────────────────
export function isOpenRouterModelId(model: string): boolean { return model.includes("/"); }

export const MODEL_ALIASES: Record<string, string> = {
  "claude-sonnet-4-6":   "anthropic/claude-sonnet-4-6",
  "claude-3-7-sonnet":   "anthropic/claude-3.7-sonnet",
  "claude-3-5-sonnet":   "anthropic/claude-3.5-sonnet",
  "claude-3-haiku":      "anthropic/claude-3-haiku",
  "claude-opus-4-6":     "anthropic/claude-opus-4-6",
  "gpt-4o":              "openai/gpt-4o",
  "gpt-4o-mini":         "openai/gpt-4o-mini",
  "o3":                  "openai/o3",
  "o3-mini":             "openai/o3-mini",
  "deepseek-chat":       "deepseek/deepseek-chat-v3-0324",
  "deepseek-coder":      "deepseek/deepseek-coder-v2",
  "deepseek-v3":         "deepseek/deepseek-chat-v3-0324",
  "deepseek-r1":         "deepseek/deepseek-r1",
  "gemini-2.5-pro":      "google/gemini-2.5-pro",
  "gemini-2.5-flash":    "google/gemini-2.5-flash",
  "llama-3.3-70b":       "meta-llama/llama-3.3-70b-instruct",
  "llama-3.1-8b":        "meta-llama/llama-3.1-8b-instruct:free",
  "qwen-2.5-coder":      "qwen/qwen-2.5-coder-32b-instruct",
  "qwen-2.5-coder-72b":  "qwen/qwen-2.5-coder-72b-instruct",
};

export function resolveModelId(model: string): string { return MODEL_ALIASES[model] || model; }

export const DEFAULT_CHAT_MODEL   = "deepseek/deepseek-chat-v3-0324";
export const DEFAULT_AUTOCOMPLETE = "deepseek/deepseek-coder-v2";

// ─── Full Config ───────────────────────────────────────────────────────────────
export const config = {
  port:      parseInt(process.env.PORT || "3000", 10),
  adminPort: parseInt(process.env.ADMIN_PORT || String((parseInt(process.env.PORT || "3000", 10) + 1)), 10),
  nodeEnv:   process.env.NODE_ENV || "development",
  baseUrl:   process.env.BASE_URL || "http://localhost:3000",
  jwtSecret: process.env.JWT_SECRET || "vynorai_default_secret_2026",

  payhere: {
    merchantId:     process.env.PAYHERE_MERCHANT_ID     || "",
    merchantSecret: process.env.PAYHERE_MERCHANT_SECRET || "",
    env: (process.env.PAYHERE_ENV || "sandbox").toLowerCase(),
    returnUrl: process.env.PAYHERE_RETURN_URL || "http://localhost:3000/dashboard.html?payment=success",
    cancelUrl: process.env.PAYHERE_CANCEL_URL || "http://localhost:3000/dashboard.html?payment=cancel",
    notifyUrl: process.env.PAYHERE_NOTIFY_URL || "http://localhost:3000/api/payment/notify",
    get checkoutUrl() {
      return this.env === "live"
        ? "https://www.payhere.lk/pay/checkout"
        : "https://sandbox.payhere.lk/pay/checkout";
    },
  },

  aiKeys: {
    openrouter: process.env.OPENROUTER_API_KEY || "",
    openai:     process.env.OPENAI_API_KEY     || "",
    anthropic:  process.env.ANTHROPIC_API_KEY  || "",
    deepseek:   process.env.DEEPSEEK_API_KEY   || "",
    groq:       process.env.GROQ_API_KEY       || "",
    gemini:     process.env.GEMINI_API_KEY     || "",
    ollama:     process.env.OLLAMA_BASE_URL    || "http://localhost:11434",
  },
};
