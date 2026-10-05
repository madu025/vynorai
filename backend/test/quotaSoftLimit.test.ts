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

test("a large estimate with credits left reserves what remains instead of refusing", async () => {
  // 89,282 of 100,000 used: a cache-blind estimate above 10,718 used to be
  // refused with 'credits are used up' even though most input is cached.
  const user = await userWithUsage(89_282);
  const reservation = await quota.reserveQuotaAtomic(user.id, "free", 50_000);
  assert.ok(reservation, "request should be allowed");
  assert.equal(reservation!.reservedTokens, 10_718);
  // Settling at the real cost releases the unused part.
  await quota.settleQuotaReservation(reservation!, 3_000);
  const usage = await quota.getOrInitMonthlyUsage(user.id, "free");
  assert.equal(usage.used_tokens, 92_282);
});

test("a nearly empty allowance is still refused", async () => {
  const user = await userWithUsage(99_500);
  assert.equal(await quota.reserveQuotaAtomic(user.id, "free", 50_000), null);
});

test("a partial hold leaves room for concurrent requests on a large balance", () => {
  // 10M left: holding all of it refused autocomplete while one turn ran.
  assert.equal(quota.partialHold(10_000_000), 5_000_000);
  // Small balances are held whole; the floor keeps a real turn covered.
  assert.equal(quota.partialHold(10_718), 10_718);
  assert.equal(quota.partialHold(150_000), 100_000);
});

test("a free answer gives back its request as well as its credits", async () => {
  const user = await userWithUsage(1_000);
  const before = await quota.getOrInitMonthlyUsage(user.id, "free");
  const reservation = await quota.reserveQuotaAtomic(user.id, "free", 2_000);
  await quota.settleQuotaReservation(reservation!, 0);
  const after = await quota.getOrInitMonthlyUsage(user.id, "free");
  assert.equal(after.used_tokens, 1_000);
  assert.equal(after.used_requests, before.used_requests);
});

test("an attached screenshot is estimated as an image, not as its base64 text", () => {
  const screenshot = `data:image/png;base64,${"A".repeat(1_000_000)}`;
  const req = {
    path: "/v1/chat/completions",
    body: {
      model: "deepseek-chat",
      max_tokens: 100,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "what is wrong here?" },
            { type: "image_url", image_url: { url: screenshot } },
          ],
        },
      ],
    },
  } as any;
  assert.ok(quota.estimateReservation(req) < 5_000);
});

test("an open hold is recorded and closed when settled", async () => {
  const user = await userWithUsage(0);
  const r = await quota.reserveQuotaAtomic(user.id, "free", 5_000);
  assert.ok(r?.id);
  const open = await dbm.dbGet<{ tokens: number }>(
    "SELECT tokens FROM quota_reservations WHERE id = ?",
    [r!.id],
  );
  assert.equal(Number(open?.tokens), 5_000);
  await quota.settleQuotaReservation(r!, 1_200);
  assert.equal(
    await dbm.dbGet("SELECT id FROM quota_reservations WHERE id = ?", [r!.id]),
    undefined,
  );
});

test("a hold stranded by a restart is given back, a live one is not", async () => {
  const user = await userWithUsage(10_000);
  const stranded = await quota.reserveQuotaAtomic(user.id, "free", 4_000);
  const live = await quota.reserveQuotaAtomic(user.id, "free", 3_000);
  // The stranded request started long ago and its process died.
  await dbm.dbRun("UPDATE quota_reservations SET created_at = ? WHERE id = ?", [
    new Date(Date.now() - quota.STALE_RESERVATION_MS - 60_000).toISOString(),
    stranded!.id,
  ]);
  assert.equal(await quota.reconcileStaleReservations(), 1);
  const usage = await quota.getOrInitMonthlyUsage(user.id, "free");
  // 10,000 + 4,000 + 3,000 held, the stranded 4,000 returned.
  assert.equal(usage.used_tokens, 13_000);
  // Running again (another instance) never refunds twice.
  assert.equal(await quota.reconcileStaleReservations(), 0);
  await quota.releaseQuotaReservation(live!);
});
