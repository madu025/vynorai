/**
 * Admin-managed provider keys: encrypted at rest, applied to config.aiKeys
 * without a restart, masked in listings, and falling back to .env on delete.
 * Runs on SQLite by default, PostgreSQL when DATABASE_URL is set.
 */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

process.chdir(fs.mkdtempSync(path.join(os.tmpdir(), "vynor-provider-keys-")));
process.env.DATA_ENCRYPTION_KEY = crypto.randomBytes(32).toString("hex");
process.env.OPENROUTER_API_KEY = "sk-or-from-env-0000000000000000";
delete process.env.DEEPSEEK_API_KEY;

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
  else await (await import("../src/services/pgDriver.js")).closePostgres();
});

const DEEPSEEK = "sk-623cf8c9b25e42e6930229testtest";

test("a saved key is used immediately, stored encrypted, and listed masked", async () => {
  const status = await keys.setProviderKey("deepseek", DEEPSEEK, "ADMIN");
  assert.equal(config.aiKeys.deepseek, DEEPSEEK);
  assert.equal(status.source, "admin");
  assert.equal(status.masked, "sk-62…test");

  const row = await dbm.dbGet<{ key_encrypted: string }>(
    "SELECT key_encrypted FROM provider_credentials WHERE provider = ?",
    ["deepseek"],
  );
  assert.ok(row && row.key_encrypted.startsWith("v1:"));
  assert.ok(!row.key_encrypted.includes(DEEPSEEK));
  assert.ok(!JSON.stringify(keys.listProviderKeys()).includes(DEEPSEEK));
});

test("a portal key overrides .env, and deleting it falls back to .env", async () => {
  await keys.setProviderKey(
    "openrouter",
    "sk-or-from-portal-1111111111111",
    "ADMIN",
  );
  assert.equal(config.aiKeys.openrouter, "sk-or-from-portal-1111111111111");

  const status = await keys.deleteProviderKey("openrouter");
  assert.equal(status.source, "env");
  assert.equal(config.aiKeys.openrouter, "sk-or-from-env-0000000000000000");
});

test("keys survive a reload from the database (another replica or a restart)", async () => {
  (config.aiKeys as Record<string, string>).deepseek = "";
  await keys.loadProviderCredentials();
  assert.equal(config.aiKeys.deepseek, DEEPSEEK);
});

test("obviously invalid keys are rejected", async () => {
  await assert.rejects(
    keys.setProviderKey("deepseek", "short", "ADMIN"),
    /does not look like an API key/,
  );
  await assert.rejects(
    keys.setProviderKey("deepseek", "sk-has a space inside it", "ADMIN"),
    /does not look like/,
  );
});
