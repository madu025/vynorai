/**
 * Worktree Manager
 *
 * Manages isolated Git worktrees so the autonomous maintenance swarm can
 * reproduce bugs, edit files, and run tests in complete isolation without
 * touching the developer's working tree or active IDE branch.
 */

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

export interface WorktreeInstance {
  id: string;
  path: string;
  branch: string;
  baseBranch: string;
}

export class WorktreeManager {
  constructor(
    private readonly projectRoot: string,
    private readonly worktreeBaseDir: string = path.join(
      projectRoot,
      ".vynor-worktrees",
    ),
  ) {}

  /**
   * Run a git command in the main project root or inside a worktree.
   */
  private async runGit(
    args: string[],
    cwd: string = this.projectRoot,
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return new Promise((resolve) => {
      const child = spawn("git", args, { cwd, shell: false });
      let stdout = "";
      let stderr = "";

      child.stdout.on("data", (d) => (stdout += d.toString()));
      child.stderr.on("data", (d) => (stderr += d.toString()));

      child.on("close", (exitCode) => {
        resolve({ stdout, stderr, exitCode: exitCode ?? 1 });
      });
      child.on("error", (err) => {
        resolve({ stdout, stderr: err.message, exitCode: 1 });
      });
    });
  }

  /**
   * Check if the current project root is an initialized Git repository.
   */
  async isGitRepository(): Promise<boolean> {
    const res = await this.runGit(["rev-parse", "--is-inside-work-tree"]);
    return res.exitCode === 0 && res.stdout.trim() === "true";
  }

  /**
   * Check if the Git repository has at least one committed revision (HEAD).
   */
  async hasCommits(): Promise<boolean> {
    const res = await this.runGit(["rev-parse", "--verify", "HEAD"]);
    return res.exitCode === 0;
  }

  /**
   * Create an isolated worktree for a specific maintenance task.
   */
  async createWorktree(
    taskId: string,
    branchName: string,
    baseBranch = "main",
  ): Promise<WorktreeInstance> {
    await fs.mkdir(this.worktreeBaseDir, { recursive: true });
    const targetDir = path.join(this.worktreeBaseDir, taskId);

    // Ensure branch or worktree directory doesn't already exist
    await this.removeWorktree(taskId, branchName).catch(() => {});

    // git worktree add -b <branchName> <targetDir> <baseBranch>
    const addResult = await this.runGit([
      "worktree",
      "add",
      "-b",
      branchName,
      targetDir,
      baseBranch,
    ]);

    if (addResult.exitCode !== 0) {
      // Fallback: If branch already exists, checkout existing branch
      const checkoutResult = await this.runGit([
        "worktree",
        "add",
        targetDir,
        branchName,
      ]);
      if (checkoutResult.exitCode !== 0) {
        throw new Error(
          `Failed to create git worktree: ${addResult.stderr || checkoutResult.stderr || "Unknown error"}`,
        );
      }
    }

    return {
      id: taskId,
      path: targetDir,
      branch: branchName,
      baseBranch,
    };
  }

  /**
   * Clean up and remove an isolated worktree after task completion or failure.
   */
  async removeWorktree(
    taskId: string,
    branchName?: string,
    keepBranch = true,
  ): Promise<void> {
    const targetDir = path.join(this.worktreeBaseDir, taskId);

    // Remove worktree from git registration
    await this.runGit(["worktree", "remove", "--force", targetDir]);

    // Ensure folder is cleaned up from disk if leftover
    await fs.rm(targetDir, { recursive: true, force: true }).catch(() => {});

    // Prune stale worktrees
    await this.runGit(["worktree", "prune"]);

    if (!keepBranch && branchName) {
      await this.runGit(["branch", "-D", branchName]).catch(() => {});
    }
  }

  /**
   * Commit all changes in the worktree and create a formatted commit.
   */
  async commitChanges(worktreePath: string, message: string): Promise<boolean> {
    const addResult = await this.runGit(["add", "-A"], worktreePath);
    if (addResult.exitCode !== 0) return false;

    const commitResult = await this.runGit(
      ["commit", "-m", message],
      worktreePath,
    );
    return commitResult.exitCode === 0;
  }

  /**
   * Get git diff statistics in the worktree.
   */
  async getDiffStats(
    worktreePath: string,
    baseBranch = "main",
  ): Promise<{
    filesChanged: number;
    additions: number;
    deletions: number;
    diff: string;
  }> {
    const diffResult = await this.runGit(
      ["diff", `${baseBranch}...HEAD`],
      worktreePath,
    );
    const statResult = await this.runGit(
      ["diff", "--shortstat", `${baseBranch}...HEAD`],
      worktreePath,
    );

    let filesChanged = 0;
    let additions = 0;
    let deletions = 0;

    const statMatch = statResult.stdout.match(
      /(\d+) files? changed(?:, (\d+) insertions?\(\+\))?(?:, (\d+) deletions?\(-\))?/,
    );
    if (statMatch) {
      filesChanged = parseInt(statMatch[1] || "0", 10);
      additions = parseInt(statMatch[2] || "0", 10);
      deletions = parseInt(statMatch[3] || "0", 10);
    }

    return {
      filesChanged,
      additions,
      deletions,
      diff: diffResult.stdout,
    };
  }

  /**
   * Get the remote URL (e.g. https://github.com/owner/repo.git or git@github.com:owner/repo.git).
   */
  async getRemoteUrl(remote = "origin"): Promise<string | null> {
    const result = await this.runGit(["remote", "get-url", remote]);
    if (result.exitCode === 0 && result.stdout.trim()) {
      return result.stdout.trim();
    }
    return null;
  }

  /**
   * Push a local worktree branch to the git remote.
   */
  async pushBranch(
    branchName: string,
    remote = "origin",
    worktreePath: string = this.projectRoot,
    force = false,
  ): Promise<{ success: boolean; error?: string }> {
    const args = ["push", "-u", remote, branchName];
    if (force) args.push("--force");

    const result = await this.runGit(args, worktreePath);
    if (result.exitCode === 0) {
      return { success: true };
    }
    return {
      success: false,
      error:
        result.stderr || result.stdout || "Failed to push branch to remote",
    };
  }
}
