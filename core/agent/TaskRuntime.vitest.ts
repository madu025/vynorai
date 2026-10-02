import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { afterEach, describe, expect, it } from "vitest";

import { TaskRuntime } from "./TaskRuntime";
import { redactSecrets } from "./redactSecrets";

const temporaryDirectories: string[] = [];

function createRuntime(): { runtime: TaskRuntime; directory: string } {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "vynor-task-test-"));
  temporaryDirectories.push(directory);
  return { runtime: new TaskRuntime(directory), directory };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("TaskRuntime", () => {
  it("persists a resumable task without storing the raw goal", async () => {
    const { runtime, directory } = createRuntime();
    const goal = "Fix billing with api_key=super-secret-value";

    const task = await runtime.start({
      sessionId: "session-1",
      workspaceId: "workspace-1",
      workspaceRevision: 4,
      goal,
    });
    const restored = new TaskRuntime(directory).get(task.id);
    const persisted = fs.readFileSync(
      path.join(directory, `${task.id}.json`),
      "utf8",
    );

    expect(restored?.id).toBe(task.id);
    expect(restored?.state).toBe("gathering");
    expect(persisted).not.toContain(goal);
    expect(persisted).not.toContain("super-secret-value");
  });

  it("enforces state transitions and stores approval/verification receipts", async () => {
    const { runtime } = createRuntime();
    const task = await runtime.start({
      sessionId: "session-1",
      workspaceId: "workspace-1",
      workspaceRevision: 1,
      goal: "Implement safely",
    });

    await runtime.transition(task.id, "awaiting_approval");
    await runtime.recordApproval({
      taskId: task.id,
      toolCallId: "call-1",
      toolName: "multi_edit",
      risk: "R2",
      decision: "approved",
      scope: "src/private.ts",
    });
    await runtime.transition(task.id, "executing");
    await runtime.consumeBudget(task.id, {
      inputTokens: 1200,
      outputTokens: 300,
      costUsd: 0.02,
    });
    await runtime.transition(task.id, "verifying");
    await runtime.recordVerification(task.id, {
      kind: "test",
      status: "passed",
      summary: "12 tests passed",
    });
    const completed = await runtime.transition(task.id, "completed");

    expect(completed.approvals).toHaveLength(1);
    expect(completed.verification).toHaveLength(1);
    expect(completed.budget.inputTokens).toBe(1200);
    await expect(runtime.transition(task.id, "executing")).rejects.toThrow(
      "Invalid task transition",
    );
  });

  it("serializes concurrent transitions instead of corrupting state", async () => {
    const { runtime } = createRuntime();
    const task = await runtime.start({
      sessionId: "session-1",
      workspaceId: "workspace-1",
      workspaceRevision: 1,
      goal: "Race test",
    });

    const results = await Promise.allSettled([
      runtime.transition(task.id, "planning"),
      runtime.transition(task.id, "completed"),
    ]);

    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
  });

  it("blocks mutation completion when only a model response was recorded", async () => {
    const { runtime } = createRuntime();
    const task = await runtime.start({
      sessionId: "session-1",
      workspaceId: "workspace-1",
      workspaceRevision: 1,
      goal: "Edit a production file",
    });
    await runtime.transition(task.id, "executing");
    await runtime.recordApproval({
      taskId: task.id,
      toolCallId: "call-edit",
      toolName: "multi_edit",
      risk: "R2",
      decision: "approved",
      scope: "src/app.ts",
    });
    await runtime.transition(task.id, "verifying");
    await runtime.recordVerification(task.id, {
      kind: "response",
      status: "passed",
      summary: "The model said the edit was complete",
    });

    await expect(runtime.transition(task.id, "completed")).rejects.toThrow(
      "Mutation task cannot complete without passed",
    );
  });
});

describe("redactSecrets", () => {
  it("redacts common credentials before journal persistence", () => {
    const value = redactSecrets(
      "Authorization: Bearer abcdefghijklmnop api_key=very-secret-value AKIA1234567890ABCDEF",
    );

    expect(value).not.toContain("abcdefghijklmnop");
    expect(value).not.toContain("very-secret-value");
    expect(value).not.toContain("AKIA1234567890ABCDEF");
  });
});
