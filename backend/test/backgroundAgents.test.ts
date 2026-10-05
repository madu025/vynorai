import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { before, test } from "node:test";

process.env.BG_QUOTE_SECRET = "q".repeat(48);
process.env.BG_MODEL_TOKEN_SECRET = "m".repeat(48);

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vynor-bg-test-"));
let dbm: typeof import("../src/db.js");
let quota: typeof import("../src/services/monthlyQuota.js");

before(async () => {
  process.chdir(tmpDir);
  dbm = await import("../src/db.js");
  await dbm.initDb();
  quota = await import("../src/services/monthlyQuota.js");
});

test("plan aliases expose the approved background entitlements", async () => {
  const { getPlan } = await import("../src/config.js");
  assert.deepEqual(getPlan("starter").background, {
    enabled: false,
    tasksPerMonth: 0,
    maxConcurrency: 0,
    priority: "normal",
  });
  assert.equal(getPlan("pro").background.tasksPerMonth, 20);
  assert.equal(getPlan("pro_monthly").background.maxConcurrency, 1);
  assert.equal(getPlan("enterprise").background.tasksPerMonth, 60);
  assert.equal(getPlan("ultra").background.priority, "high");
});

test("estimate quotes are bound to owner and exact input", async () => {
  const {
    createEstimateQuote,
    estimateInputDigest,
    validateEstimateInput,
    verifyEstimateQuote,
  } = await import("../src/services/backgroundQuote.js");
  const input = validateEstimateInput({
    prompt: "Fix checkout validation and run tests",
    language: "en",
    projectFingerprint: "a".repeat(64),
    manifestDigest: "b".repeat(64),
    fileCount: 42,
    uploadBytes: 120_000,
    stacks: ["node"],
  });
  const { quote, signature } = createEstimateQuote("user-1", input);
  assert.equal(verifyEstimateQuote(quote, signature), true);
  assert.equal(quote.inputDigest, estimateInputDigest(input));
  assert.equal(
    verifyEstimateQuote({ ...quote, userId: "user-2" }, signature),
    false,
  );
  assert.notEqual(
    estimateInputDigest({ ...input, prompt: `${input.prompt}!` }),
    estimateInputDigest(input),
    "any prompt change must invalidate the quote",
  );
});

test("scoped model tokens cannot be reused for another task", async () => {
  const { mintBackgroundModelToken, verifyBackgroundModelToken } = await import(
    "../src/services/backgroundModelToken.js"
  );
  const token = mintBackgroundModelToken("task-1", "user-1");
  const claims = verifyBackgroundModelToken(token) as any;
  assert.equal(claims.taskId, "task-1");
  assert.equal(claims.userId, "user-1");
  assert.equal(claims.scope, "background:model");
  assert.equal(claims.aud, "vynor-background-model");
});

test("ordinary stale cleanup never refunds a live background-task hold", async () => {
  const userId = `bg-${Date.now()}`;
  await dbm.dbRun(
    "INSERT INTO users (id, email, password_hash, api_key, api_key_hash) VALUES (?, ?, 'x', ?, ?)",
    [userId, `${userId}@test.invalid`, `key-${userId}`, `hash-${userId}`],
  );
  const reservation = await quota.reserveQuotaAtomic(userId, "pro", 100_000, {
    type: "background_task",
    id: "task-live",
  });
  assert.ok(reservation?.id);
  await dbm.dbRun("UPDATE quota_reservations SET created_at = ? WHERE id = ?", [
    "2000-01-01T00:00:00.000Z",
    reservation!.id,
  ]);
  assert.equal(await quota.reconcileStaleReservations(), 0);
  assert.ok(
    await dbm.dbGet("SELECT id FROM quota_reservations WHERE id = ?", [
      reservation!.id,
    ]),
  );
});
