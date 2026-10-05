import assert from "node:assert/strict";
import test from "node:test";
import {
  creditsFor,
  creditWeight,
  isTopupPlan,
  planDurationDays,
  planTier,
  proratedCreditMs,
  UNKNOWN_MODEL_WEIGHT,
  validateIpnAgainstOrder,
} from "../src/services/billingPolicy.js";

const order = {
  user_id: "u1",
  plan_name: "starter",
  status: "pending",
  amount_minor: 185_000,
  currency: "LKR",
};
const ipn = {
  merchant_id: "M1",
  payhere_amount: "1850.00",
  payhere_currency: "LKR",
};

test("DeepSeek V3 is the 1x credit baseline, aliases included", () => {
  assert.equal(creditWeight("deepseek/deepseek-chat-v3-0324"), 1);
  assert.equal(creditWeight("deepseek-v3"), 1);
  assert.equal(creditsFor("deepseek-chat", 1000), 1000);
});

test("premium models are weighted by upstream price", () => {
  assert.equal(creditWeight("claude-opus-4-6"), 64);
  assert.equal(creditWeight("anthropic/claude-3.7-sonnet"), 15);
  assert.equal(creditWeight("deepseek-r1"), 2);
  assert.equal(creditWeight("openai/gpt-4o-mini"), 1);
  assert.equal(creditWeight("gpt-4o"), 10);
});

test("unknown models are billed conservatively", () => {
  assert.equal(
    creditWeight("mystery/new-frontier-model"),
    UNKNOWN_MODEL_WEIGHT,
  );
});

test("credits round up and never go negative", () => {
  assert.equal(creditsFor("deepseek-v3", 0), 0);
  assert.equal(creditsFor("deepseek-v3", -5), 0);
  assert.equal(creditsFor("claude-opus-4-6", 1), 64);
});

test("plan helpers", () => {
  assert.equal(isTopupPlan("topup5m"), true);
  assert.equal(isTopupPlan("pro"), false);
  assert.equal(planDurationDays("pro_yearly"), 365);
  assert.equal(planDurationDays("pro"), 30);
});

test("IPN must match the stored order", () => {
  assert.deepEqual(validateIpnAgainstOrder(ipn, order, "M1"), { ok: true });
  assert.deepEqual(validateIpnAgainstOrder(ipn, undefined, "M1"), {
    ok: false,
    reason: "unknown_order",
  });
  assert.deepEqual(validateIpnAgainstOrder(ipn, order, "OTHER"), {
    ok: false,
    reason: "merchant_mismatch",
  });
  assert.deepEqual(validateIpnAgainstOrder(ipn, order, ""), {
    ok: false,
    reason: "merchant_mismatch",
  });
  assert.deepEqual(
    validateIpnAgainstOrder({ ...ipn, payhere_amount: "650.00" }, order, "M1"),
    { ok: false, reason: "amount_mismatch" },
  );
  assert.deepEqual(
    validateIpnAgainstOrder({ ...ipn, payhere_currency: "USD" }, order, "M1"),
    { ok: false, reason: "currency_mismatch" },
  );
});

test("monthly and yearly billing of one plan are the same tier", () => {
  assert.equal(planTier("pro_yearly"), "pro");
  assert.equal(planTier("pro_monthly"), "pro");
  assert.equal(planTier("starter"), "starter");
});

test("switching tier carries the unused paid time, prorated by price", () => {
  const day = 24 * 60 * 60 * 1000;
  // 100 unused days of a plan half as expensive per day = 50 days of the new one.
  assert.equal(proratedCreditMs(50, 100, 100 * day), 50 * day);
  assert.equal(proratedCreditMs(50, 100, -day), 0);
  assert.equal(proratedCreditMs(0, 100, 10 * day), 0);
});
