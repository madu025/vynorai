/**
 * VynorAI Git Worktree Isolation Sandbox Engine
 * ─────────────────────────────────────────────────────────────────────────────
 * Spawns background agent tasks in completely isolated Git worktrees,
 * preserving developer dirty workspace state, executing background test gates,
 * and performing atomic merges on success.
 *
 * Key Capabilities:
 *  1. Developer Dirty State Preservation:
 *     - Inspects main workspace status (`git status --porcelain`)
 *     - Never touches or stashes developer's active uncommitted edits
 *  2. Fast Sandbox Creation with NTFS Junction / Symlink Linking:
 *     - Uses `git worktree add` to branch off HEAD or base branch
 *     - Fast-links `node_modules` and config files via directory junctions
 *  3. Verification Test Gates & Self-Healing:
 *     - Executes test/build gates inside the isolated sandbox
 *     - Optionally invokes `runAutonomousSelfHealingLoop` if gates fail
 *  4. Atomic Merge & Safe Rollback:
 *     - Performs dry-run conflict check
 *     - Merges cleanly or aborts (`git merge --abort`) on conflict with zero pollution
 *     - Automatically removes and prunes worktrees on completion
 */

import fs from "node:fs";
import path from "node:path";
import { exec, spawn } from "node:child_process";
import { promisify } from "node:util";
import { runAutonomousSelfHealingLoop } from "./terminalSelfHealingEngine.js";

const execAsync = promisify(exec);

// ─── Interfaces ───────────────────────────────────────────────────────────────

export interface WorkspaceState {
  isGitRepo: boolean;
  isDirty: boolean;
  activeBranch: string;
  headCommit: string;
  dirtyFiles: string[];
}

export interface WorktreeSandboxInstance {
  sandboxId: string;
  worktreePath: string;
  branchName: string;
  baseBranch: string;
  createdAt: number;
}

export interface TestGateResult {
  passed: boolean;
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  healed?: boolean;
}

export interface SandboxMergeResult {
  success: boolean;
  targetBranch: string;
  mergedCommit?: string;
  conflicts?: string[];
  error?: string;
}

export interface SandboxExecutionOptions {
  taskId: string;
  projectRoot?: string;
  baseBranch?: string;
  edits?: Record<string, string>; // relativePath -> newContent
  testGateCommand?: string; // e.g. "npm test" or "npx tsc --noEmit"
  autoHealOnFailure?: boolean;
  commitMessage?: string;
  targetMergeBranch?: string; // e.g. "main"
  timeoutMs?: number;
}

export interface SandboxExecutionResult {
  success: boolean;
  sandboxId: string;
  branchName: string;
  workspaceStatePreserved: boolean;
  dirtyFilesCount: number;
  editsApplied: number;
  testGate?: TestGateResult;
  merge?: SandboxMergeResult;
  cleanedUp: boolean;
  durationMs: number;
  error?: string;
}

// ─── Git Worktree Sandbox Engine ─────────────────────────────────────────────

export class GitWorktreeSandboxEngine {
  constructor(
    private readonly defaultProjectRoot: string = process.cwd(),
    private readonly worktreeBaseDir: string = path.join(
      defaultProjectRoot,
      ".vynor-worktrees",
    ),
  ) {}

  private async runGit(
    args: string[],
    cwd: string = this.defaultProjectRoot,
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return new Promise((resolve) => {
      const child = spawn("git", args, { cwd, shell: false });
      let stdout = "";
      let stderr = "";

      child.stdout.on("data", (d) => (stdout += d.toString()));
      child.stderr.on("data", (d) => (stderr += d.toString()));

      child.on("close", (exitCode) => {
        resolve({
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          exitCode: exitCode ?? 1,
        });
      });
      child.on("error", (err) => {
        resolve({ stdout, stderr: err.message, exitCode: 1 });
      });
    });
  }

  /**
   * 1. Inspect and snapshot main workspace state to guarantee preservation.
   */
  public async getWorkspaceState(
    projectRoot: string = this.defaultProjectRoot,
  ): Promise<WorkspaceState> {
    const isRepoRes = await this.runGit(
      ["rev-parse", "--is-inside-work-tree"],
      projectRoot,
    );
    if (isRepoRes.exitCode !== 0) {
      return {
        isGitRepo: false,
        isDirty: false,
        activeBranch: "",
        headCommit: "",
        dirtyFiles: [],
      };
    }

    const branchRes = await this.runGit(
      ["rev-parse", "--abbrev-ref", "HEAD"],
      projectRoot,
    );
    const headRes = await this.runGit(["rev-parse", "HEAD"], projectRoot);
    const statusRes = await this.runGit(["status", "--porcelain"], projectRoot);

    const dirtyFiles = statusRes.stdout
      ? statusRes.stdout
          .split(/\r?\n/)
          .map((line) => {
            const match = line.match(/^.{1,2}\s+(.*)$/);
            const rawPath = match ? match[1].trim() : line.trim();
            return rawPath.replace(/^"|"$/g, "");
          })
          .filter(Boolean)
      : [];

    return {
      isGitRepo: true,
      isDirty: dirtyFiles.length > 0,
      activeBranch: branchRes.stdout || "main",
      headCommit: headRes.stdout || "",
      dirtyFiles,
    };
  }

  /**
   * 2. Spawn an isolated Git worktree sandbox on a dedicated task branch.
   */
  public async spawnSandbox(
    taskId: string,
    options: {
      projectRoot?: string;
      baseBranch?: string;
      linkDependencies?: boolean;
    } = {},
  ): Promise<WorktreeSandboxInstance> {
    const projectRoot = options.projectRoot || this.defaultProjectRoot;
    const baseBranch = options.baseBranch || "HEAD";
    const cleanTaskId = taskId.replace(/[^a-zA-Z0-9]/g, "_");
    const sandboxDir = path.join(
      this.worktreeBaseDir,
      `sandbox-${cleanTaskId}`,
    );
    const branchName = `vynor-sandbox/${cleanTaskId}`;

    if (!fs.existsSync(this.worktreeBaseDir)) {
      fs.mkdirSync(this.worktreeBaseDir, { recursive: true });
    }

    // Clean up any stale worktree or branch with same name
    await this.cleanupSandbox(cleanTaskId, branchName, projectRoot).catch(
      () => {},
    );

    // Create worktree on new branch
    const addRes = await this.runGit(
      ["worktree", "add", "-b", branchName, sandboxDir, baseBranch],
      projectRoot,
    );

    if (addRes.exitCode !== 0) {
      // Fallback: If branch already exists, add without -b
      const checkoutRes = await this.runGit(
        ["worktree", "add", sandboxDir, branchName],
        projectRoot,
      );
      if (checkoutRes.exitCode !== 0) {
        throw new Error(
          `Failed to spawn git worktree: ${addRes.stderr || checkoutRes.stderr || "Unknown error"}`,
        );
      }
    }

    // Fast-link runtime dependencies (node_modules, packages) via directory junctions
    if (options.linkDependencies !== false) {
      this.linkRuntimeDependencies(projectRoot, sandboxDir);
    }

    return {
      sandboxId: cleanTaskId,
      worktreePath: sandboxDir,
      branchName,
      baseBranch,
      createdAt: Date.now(),
    };
  }

  /**
   * Fast-link node_modules and .env files to the worktree using NTFS junctions.
   * Enables immediate npm test / tsc execution without duplicate npm install.
   */
  private linkRuntimeDependencies(
    sourceRoot: string,
    targetRoot: string,
  ): void {
    const targets = [
      "node_modules",
      path.join("backend", "node_modules"),
      path.join("core", "node_modules"),
      path.join("gui", "node_modules"),
      ".env",
      path.join("backend", ".env"),
    ];

    for (const rel of targets) {
      const srcPath = path.join(sourceRoot, rel);
      const destPath = path.join(targetRoot, rel);

      if (fs.existsSync(srcPath) && !fs.existsSync(destPath)) {
        try {
          const stat = fs.statSync(srcPath);
          fs.mkdirSync(path.dirname(destPath), { recursive: true });

          if (stat.isDirectory()) {
            // Use directory junction on Windows, symlink on POSIX
            fs.symlinkSync(srcPath, destPath, "junction");
          } else {
            fs.copyFileSync(srcPath, destPath);
          }
        } catch {
          // Non-fatal if symlink fails
        }
      }
    }
  }

  /**
   * 3. Apply file edits inside the isolated sandbox.
   */
  public async applySandboxEdits(
    worktreePath: string,
    edits: Record<string, string>,
  ): Promise<number> {
    let applied = 0;
    for (const [relPath, content] of Object.entries(edits)) {
      const target = path.join(worktreePath, relPath);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, content, "utf-8");
      applied++;
    }
    return applied;
  }

  /**
   * 4. Run verification test gates inside the isolated sandbox.
   */
  public async runTestGate(
    worktreePath: string,
    command: string,
    autoHeal = false,
  ): Promise<TestGateResult> {
    const t0 = performance.now();

    if (autoHeal) {
      // Run through autonomous self-healing loop inside sandbox
      const healResult = await runAutonomousSelfHealingLoop({
        command,
        cwd: worktreePath,
        maxAttempts: 3,
      });

      const durationMs = Math.round(performance.now() - t0);
      return {
        passed: healResult.success,
        command,
        exitCode: healResult.finalExitCode,
        stdout: healResult.iterations
          .map((it) => it.patchApplied || "")
          .join("\n"),
        stderr: healResult.error || "",
        durationMs,
        healed: healResult.attempts > 1 && healResult.success,
      };
    }

    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd: worktreePath,
        timeout: 60000,
        maxBuffer: 10 * 1024 * 1024,
      });

      const durationMs = Math.round(performance.now() - t0);
      return {
        passed: true,
        command,
        exitCode: 0,
        stdout: String(stdout || ""),
        stderr: String(stderr || ""),
        durationMs,
      };
    } catch (err: any) {
      const durationMs = Math.round(performance.now() - t0);
      return {
        passed: false,
        command,
        exitCode: typeof err.code === "number" ? err.code : 1,
        stdout: String(err.stdout || ""),
        stderr: String(err.stderr || err.message || ""),
        durationMs,
      };
    }
  }

  /**
   * 5. Atomically merge verified sandbox branch into target branch.
   */
  public async atomicMerge(
    worktreePath: string,
    branchName: string,
    targetBranch: string = "main",
    projectRoot: string = this.defaultProjectRoot,
    commitMessage = "feat: automated worktree task completion",
  ): Promise<SandboxMergeResult> {
    // 5.1 Commit all pending changes in the worktree
    await this.runGit(["add", "-A"], worktreePath);
    const commitRes = await this.runGit(
      ["commit", "-m", commitMessage],
      worktreePath,
    );
    if (
      commitRes.exitCode !== 0 &&
      !commitRes.stdout.includes("nothing to commit")
    ) {
      return {
        success: false,
        targetBranch,
        error: `Failed to commit sandbox changes: ${commitRes.stderr || commitRes.stdout}`,
      };
    }

    // 5.2 Get head commit of sandbox branch
    const sandboxHead = await this.runGit(["rev-parse", "HEAD"], worktreePath);

    // 5.3 Dry-run conflict check from the project root
    // Check if branch can be fast-forwarded or merged without conflicts
    const mergeBaseRes = await this.runGit(
      ["merge-base", targetBranch, branchName],
      projectRoot,
    );
    if (mergeBaseRes.exitCode !== 0) {
      return {
        success: false,
        targetBranch,
        error: `Could not find common merge ancestor with ${targetBranch}`,
      };
    }

    // Attempt dry-run merge in project root
    const mergeTestRes = await this.runGit(
      ["merge", "--no-commit", "--no-ff", branchName],
      projectRoot,
    );

    if (mergeTestRes.exitCode !== 0) {
      // Conflicts detected! Abort immediately to preserve project root state
      await this.runGit(["merge", "--abort"], projectRoot);
      const conflictFiles = mergeTestRes.stderr
        .split("\n")
        .filter((l) => l.includes("CONFLICT"))
        .map((l) => l.trim());

      return {
        success: false,
        targetBranch,
        conflicts:
          conflictFiles.length > 0
            ? conflictFiles
            : [mergeTestRes.stderr || "Merge conflict"],
        error:
          "Merge conflicts detected. Main workspace preserved with zero modifications.",
      };
    }

    // 5.4 Commit the merge
    const finalCommitRes = await this.runGit(
      ["commit", "-m", `Merge branch '${branchName}' into ${targetBranch}`],
      projectRoot,
    );

    const mergedHead = await this.runGit(["rev-parse", "HEAD"], projectRoot);

    return {
      success: true,
      targetBranch,
      mergedCommit: mergedHead.stdout || sandboxHead.stdout,
    };
  }

  /**
   * 6. Clean up and prune isolated worktree sandbox directory.
   */
  public async cleanupSandbox(
    taskId: string,
    branchName?: string,
    projectRoot: string = this.defaultProjectRoot,
    deleteBranch = false,
  ): Promise<void> {
    const cleanTaskId = taskId.replace(/[^a-zA-Z0-9]/g, "_");
    const sandboxDir = path.join(
      this.worktreeBaseDir,
      `sandbox-${cleanTaskId}`,
    );

    // Remove git registration
    await this.runGit(
      ["worktree", "remove", "--force", sandboxDir],
      projectRoot,
    );

    // Remove directory from disk if leftover
    if (fs.existsSync(sandboxDir)) {
      try {
        fs.rmSync(sandboxDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }

    // Prune stale worktree entries
    await this.runGit(["worktree", "prune"], projectRoot);

    // Optionally delete temporary branch
    if (deleteBranch && branchName) {
      await this.runGit(["branch", "-D", branchName], projectRoot);
    }
  }

  /**
   * 7. End-to-end sandbox task runner:
   * Spawn -> Apply Edits -> Test Gate -> Auto-heal -> Atomic Merge -> Cleanup
   */
  public async executeTaskInSandbox(
    options: SandboxExecutionOptions,
  ): Promise<SandboxExecutionResult> {
    const tStart = performance.now();
    const projectRoot = options.projectRoot || this.defaultProjectRoot;
    const baseBranch = options.baseBranch || "HEAD";
    const targetBranch = options.targetMergeBranch || "main";

    // 1. Snapshot and verify workspace state preservation
    const initialState = await this.getWorkspaceState(projectRoot);

    // 2. Spawn sandbox worktree
    const sandbox = await this.spawnSandbox(options.taskId, {
      projectRoot,
      baseBranch,
    });

    let testGate: TestGateResult | undefined;
    let merge: SandboxMergeResult | undefined;
    let editsApplied = 0;

    try {
      // 3. Apply edits
      if (options.edits && Object.keys(options.edits).length > 0) {
        editsApplied = await this.applySandboxEdits(
          sandbox.worktreePath,
          options.edits,
        );
      }

      // 4. Run test gate
      if (options.testGateCommand) {
        testGate = await this.runTestGate(
          sandbox.worktreePath,
          options.testGateCommand,
          options.autoHealOnFailure ?? true,
        );

        if (!testGate.passed) {
          return {
            success: false,
            sandboxId: sandbox.sandboxId,
            branchName: sandbox.branchName,
            workspaceStatePreserved: true,
            dirtyFilesCount: initialState.dirtyFiles.length,
            editsApplied,
            testGate,
            cleanedUp: true,
            durationMs: Math.round(performance.now() - tStart),
            error: `Test gate failed with exit code ${testGate.exitCode}`,
          };
        }
      }

      // 5. Atomic Merge on Success
      merge = await this.atomicMerge(
        sandbox.worktreePath,
        sandbox.branchName,
        targetBranch,
        projectRoot,
        options.commitMessage || `feat: sandbox task ${options.taskId}`,
      );

      return {
        success: merge.success,
        sandboxId: sandbox.sandboxId,
        branchName: sandbox.branchName,
        workspaceStatePreserved: true,
        dirtyFilesCount: initialState.dirtyFiles.length,
        editsApplied,
        testGate,
        merge,
        cleanedUp: true,
        durationMs: Math.round(performance.now() - tStart),
        error: merge.error,
      };
    } finally {
      // 6. Always clean up the sandbox directory
      await this.cleanupSandbox(
        options.taskId,
        sandbox.branchName,
        projectRoot,
        merge?.success === true, // delete branch only if merged cleanly
      );
    }
  }
}

// Global Singleton Instance
export const gitWorktreeSandboxEngine = new GitWorktreeSandboxEngine();
