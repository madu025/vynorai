import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { before, test } from "node:test";

process.env.BG_QUOTE_SECRET = "q".repeat(48);
process.env.BG_MODEL_TOKEN_SECRET = "m".repeat(48);

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vynor-idor-test-"));
let dbm: typeof import("../src/db.js");

before(async () => {
  process.chdir(tmpDir);
  dbm = await import("../src/db.js");
  await dbm.initDb();
});

async function addUser(id: string) {
  await dbm.dbRun(
    "INSERT INTO users (id, email, password_hash, api_key, api_key_hash) VALUES (?, ?, 'x', ?, ?)",
    [id, `${id}@test.invalid`, `key-${id}`, `hash-${id}`],
  );
}

async function addTask(id: string, userId: string, status = "queued") {
  await dbm.dbRun(
    `INSERT INTO background_tasks
       (id, user_id, status, project_fingerprint, manifest_digest, estimate_credits, cap_credits, quote_id, idempotency_key)
     VALUES (?, ?, ?, ?, ?, 1, 1, ?, ?)`,
    [id, userId, status, "f".repeat(64), "d".repeat(64), `q-${id}`, `k-${id}`],
  );
}

test("a background task id from another user is not found and nothing changes", async () => {
  const bg = await import("../src/services/backgroundTasks.js");
  await addUser("owner-a");
  await addUser("intruder-b");
  await addTask("task-owned-by-a", "owner-a", "running");
  for (const call of [
    () => bg.getBackgroundTask("intruder-b", "task-owned-by-a"),
    () => bg.cancelBackgroundTask("intruder-b", "task-owned-by-a"),
    () => bg.purgeBackgroundTask("intruder-b", "task-owned-by-a"),
  ])
    await assert.rejects(call, /BACKGROUND_TASK_NOT_FOUND/);
  const row = await dbm.dbGet<{ status: string; prompt: string | null }>(
    "SELECT status, prompt FROM background_tasks WHERE id = ?",
    ["task-owned-by-a"],
  );
  assert.equal(row?.status, "running");
});

test("the owner's cancel and purge write only their own row", async () => {
  const bg = await import("../src/services/backgroundTasks.js");
  await addUser("owner-c");
  await addUser("other-d");
  await addTask("task-c", "owner-c", "running");
  await addTask("task-d", "other-d", "running");
  await bg.cancelBackgroundTask("owner-c", "task-c");
  const own = await dbm.dbGet<{ status: string }>(
    "SELECT status FROM background_tasks WHERE id = ?",
    ["task-c"],
  );
  const foreign = await dbm.dbGet<{ status: string }>(
    "SELECT status FROM background_tasks WHERE id = ?",
    ["task-d"],
  );
  assert.equal(own?.status, "cancel_requested");
  assert.equal(foreign?.status, "running");
});

test("deleting a rule id owned by someone else removes nothing", async () => {
  const memory = await import("../src/services/memoryEngine.js");
  await memory.ensureMemoryTables();
  await addUser("rule-owner");
  await addUser("rule-intruder");
  const ruleId = await memory.addUserRule(
    "rule-owner",
    "Always answer briefly",
  );
  await memory.deleteUserRule("rule-intruder", ruleId);
  assert.deepEqual(await memory.getUserRules("rule-owner"), [
    "Always answer briefly",
  ]);
  await memory.deleteUserRule("rule-owner", ruleId);
  assert.deepEqual(await memory.getUserRules("rule-owner"), []);
});

test("minted background and approval ids are unguessable", async () => {
  process.env.BG_MODEL_TOKEN_SECRET = "m".repeat(48);
  const { mintBackgroundModelToken } = await import(
    "../src/services/backgroundModelToken.js"
  );
  const jwt = (await import("jsonwebtoken")).default;
  const jtis = new Set<string>();
  for (let i = 0; i < 50; i += 1) {
    const claims = jwt.decode(mintBackgroundModelToken("task-1", "user-1")) as {
      jti: string;
    };
    assert.match(claims.jti, /^bgm_[0-9a-f]{32}$/);
    jtis.add(claims.jti);
  }
  assert.equal(jtis.size, 50);
});
