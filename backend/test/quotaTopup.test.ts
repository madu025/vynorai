/**
 * An admin "Add tokens" top-up adds requests in the same proportion as the user's plan (the plan's
 * requests per credit), so a user stopped at the monthly request cap is let through again.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { before, test } from "node:test";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vynor-topup-"));
let dbm: typeof import("../src/db.js");
let quota: typeof import("../src/services/monthlyQuota.js");
let getPlan: typeof import("../src/config.js").getPlan;

before(async () => {
  process.chdir(tmpDir);
  dbm = await import("../src/db.js");
  await dbm.initDb();
  quota = await import("../src/services/monthlyQuota.js");
  ({ getPlan } = await import("../src/config.js"));
});

async function newUser(plan: string) {
  const id = `u-${Math.random().toString(36).slice(2)}`;
  await dbm.dbRun(
    "INSERT INTO users (id, email, password_hash, api_key, api_key_hash) VALUES (?, ?, 'x', ?, ?)",
    [id, `${id}@t.lk`, `k-${id}`, `h-${id}`],
  );
  if (plan !== "free") {
    await dbm.dbRun(
      `INSERT INTO subscriptions (id, user_id, plan_name, status, order_id, payment_id, amount, currency, valid_until)
       VALUES (?, ?, ?, 'active', ?, 'T', 0, 'LKR', ?)`,
      [`s-${id}`, id, plan, `o-${id}`, new Date(Date.now() + 30 * 86_400_000).toISOString()],
    );
  }
  await quota.getOrInitMonthlyUsage(id, plan);
  return id;
}

const usage = (id: string) =>
  dbm.dbGet<any>(
    "SELECT max_tokens, bonus_tokens, bonus_requests, used_requests FROM monthly_usage WHERE user_id = ? ORDER BY period_end DESC LIMIT 1",
    [id],
  );

test("requests follow the plan's requests-per-credit ratio", () => {
  const plan = getPlan("pro");
  assert.equal(
    quota.proportionalRequests("pro", 2_500_000),
    Math.round((2_500_000 * plan.monthlyRequests) / plan.monthlyTokens),
  );
  // One plan allowance of credits comes with one plan allowance of requests.
  assert.equal(
    quota.proportionalRequests("pro", plan.monthlyTokens),
    plan.monthlyRequests,
  );
  assert.equal(quota.proportionalRequests("pro", 1), 1);
  assert.equal(quota.proportionalRequests("pro", 0), 0);
  assert.ok(quota.proportionalRequests("starter", 1_000_000) > 0);
});

test("an admin top-up without a request count adds requests in proportion", async () => {
  const id = await newUser("pro");
  await quota.creditTopup(id, 5_000_000);
  const row = await usage(id);
  assert.equal(row.bonus_tokens, 5_000_000);
  assert.equal(row.bonus_requests, quota.proportionalRequests("pro", 5_000_000));
  assert.ok(row.bonus_requests > 1000);
});

test("a user at the request cap is let through after a top-up", async () => {
  const id = await newUser("pro");
  await dbm.dbRun("UPDATE monthly_usage SET used_requests = 10000 WHERE user_id = ?", [id]);
  await quota.creditTopup(id, 5_000_000);
  const res: any = { status: () => ({ json: (body: any) => (blocked = body) }) };
  let blocked: unknown;
  let passed = false;
  await quota.monthlyQuotaGuard(
    { user: { id, subscriptionPlan: "pro" }, path: "/v1/chat/completions", body: { model: "vynor-auto", messages: [{ role: "user", content: "hi" }] } } as any,
    res,
    () => {
      passed = true;
    },
  );
  assert.equal(blocked, undefined);
  assert.equal(passed, true);
});

test("a paid top-up pack still adds exactly the requests it names", async () => {
  const id = await newUser("pro");
  await quota.creditTopup(id, 25_000_000, 10_000);
  assert.equal((await usage(id)).bonus_requests, 10_000);
  await quota.creditTopup(id, 100, 0);
  assert.equal((await usage(id)).bonus_requests, 10_000);
});
