/**
 * An admin reset must lift a request-limit block: a user stopped at the monthly request cap gets
 * through the quota guard again after startPaidCycle (the admin "grant subscription" path), in
 * every cycle shape the database can be in.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { before, test } from "node:test";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vynor-reset-"));
let dbm: typeof import("../src/db.js");
let quota: typeof import("../src/services/monthlyQuota.js");

before(async () => {
  process.chdir(tmpDir);
  dbm = await import("../src/db.js");
  await dbm.initDb();
  quota = await import("../src/services/monthlyQuota.js");
});

const DAY = 86_400_000;
const iso = (date: Date) => date.toISOString().slice(0, 10);

async function proUserAtCap() {
  const id = `u-${Math.random().toString(36).slice(2)}`;
  await dbm.dbRun(
    "INSERT INTO users (id, email, password_hash, api_key, api_key_hash) VALUES (?, ?, 'x', ?, ?)",
    [id, `${id}@t.lk`, `k-${id}`, `h-${id}`],
  );
  await quota.getOrInitMonthlyUsage(id, "pro");
  await dbm.dbRun("UPDATE monthly_usage SET used_requests = 10000 WHERE user_id = ?", [id]);
  return id;
}

function guard(userId: string) {
  return new Promise<{ status?: number; body?: any }>((resolve) => {
    const req: any = {
      user: { id: userId, subscriptionPlan: "pro" },
      path: "/v1/chat/completions",
      body: { model: "vynor-auto", messages: [{ role: "user", content: "hi" }] },
    };
    const res: any = {
      status(code: number) {
        return { json: (body: any) => resolve({ status: code, body }) };
      },
    };
    void quota.monthlyQuotaGuard(req, res, () => resolve({}));
  });
}

test("a user at the request cap is blocked", async () => {
  const id = await proUserAtCap();
  const blocked = await guard(id);
  assert.equal(blocked.status, 403);
  assert.equal(blocked.body.error.code, "monthly_limit_reached");
});

test("startPaidCycle on the same day lifts the block", async () => {
  const id = await proUserAtCap();
  await quota.startPaidCycle(id, "pro", new Date(Date.now() + 30 * DAY));
  assert.equal((await guard(id)).status, undefined);
});

test("startPaidCycle when the cycle started on an earlier day lifts the block", async () => {
  const id = await proUserAtCap();
  await dbm.dbRun(
    "UPDATE monthly_usage SET period_start = ?, period_end = ? WHERE user_id = ?",
    [iso(new Date(Date.now() - 10 * DAY)), iso(new Date(Date.now() + 20 * DAY)), id],
  );
  await quota.startPaidCycle(id, "pro", new Date(Date.now() + 30 * DAY));
  assert.equal((await guard(id)).status, undefined);
  const rows = await dbm.dbAll<any>(
    "SELECT used_requests, period_start, period_end FROM monthly_usage WHERE user_id = ? ORDER BY period_start",
    [id],
  );
  assert.equal(rows.filter((row) => row.period_end >= iso(new Date())).length, 1);
});

test("a granted bonus-request balance does not re-block after the reset", async () => {
  const id = await proUserAtCap();
  await dbm.dbRun("UPDATE monthly_usage SET bonus_requests = 500 WHERE user_id = ?", [id]);
  await quota.startPaidCycle(id, "pro", new Date(Date.now() + 30 * DAY));
  const row = await dbm.dbGet<any>(
    "SELECT used_requests FROM monthly_usage WHERE user_id = ? ORDER BY period_end DESC LIMIT 1",
    [id],
  );
  assert.equal(row.used_requests, 0);
  assert.equal((await guard(id)).status, undefined);
});
