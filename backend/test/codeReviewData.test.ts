/**
 * Regression tests for the data-layer findings of the full code review (R2#1-#12, R5#2):
 * validated and lossless page cursors, bounded memory fields, plan overrides that survive a database
 * blip, batched stale-hold sweeps, paged admin lists, and the cutover script's rollback and rename
 * safety. The tests are portable: they run on SQLite and, with DATABASE_URL set, on PostgreSQL.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Server } from "node:http";
import { after, before, test } from "node:test";

const originalCwd = process.cwd();
const tmpDir = fs.mkdtempSync(
  path.join(os.tmpdir(), "vynor-code-review-data-"),
);
const adminSecret = "s".repeat(40);
const adminHeaders = {
  "x-admin-secret": adminSecret,
  "content-type": "application/json",
};
const repoRoot = path.resolve(originalCwd, "..");

let dbm: typeof import("../src/db.js");
let server: Server;
let baseUrl = "";

process.env.BG_QUOTE_SECRET = "q".repeat(48);
process.env.BG_MODEL_TOKEN_SECRET = "m".repeat(48);

before(async () => {
  process.chdir(tmpDir);
  process.env.NODE_ENV = "test";
  process.env.ADMIN_SECRET = adminSecret;
  dbm = await import("../src/db.js");
  await dbm.initDb();
  await (await import("../src/services/planManager.js")).initPlanManager();
  await (await import("../src/services/memoryEngine.js")).ensureMemoryTables();
  const express = (await import("express")).default;
  const { adminRouter } = await import("../src/routes/admin.js");
  const app = express();
  app.use(express.json());
  app.use("/admin", adminRouter);
  server = app.listen(0);
  baseUrl = `http://127.0.0.1:${(server.address() as any).port}`;
});

after(async () => {
  server?.close();
  if (dbm?.db)
    await new Promise<void>((resolve) => dbm.db!.close(() => resolve()));
  process.chdir(originalCwd);
});

let counter = 0;
async function addUser(prefix = "u", email?: string) {
  counter += 1;
  const id = `${prefix}-${counter}`;
  await dbm.dbRun(
    "INSERT INTO users (id, email, password_hash, api_key, api_key_hash) VALUES (?, ?, 'x', ?, ?)",
    [id, email ?? `${id}@test.invalid`, `key-${id}`, `hash-${id}`],
  );
  return id;
}

async function addTask(id: string, userId: string, createdAt: string) {
  await dbm.dbRun(
    `INSERT INTO background_tasks
       (id, user_id, status, project_fingerprint, manifest_digest, estimate_credits, cap_credits, quote_id, idempotency_key, created_at)
     VALUES (?, ?, 'queued', ?, ?, 1, 1, ?, ?, ?)`,
    [
      id,
      userId,
      "f".repeat(64),
      "d".repeat(64),
      `q-${id}`,
      `k-${id}`,
      createdAt,
    ],
  );
}

// ---------------------------------------------------------------------------------------------
// R2#1 and R2#2: background task cursor
// ---------------------------------------------------------------------------------------------

test("a page cursor must look like a timestamp (optionally with a task id), anything else is a 400", async () => {
  const bg = await import("../src/services/backgroundTasks.js");
  const { ListTasksQuerySchema } = await import("../src/routes/background.js");
  const valid = [
    "2026-10-25 04:30:00",
    "2026-10-25T04:30:00.123Z",
    "2026-10-25 04:30:00.123456+00",
    "2026-10-25 04:30:00.123456+05:30|task_abc-1",
  ];
  for (const cursor of valid) {
    assert.ok(bg.BACKGROUND_CURSOR_PATTERN.test(cursor), cursor);
    assert.ok(ListTasksQuerySchema.safeParse({ cursor }).success, cursor);
  }
  const invalid = [
    "garbage",
    "",
    "2026-10-25",
    "2026-10-25 04:30:00'; DROP TABLE users;--",
    "2026-10-25 04:30:00|",
    "2026-10-25 04:30:00|bad id!",
    "x|y",
    `2026-10-25 04:30:00|${"a".repeat(129)}`,
    "2026-13-45 99:99:99x",
  ];
  for (const cursor of invalid) {
    if (cursor === "") continue; // an empty value means "no cursor"
    assert.equal(bg.parseBackgroundCursor(cursor), undefined, cursor);
    assert.ok(!ListTasksQuerySchema.safeParse({ cursor }).success, cursor);
  }
  await assert.rejects(
    () => bg.listBackgroundTasks("nobody", 5, undefined, "garbage"),
    /BACKGROUND_INVALID_CURSOR/,
  );
});

test("paging by (created_at, id) loses no task that shares an instant with the page boundary", async () => {
  const bg = await import("../src/services/backgroundTasks.js");
  const userId = await addUser("pager");
  const same = "2026-10-20T10:00:00.000Z";
  for (const n of ["a", "b", "c", "d", "e"])
    await addTask(`pg-same-${n}`, userId, same);
  const seen: string[] = [];
  let cursor: string | undefined;
  for (let guard = 0; guard < 10; guard += 1) {
    const page = await bg.listBackgroundTasks(userId, 2, undefined, cursor);
    seen.push(...page.tasks.map((t: any) => String(t.id)));
    if (!page.nextCursor) break;
    cursor = page.nextCursor;
  }
  assert.deepEqual(seen.slice().sort(), [
    "pg-same-a",
    "pg-same-b",
    "pg-same-c",
    "pg-same-d",
    "pg-same-e",
  ]);
  assert.equal(new Set(seen).size, 5, "no task is returned twice");
});

test("a cursor keeps sub-millisecond precision so the next page does not skip a row", async () => {
  const bg = await import("../src/services/backgroundTasks.js");
  const userId = await addUser("micro");
  // PostgreSQL stores microseconds; the driver rounds timestamps it returns to milliseconds.
  await addTask("micro-older", userId, "2026-10-21T10:00:00.123456Z");
  await addTask("micro-newer", userId, "2026-10-21T10:00:00.123789Z");
  const first = await bg.listBackgroundTasks(userId, 1);
  assert.equal((first.tasks[0] as any).id, "micro-newer");
  assert.ok(first.nextCursor);
  const second = await bg.listBackgroundTasks(
    userId,
    1,
    undefined,
    first.nextCursor!,
  );
  assert.deepEqual(
    second.tasks.map((t: any) => t.id),
    ["micro-older"],
  );
});

// ---------------------------------------------------------------------------------------------
// R2#3 and R2#4: memory rules and entries
// ---------------------------------------------------------------------------------------------

test("a rule scope longer than the 32-character column is refused with a 400, not a 500", async () => {
  const { AddRuleSchema, RulesQuerySchema } = await import(
    "../src/routes/memory.js"
  );
  assert.ok(
    AddRuleSchema.safeParse({ rule: "use tabs", scope: "s".repeat(32) })
      .success,
  );
  assert.ok(
    !AddRuleSchema.safeParse({ rule: "use tabs", scope: "s".repeat(33) })
      .success,
  );
  assert.ok(!RulesQuerySchema.safeParse({ scope: "s".repeat(33) }).success);
  assert.equal(AddRuleSchema.parse({ rule: "r" }).scope, "global");
});

test("ttl_days is bounded and a huge value can no longer create an invalid date", async () => {
  const { PutMemorySchema } = await import("../src/routes/memory.js");
  assert.ok(PutMemorySchema.safeParse({ value: "v", ttl_days: 3650 }).success);
  assert.ok(!PutMemorySchema.safeParse({ value: "v", ttl_days: 3651 }).success);
  assert.ok(!PutMemorySchema.safeParse({ value: "v", ttl_days: 1e12 }).success);

  // The service clamps as well, so a caller that skips the route cannot throw RangeError.
  const memory = await import("../src/services/memoryEngine.js");
  const userId = await addUser("mem");
  await assert.doesNotReject(() =>
    memory.setMemory(userId, "k-huge", "v", 1e12),
  );
  await assert.doesNotReject(() =>
    memory.setMemory(userId, "k-nan", "v", Number.NaN),
  );
  const row = await dbm.dbGet<{ expires_at: string | null }>(
    "SELECT expires_at FROM user_memory WHERE user_id = ? AND key = ?",
    [userId, "k-huge"],
  );
  const at = new Date(String(row?.expires_at)).getTime();
  assert.ok(Number.isFinite(at), "the stored expiry is a real date");
  assert.ok(at <= Date.now() + 3651 * 86_400_000, "clamped to ten years");
});

// ---------------------------------------------------------------------------------------------
// R2#5 and R2#6: plan overrides
// ---------------------------------------------------------------------------------------------

test("plan overrides: zero is honoured and one malformed JSON column skips only that field", async () => {
  const planManager = await import("../src/services/planManager.js");
  const { PLANS } = await import("../src/config.js");
  await dbm.dbRun("DELETE FROM plan_overrides WHERE plan_id = ?", ["pro"]);
  await dbm.dbRun(
    "INSERT INTO plan_overrides (plan_id, display_name, monthly_requests, allowed_models, features, is_active) VALUES (?, ?, ?, ?, ?, 1)",
    ["pro", "Zed Pro", 0, "{not json", '["a","b"]'],
  );
  try {
    planManager.invalidatePlanCache();
    const plans = await planManager.getEffectivePlans();
    assert.equal(plans.pro.displayName, "Zed Pro");
    assert.equal(plans.pro.monthlyRequests, 0, "an override of 0 is applied");
    assert.deepEqual(
      plans.pro.features,
      ["a", "b"],
      "the good column still applies",
    );
    assert.deepEqual(
      plans.pro.allowedModels,
      PLANS.pro.allowedModels,
      "the malformed column keeps the default",
    );
  } finally {
    await dbm.dbRun("DELETE FROM plan_overrides WHERE plan_id = ?", ["pro"]);
    planManager.invalidatePlanCache();
  }
});

test("a database error keeps the last loaded plan overrides instead of silently resetting to defaults", async () => {
  const planManager = await import("../src/services/planManager.js");
  await dbm.dbRun("DELETE FROM plan_overrides WHERE plan_id = ?", ["starter"]);
  await dbm.dbRun(
    "INSERT INTO plan_overrides (plan_id, display_name, is_active) VALUES (?, ?, 1)",
    ["starter", "Kept Starter"],
  );
  const realNow = Date.now;
  const realError = console.error;
  const logged: string[] = [];
  try {
    planManager.invalidatePlanCache();
    assert.equal(
      (await planManager.getEffectivePlans()).starter.displayName,
      "Kept Starter",
    );
    // A failure that is not "table missing": the column the query filters on disappears.
    await dbm.dbRun(
      "ALTER TABLE plan_overrides RENAME COLUMN is_active TO is_active_x",
    );
    console.error = (...args: unknown[]) =>
      void logged.push(args.map(String).join(" "));
    Date.now = () => realNow() + 120_000; // the 30 s cache has expired
    const plans = await planManager.getEffectivePlans();
    assert.equal(
      plans.starter.displayName,
      "Kept Starter",
      "previous overrides are kept",
    );
    assert.ok(
      logged.some((line) => line.includes("plan_overrides read failed")),
    );
  } finally {
    Date.now = realNow;
    console.error = realError;
    await dbm
      .dbRun(
        "ALTER TABLE plan_overrides RENAME COLUMN is_active_x TO is_active",
      )
      .catch(() => {});
    await dbm.dbRun("DELETE FROM plan_overrides WHERE plan_id = ?", [
      "starter",
    ]);
    planManager.invalidatePlanCache();
  }
});

// ---------------------------------------------------------------------------------------------
// R2#10: stale hold sweep in batches
// ---------------------------------------------------------------------------------------------

test("the stale-hold sweep releases more holds than one batch and restores the cycle", async () => {
  const quota = await import("../src/services/monthlyQuota.js");
  const userId = await addUser("stale");
  await quota.getOrInitMonthlyUsage(userId, "starter");
  const holds = 1100; // more than two batches of 500
  const old = new Date(
    Date.now() - quota.STALE_RESERVATION_MS - 120_000,
  ).toISOString();
  for (let start = 0; start < holds; start += 100) {
    const rows: string[] = [];
    const params: unknown[] = [];
    for (let i = start; i < Math.min(holds, start + 100); i += 1) {
      rows.push("(?, ?, 10, 1, ?)");
      params.push(`stale-hold-${userId}-${i}`, userId, old);
    }
    await dbm.dbRun(
      `INSERT INTO quota_reservations (id, user_id, tokens, requests, created_at) VALUES ${rows.join(", ")}`,
      params,
    );
  }
  await dbm.dbRun(
    "UPDATE monthly_usage SET used_tokens = ?, used_requests = ? WHERE user_id = ?",
    [holds * 10, holds, userId],
  );
  const released = await quota.reconcileStaleReservations();
  assert.ok(released >= holds, `released ${released}`);
  const left = await dbm.dbGet<{ n: number | string }>(
    "SELECT COUNT(*) AS n FROM quota_reservations WHERE user_id = ?",
    [userId],
  );
  assert.equal(Number(left?.n), 0);
  const usage = await dbm.dbGet<{
    used_tokens: number | string;
    used_requests: number | string;
  }>("SELECT used_tokens, used_requests FROM monthly_usage WHERE user_id = ?", [
    userId,
  ]);
  assert.equal(Number(usage?.used_tokens), 0);
  assert.equal(Number(usage?.used_requests), 0);
});

// ---------------------------------------------------------------------------------------------
// R2#11: admin lists
// ---------------------------------------------------------------------------------------------

async function getJson(pathname: string) {
  const res = await fetch(`${baseUrl}${pathname}`, { headers: adminHeaders });
  assert.equal(res.status, 200, pathname);
  return (await res.json()) as any;
}

test("admin users: limit, offset and search page the list; wildcards in the search are literal", async () => {
  for (let i = 0; i < 7; i += 1) await addUser("lst");
  await addUser("needle", "find.the.needle@test.invalid");
  await addUser("pct", "100%.real@test.invalid");

  const all = await getJson("/admin/users?limit=500");
  assert.ok(all.total >= 9);
  assert.equal(all.limit, 500);

  const first = await getJson("/admin/users?limit=3&offset=0");
  const second = await getJson("/admin/users?limit=3&offset=3");
  assert.equal(first.users.length, 3);
  assert.equal(second.users.length, 3);
  assert.equal(first.total, all.total);
  const ids = new Set([...first.users, ...second.users].map((u: any) => u.id));
  assert.equal(ids.size, 6, "pages do not overlap");

  const found = await getJson("/admin/users?q=NEEDLE");
  assert.equal(found.users.length, 1);
  assert.match(found.users[0].email, /needle/);

  // "%" and "_" are searched as literal characters, never as wildcards.
  const percent = await getJson(`/admin/users?q=${encodeURIComponent("%")}`);
  assert.deepEqual(
    percent.users.map((u: any) => u.email),
    ["100%.real@test.invalid"],
  );
  const underscore = await getJson(`/admin/users?q=${encodeURIComponent("_")}`);
  assert.equal(underscore.users.length, 0);

  const clamped = await getJson("/admin/users?limit=999999");
  assert.equal(clamped.limit, 500);
  const defaults = await getJson("/admin/users");
  assert.equal(defaults.limit, 100);
  assert.equal(defaults.offset, 0);
});

test("admin subscriptions: paging and search keep the old response shape", async () => {
  const userId = await addUser("sub", "subscriber.one@test.invalid");
  await dbm.dbRun(
    "INSERT INTO subscriptions (id, user_id, order_id, plan_name, status, currency, valid_until) VALUES (?, ?, ?, 'pro', 'active', 'LKR', ?)",
    [`sub-${userId}`, userId, `ORDER-${userId}`, "2099-01-01T00:00:00.000Z"],
  );
  const paged = await getJson("/admin/subscriptions?limit=1&offset=0");
  assert.ok(Array.isArray(paged.subscriptions));
  assert.equal(paged.count, paged.subscriptions.length);
  assert.ok(paged.subscriptions.length <= 1);
  assert.ok(paged.total >= 1);
  const searched = await getJson("/admin/subscriptions?q=subscriber.one");
  assert.equal(searched.subscriptions.length, 1);
  assert.equal(searched.subscriptions[0].user_id, userId);
});

// ---------------------------------------------------------------------------------------------
// R2#7, R2#8, R5#2, R2#12: scripts and cleanup logging (source contracts)
// ---------------------------------------------------------------------------------------------

const cutover = fs.readFileSync(
  path.join(repoRoot, "deploy", "typed-db-cutover.sh"),
  "utf8",
);

test("the cutover script reads the database URL from container config, so copy and swap work with the backends stopped", () => {
  assert.match(
    cutover,
    /docker inspect "\$BACKEND_CONTAINER"[^\n]*Config\.Env/,
  );
  assert.doesNotMatch(cutover, /docker exec[^\n]*printenv DATABASE_URL/);
});

test("rollback finds the newest vynor_old_* database instead of assuming today's date", () => {
  assert.match(cutover, /DB_OLD_EXPLICIT/);
  assert.match(
    cutover,
    /datname LIKE '\$\{DB_LIVE\}\\_old\\_%' ORDER BY datname DESC LIMIT 1/,
  );
  assert.match(cutover, /nothing to roll back to/);
});

test("the two database renames go through one helper that prints the exact recovery command", () => {
  assert.match(cutover, /rename_pair\(\)/);
  assert.match(cutover, /rename_pair "\$DB_LIVE" "\$DB_OLD" "\$DB_NEW"/);
  assert.match(cutover, /rename_pair "\$DB_LIVE" "\$failed" "\$DB_OLD"/);
  assert.match(cutover, /Restore with: docker exec/);
  assert.doesNotMatch(
    cutover,
    /RENAME TO[^\n]*" -c "ALTER DATABASE/,
    "no two statements in one call",
  );
});

test("the cutover script is valid bash and the runbook invokes it through bash", () => {
  const probe = spawnSync("bash", ["--version"], { encoding: "utf8" });
  if (probe.error || probe.status !== 0) return; // no bash on this machine
  const syntax = spawnSync(
    "bash",
    ["-n", path.join(repoRoot, "deploy", "typed-db-cutover.sh")],
    {
      encoding: "utf8",
    },
  );
  assert.equal(syntax.status, 0, syntax.stderr);
  const runbook = fs.readFileSync(
    path.join(repoRoot, "docs", "DB_CUTOVER_RUNBOOK.md"),
    "utf8",
  );
  assert.doesNotMatch(runbook, /^\.\/deploy\/typed-db-cutover\.sh/m);
  assert.match(runbook, /^bash \.\/deploy\/typed-db-cutover\.sh preflight/m);
});

test("the hourly token cleanup logs a database failure instead of swallowing it", () => {
  const source = fs.readFileSync(
    path.join(originalCwd, "src", "db.ts"),
    "utf8",
  );
  const start = source.indexOf("function startVerificationCleanup");
  assert.ok(start > 0);
  const body = source.slice(start, start + 900);
  assert.match(body, /console\.warn\(/);
  assert.doesNotMatch(body, /catch \(e\) \{\s*\}/);
});
