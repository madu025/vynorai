/**
 * VynorAI Billing Policy — pure, side-effect-free billing rules.
 * ---------------------------------------------------------------
 * Quota is metered in *credits*, priced so no token mix can cost more than
 * it earns. For DeepSeek V4.1 Flash (peak list prices):
 *
 *   uncached input  1   credit  ($0.30 / 1M tokens)
 *   cached input    0.1 credit  ($0.006 / 1M — DeepSeek prefix cache)
 *   output          4   credits ($1.20 / 1M, reasoning tokens included)
 *
 * so one million credits never costs more than $0.30 upstream, whatever the
 * mix. Other models multiply this by their price relative to Flash, rounded
 * UP (CREDIT_WEIGHTS). Only DeepSeek's cache is cheap enough for the cached
 * discount; other providers bill cached input as normal input here.
 *
 * Update the weights whenever upstream list prices change.
 */
import { resolveModelId } from "../config.js";
import { isDeepSeekModel, isDeepSeekOffPeak } from "./pricing.js";

// First match wins — keep specific patterns above general ones.
const CREDIT_WEIGHTS: Array<[RegExp, number]> = [
  // Auto resolves to a tier model before settlement; reserve for its priciest tier (Flash).
  [/^(vynor-auto|auto)$/, 1],
  [/deepseek-v4-pro/, 5], // $1.32 / $3.96 (peak): 4.4x Flash input, 3.3x output
  [/claude.*opus/, 64], // $15 / $75
  [/claude.*sonnet/, 15], // $3 / $15
  [/claude.*haiku/, 2], // $0.25 / $1.25
  [/openai\/o3-mini/, 4], // $1.10 / $4.40
  [/openai\/o3/, 8], // $2 / $8
  [/gpt-4o-mini/, 1], // $0.15 / $0.60
  [/gpt-4o/, 10], // $2.50 / $10
  [/gemini-2\.5-pro/, 9], // $1.25 / $10
  [/gemini-2\.5-flash/, 3], // $0.30 / $2.50
  [/deepseek-r1/, 2], // $0.55 / $2.19
  [/deepseek/, 1],
  [/qwen/, 1],
  [/llama/, 1],
];

/** Unknown models are billed conservatively until they are priced explicitly. */
export const UNKNOWN_MODEL_WEIGHT = 20;

export function creditWeight(model: string | undefined | null): number {
  if (!model) return 1;
  const canonical = resolveModelId(model).toLowerCase();
  for (const [pattern, weight] of CREDIT_WEIGHTS) {
    if (pattern.test(canonical)) return weight;
  }
  return UNKNOWN_MODEL_WEIGHT;
}

/** Convert raw provider tokens into billable credits for a model. */
export function creditsFor(
  model: string | undefined | null,
  tokens: number,
): number {
  if (!Number.isFinite(tokens) || tokens <= 0) return 0;
  return Math.ceil(tokens * creditWeight(model));
}

/**
 * DeepSeek bills off-peak hours at half price. Passing part of that on
 * (default: 0.67 credits per token, i.e. 1.5x more work per credit) moves
 * heavy work to cheap hours and still keeps more margin than peak.
 */
export function offPeakCreditFactor(
  model: string | undefined | null,
  at: Date = new Date(),
): number {
  if (!model || !isDeepSeekModel(resolveModelId(model))) return 1;
  if (!isDeepSeekOffPeak(at)) return 1;
  const configured = Number(process.env.OFFPEAK_CREDIT_FACTOR ?? "0.67");
  // Never below DeepSeek's own discount, never a surcharge.
  return Number.isFinite(configured)
    ? Math.min(1, Math.max(0.5, configured))
    : 1;
}

/** Credits per token type, relative to one uncached input token. */
export const TOKEN_TYPE_WEIGHTS = {
  input: 1,
  cachedInput: 0.1,
  output: 4,
} as const;

export interface TokenUsage {
  inputTokens: number;
  /** Part of inputTokens served from the provider prefix cache. */
  cachedInputTokens: number;
  outputTokens: number;
}

/**
 * Credits for a finished request: token types weighted by real cost, times
 * the model weight, times the off-peak factor.
 */
export function usageCredits(
  model: string | undefined | null,
  usage: TokenUsage,
  at: Date = new Date(),
): number {
  const n = (v: number) => (Number.isFinite(v) && v > 0 ? v : 0);
  const input = n(usage.inputTokens);
  const output = n(usage.outputTokens);
  const deepseek = !!model && isDeepSeekModel(resolveModelId(model));
  const cached = deepseek ? Math.min(n(usage.cachedInputTokens), input) : 0;
  const weighted =
    (input - cached) * TOKEN_TYPE_WEIGHTS.input +
    cached * TOKEN_TYPE_WEIGHTS.cachedInput +
    output * TOKEN_TYPE_WEIGHTS.output;
  if (weighted <= 0) return 0;
  return Math.ceil(
    weighted * creditWeight(model) * offPeakCreditFactor(model, at),
  );
}

// ─── Plans ────────────────────────────────────────────────────────────────────

/** Top-ups add credits to the current cycle; they are never a subscription tier. */
export function isTopupPlan(planId: string): boolean {
  return planId.startsWith("topup");
}

export function planDurationDays(planId: string): number {
  return planId.endsWith("_yearly") ? 365 : 30;
}

// ─── PayHere IPN ──────────────────────────────────────────────────────────────

export interface StoredOrder {
  user_id: string;
  plan_name: string;
  status: string;
  amount_minor: number;
  currency: string;
}

/**
 * Validate a signature-verified IPN against the order we created at checkout.
 * PayHere's md5sig does not cover custom_1/custom_2, so user and plan must
 * always come from the stored order — never from the IPN body.
 */
export function validateIpnAgainstOrder(
  ipn: Record<string, any>,
  order: StoredOrder | undefined,
  merchantId: string,
): { ok: true } | { ok: false; reason: string } {
  if (!order) return { ok: false, reason: "unknown_order" };
  if (!merchantId || String(ipn.merchant_id) !== merchantId) {
    return { ok: false, reason: "merchant_mismatch" };
  }
  if (String(ipn.payhere_currency) !== order.currency) {
    return { ok: false, reason: "currency_mismatch" };
  }
  const paidMinor = Math.round(Number(ipn.payhere_amount) * 100);
  if (!Number.isFinite(paidMinor) || paidMinor !== order.amount_minor) {
    return { ok: false, reason: "amount_mismatch" };
  }
  return { ok: true };
}

/** Date-only (YYYY-MM-DD, UTC) string used by monthly_usage periods. */
export function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
