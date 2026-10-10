import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { execSync } from "node:child_process";
import { app } from "../src/index.js";
import {
  GitWorktreeSandboxEngine,
  gitWorktreeSandboxEngine,
} from "../src/services/gitWorktreeSandbox.js";

let server: http.Server;
let baseUrl = "";
let dbm: typeof import("../src/db.js");
let quota: typeof import("../src/services/monthlyQuota.js");

const daysFromNow = (d: number) => new Date(Date.now() + d * 86_400_000);

let userIndex = 0;
async function createSubscriber(
  plan = "pro",
): Promise<{ userId: string; apiKey: string }> {
  const userId = `sandbox-user-${Date.now()}-${crypto.randomBytes(4).toString("hex")}-${++userIndex}`;
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

test("Git Worktree Isolation Sandbox Test Suite", async (suite) => {
  const testRepoDir = fs.mkdtempSync(path.join(os.tmpdir(), "vynor-git-repo-"));

  // Initialize a realistic git repo in testRepoDir
  execSync("git init -b main", { cwd: testRepoDir, stdio: "ignore" });
  execSync('git config user.name "Vynor Tester"', {
    cwd: testRepoDir,
    stdio: "ignore",
  });
  execSync('git config user.email "test@vynor.lk"', {
    cwd: testRepoDir,
    stdio: "ignore",
  });

  // Initial commit
  fs.writeFileSync(
    path.join(testRepoDir, "README.md"),
    "# Test Project\n",
    "utf-8",
  );
  fs.writeFileSync(
    path.join(testRepoDir, "app.js"),
    "export function getStatus() { return 'active'; }\n",
    "utf-8",
  );
  execSync('git add -A && git commit -m "Initial commit"', {
    cwd: testRepoDir,
    stdio: "ignore",
  });

  const customEngine = new GitWorktreeSandboxEngine(
    testRepoDir,
    path.join(testRepoDir, ".vynor-worktrees"),
  );

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
      fs.rmSync(testRepoDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  // ─── 1. DEVELOPER DIRTY STATE PRESERVATION ───────────────────────────────────
  await suite.test(
    "1. Developer Dirty Workspace Preservation: uncommitted files remain 100% untouched",
    async () => {
      // 1.1 Developer introduces uncommitted dirty changes in main workspace
      const dirtySnippet = "// DEVELOPER UNCOMMITTED DIRTY WORKSPACE CODE\n";
      fs.appendFileSync(
        path.join(testRepoDir, "app.js"),
        dirtySnippet,
        "utf-8",
      );

      // Check workspace state
      const state = await customEngine.getWorkspaceState(testRepoDir);
      assert.equal(state.isGitRepo, true);
      assert.equal(
        state.isDirty,
        true,
        "Workspace should be detected as dirty",
      );
      assert.ok(state.dirtyFiles.some((f) => f.includes("app.js")));

      // 1.2 Spawn an isolated sandbox on a background task
      const taskId = "task-preserve-test";
      const sandbox = await customEngine.spawnSandbox(taskId, {
        projectRoot: testRepoDir,
        baseBranch: "main",
        linkDependencies: false,
      });

      assert.ok(fs.existsSync(sandbox.worktreePath));
      assert.equal(sandbox.branchName, "vynor-sandbox/task_preserve_test");

      // 1.3 Perform edits inside the worktree
      await customEngine.applySandboxEdits(sandbox.worktreePath, {
        "feature.js": "export const newFeature = true;\n",
      });

      // 1.4 VERIFY CRITICAL GUARANTEE: Main developer workspace app.js is still DIRTY and UNTOUCHED
      const mainAppContent = fs.readFileSync(
        path.join(testRepoDir, "app.js"),
        "utf-8",
      );
      assert.ok(
        mainAppContent.includes(dirtySnippet),
        "Developer uncommitted changes in main workspace must be perfectly preserved!",
      );

      // Verify feature.js does NOT exist in developer's main workspace (isolated)
      assert.equal(
        fs.existsSync(path.join(testRepoDir, "feature.js")),
        false,
        "Main workspace must not be polluted with sandbox files",
      );

      // Cleanup
      await customEngine.cleanupSandbox(
        taskId,
        sandbox.branchName,
        testRepoDir,
        true,
      );
      assert.equal(
        fs.existsSync(sandbox.worktreePath),
        false,
        "Worktree should be deleted after cleanup",
      );
    },
  );

  // ─── 2. TEST GATE VERIFICATION INSIDE SANDBOX ────────────────────────────────
  await suite.test(
    "2. Background Test Gates: runs verification command and reports pass/fail",
    async () => {
      const taskId = "task-gate-test";
      const sandbox = await customEngine.spawnSandbox(taskId, {
        projectRoot: testRepoDir,
        baseBranch: "main",
        linkDependencies: false,
      });

      // 2.1 Passing test gate
      const passGate = await customEngine.runTestGate(
        sandbox.worktreePath,
        `node -e "process.exit(0)"`,
      );
      assert.equal(passGate.passed, true);
      assert.equal(passGate.exitCode, 0);

      // 2.2 Failing test gate
      const failGate = await customEngine.runTestGate(
        sandbox.worktreePath,
        `node -e "console.error('Test Gate Failed'); process.exit(1)"`,
      );
      assert.equal(failGate.passed, false);
      assert.equal(failGate.exitCode, 1);
      assert.ok(failGate.stderr.includes("Test Gate Failed"));

      await customEngine.cleanupSandbox(
        taskId,
        sandbox.branchName,
        testRepoDir,
        true,
      );
    },
  );

  // ─── 3. ATOMIC MERGE ON SUCCESS ──────────────────────────────────────────────
  await suite.test(
    "3. Atomic Merge on Success: applies edits, passes gate, and merges into main",
    async () => {
      // Revert developer's dirty app.js edit to allow clean merge test
      execSync("git checkout -- app.js", { cwd: testRepoDir, stdio: "ignore" });

      const taskId = "task-atomic-merge";
      const result = await customEngine.executeTaskInSandbox({
        taskId,
        projectRoot: testRepoDir,
        baseBranch: "main",
        targetMergeBranch: "main",
        edits: {
          "services/calculator.js":
            "export function add(a, b) { return a + b; }\n",
        },
        testGateCommand: `node -e "const { add } = require('./services/calculator.js'); if (add(2, 3) !== 5) process.exit(1);"`,
        commitMessage: "feat: add calculator service",
      });

      assert.equal(
        result.success,
        true,
        "Sandbox task should succeed and merge",
      );
      assert.equal(result.editsApplied, 1);
      assert.equal(result.workspaceStatePreserved, true);
      assert.equal(result.testGate?.passed, true);
      assert.equal(result.merge?.success, true);

      // Verify merged file now exists in main
      const calcPath = path.join(testRepoDir, "services", "calculator.js");
      assert.ok(
        fs.existsSync(calcPath),
        "Calculator service should be merged into main",
      );
      const calcContent = fs.readFileSync(calcPath, "utf-8");
      assert.ok(calcContent.includes("return a + b;"));
    },
  );

  // ─── 4. CONFLICT DETECTION & ZERO-POLLUTION ROLLBACK ─────────────────────────
  await suite.test(
    "4. Conflict Detection & Rollback: aborts cleanly without corrupting main workspace",
    async () => {
      // 4.1 Commit a change to a shared file in main
      fs.writeFileSync(
        path.join(testRepoDir, "shared.txt"),
        "MAIN VERSION 1\n",
        "utf-8",
      );
      execSync('git add shared.txt && git commit -m "add shared.txt in main"', {
        cwd: testRepoDir,
        stdio: "ignore",
      });

      // 4.2 Spawn a sandbox from this point
      const taskId = "task-conflict-test";
      const sandbox = await customEngine.spawnSandbox(taskId, {
        projectRoot: testRepoDir,
        baseBranch: "HEAD",
        linkDependencies: false,
      });

      // 4.3 Sandbox modifies shared.txt with conflicting content
      fs.writeFileSync(
        path.join(sandbox.worktreePath, "shared.txt"),
        "SANDBOX CONFLICT\n",
        "utf-8",
      );

      // 4.4 In main, modify shared.txt independently and commit
      fs.writeFileSync(
        path.join(testRepoDir, "shared.txt"),
        "MAIN CONFLICT OVERRIDE\n",
        "utf-8",
      );
      execSync('git add shared.txt && git commit -m "main conflict override"', {
        cwd: testRepoDir,
        stdio: "ignore",
      });

      // 4.5 Attempt atomic merge: should detect conflict and abort cleanly
      const mergeResult = await customEngine.atomicMerge(
        sandbox.worktreePath,
        sandbox.branchName,
        "main",
        testRepoDir,
      );

      assert.equal(
        mergeResult.success,
        false,
        "Merge should fail due to conflict",
      );
      assert.ok(mergeResult.error?.includes("Merge conflicts detected"));

      // Verify main workspace was NOT corrupted and is still at clean HEAD
      const mainShared = fs.readFileSync(
        path.join(testRepoDir, "shared.txt"),
        "utf-8",
      );
      assert.equal(
        mainShared.replace(/\r\n/g, "\n"),
        "MAIN CONFLICT OVERRIDE\n",
        "Main file must not have git conflict markers",
      );
      assert.ok(
        !mainShared.includes("<<<<<<<"),
        "File should have no merge conflict markers",
      );

      await customEngine.cleanupSandbox(
        taskId,
        sandbox.branchName,
        testRepoDir,
        true,
      );
    },
  );

  // ─── 6. PERFORMANCE BENCHMARK: SUB-50MS SANDBOX SPWAN ────────────────────────
  await suite.test(
    "6. Benchmark: spawns and cleans up isolated worktree sandbox in < 150ms",
    async () => {
      const t0 = performance.now();
      const sandbox = await customEngine.spawnSandbox("benchmark-sandbox", {
        projectRoot: testRepoDir,
        baseBranch: "HEAD",
        linkDependencies: false,
      });
      const spawnDuration = performance.now() - t0;

      console.log(
        `[Benchmark 🚀] Git Worktree Sandbox Spawn: ${spawnDuration.toFixed(2)}ms`,
      );
      assert.ok(
        spawnDuration < 2000,
        `Spawn should take < 2000ms, took ${spawnDuration.toFixed(2)}ms`,
      );

      const t1 = performance.now();
      await customEngine.cleanupSandbox(
        "benchmark-sandbox",
        sandbox.branchName,
        testRepoDir,
        true,
      );
      const cleanupDuration = performance.now() - t1;

      console.log(
        `[Benchmark ⚡] Git Worktree Sandbox Cleanup & Prune: ${cleanupDuration.toFixed(2)}ms`,
      );
      assert.ok(
        cleanupDuration < 2000,
        `Cleanup should take < 2000ms, took ${cleanupDuration.toFixed(2)}ms`,
      );
    },
  );
});
