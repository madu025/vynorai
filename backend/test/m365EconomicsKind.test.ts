/**
 * Excel add-in requests are recorded in the economics ledger as request_kind "m365", so their credits
 * can be compared with the M365 quota ledger and read apart from IDE chat in the admin economics view.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { before, test } from "node:test";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vynor-m365-econ-"));
let dbm: typeof import("../src/db.js");
let costLedger: typeof import("../src/services/costLedger.js");

before(async () => {
  process.chdir(tmpDir);
  process.env.NODE_ENV = "test";
  dbm = await import("../src/db.js");
  await dbm.initDb();
  costLedger = await import("../src/services/costLedger.js");
});

async function record(userId: string, requestKind?: "m365" | "chat") {
  await costLedger.recordRequestEconomics({
    userId,
    planId: "free",
    requestedModel: "deepseek-chat",
    resolvedModel: "deepseek-chat",
    provider: "deepseek",
    inputTokens: 15_000,
    cachedInputTokens: 14_000,
    outputTokens: 200,
    providerCostUsd: null,
    costSource: "unknown",
    outcome: "success",
    creditsCharged: 1_700,
    latencyMs: 100,
    ...(requestKind ? { requestKind } : {}),
  });
}

test("m365 requests are stored with their own kind; others stay chat", async () => {
  const userId = `u-econ-${Math.random().toString(36).slice(2, 8)}`;
  await dbm.dbRun(
    "INSERT INTO users (id, email, password_hash, api_key, api_key_hash) VALUES (?, ?, 'x', ?, ?)",
    [userId, `${userId}@example.com`, `key-${userId}`, `hash-${userId}`],
  );
  await record(userId, "m365");
  await record(userId, "m365");
  await record(userId);
  const rows = await dbm.dbAll<any>(
    "SELECT request_kind AS kind, count(*) AS n, sum(credits_charged) AS credits FROM request_economics WHERE user_id = ? GROUP BY request_kind ORDER BY request_kind",
    [userId],
  );
  assert.deepEqual(
    rows.map((r) => [r.kind, Number(r.n), Number(r.credits)]),
    [
      ["chat", 1, 1_700],
      ["m365", 2, 3_400],
    ],
  );
});
