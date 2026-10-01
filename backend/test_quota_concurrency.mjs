import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const originalCwd = process.cwd();
const testRoot = path.join(originalCwd, `.tmp-quota-${crypto.randomUUID()}`);
fs.mkdirSync(testRoot, { recursive: false });

try {
  process.chdir(testRoot);
  const dbModule = await import(pathToFileURL(path.join(originalCwd, "dist/db.js")).href);
  await dbModule.initDb();
  await dbModule.dbRun(
    "INSERT INTO users (id, email, password_hash, api_key, api_key_hash) VALUES (?, ?, ?, ?, ?)",
    ["quota-test-user", "quota-test@example.com", "test", "legacy:test", "hash"],
  );

  const quota = await import(
    pathToFileURL(path.join(originalCwd, "dist/services/monthlyQuota.js")).href
  );
  const reservations = await Promise.all(
    Array.from({ length: 20 }, () =>
      quota.reserveQuotaAtomic("quota-test-user", "free", 10_000),
    ),
  );
  const allowed = reservations.filter(Boolean).length;
  const usage = await dbModule.dbGet(
    "SELECT used_tokens, used_requests FROM monthly_usage WHERE user_id = ?",
    ["quota-test-user"],
  );

  if (allowed !== 10 || usage?.used_tokens !== 100_000 || usage?.used_requests !== 10) {
    throw new Error(`Atomic quota failed: ${JSON.stringify({ allowed, usage })}`);
  }
  console.log("atomic quota concurrency: ok");
  await new Promise((resolve, reject) =>
    dbModule.db.close((error) => (error ? reject(error) : resolve())),
  );
} finally {
  process.chdir(originalCwd);
  const resolved = path.resolve(testRoot);
  if (resolved.startsWith(`${path.resolve(originalCwd)}${path.sep}.tmp-quota-`)) {
    fs.rmSync(resolved, { recursive: true, force: true });
  }
}
