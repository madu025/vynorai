import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { afterEach, describe, expect, it } from "vitest";

import { TaskRuntime } from "./TaskRuntime";
import { redactSecrets } from "./redactSecrets";
import { BuiltInToolNames } from "../tools/builtIn";

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

  it("continues journal sequence numbers after a runtime restart", async () => {
    const { runtime, directory } = createRuntime();
    const task = await runtime.start({
      sessionId: "session-1",
      workspaceId: "workspace-1",
      workspaceRevision: 1,
      goal: "Crash recovery",
    });
    await runtime.transition(task.id, "planning");
    const restarted = new TaskRuntime(directory);
    await restarted.transition(task.id, "executing");
    const events = fs
      .readFileSync(path.join(directory, `${task.id}.events.jsonl`), "utf8")
      .trim()
      .split(/\r?\n/)
      .map((line) => JSON.parse(line));
    expect(events.map((event) => event.sequence)).toEqual([1, 2, 3]);
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

describe("implementation subagents", () => {
  it("persists least-privilege scope without storing the objective", async () => {
    const { runtime, directory } = createRuntime();
    const task = await runtime.start({
      sessionId: "session-1",
      workspaceId: "workspace-1",
      workspaceRevision: 1,
      goal: "Parent task",
    });
    const objective = "Fix token=private-value in the frontend";
    const subagent = await runtime.createSubagent({
      taskId: task.id,
      role: "frontend",
      objective,
      authority: { read: true, write: true, command: true, network: false },
      fileScope: ["gui/src"],
      budget: {
        maxInputTokens: 10_000,
        maxOutputTokens: 2_000,
        maxCostUsd: 0.5,
      },
    });
    const persisted = fs.readFileSync(
      path.join(directory, `${task.id}.json`),
      "utf8",
    );
    expect(subagent.fileScope).toEqual(["gui/src"]);
    expect(persisted).not.toContain(objective);
    expect(persisted).not.toContain("private-value");
  });

  it("prevents concurrent ownership of overlapping write scopes", async () => {
    const { runtime } = createRuntime();
    const task = await runtime.start({
      sessionId: "s",
      workspaceId: "w",
      workspaceRevision: 1,
      goal: "Parallel work",
    });
    const authority = {
      read: true,
      write: true,
      command: false,
      network: false,
    };
    const first = await runtime.createSubagent({
      taskId: task.id,
      role: "frontend",
      objective: "Edit UI",
      authority,
      fileScope: ["gui/src"],
      budget: {
        maxInputTokens: 20_000,
        maxOutputTokens: 3_000,
        maxCostUsd: 0.5,
      },
    });
    const second = await runtime.createSubagent({
      taskId: task.id,
      role: "qa",
      objective: "Edit UI tests",
      authority,
      fileScope: ["gui/src/tests"],
      budget: {
        maxInputTokens: 20_000,
        maxOutputTokens: 3_000,
        maxCostUsd: 0.5,
      },
    });
    await runtime.startSubagent(task.id, first.id);
    await expect(runtime.startSubagent(task.id, second.id)).rejects.toThrow(
      "owned by running subagent",
    );
  });

  it("rejects traversal, out-of-scope edits, and unevidenced handoffs", async () => {
    const { runtime } = createRuntime();
    const task = await runtime.start({
      sessionId: "s",
      workspaceId: "w",
      workspaceRevision: 1,
      goal: "Safe implementation",
    });
    await expect(
      runtime.createSubagent({
        taskId: task.id,
        role: "backend",
        objective: "Escape",
        authority: { read: true, write: true, command: false, network: false },
        fileScope: ["../outside"],
      }),
    ).rejects.toThrow("workspace-relative");
    const subagent = await runtime.createSubagent({
      taskId: task.id,
      role: "backend",
      objective: "API change",
      authority: { read: true, write: true, command: true, network: false },
      fileScope: ["backend/src"],
    });
    await runtime.startSubagent(task.id, subagent.id);
    await expect(
      runtime.completeSubagent({
        taskId: task.id,
        subagentId: subagent.id,
        summary: "done",
        changedFiles: ["core/secrets.ts"],
        verification: [],
      }),
    ).rejects.toThrow("outside its delegated scope");
    await expect(
      runtime.completeSubagent({
        taskId: task.id,
        subagentId: subagent.id,
        summary: "done",
        changedFiles: ["backend/src/api.ts"],
        verification: [],
      }),
    ).rejects.toThrow("requires passed verification");
  });

  it("enforces capabilities and charges usage to child and parent", async () => {
    const { runtime } = createRuntime();
    const task = await runtime.start({
      sessionId: "s",
      workspaceId: "w",
      workspaceRevision: 1,
      goal: "Delegated work",
      budget: { maxInputTokens: 20_000, maxOutputTokens: 5_000, maxCostUsd: 1 },
    });
    const subagent = await runtime.createSubagent({
      taskId: task.id,
      role: "security",
      objective: "Review auth",
      authority: { read: true, write: false, command: false, network: false },
      fileScope: ["backend/src/auth"],
      budget: {
        maxInputTokens: 5_000,
        maxOutputTokens: 1_000,
        maxCostUsd: 0.2,
      },
    });
    await runtime.startSubagent(task.id, subagent.id);
    expect(
      runtime.authorizeSubagentAction({
        taskId: task.id,
        subagentId: subagent.id,
        capability: "read",
        resource: "backend/src/auth/jwt.ts",
      }),
    ).toBe(true);
    expect(() =>
      runtime.authorizeSubagentAction({
        taskId: task.id,
        subagentId: subagent.id,
        capability: "write",
        resource: "backend/src/auth/jwt.ts",
      }),
    ).toThrow("lacks write authority");
    expect(() =>
      runtime.authorizeSubagentAction({
        taskId: task.id,
        subagentId: subagent.id,
        capability: "read",
        resource: "core/secrets.ts",
      }),
    ).toThrow("outside its delegated scope");
    expect(
      runtime.authorizeSubagentTool({
        taskId: task.id,
        subagentId: subagent.id,
        toolName: BuiltInToolNames.ReadFile,
        args: { filepath: "backend/src/auth/session.ts" },
      }),
    ).toBe(true);
    expect(() =>
      runtime.authorizeSubagentTool({
        taskId: task.id,
        subagentId: subagent.id,
        toolName: BuiltInToolNames.GrepSearch,
        args: { query: "secret" },
      }),
    ).toThrow("outside its delegated scope");
    await runtime.consumeSubagentBudget(task.id, subagent.id, {
      inputTokens: 100,
      outputTokens: 20,
      costUsd: 0.01,
    });
    expect(runtime.get(task.id)?.budget.inputTokens).toBe(100);
  });

  it("enforces dependency order, stale revisions, and deterministic merge order", async () => {
    const { runtime } = createRuntime();
    const task = await runtime.start({
      sessionId: "s",
      workspaceId: "w",
      workspaceRevision: 9,
      goal: "Ordered delegated implementation",
    });
    const authority = {
      read: true,
      write: true,
      command: false,
      network: false,
    };
    const first = await runtime.createSubagent({
      taskId: task.id,
      role: "backend",
      objective: "Implement API",
      authority,
      fileScope: ["backend/src"],
      budget: {
        maxInputTokens: 10_000,
        maxOutputTokens: 2_000,
        maxCostUsd: 0.2,
      },
    });
    const second = await runtime.createSubagent({
      taskId: task.id,
      role: "qa",
      objective: "Add API tests",
      authority,
      fileScope: ["backend/src"],
      dependsOn: [first.id],
      budget: {
        maxInputTokens: 10_000,
        maxOutputTokens: 2_000,
        maxCostUsd: 0.2,
      },
    });
    await expect(runtime.startSubagent(task.id, second.id, 9)).rejects.toThrow(
      "dependency",
    );
    await expect(runtime.startSubagent(task.id, first.id, 10)).rejects.toThrow(
      "Workspace changed",
    );
    await runtime.startSubagent(task.id, first.id, 9);
    const verification = [
      {
        id: "verification-1",
        kind: "test" as const,
        status: "passed" as const,
        summary: "tests passed",
        createdAt: Date.now(),
      },
    ];
    await runtime.completeSubagent({
      taskId: task.id,
      subagentId: first.id,
      summary: "API implemented",
      changedFiles: ["backend/src/api.ts"],
      verification,
      workspaceRevision: 9,
    });
    await runtime.startSubagent(task.id, second.id, 9);
    await runtime.completeSubagent({
      taskId: task.id,
      subagentId: second.id,
      summary: "API tests implemented",
      changedFiles: ["backend/src/api.ts"],
      verification,
      workspaceRevision: 9,
    });
    expect(
      runtime.getSubagentMergeQueue(task.id).map((item) => item.id),
    ).toEqual([first.id, second.id]);
  });

  it("rejects overlapping completed handoffs without an explicit dependency", async () => {
    const { runtime } = createRuntime();
    const task = await runtime.start({
      sessionId: "s",
      workspaceId: "w",
      workspaceRevision: 1,
      goal: "Detect merge conflicts",
    });
    const create = (objective: string) =>
      runtime.createSubagent({
        taskId: task.id,
        role: "backend",
        objective,
        authority: { read: true, write: true, command: false, network: false },
        fileScope: ["core/agent"],
        budget: {
          maxInputTokens: 10_000,
          maxOutputTokens: 2_000,
          maxCostUsd: 0.2,
        },
      });
    const first = await create("First change");
    const second = await create("Conflicting change");
    const verification = [
      {
        id: "v",
        kind: "review" as const,
        status: "passed" as const,
        summary: "reviewed",
        createdAt: Date.now(),
      },
    ];
    await runtime.startSubagent(task.id, first.id);
    await runtime.completeSubagent({
      taskId: task.id,
      subagentId: first.id,
      summary: "done",
      changedFiles: ["core/agent/types.ts"],
      verification,
    });
    await runtime.startSubagent(task.id, second.id);
    await expect(
      runtime.completeSubagent({
        taskId: task.id,
        subagentId: second.id,
        summary: "done",
        changedFiles: ["core/agent/types.ts"],
        verification,
      }),
    ).rejects.toThrow("without an explicit dependency");
  });
});
