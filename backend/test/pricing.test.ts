import assert from "node:assert/strict";
import { test } from "node:test";

import {
  estimateDeepSeekCostUsd,
  isDeepSeekOffPeak,
} from "../src/services/pricing.ts";
import {
  billableCredits,
  offPeakCreditFactor,
} from "../src/services/billingPolicy.ts";

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
  assert.equal(
    billableCredits("deepseek/deepseek-flash", 1000, SAT_10_BJ),
    670,
  );
  assert.equal(
    billableCredits("deepseek/deepseek-flash", 1000, MON_10_BJ),
    1000,
  );

  // The discount can be tuned but never goes below DeepSeek's own 50%.
  process.env.OFFPEAK_CREDIT_FACTOR = "0.2";
  assert.equal(offPeakCreditFactor("deepseek-flash", SAT_10_BJ), 0.5);
  process.env.OFFPEAK_CREDIT_FACTOR = "1";
  assert.equal(offPeakCreditFactor("deepseek-flash", SAT_10_BJ), 1);
  delete process.env.OFFPEAK_CREDIT_FACTOR;
});
