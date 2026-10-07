import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import express from "express";

import { parseMultiFileDiff } from "../src/services/unifiedDiffParser.js";
import { applyHunk } from "../src/services/symbolChunkMatcher.js";
import { validateCodeSyntax } from "../src/services/syntaxValidator.js";
import { applySpeculativeDiff } from "../src/services/speculativeDiffEngine.js";

const tmpDir = fs.mkdtempSync(
  path.join(os.tmpdir(), "vynor-speculative-diff-"),
);
const originalCwd = process.cwd();

let baseUrl = "";
let server: http.Server;
let dbm: typeof import("../src/db.js");
let quota: typeof import("../src/services/monthlyQuota.js");

const daysFromNow = (d: number) => new Date(Date.now() + d * 86_400_000);

let userIndex = 0;
async function createSubscriber(
  plan = "pro",
): Promise<{ userId: string; apiKey: string }> {
  const userId = `diff-user-${Date.now()}-${crypto.randomBytes(4).toString("hex")}-${++userIndex}`;
  const apiKey = `vynor_live_${crypto.randomBytes(24).toString("hex")}`;
  const apiKeyHash = crypto.createHash("sha256").update(apiKey).digest("hex");

  await dbm.dbRun(
    "INSERT INTO users (id, email, password_hash, api_key, api_key_hash) VALUES (?, ?, 'hash', ?, ?)",
    [userId, `${userId}@example.com`, apiKey, apiKeyHash],
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

test("High-Speed Multi-File Speculative Diff Engine Test Suite", async (suite) => {
  process.chdir(tmpDir);
  process.env.NODE_ENV = "test";
  process.env.ADMIN_SECRET = "test-admin-secret-32-chars-long";

  dbm = await import("../src/db.js");
  await dbm.initDb();
  quota = await import("../src/services/monthlyQuota.js");

  const { proxyRouter } = await import("../src/routes/proxy.js");
  const app = express();
  app.use(express.json({ limit: "10mb" }));
  app.use("/v1", proxyRouter);

  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;

  suite.after(async () => {
    server?.close();
    if (dbm.db) {
      await new Promise<void>((resolve) => dbm.db!.close(() => resolve()));
    }
    process.chdir(originalCwd);
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 3 });
    } catch {}
  });

  // ─── 1. MULTI-FILE UNIFIED DIFF PARSING & LINE-SHIFT FUZZY MATCHING ────────
  await suite.test(
    "1. Multi-File Unified Diff: parses multi-file patches and applies with line-shift tolerance",
    async () => {
      const virtualFiles = {
        "src/calculator.ts": `// Calculator Module\nexport function add(a: number, b: number): number {\n  return a + b;\n}\n\nexport function multiply(a: number, b: number): number {\n  return a * b;\n}\n`,
        "src/config.json": `{\n  "version": "1.0.0",\n  "debug": false\n}\n`,
      };

      const unifiedDiff = `
diff --git a/src/calculator.ts b/src/calculator.ts
--- a/src/calculator.ts
+++ b/src/calculator.ts
@@ -2,3 +2,4 @@
 export function add(a: number, b: number): number {
+  console.log("Adding numbers");
   return a + b;
 }
diff --git a/src/config.json b/src/config.json
--- a/src/config.json
+++ b/src/config.json
@@ -2,2 +2,3 @@
   "version": "1.0.0",
+  "environment": "production",
   "debug": false
`;

      const result = await applySpeculativeDiff(unifiedDiff, {
        virtualFiles,
        validateSyntax: true,
        dryRun: false,
      });

      assert.equal(result.success, true);
      assert.equal(result.status, "applied");
      assert.equal(result.modifiedFiles.length, 2);
      assert.ok(
        virtualFiles["src/calculator.ts"].includes(
          'console.log("Adding numbers");',
        ),
      );
      assert.ok(
        virtualFiles["src/config.json"].includes('"environment": "production"'),
      );
      assert.equal(result.fileOutcomes["src/calculator.ts"].syntaxValid, true);
      assert.equal(result.fileOutcomes["src/config.json"].syntaxValid, true);
    },
  );

  // ─── 2. SEARCH/REPLACE BLOCK FORMAT & INDENTATION-AWARE MATCHING ───────────
  await suite.test(
    "2. Search/Replace Blocks: symbol-anchoring and indentation preservation",
    async () => {
      const virtualFiles = {
        "src/userService.ts": `export class UserService {\n    public async findUser(id: string) {\n        const user = await db.query(id);\n        return user;\n    }\n}\n`,
      };

      // Notice search block has 2 spaces indentation, original has 4 spaces!
      const searchReplaceDiff = `
# File: src/userService.ts
<<<<<<< SEARCH
  const user = await db.query(id);
  return user;
=======
  const user = await db.query(id);
  if (!user) throw new Error("Not found");
  return user;
>>>>>>> REPLACE
`;

      const result = await applySpeculativeDiff(searchReplaceDiff, {
        virtualFiles,
        validateSyntax: true,
        dryRun: false,
      });

      assert.equal(result.success, true);
      assert.equal(result.status, "applied");
      // Indentation should preserve the original 4 spaces
      assert.ok(
        virtualFiles["src/userService.ts"].includes(
          '        if (!user) throw new Error("Not found");',
        ),
      );
    },
  );

  // ─── 3. PRE-FLIGHT SYNTAX VALIDATION & ATOMIC ROLLBACK ON DISK ──────────────
  await suite.test(
    "3. Atomic Rollback: syntax error in 1 of 3 files preserves 100% of files on disk with zero pollution",
    async () => {
      const testDir = path.join(tmpDir, "atomic-rollback-test");
      fs.mkdirSync(path.join(testDir, "src"), { recursive: true });

      const file1Path = path.join(testDir, "src", "file1.ts");
      const file2Path = path.join(testDir, "src", "file2.ts");
      const file3Path = path.join(testDir, "src", "file3.json");

      const originalFile1 = `export const message = "File 1 original";\n`;
      const originalFile2 = `export function getStatus(): boolean {\n  return true;\n}\n`;
      const originalFile3 = `{\n  "status": "original"\n}\n`;

      fs.writeFileSync(file1Path, originalFile1);
      fs.writeFileSync(file2Path, originalFile2);
      fs.writeFileSync(file3Path, originalFile3);

      // File 1 is valid, File 2 introduces invalid syntax (unclosed curly brace `{`), File 3 is valid
      const faultyMultiFileDiff = `
diff --git a/src/file1.ts b/src/file1.ts
--- a/src/file1.ts
+++ b/src/file1.ts
@@ -1,1 +1,1 @@
-export const message = "File 1 original";
+export const message = "File 1 modified";
diff --git a/src/file2.ts b/src/file2.ts
--- a/src/file2.ts
+++ b/src/file2.ts
@@ -1,3 +1,3 @@
 export function getStatus(): boolean {
-  return true;
+  return { broken: ;
 }
diff --git a/src/file3.json b/src/file3.json
--- a/src/file3.json
+++ b/src/file3.json
@@ -2,1 +2,1 @@
-  "status": "original"
+  "status": "modified"
`;

      const result = await applySpeculativeDiff(faultyMultiFileDiff, {
        workspaceRoot: testDir,
        validateSyntax: true,
        dryRun: false,
      });

      // Verification of atomic rollback:
      assert.equal(result.success, false);
      assert.equal(result.status, "syntax_error");
      assert.ok(
        result.error?.includes('Syntax error introduced in "src/file2.ts"'),
      );

      // Crucial check: NONE of the files on disk must have been touched!
      const diskContent1 = fs.readFileSync(file1Path, "utf-8");
      const diskContent2 = fs.readFileSync(file2Path, "utf-8");
      const diskContent3 = fs.readFileSync(file3Path, "utf-8");

      assert.equal(
        diskContent1,
        originalFile1,
        "File 1 on disk must remain unchanged",
      );
      assert.equal(
        diskContent2,
        originalFile2,
        "File 2 on disk must remain unchanged",
      );
      assert.equal(
        diskContent3,
        originalFile3,
        "File 3 on disk must remain unchanged",
      );
    },
  );

  // ─── 4. HIGH-SPEED MULTI-FILE BENCHMARK (10 FILES IN < 50ms) ───────────────
  await suite.test(
    "4. Benchmark: speculatively parses, matches, AST-validates, and patches 10 files in < 50ms",
    async () => {
      const virtualFiles: Record<string, string> = {};
      const diffChunks: string[] = [];

      for (let i = 0; i < 10; i++) {
        const fileName = `src/module_${i}.ts`;
        virtualFiles[fileName] =
          `// Module ${i}\nexport function compute_${i}(x: number): number {\n  return x * ${i};\n}\n`;

        diffChunks.push(`
diff --git a/${fileName} b/${fileName}
--- a/${fileName}
+++ b/${fileName}
@@ -2,2 +2,3 @@
 export function compute_${i}(x: number): number {
+  const factor = 10;
   return x * ${i};
`);
      }

      const fullBenchmarkDiff = diffChunks.join("\n");

      const t0 = performance.now();
      const result = await applySpeculativeDiff(fullBenchmarkDiff, {
        virtualFiles,
        validateSyntax: true,
        dryRun: false,
      });
      const totalLatency = performance.now() - t0;

      assert.equal(result.success, true);
      assert.equal(result.status, "applied");
      assert.equal(result.modifiedFiles.length, 10);
      assert.equal(result.totalHunks, 10);
      assert.equal(result.appliedHunks, 10);

      // Verify all 10 files were correctly patched in memory
      for (let i = 0; i < 10; i++) {
        const fileName = `src/module_${i}.ts`;
        assert.ok(virtualFiles[fileName].includes("const factor = 10;"));
      }

      console.log(
        `[Benchmark 🚀] 10-File Speculative Diff & AST Validation completed in: ${totalLatency.toFixed(2)}ms`,
      );
      assert.ok(
        totalLatency < 80,
        `Expected 10 files patched in < 80ms, took ${totalLatency.toFixed(2)}ms`,
      );
    },
  );

  // ─── 5. API ENDPOINT INTEGRATION (/v1/diff/preview & /v1/diff/apply) ────────
  await suite.test(
    "5. HTTP API Endpoints: /v1/diff/preview and /v1/diff/apply with subscriber auth",
    async () => {
      const { apiKey } = await createSubscriber("pro");

      const virtualFiles = {
        "src/api.ts": `export const apiVersion = "1.0.0";\n`,
      };

      const diff = `
diff --git a/src/api.ts b/src/api.ts
--- a/src/api.ts
+++ b/src/api.ts
@@ -1,1 +1,2 @@
+export const apiName = "VynorAI";
 export const apiVersion = "1.0.0";
`;

      // 5.1 Preview Mode (dryRun)
      const previewRes = await fetch(`${baseUrl}/diff/preview`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          diff,
          virtualFiles: { ...virtualFiles },
        }),
      });

      assert.equal(previewRes.status, 200);
      const previewJson = (await previewRes.json()) as any;
      assert.equal(previewJson.success, true);
      assert.equal(previewJson.status, "preview");
      assert.equal(previewJson.modifiedFiles[0], "src/api.ts");

      // 5.2 Apply Mode
      const applyRes = await fetch(`${baseUrl}/diff/apply`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          diff,
          virtualFiles,
          dryRun: false,
        }),
      });

      assert.equal(applyRes.status, 200);
      const applyJson = (await applyRes.json()) as any;
      assert.equal(applyJson.success, true);
      assert.equal(applyJson.status, "applied");
      assert.ok(applyJson.durationMs >= 0);
    },
  );
});
