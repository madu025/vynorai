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

  // ─── 2. ZERO PLAINTEXT RETENTION IN DATABASE (STRICT AUDIT INSPECTION) ─────
  await suite.test(
    "2. Zero Plaintext Retention: guarantees 0 instances of proprietary code in all SQLite tables",
    async () => {
      const { apiKey } = await createSubscriber("enterprise");
      const secretSignature = "SUPER_CONFIDENTIAL_TRADING_ALGORITHM_ABC123";

      const diff = `
diff --git a/src/algo.ts b/src/algo.ts
--- a/src/algo.ts
+++ b/src/algo.ts
@@ -1,1 +1,2 @@
+export const SECRET = "${secretSignature}";
 export const version = 1;
`;

      const virtualFiles = {
        "src/algo.ts": `export const version = 1;\n`,
      };

      const res = await fetch(`${baseUrl}/diff/apply`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
          "X-VynorAI-ZK-Mode": "air-gapped",
        },
        body: JSON.stringify({
          diff,
          virtualFiles,
        }),
      });

      assert.equal(res.status, 200);
      assert.equal(res.headers.get("x-vynorai-zk-mode"), "Air-Gapped");
      assert.equal(res.headers.get("x-vynorai-zero-retention"), "Verified");
      assert.ok(res.headers.get("x-vynorai-diff-fingerprint"));

      // Exhaustive database inspection for secret leak
      const tables = [
        "usage_logs",
        "request_economics",
        "zk_compliance_audit_logs",
        "user_rules",
        "user_memory",
      ];

      for (const table of tables) {
        try {
          const rows = await dbm.dbAll<any>(`SELECT * FROM ${table}`);
          const dump = JSON.stringify(rows);
          assert.equal(
            dump.includes(secretSignature),
            false,
            `CRITICAL PRIVACY VIOLATION: Plaintext secret leaked into table "${table}"!`,
          );
        } catch (err: any) {
          if (!err.message?.includes("no such table")) throw err;
        }
      }

      // Verify audit table contains only the SHA-256 hash and metadata
      const auditRows = await dbm.dbAll<any>(
        `SELECT * FROM zk_compliance_audit_logs ORDER BY ${dbm.usingPostgres ? "seq" : "rowid"} DESC LIMIT 1`,
      );
      assert.ok(auditRows.length > 0);
      assert.equal(auditRows[0].zero_retention_verified, 1);
      assert.ok(auditRows[0].diff_fingerprint);
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

  // ─── 5. ENTERPRISE COMPLIANCE REPORT API & AUDIT VERIFICATION ──────────────
  await suite.test(
    "5. Compliance Report API: serves verifiable SOC2/ISO27001 zero-retention report",
    async () => {
      const { apiKey } = await createSubscriber("enterprise");

      // 5.1 Generate audit report via API
      const reportRes = await fetch(`${baseUrl}/zk/compliance-report`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      });

      assert.equal(reportRes.status, 200);
      const reportJson = (await reportRes.json()) as any;

      assert.equal(reportJson.complianceStandard, "VynorAI-ZK-AirGapped-v1.0");
      assert.equal(reportJson.zeroRetentionEnforced, true);
      assert.equal(reportJson.chainIntegrityValid, true);
      assert.ok(reportJson.latestMerkleRoot);
      assert.ok(Array.isArray(reportJson.auditTrail));

      // 5.2 Validate chain verification endpoint
      const verifyRes = await fetch(`${baseUrl}/zk/verify-chain`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      });

      assert.equal(verifyRes.status, 200);
      const verifyJson = (await verifyRes.json()) as any;
      assert.equal(verifyJson.valid, true);
    },
  );
});
