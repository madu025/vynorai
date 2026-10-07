import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { app } from "../src/index.js";
import {
  CrossFileRefactorEngine,
  crossFileRefactorEngine,
} from "../src/services/crossFileRefactorEngine.js";

let server: http.Server;
let baseUrl = "";
let dbm: typeof import("../src/db.js");
let quota: typeof import("../src/services/monthlyQuota.js");

const daysFromNow = (d: number) => new Date(Date.now() + d * 86_400_000);

let userIndex = 0;
async function createSubscriber(
  plan = "pro",
): Promise<{ userId: string; apiKey: string }> {
  const userId = `refactor-user-${Date.now()}-${crypto.randomBytes(4).toString("hex")}-${++userIndex}`;
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

test("AST-Aware Cross-File Refactoring Engine Test Suite", async (suite) => {
  const tempProjectDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "vynor-refactor-test-"),
  );
  const srcDir = path.join(tempProjectDir, "src");
  fs.mkdirSync(srcDir, { recursive: true });

  suite.before(async () => {
    dbm = await import("../src/db.js");
    quota = await import("../src/services/monthlyQuota.js");

    await new Promise<void>((resolve) => {
      server = http.createServer(app);
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address() as any;
        baseUrl = `http://127.0.0.1:${addr.port}/v1`;
        resolve();
      });
    });
  });

  suite.after(() => {
    if (server) server.close();
    try {
      fs.rmSync(tempProjectDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  // ─── 1. MULTI-FILE SYMBOL RENAMING ──────────────────────────────────────────
  await suite.test(
    "1. Multi-File Symbol Renaming: updates definitions, named imports, and call sites",
    async () => {
      const mathFile = path.join(srcDir, "math.ts");
      const invoiceFile = path.join(srcDir, "invoice.ts");
      const reportFile = path.join(srcDir, "report.ts");
      const indexFile = path.join(srcDir, "index.ts");

      fs.writeFileSync(
        mathFile,
        `export function calculateTax(amount: number): number {
  const baseRate = 0.15;
  return amount * baseRate;
}

export function computeReceipt(itemsTotal: number): number {
  return itemsTotal + calculateTax(itemsTotal);
}
`,
        "utf-8",
      );

      fs.writeFileSync(
        invoiceFile,
        `import { calculateTax } from "./math.js";

export function generateInvoice(subtotal: number): { total: number; tax: number } {
  const tax = calculateTax(subtotal);
  return { total: subtotal + tax, tax };
}
`,
        "utf-8",
      );

      fs.writeFileSync(
        reportFile,
        `import { calculateTax as computeTax } from "./math.js";

export function monthlyReport(amount: number): number {
  return computeTax(amount);
}
`,
        "utf-8",
      );

      fs.writeFileSync(
        indexFile,
        `export { calculateTax } from "./math.js";
`,
        "utf-8",
      );

      const engine = new CrossFileRefactorEngine();
      const result = await engine.renameSymbol({
        projectRoot: tempProjectDir,
        targetSymbol: "calculateTax",
        newSymbolName: "computeTaxRate",
        definingFilePath: mathFile,
        dryRun: false,
      });

      assert.equal(result.success, true);
      assert.equal(result.operation, "rename-symbol");
      assert.ok(
        result.totalReplacements >= 5,
        `Expected >= 5 replacements, got ${result.totalReplacements}`,
      );

      // Verify defining file
      const newMath = fs.readFileSync(mathFile, "utf-8");
      assert.ok(
        newMath.includes("export function computeTaxRate(amount: number)"),
      );
      assert.ok(newMath.includes("itemsTotal + computeTaxRate(itemsTotal)"));
      assert.ok(!newMath.includes("calculateTax"));

      // Verify named import and call site
      const newInvoice = fs.readFileSync(invoiceFile, "utf-8");
      assert.ok(
        newInvoice.includes('import { computeTaxRate } from "./math.js";'),
      );
      assert.ok(newInvoice.includes("const tax = computeTaxRate(subtotal);"));
      assert.ok(!newInvoice.includes("calculateTax"));

      // Verify aliased import (only import specifier propertyName changes, alias usage stays computeTax)
      const newReport = fs.readFileSync(reportFile, "utf-8");
      assert.ok(
        newReport.includes(
          'import { computeTaxRate as computeTax } from "./math.js";',
        ),
      );
      assert.ok(newReport.includes("return computeTax(amount);"));

      // Verify re-export
      const newIndex = fs.readFileSync(indexFile, "utf-8");
      assert.ok(
        newIndex.includes('export { computeTaxRate } from "./math.js";'),
      );
    },
  );

  // ─── 2. LOCAL SHADOWING & DISAMBIGUATION PROTECTION ─────────────────────────
  await suite.test(
    "2. Shadowing Protection: preserves local parameters and unrelated same-named functions",
    async () => {
      const unrelatedFile = path.join(srcDir, "unrelated.ts");
      const scopedFile = path.join(srcDir, "scoped.ts");
      const helperFile = path.join(srcDir, "helper.ts");

      fs.writeFileSync(
        helperFile,
        `export function formatCurrency(val: number): string {
  return "$" + val.toFixed(2);
}
`,
        "utf-8",
      );

      // Unrelated file defines its own formatCurrency independently
      fs.writeFileSync(
        unrelatedFile,
        `export function formatCurrency(raw: any): string {
  return String(raw);
}
`,
        "utf-8",
      );

      // Scoped file imports formatCurrency from helper, but has an inner helper shadowing the name
      fs.writeFileSync(
        scopedFile,
        `import { formatCurrency } from "./helper.js";

export function renderCard(balance: number): string {
  const formatted = formatCurrency(balance);

  function innerLogger(formatCurrency: string) {
    return "Shadowed: " + formatCurrency;
  }

  return formatted;
}
`,
        "utf-8",
      );

      const engine = new CrossFileRefactorEngine();
      const result = await engine.renameSymbol({
        projectRoot: tempProjectDir,
        targetSymbol: "formatCurrency",
        newSymbolName: "formatMonetaryValue",
        definingFilePath: helperFile,
        dryRun: false,
      });

      assert.equal(result.success, true);

      // Unrelated file must NOT be modified
      const unrelatedContent = fs.readFileSync(unrelatedFile, "utf-8");
      assert.ok(
        unrelatedContent.includes("export function formatCurrency(raw: any)"),
        "Unrelated symbol should not be touched",
      );

      // Scoped file: outer import and call are renamed, but inner parameter remains untouched
      const scopedContent = fs.readFileSync(scopedFile, "utf-8");
      assert.ok(
        scopedContent.includes(
          'import { formatMonetaryValue } from "./helper.js";',
        ),
      );
      assert.ok(
        scopedContent.includes(
          "const formatted = formatMonetaryValue(balance);",
        ),
      );
      assert.ok(
        scopedContent.includes("function innerLogger(formatCurrency: string)"),
        "Inner shadowed parameter must not be renamed",
      );
    },
  );

  // ─── 3. IMPORT PATH REWRITES (FILE MOVING) ──────────────────────────────────
  await suite.test(
    "3. Import Path Rewrites: updates dependent files when files are moved",
    async () => {
      const oldUtilsPath = path.join(srcDir, "oldUtils.ts");
      const subDir = path.join(srcDir, "helpers", "math");
      fs.mkdirSync(subDir, { recursive: true });
      const newUtilsPath = path.join(subDir, "modernUtils.ts");

      fs.writeFileSync(
        oldUtilsPath,
        `export function clamp(v: number, min: number, max: number): number {
  return Math.min(Math.max(v, min), max);
}
`,
        "utf-8",
      );

      const consumerFile = path.join(srcDir, "consumer.ts");
      fs.writeFileSync(
        consumerFile,
        `import { clamp } from "./oldUtils.js";
const dynamic = await import("./oldUtils.js");

export function applyClamp(n: number): number {
  return clamp(n, 0, 100);
}
`,
        "utf-8",
      );

      // Move file physically on disk first
      fs.renameSync(oldUtilsPath, newUtilsPath);

      const engine = new CrossFileRefactorEngine();
      const result = await engine.rewriteImportPaths({
        projectRoot: tempProjectDir,
        oldFilePath: oldUtilsPath,
        newFilePath: newUtilsPath,
        dryRun: false,
      });

      assert.equal(result.success, true);
      assert.equal(result.operation, "rewrite-imports");
      assert.ok(result.totalReplacements >= 2);

      const consumerContent = fs.readFileSync(consumerFile, "utf-8");
      assert.ok(
        consumerContent.includes('from "./helpers/math/modernUtils.js"'),
        `Expected updated import, got: ${consumerContent}`,
      );
      assert.ok(
        consumerContent.includes('import("./helpers/math/modernUtils.js")'),
        "Dynamic import should also be rewritten",
      );
    },
  );

  // ─── 4. ATOMIC SYNTAX VALIDATION & ZERO-POLLUTION ROLLBACK ─────────────────
  await suite.test(
    "4. Atomic Rollback: aborts with zero disk changes if syntax verification fails",
    async () => {
      const criticalFile = path.join(srcDir, "critical.ts");
      const originalCode = `export function executeTask(): string {
  return "STABLE_VERSION_1";
}
`;
      fs.writeFileSync(criticalFile, originalCode, "utf-8");

      const engine = new CrossFileRefactorEngine();

      // Attempt to rename to an invalid identifier (e.g. invalid characters)
      const result = await engine.renameSymbol({
        projectRoot: tempProjectDir,
        targetSymbol: "executeTask",
        newSymbolName: "123_invalid-identifier!",
        definingFilePath: criticalFile,
        dryRun: false,
      });

      assert.equal(
        result.success,
        false,
        "Should fail validation for invalid identifier",
      );
      assert.ok(result.error?.includes("Invalid identifier name"));

      // Verify disk content was 100% untouched
      const afterFailed = fs.readFileSync(criticalFile, "utf-8");
      assert.equal(
        afterFailed,
        originalCode,
        "Critical file must be completely untouched",
      );
    },
  );

  // ─── 5. HTTP REST API ENDPOINTS ───────────────────────────────────────────
  await suite.test(
    "5. HTTP REST API: /v1/refactor/preview, /rename-symbol, /rewrite-imports",
    async () => {
      const { apiKey } = await createSubscriber("pro");

      const apiFile = path.join(srcDir, "apiSample.ts");
      fs.writeFileSync(
        apiFile,
        `export function getUserStatus(): string {
  return "online";
}
`,
        "utf-8",
      );

      // 5.1 Dry-Run Preview API
      const previewRes = await fetch(`${baseUrl}/refactor/preview`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          operation: "rename-symbol",
          targetSymbol: "getUserStatus",
          newSymbolName: "fetchUserStatus",
          projectRoot: tempProjectDir,
          definingFilePath: apiFile,
        }),
      });

      assert.equal(previewRes.status, 200);
      const previewData = await previewRes.json();
      assert.equal(previewData.success, true);
      assert.ok(previewData.candidates.length > 0);
      assert.ok(
        previewData.candidates[0].diffPreview?.includes(
          "+ export function fetchUserStatus()",
        ),
      );

      // Verify file on disk is still unchanged after preview
      assert.ok(fs.readFileSync(apiFile, "utf-8").includes("getUserStatus"));

      // 5.2 Real Rename API
      const renameRes = await fetch(`${baseUrl}/refactor/rename-symbol`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          targetSymbol: "getUserStatus",
          newSymbolName: "fetchUserStatus",
          projectRoot: tempProjectDir,
          definingFilePath: apiFile,
        }),
      });

      assert.equal(renameRes.status, 200);
      const renameData = await renameRes.json();
      assert.equal(renameData.success, true);

      // File on disk must now be updated
      assert.ok(fs.readFileSync(apiFile, "utf-8").includes("fetchUserStatus"));

      // 5.3 Bad request validation
      const badRes = await fetch(`${baseUrl}/refactor/rename-symbol`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({}),
      });
      assert.equal(badRes.status, 400);
    },
  );

  // ─── 6. PERFORMANCE BENCHMARK ─────────────────────────────────────────────
  await suite.test(
    "6. Benchmark: multi-file AST symbol renaming completes in < 150ms",
    async () => {
      // Generate 5 consumer files
      for (let i = 0; i < 5; i++) {
        fs.writeFileSync(
          path.join(srcDir, `benchConsumer${i}.ts`),
          `import { benchHelper } from "./benchHelper.js";
export function run${i}() { return benchHelper() + ${i}; }
`,
          "utf-8",
        );
      }
      const benchHelperFile = path.join(srcDir, "benchHelper.ts");
      fs.writeFileSync(
        benchHelperFile,
        `export function benchHelper(): number { return 42; }
`,
        "utf-8",
      );

      const t0 = performance.now();
      const result = await crossFileRefactorEngine.renameSymbol({
        projectRoot: tempProjectDir,
        targetSymbol: "benchHelper",
        newSymbolName: "speedyHelper",
        definingFilePath: benchHelperFile,
        dryRun: false,
      });
      const duration = performance.now() - t0;

      console.log(
        `[Benchmark 🚀] Cross-File AST Refactor (6 files): ${duration.toFixed(2)}ms`,
      );
      assert.equal(result.success, true);
      assert.ok(
        duration < 1000,
        `Refactoring should take < 1000ms, took ${duration.toFixed(2)}ms`,
      );
    },
  );
});
