import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { app } from "../src/index.js";
import {
  parseDiagnostics,
  executeTerminalCommand,
  generateHeuristicFix,
  runAutonomousSelfHealingLoop,
} from "../src/services/terminalSelfHealingEngine.js";

let server: http.Server;
let baseUrl = "";
let dbm: typeof import("../src/db.js");
let quota: typeof import("../src/services/monthlyQuota.js");

const daysFromNow = (d: number) => new Date(Date.now() + d * 86_400_000);

let userIndex = 0;
async function createSubscriber(
  plan = "pro",
): Promise<{ userId: string; apiKey: string }> {
  const userId = `heal-user-${Date.now()}-${crypto.randomBytes(4).toString("hex")}-${++userIndex}`;
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

test("Autonomous Terminal Self-Healing Agent Loop Test Suite", async (suite) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vynor-selfheal-"));

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

  suite.after(async () => {
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  // ─── 1. DIAGNOSTIC & STACK TRACE PARSING ─────────────────────────────────────
  await suite.test(
    "1. Universal Diagnostic Parser: extracts TS, Node, Python, and Test diagnostics",
    () => {
      // 1.1 TypeScript compiler output
      const tsOutput = `
src/services/billing.ts(42,15): error TS2304: Cannot find name 'crypto'.
src/routes/api.ts:108:5 - error TS2345: Argument of type 'string | string[]' is not assignable to parameter of type 'string'.
`;
      const tsDiags = parseDiagnostics(tsOutput);
      assert.equal(tsDiags.length, 2);
      assert.equal(tsDiags[0].line, 42);
      assert.equal(tsDiags[0].column, 15);
      assert.equal(tsDiags[0].errorCode, "TS2304");
      assert.equal(tsDiags[0].category, "compiler");
      assert.equal(tsDiags[1].line, 108);
      assert.equal(tsDiags[1].errorCode, "TS2345");

      // 1.2 Node.js runtime stack trace
      const nodeOutput = `
ReferenceError: totalRevenue is not defined
    at calculateYield (/app/services/yield.js:14:21)
    at Object.<anonymous> (/app/index.js:5:1)
`;
      const nodeDiags = parseDiagnostics(nodeOutput);
      assert.equal(nodeDiags.length, 1);
      assert.equal(nodeDiags[0].errorCode, "ReferenceError");
      assert.equal(nodeDiags[0].filePath, "/app/services/yield.js");
      assert.equal(nodeDiags[0].line, 14);
      assert.equal(nodeDiags[0].category, "runtime");

      // 1.3 Python traceback
      const pyOutput = `
Traceback (most recent call last):
  File "calculator.py", line 28, in compute_sum
    return a + b
NameError: name 'b' is not defined
`;
      const pyDiags = parseDiagnostics(pyOutput);
      assert.equal(pyDiags.length, 1);
      assert.equal(pyDiags[0].filePath, "calculator.py");
      assert.equal(pyDiags[0].line, 28);
      assert.equal(pyDiags[0].errorCode, "NameError");

      // 1.4 Test runner failure
      const testOutput = `
not ok 4 - assert subscriber plan
  location: 'test/auth.test.ts:75:10'
  error: 'Expected values to be strictly equal: 200 !== 401'
`;
      const testDiags = parseDiagnostics(testOutput);
      assert.equal(testDiags.length, 1);
      assert.equal(testDiags[0].filePath, "test/auth.test.ts");
      assert.equal(testDiags[0].line, 75);
      assert.equal(testDiags[0].category, "assertion");
    },
  );

  // ─── 2. IMMEDIATE PASSING COMMAND ───────────────────────────────────────────
  await suite.test(
    "2. Immediate Success: passing command exits in 1 attempt with no modifications",
    async () => {
      const result = await runAutonomousSelfHealingLoop({
        command: `node -e "process.exit(0)"`,
        maxAttempts: 3,
      });

      assert.equal(result.success, true);
      assert.equal(result.attempts, 1);
      assert.equal(result.finalExitCode, 0);
      assert.equal(result.modifiedFiles.length, 0);
    },
  );

  // ─── 3. AUTONOMOUS SELF-HEALING LOOP WITH REAL DISK REPAIR ───────────────────
  await suite.test(
    "3. Self-Healing Loop: repairs missing import and achieves exit code 0",
    async () => {
      const scriptPath = path.join(tempDir, "repair_test.mjs");

      // Initial code: uses path.join without importing path
      const initialCode = `
const out = path.join("a", "b");
if (out.length < 1) process.exit(1);
console.log("SUCCESS:" + out);
`;
      fs.writeFileSync(scriptPath, initialCode, "utf-8");

      // Run self healing loop
      const result = await runAutonomousSelfHealingLoop({
        command: `node "${scriptPath}"`,
        cwd: tempDir,
        maxAttempts: 4,
      });

      assert.equal(
        result.success,
        true,
        "Self-healing should achieve exit code 0",
      );
      assert.equal(result.finalExitCode, 0);
      assert.ok(
        result.attempts >= 2,
        `Should take at least 2 attempts (initial failure + fix), took: ${result.attempts}`,
      );
      assert.ok(
        result.modifiedFiles.includes(scriptPath),
        "Script path should be marked as modified",
      );

      // Verify file content was fixed on disk
      const fixedContent = fs.readFileSync(scriptPath, "utf-8");
      assert.ok(
        fixedContent.includes('import path from "node:path";'),
        "Fixed file must contain import statement",
      );
    },
  );

  // ─── 4. TEST RUNNER ASSERTION AUTO-HEAL ──────────────────────────────────────
  await suite.test(
    "4. Assertion Auto-Heal: repairs mismatched test expectation and passes",
    async () => {
      const testFilePath = path.join(tempDir, "sample.test.mjs");

      // Initial test with outdated expected value
      const initialTestCode = `
import assert from "node:assert/strict";

const actualMultiplier = 10;
assert.equal(actualMultiplier, 5);
`;
      fs.writeFileSync(testFilePath, initialTestCode, "utf-8");

      const result = await runAutonomousSelfHealingLoop({
        command: `node "${testFilePath}"`,
        cwd: tempDir,
        maxAttempts: 3,
        customFixGenerator: (diag, content) => {
          // Custom surgical fix that fixes the assertion mismatch
          if (content.includes("assert.equal(actualMultiplier, 5)")) {
            return content.replace(
              "assert.equal(actualMultiplier, 5);",
              "assert.equal(actualMultiplier, 10);",
            );
          }
          return null;
        },
      });

      assert.equal(result.success, true);
      assert.equal(result.finalExitCode, 0);
      assert.equal(result.attempts, 2);

      const patchedContent = fs.readFileSync(testFilePath, "utf-8");
      assert.ok(patchedContent.includes("assert.equal(actualMultiplier, 10);"));
    },
  );

  // ─── 5. CIRCUIT BREAKER & UNFIXABLE COMMAND PROTECTION ───────────────────────
  await suite.test(
    "5. Circuit Breaker: terminates cleanly when command cannot be healed",
    async () => {
      const unfixableScript = path.join(tempDir, "unfixable.mjs");
      fs.writeFileSync(unfixableScript, `process.exit(42);`, "utf-8");

      const result = await runAutonomousSelfHealingLoop({
        command: `node "${unfixableScript}"`,
        cwd: tempDir,
        maxAttempts: 2,
      });

      assert.equal(result.success, false);
      assert.equal(result.finalExitCode, 42);
      assert.ok(
        result.attempts <= 2,
        "Must terminate within maxAttempts bounds",
      );
      assert.ok(result.error);
    },
  );

  // ─── 6. IN-MEMORY VIRTUAL WORKSPACE SELF-HEALING ──────────────────────────────
  await suite.test(
    "6. Virtual Workspace: validates in-memory self-healing without touching physical disk",
    async () => {
      const virtualFiles = {
        "src/engine.ts": `
export function computeRate(): number {
  throw new Error("Rate calculation unimplemented");
}
`,
      };

      const result = await runAutonomousSelfHealingLoop({
        command: `npx tsc --noEmit`,
        virtualFiles,
        maxAttempts: 3,
        customFixGenerator: (diag, content) => {
          if (content.includes("Rate calculation unimplemented")) {
            return content.replace(
              `throw new Error("Rate calculation unimplemented");`,
              `return 4.5;`,
            );
          }
          return null;
        },
      });

      assert.equal(result.success, true);
      assert.equal(result.finalExitCode, 0);
      assert.ok(virtualFiles["src/engine.ts"].includes("return 4.5;"));
    },
  );

  // ─── 7. REST API ENDPOINT: POST /v1/terminal/self-heal ─────────────────────────
  await suite.test(
    "7. HTTP REST API Endpoint: POST /v1/terminal/self-heal with subscriber auth",
    async () => {
      const { apiKey } = await createSubscriber("pro");

      // 7.1 Immediate success command
      const res = await fetch(`${baseUrl}/terminal/self-heal`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          command: `node -e "process.exit(0)"`,
          maxAttempts: 3,
        }),
      });

      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.success, true);
      assert.equal(data.finalExitCode, 0);
      assert.equal(data.attempts, 1);
      assert.ok(Array.isArray(data.iterations));

      // 7.2 Bad request validation (missing command)
      const badRes = await fetch(`${baseUrl}/terminal/self-heal`, {
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

  // ─── 8. PERFORMANCE BENCHMARK ────────────────────────────────────────────────
  await suite.test(
    "8. Benchmark: parse diagnostics and execution loop completes quickly",
    async () => {
      const sampleOutput = `
src/module.ts(10,5): error TS2304: Cannot find name 'fs'.
src/module.ts(20,5): error TS2304: Cannot find name 'path'.
src/module.ts(30,5): error TS2304: Cannot find name 'crypto'.
`;
      const t0 = performance.now();
      for (let i = 0; i < 50; i++) {
        parseDiagnostics(sampleOutput);
      }
      const parseTime = performance.now() - t0;
      console.log(
        `[Benchmark 🚀] 50 Diagnostic Parser Batches: ${parseTime.toFixed(2)}ms`,
      );
      assert.ok(
        parseTime < 50,
        `50 diagnostic parsing runs should take < 50ms, took ${parseTime.toFixed(2)}ms`,
      );
    },
  );
});
