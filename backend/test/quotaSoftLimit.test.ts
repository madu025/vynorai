/**
 * "Never hard-stop": a used-up allowance still lets chat requests through to
 * the zero-cost answers (cache, templates); only upstream calls are refused.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { before, test } from "node:test";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vynor-soft-"));
let dbm: typeof import("../src/db.js");
let quota: typeof import("../src/services/monthlyQuota.js");

before(async () => {
  process.chdir(tmpDir);
  dbm = await import("../src/db.js");
  await dbm.initDb();
  quota = await import("../src/services/monthlyQuota.js");
});

async function userWithUsage(used: number) {
  const id = `u-${Math.random().toString(36).slice(2)}`;
  await dbm.dbRun(
    "INSERT INTO users (id, email, password_hash, api_key, api_key_hash) VALUES (?, ?, 'x', ?, ?)",
    [id, `${id}@t.lk`, `k-${id}`, `h-${id}`],
  );
  await quota.getOrInitMonthlyUsage(id, "free");
  await dbm.dbRun(
    "UPDATE monthly_usage SET used_tokens = ? WHERE user_id = ?",
    [used, id],
  );
  return { id, subscriptionPlan: "free" };
}

function run(user: object, reqPath: string) {
  return new Promise<{ status?: number; body?: any; info?: any }>((resolve) => {
    const req: any = {
      user,
      path: reqPath,
      body: {
        model: "vynor-auto",
        messages: [{ role: "user", content: "hi" }],
      },
    };
    const res: any = {
      status(code: number) {
        return { json: (body: any) => resolve({ status: code, body }) };
      },
    };
    void quota.monthlyQuotaGuard(req, res, () =>
      resolve({ info: req.quotaInfo }),
    );
  });
}

test("used-up allowance: chat goes on to zero-cost answers, autocomplete is refused", async () => {
  const user = await userWithUsage(100_000); // free plan: 100K credits
  const chat = await run(user, "/v1/chat/completions");
  assert.equal(chat.status, undefined);
  assert.equal(chat.info.exhausted, true);
  assert.equal(chat.info.reservation, undefined); // nothing reserved, nothing billed
  assert.equal(chat.info.creditError.error.code, "monthly_limit_reached");

  const fim = await run(user, "/v1/fim/completions");
  assert.equal(fim.status, 403);
});

test("saver mode from 80% of the allowance", async () => {
  const at85 = await run(await userWithUsage(85_000), "/v1/chat/completions");
  assert.equal(at85.info.saver, true);
  assert.equal(at85.info.exhausted, undefined);
  const at10 = await run(await userWithUsage(10_000), "/v1/chat/completions");
  assert.equal(at10.info.saver, false);
});
