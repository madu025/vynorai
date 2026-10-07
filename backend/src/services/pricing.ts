/**
 * Upstream list prices, for unit economics when a provider reports no cost
 * (DeepSeek returns token counts only). Update when DeepSeek changes prices.
 *
 * DeepSeek bills peak hours at 2x: Mon-Fri 09:00-12:00 and 14:00-18:00
 * Beijing time (UTC+8). Everything else, and all weekend, is off-peak.
 */

interface PricePerMillion {
  /** Input tokens not served from the prefix cache. */
  miss: number;
  /** Input tokens served from the prefix cache. */
  hit: number;
  output: number;
}

export const DEEPSEEK_PRICING_SOURCE_URL =
  "https://api-docs.deepseek.com/quick_start/pricing/";
export const DEEPSEEK_PRICING_VERIFIED_AT = "2026-10-06";
export const DEEPSEEK_COST_METHOD =
  "Recorded provider tokens multiplied by DeepSeek's published cache-hit, cache-miss, output, peak and off-peak rates";

// Peak prices, USD per 1M tokens. First match wins.
const DEEPSEEK_PEAK_PRICES: Array<[RegExp, PricePerMillion]> = [
  [/deepseek-v4-pro/, { miss: 1.32, hit: 0.0264, output: 3.96 }],
  [/deepseek/, { miss: 0.3, hit: 0.006, output: 1.2 }],
];

const BEIJING_OFFSET_MS = 8 * 3600_000;

export function isDeepSeekOffPeak(at: Date = new Date()): boolean {
  const beijing = new Date(at.getTime() + BEIJING_OFFSET_MS);
  const day = beijing.getUTCDay();
  if (day === 0 || day === 6) return true;
  const minutes = beijing.getUTCHours() * 60 + beijing.getUTCMinutes();
  const peak =
    (minutes >= 9 * 60 && minutes < 12 * 60) ||
    (minutes >= 14 * 60 && minutes < 18 * 60);
  return !peak;
}

export function isDeepSeekModel(model: string | null | undefined): boolean {
  return /deepseek/i.test(String(model ?? ""));
}

/** USD cost of one DeepSeek request from its token counts, or null for other models. */
export function estimateDeepSeekCostUsd(
  model: string | null | undefined,
  usage: {
    inputTokens: number;
    cachedInputTokens: number;
    outputTokens: number;
  },
  at: Date = new Date(),
): number | null {
  const id = String(model ?? "").toLowerCase();
  const price = DEEPSEEK_PEAK_PRICES.find(([re]) => re.test(id))?.[1];
  if (!price) return null;
  const factor = isDeepSeekOffPeak(at) ? 0.5 : 1;
  const hit = Math.min(usage.cachedInputTokens, usage.inputTokens);
  const miss = usage.inputTokens - hit;
  return (
    ((miss * price.miss + hit * price.hit + usage.outputTokens * price.output) *
      factor) /
    1_000_000
  );
}
