/**
 * VynorAI Billing Policy — pure, side-effect-free billing rules.
 * ---------------------------------------------------------------
 * Quota is metered in *credits*. 1 credit = 1 DeepSeek V4.1 Flash token
 * (peak, uncached: 70% input / 30% output ≈ $0.57 per 1M tokens — the same
 * scale as the old DeepSeek V3 baseline). Other models are weighted by their
 * blended upstream price relative to that, rounded UP so an expensive model
 * can never be billed below its real cost. Reasoning tokens are output tokens,
 * so thinking turns cost more credits automatically.
 *
 * Update CREDIT_WEIGHTS whenever upstream list prices change.
 */
import { resolveModelId } from "../config.js";

// First match wins — keep specific patterns above general ones.
const CREDIT_WEIGHTS: Array<[RegExp, number]> = [
  // Auto resolves to a tier model before settlement; reserve for its priciest tier (Flash).
  [/^(vynor-auto|auto)$/, 1],
  [/deepseek-v4-pro/, 4], // $1.32 / $3.96 (peak)
  [/claude.*opus/, 64], // $15 / $75
  [/claude.*sonnet/, 15], // $3 / $15
  [/claude.*haiku/, 2], // $0.25 / $1.25
  [/openai\/o3-mini/, 4], // $1.10 / $4.40
  [/openai\/o3/, 8], // $2 / $8
  [/gpt-4o-mini/, 1], // $0.15 / $0.60
  [/gpt-4o/, 10], // $2.50 / $10
  [/gemini-2\.5-pro/, 8], // $1.25 / $10
  [/gemini-2\.5-flash/, 2], // $0.30 / $2.50
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
