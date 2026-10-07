/**
 * Tests for Multi-Key Pool and Balance Management:
 * - Adding multiple DeepSeek / OpenRouter keys
 * - Round-robin rotation between pool keys
 * - Balance telemetry parsing
 * - Disabling and deleting keys from the pool
 */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

process.chdir(fs.mkdtempSync(path.join(os.tmpdir(), "vynor-multikey-test-")));
process.env.DATA_ENCRYPTION_KEY = crypto.randomBytes(32).toString("hex");
process.env.OPENROUTER_API_KEY = "sk-or-from-env-0000000000000000";

let keys: typeof import("../src/services/providerCredentials.js");
let config: typeof import("../src/config.js").config;
let dbm: typeof import("../src/db.js");

before(async () => {
  dbm = await import("../src/db.js");
  await dbm.initDb();
  ({ config } = await import("../src/config.js"));
  keys = await import("../src/services/providerCredentials.js");
  await keys.loadProviderCredentials();
});

after(async () => {
  if (dbm.db)
    await new Promise<void>((resolve) => dbm.db!.close(() => resolve()));
});

test("can add multiple DeepSeek keys to the multi-key pool", async () => {
  const key1 = "sk-623cf8c9b25e42e6930229keyone111111";
  const key2 = "sk-623cf8c9b25e42e6930229keytwo222222";

  const item1 = await keys.addProviderApiKey(
    "deepseek",
    key1,
    "DeepSeek Primary Key",
    "ADMIN",
    true,
  );
  assert.equal(item1.provider, "deepseek");
  assert.equal(item1.label, "DeepSeek Primary Key");
  assert.equal(item1.isActive, true);
  assert.equal(item1.masked, "sk-62…1111");

  const item2 = await keys.addProviderApiKey(
    "deepseek",
    key2,
    "DeepSeek Secondary Backup",
    "ADMIN",
    true,
  );
  assert.equal(item2.provider, "deepseek");
  assert.equal(item2.label, "DeepSeek Secondary Backup");
  assert.equal(item2.isActive, true);
  assert.equal(item2.masked, "sk-62…2222");

  const pool = await keys.listMultiProviderKeys();
  const dsPool = pool.filter((k) => k.provider === "deepseek");
  assert.ok(dsPool.length >= 2, "Should have at least 2 DeepSeek keys in pool");
});

test("round-robin rotates between active keys in the pool", async () => {
  const rotated1 = keys.getRotatedProviderKey("deepseek");
  const rotated2 = keys.getRotatedProviderKey("deepseek");
  assert.ok(rotated1, "Rotated key 1 should exist");
  assert.ok(rotated2, "Rotated key 2 should exist");
  assert.notEqual(
    rotated1,
    rotated2,
    "Should rotate across distinct active keys",
  );
});

test("disabling a key removes it from the active rotation pool", async () => {
  const pool = await keys.listMultiProviderKeys();
  const dsKeys = pool.filter((k) => k.provider === "deepseek");
  assert.ok(dsKeys.length >= 2);

  // Disable the second key
  await keys.updateProviderApiKey(dsKeys[1].id, { isActive: false });

  // Now rotation should only return the remaining active key
  const r1 = keys.getRotatedProviderKey("deepseek");
  const r2 = keys.getRotatedProviderKey("deepseek");
  assert.equal(r1, r2, "Disabled key is excluded from active rotation");
});

test("deleting a key removes it from the database", async () => {
  const pool = await keys.listMultiProviderKeys();
  const toDelete = pool.find((k) => k.label === "DeepSeek Secondary Backup");
  assert.ok(toDelete);

  await keys.deleteProviderApiKey(toDelete.id);

  const poolAfter = await keys.listMultiProviderKeys();
  assert.ok(!poolAfter.some((k) => k.id === toDelete.id));
});
