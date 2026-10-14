import { describe, expect, it } from "vitest";
import { WorktreeManager } from "./WorktreeManager";

describe("WorktreeManager isolation guards", () => {
  it("rejects traversal task IDs and invalid refs before invoking git", async () => {
    const manager = new WorktreeManager(
      "/workspace/project",
      "/tmp/vynor-worktrees",
    );
    await expect(
      manager.createWorktree("../escape", "vynor/task", "main"),
    ).rejects.toThrow("INVALID_WORKTREE_TASK_ID");
    await expect(
      manager.createWorktree("task-1", "vynor/../escape", "main"),
    ).rejects.toThrow("INVALID_WORKTREE_BRANCH");
  });

  it("rejects paths outside the disposable worktree root", async () => {
    const manager = new WorktreeManager(
      "/workspace/project",
      "/tmp/vynor-worktrees",
    );
    await expect(
      manager.commitChanges("/workspace/project", "test"),
    ).rejects.toThrow("WORKTREE_PATH_OUTSIDE_SANDBOX");
    await expect(
      manager.getDiffStats("/tmp/vynor-worktrees/../project", "main"),
    ).rejects.toThrow("WORKTREE_PATH_OUTSIDE_SANDBOX");
  });

  it("does not allow the developer root to be the worktree root", () => {
    expect(
      () => new WorktreeManager("/workspace/project", "/workspace/project"),
    ).toThrow("WORKTREE_BASE_MUST_BE_ISOLATED");
  });
});
