import assert from "node:assert/strict";
import { test } from "node:test";

import {
  estimateDeepSeekCostUsd,
  isDeepSeekOffPeak,
} from "../src/services/pricing.ts";
import {
  offPeakCreditFactor,
  usageCredits,
} from "../src/services/billingPolicy.ts";
import { PLANS, getEffectivePrice } from "../src/config.ts";

// Beijing is UTC+8. 2026-10-05 is a Monday.
const MON_10_BJ = new Date("2026-10-05T02:00:00Z"); // 10:00 peak
const MON_13_BJ = new Date("2026-10-05T05:00:00Z"); // 13:00 lunch, off-peak
const MON_18_BJ = new Date("2026-10-05T10:00:00Z"); // 18:00 peak just ended
const SAT_10_BJ = new Date("2026-10-03T02:00:00Z"); // weekend

test("DeepSeek peak windows follow Beijing weekday hours", () => {
  assert.equal(isDeepSeekOffPeak(MON_10_BJ), false);
  assert.equal(isDeepSeekOffPeak(MON_13_BJ), true);
  assert.equal(isDeepSeekOffPeak(MON_18_BJ), true);
  assert.equal(isDeepSeekOffPeak(SAT_10_BJ), true);
});

test("cost estimate prices cache hits, misses and output, halved off-peak", () => {
  const usage = {
    inputTokens: 1_000_000,
    cachedInputTokens: 900_000,
    outputTokens: 100_000,
  };
  // 100K miss x $0.30 + 900K hit x $0.006 + 100K out x $1.20 = $0.1554 at peak
  const peak = estimateDeepSeekCostUsd(
    "deepseek/deepseek-flash",
    usage,
    MON_10_BJ,
  )!;
  assert.ok(Math.abs(peak - 0.1554) < 1e-9);
  const off = estimateDeepSeekCostUsd("deepseek-flash", usage, SAT_10_BJ)!;
  assert.ok(Math.abs(off - peak / 2) < 1e-9);
  assert.equal(
    estimateDeepSeekCostUsd("anthropic/claude-sonnet-4", usage),
    null,
  );
});

test("off-peak gives DeepSeek requests a credit discount, never other models", () => {
  delete process.env.OFFPEAK_CREDIT_FACTOR;
  assert.equal(offPeakCreditFactor("deepseek/deepseek-flash", MON_10_BJ), 1);
  assert.equal(offPeakCreditFactor("deepseek/deepseek-flash", SAT_10_BJ), 0.67);
  assert.equal(offPeakCreditFactor("anthropic/claude-sonnet-4", SAT_10_BJ), 1);
  const thousandIn = {
    inputTokens: 1000,
    cachedInputTokens: 0,
    outputTokens: 0,
  };
  assert.equal(
    usageCredits("deepseek/deepseek-flash", thousandIn, SAT_10_BJ),
    670,
  );
  assert.equal(
    usageCredits("deepseek/deepseek-flash", thousandIn, MON_10_BJ),
    1000,
  );

  // The discount can be tuned but never goes below DeepSeek's own 50%.
  process.env.OFFPEAK_CREDIT_FACTOR = "0.2";
  assert.equal(offPeakCreditFactor("deepseek-flash", SAT_10_BJ), 0.5);
  process.env.OFFPEAK_CREDIT_FACTOR = "1";
  assert.equal(offPeakCreditFactor("deepseek-flash", SAT_10_BJ), 1);
  delete process.env.OFFPEAK_CREDIT_FACTOR;
});

test("credits weight cached input 0.1 and output 4 (DeepSeek only)", () => {
  const usage = {
    inputTokens: 10_000,
    cachedInputTokens: 9_000,
    outputTokens: 500,
  };
  // 1,000 uncached + 9,000 x 0.1 + 500 x 4 = 3,900
  assert.equal(
    usageCredits("deepseek/deepseek-flash", usage, MON_10_BJ),
    3_900,
  );
  // Pro: x5
  assert.equal(
    usageCredits("deepseek/deepseek-v4-pro", usage, MON_10_BJ),
    19_500,
  );
  // Other providers get no cached discount: 10,000 + 2,000 = 12,000 x 10
  assert.equal(usageCredits("openai/gpt-4o", usage, MON_10_BJ), 120_000);
});

test("no token mix can make a paid plan lose money (peak prices, worst case)", () => {
  let seed = 3;
  const rand = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  let worstCostPerCredit = 0;
  for (const model of ["deepseek/deepseek-flash", "deepseek/deepseek-v4-pro"]) {
    for (let i = 0; i < 2000; i++) {
      const input = Math.floor(rand() * 200_000);
      const usage = {
        inputTokens: input,
        cachedInputTokens: Math.floor(input * rand()),
        outputTokens: Math.floor(rand() * 40_000),
      };
      const credits = usageCredits(model, usage, MON_10_BJ);
      if (!credits) continue;
      const cost = estimateDeepSeekCostUsd(model, usage, MON_10_BJ)!;
      worstCostPerCredit = Math.max(worstCostPerCredit, cost / credits);
    }
  }
  assert.ok(
    worstCostPerCredit * 1e6 <= 0.3 + 1e-9,
    `worst $${worstCostPerCredit * 1e6}/1M credits`,
  );
  // Every paid plan earns more per credit than the worst case costs, after a 3% payment fee.
  for (const plan of Object.values(PLANS)) {
    const usd = getEffectivePrice(plan).usd;
    if (!usd || !plan.monthlyTokens) continue;
    const months = plan.id.endsWith("_yearly") ? 12 : 1;
    const revenuePerCredit = (usd * 0.97) / (plan.monthlyTokens * months);
    assert.ok(
      revenuePerCredit > worstCostPerCredit,
      `${plan.id} loses money in the worst case`,
    );
  }
});
