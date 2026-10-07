import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vynor-cache-"));
const originalCwd = process.cwd();
let dbm: typeof import("../src/db.js");
let cache: typeof import("../src/services/cacheEngine.js");

before(async () => {
  process.chdir(tmpDir);
  process.env.NODE_ENV = "test";
  process.env.DATA_ENCRYPTION_KEY = crypto.randomBytes(32).toString("hex");
  delete process.env.REDIS_URL;
  dbm = await import("../src/db.js");
  await dbm.initDb();
  cache = await import("../src/services/cacheEngine.js");
  await cache.initCacheTable();
});

after(async () => {
  if (dbm.db)
    await new Promise<void>((resolve) => dbm.db!.close(() => resolve()));
  process.chdir(originalCwd);
  try {
    fs.rmSync(tmpDir, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
  } catch {
    // Windows virus scanners can retain the SQLite sidecar briefly; the OS
    // temp directory can safely clean this test-only folder later.
  }
});

test("same prompt is isolated for ten users and separate projects", () => {
  const messages = [{ role: "user", content: "same prompt" }];
  const keys = Array.from({ length: 10 }, (_, index) =>
    cache.generateCacheKey(
      { userId: `user-${index}`, projectId: "project-a" },
      "vynor-auto",
      messages,
      0,
    ),
  );
  assert.equal(new Set(keys).size, 10);
  assert.notEqual(
    keys[0],
    cache.generateCacheKey(
      { userId: "user-0", projectId: "project-b" },
      "vynor-auto",
      messages,
      0,
    ),
  );
});

test("cache persists tenant ownership and purge removes L1 and database copies", async () => {
  const owner = { userId: "cache-user", projectId: "private-project" };
  const key = cache.generateCacheKey(owner, "vynor-auto", [
    { role: "user", content: "explain this code" },
  ]);
  const chunks = [{ choices: [{ delta: { content: "safe answer" } }] }];
  assert.equal(await cache.saveToCache(key, chunks, owner), true);

  const row = await dbm.dbGet<any>(
    "SELECT user_id, project_id, response_bytes, expires_at FROM cache_entries WHERE cache_key = ?",
    [key],
  );
  assert.equal(row.user_id, owner.userId);
  assert.equal(row.project_id, owner.projectId);
  assert.ok(row.response_bytes > 0);
  assert.ok(new Date(row.expires_at).getTime() > Date.now());
  assert.deepEqual(
    (await cache.getFromCache(key, owner))?.responseChunks,
    chunks,
  );

  await cache.purgeUserCache(owner.userId);
  assert.equal(
    await dbm.dbGet("SELECT 1 FROM cache_entries WHERE cache_key = ?", [key]),
    undefined,
  );
  assert.equal(await cache.getFromCache(key, owner), null);
});

test("oversized answers are returned to callers but never cached", async () => {
  const owner = { userId: "large-user", projectId: "project" };
  const key = cache.generateCacheKey(owner, "vynor-auto", [
    { role: "user", content: "large response" },
  ]);
  const chunks = [
    { choices: [{ delta: { content: "x".repeat(600 * 1024) } }] },
  ];
  assert.equal(await cache.saveToCache(key, chunks, owner), false);
  assert.equal(await cache.getFromCache(key, owner), null);
});

test("local admission fallback bounds ten simultaneous upstream attempts", async () => {
  delete process.env.REDIS_URL;
  const { acquireProviderAdmission, localAdmissionCount } = await import(
    "../src/services/admissionControl.js"
  );
  const attempts = await Promise.all(
    Array.from({ length: 10 }, () =>
      acquireProviderAdmission("deepseek", {
        globalLimit: 3,
        providerLimit: 3,
        waitMs: 25,
      }),
    ),
  );
  const leases = attempts.filter((lease) => lease !== null);
  assert.equal(leases.length, 3);
  assert.equal(localAdmissionCount("ai-global"), 3);
  await Promise.all(leases.map((lease) => lease!.release()));
  assert.equal(localAdmissionCount("ai-global"), 0);

  const afterRelease = await acquireProviderAdmission("deepseek", {
    globalLimit: 3,
    providerLimit: 3,
    waitMs: 25,
  });
  assert.ok(afterRelease);
  await afterRelease.release();
});

test("cache-fill single-flight elects one owner for ten identical misses", async () => {
  delete process.env.REDIS_URL;
  const { acquireCacheFillLock, releaseCacheFillLock } = await import(
    "../src/services/redisStore.js"
  );
  const attempts = await Promise.all(
    Array.from({ length: 10 }, () => acquireCacheFillLock("same-key", 5_000)),
  );
  const owners = attempts.filter((token) => typeof token === "string");
  assert.equal(owners.length, 1);
  await releaseCacheFillLock("same-key", owners[0]!);
  const next = await acquireCacheFillLock("same-key", 5_000);
  assert.equal(typeof next, "string");
  await releaseCacheFillLock("same-key", next!);
});

test("a duplicate miss receives the first local worker's completed answer", async () => {
  delete process.env.REDIS_URL;
  const { acquireCacheFillLock, releaseCacheFillLock } = await import(
    "../src/services/redisStore.js"
  );
  const owner = { userId: "coalesced-user", projectId: "project" };
  const key = cache.generateCacheKey(owner, "vynor-auto", [
    { role: "user", content: "same concurrent request" },
  ]);
  const token = await acquireCacheFillLock(key, 5_000);
  assert.equal(typeof token, "string");
  const waiter = cache.waitForCacheFill(key, owner, 1_000);
  const chunks = [{ choices: [{ delta: { content: "one model call" } }] }];
  await new Promise((resolve) => setTimeout(resolve, 20));
  await cache.saveToCache(key, chunks, owner);
  await releaseCacheFillLock(key, token!);
  assert.deepEqual((await waiter)?.responseChunks, chunks);
});
