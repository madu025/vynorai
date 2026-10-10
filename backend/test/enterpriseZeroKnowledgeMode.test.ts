import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import express from "express";

import {
  computeSha256,
  computeDiffFingerprint,
  recordZkComplianceAuditLog,
  verifyZkAuditChainIntegrity,
  generateZkComplianceReport,
} from "../src/services/enterpriseZkEngine.js";
import { applySpeculativeDiff } from "../src/services/speculativeDiffEngine.js";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vynor-zk-enterprise-"));
const originalCwd = process.cwd();

let baseUrl = "";
let server: http.Server;
let dbm: typeof import("../src/db.js");
let quota: typeof import("../src/services/monthlyQuota.js");

const daysFromNow = (d: number) => new Date(Date.now() + d * 86_400_000);

async function createSubscriber(
  plan = "enterprise",
): Promise<{ userId: string; apiKey: string }> {
  const uniqueTag = crypto.randomBytes(8).toString("hex");
  const userId = `zk-enterprise-user-${uniqueTag}`;
  const apiKey = `vynor_live_${crypto.randomBytes(24).toString("hex")}`;
  const apiKeyHash = crypto.createHash("sha256").update(apiKey).digest("hex");

  await dbm.dbRun(
    "INSERT INTO users (id, email, password_hash, api_key, api_key_hash) VALUES (?, ?, 'hash', ?, ?)",
    [userId, `${userId}@bank-enterprise.lk`, apiKey, apiKeyHash],
  );

  const validUntil = daysFromNow(30);
  await dbm.dbRun(
    `INSERT INTO subscriptions (id, user_id, plan_name, status, order_id, currency, valid_until)
     VALUES (?, ?, ?, 'active', ?, 'LKR', ?)`,
    [
      crypto.randomUUID(),
      userId,
      plan,
      `order-${userId}`,
      validUntil.toISOString(),
    ],
  );

  await quota.startPaidCycle(userId, plan, validUntil);
  return { userId, apiKey };
}

test("Enterprise Air-Gapped Zero-Knowledge Mode & Compliance Audit Suite", async (suite) => {
  process.chdir(tmpDir);
  process.env.NODE_ENV = "test";
  process.env.ADMIN_SECRET = "test-admin-secret-32-chars-long";

  dbm = await import("../src/db.js");
  await dbm.initDb();
  quota = await import("../src/services/monthlyQuota.js");

  const { ensureMemoryTables } = await import(
    "../src/services/memoryEngine.js"
  );
  await ensureMemoryTables();

  const { config } = await import("../src/config.js");
  config.aiKeys.openrouter = "mock-openrouter-key";
  config.aiKeys.deepseek = "mock-deepseek-key";

  // Mock upstream AI provider to intercept zero-retention headers and payload.store
  let lastUpstreamPayload: any = null;
  let lastUpstreamHeaders: any = null;

  const mockUpstreamServer = http.createServer((req, res) => {
    lastUpstreamHeaders = req.headers;
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      try {
        lastUpstreamPayload = JSON.parse(raw);
      } catch {}

      if (lastUpstreamPayload?.stream) {
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        });
        const chunk = {
          id: "chatcmpl-zk-mock",
          object: "chat.completion.chunk",
          choices: [
            {
              index: 0,
              delta: { content: " ZK verified response." },
              finish_reason: null,
            },
          ],
        };
        res.write(`data: ${JSON.stringify(chunk)}\n\n`);
        res.write("data: [DONE]\n\n");
        res.end();
      } else {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            id: "chatcmpl-zk-mock",
            object: "chat.completion",
            choices: [
              {
                index: 0,
                message: { role: "assistant", content: " ZK response." },
              },
            ],
          }),
        );
      }
    });
  });

  await new Promise<void>((resolve) => mockUpstreamServer.listen(0, resolve));
  const mockUpstreamPort = (mockUpstreamServer.address() as AddressInfo).port;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const urlStr =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : (input as Request).url;
    if (
      urlStr.startsWith("https://api.deepseek.com") ||
      urlStr.startsWith("https://openrouter.ai") ||
      urlStr.startsWith("https://api.openai.com") ||
      urlStr.startsWith("https://api.anthropic.com")
    ) {
      const parsed = new URL(urlStr);
      const mockTarget = `http://127.0.0.1:${mockUpstreamPort}${parsed.pathname}${parsed.search}`;
      return originalFetch(mockTarget, init);
    }
    return originalFetch(input, init);
  };

  const { proxyRouter } = await import("../src/routes/proxy.js");
  const app = express();
  app.use(express.json({ limit: "10mb" }));
  app.use("/v1", proxyRouter);

  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;

  suite.after(async () => {
    mockUpstreamServer?.close();
    globalThis.fetch = originalFetch;
    server?.close();
    if (dbm.db) {
      await new Promise<void>((resolve) => dbm.db!.close(() => resolve()));
    }
    process.chdir(originalCwd);
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 3 });
    } catch {}
  });

  // ─── 1. LOCAL-ONLY DIFF HASHING & MEMORY PLAINTEXT SCRUBBING ───────────────
  await suite.test(
    "1. Local-Only Diff Hashing: generates SHA-256 blind fingerprints and scrubs plaintext from outcome",
    async () => {
      const proprietaryCode =
        "const BANK_SECRET_KEY = 'vault_sec_99482184910';";
      const virtualFiles = {
        "src/securityVault.ts": `// Bank Vault Module\nexport function verifyToken() {\n  return true;\n}\n`,
      };

      const diff = `
diff --git a/src/securityVault.ts b/src/securityVault.ts
--- a/src/securityVault.ts
+++ b/src/securityVault.ts
@@ -2,2 +2,3 @@
 export function verifyToken() {
+  ${proprietaryCode}
   return true;
`;

      const result = await applySpeculativeDiff(diff, {
        virtualFiles,
        validateSyntax: true,
        dryRun: false,
        zkMode: true, // Air-Gapped Zero-Knowledge Mode
      });

      assert.equal(result.success, true);
      assert.equal(result.status, "applied");

      // Fingerprint verification
      assert.ok(
        result.zkFingerprint,
        "Must generate cryptographic ZK fingerprint",
      );
      assert.equal(result.zkFingerprint.zeroRetentionVerified, true);
      assert.equal(
        result.zkFingerprint.diffFingerprint.length,
        64,
        "Must be valid SHA-256 64-char hex",
      );
      assert.ok(result.zkFingerprint.fileHashes["src/securityVault.ts"]);

      // Strict zero-plaintext verification in returned memory object
      const outcome = result.fileOutcomes["src/securityVault.ts"];
      assert.equal(
        outcome.originalContent,
        undefined,
        "Must scrub originalContent from outcome memory",
      );
      assert.equal(
        outcome.patchedContent,
        undefined,
        "Must scrub patchedContent from outcome memory",
      );
    },
  );

  // ─── 3. UPSTREAM ZERO-RETENTION ENFORCEMENT (store: false & X-Zero-Retention)
  await suite.test(
    "3. Upstream Zero-Retention: forces store: false and X-Zero-Retention on AI provider requests",
    async () => {
      const { apiKey } = await createSubscriber("enterprise");

      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
          "X-VynorAI-ZK-Mode": "air-gapped",
        },
        body: JSON.stringify({
          model: "deepseek/deepseek-flash",
          messages: [{ role: "user", content: "Analyze financial model" }],
          stream: false,
        }),
      });

      assert.equal(res.status, 200);
      assert.equal(res.headers.get("x-vynorai-zk-mode"), "Air-Gapped");
      assert.equal(res.headers.get("x-vynorai-zero-retention"), "Verified");

      // Verify upstream request received zero retention instructions
      assert.ok(
        lastUpstreamPayload,
        "Upstream provider must have received payload",
      );
      assert.equal(
        lastUpstreamPayload.store,
        false,
        "Upstream payload must enforce store: false",
      );
      assert.equal(
        lastUpstreamHeaders?.["x-zero-retention"],
        "true",
        "Upstream request must carry X-Zero-Retention: true header",
      );
    },
  );

  // ─── 4. TAMPER-EVIDENT MERKLE HASH CHAIN INTEGRITY ─────────────────────────
  await suite.test(
    "4. Merkle Hash Chain: validates cryptographic chain integrity and detects database tampering",
    async () => {
      // 4.1 Valid chain verification
      const initialCheck = await verifyZkAuditChainIntegrity();
      assert.equal(
        initialCheck.valid,
        true,
        "Untampered chain must pass verification",
      );

      // 4.2 Append two verified audit records
      await recordZkComplianceAuditLog({
        userSurrogateId: "zk_vynor_test_1",
        requestType: "diff_apply",
        action: "speculative_diff_success",
        diffFingerprint: computeSha256("test_diff_1"),
        filesCount: 3,
        linesAdded: 15,
        linesDeleted: 2,
      });

      await recordZkComplianceAuditLog({
        userSurrogateId: "zk_vynor_test_2",
        requestType: "chat_completion",
        action: "ephemeral_chat_completion",
        promptFingerprint: computeSha256("test_prompt_2"),
        filesCount: 0,
      });

      const chainAfterInserts = await verifyZkAuditChainIntegrity();
      assert.equal(chainAfterInserts.valid, true);
      assert.ok(chainAfterInserts.totalRecords >= 2);

      // 4.3 Intentional database tamper simulation
      const latestRecord = await dbm.dbGet<any>(
        `SELECT * FROM zk_compliance_audit_logs ORDER BY ${dbm.usingPostgres ? "seq" : "rowid"} DESC LIMIT 1`,
      );

      // Tamper with lines_added in the database directly
      await dbm.dbRun(
        "UPDATE zk_compliance_audit_logs SET lines_added = 9999 WHERE id = ?",
        [latestRecord.id],
      );

      const tamperedCheck = await verifyZkAuditChainIntegrity();
      assert.equal(
        tamperedCheck.valid,
        false,
        "Tampered database row must be caught by Merkle validation",
      );
      assert.ok(
        tamperedCheck.error?.includes("Tamper detected"),
        "Must report tamper detection",
      );

      // Revert the tamper to restore pristine state
      await dbm.dbRun(
        "UPDATE zk_compliance_audit_logs SET lines_added = ? WHERE id = ?",
        [latestRecord.lines_added, latestRecord.id],
      );

      const restoredCheck = await verifyZkAuditChainIntegrity();
      assert.equal(
        restoredCheck.valid,
        true,
        "Restored chain must validate cleanly",
      );
    },
  );
});
