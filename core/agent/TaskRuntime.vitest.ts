import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { afterEach, describe, expect, it } from "vitest";

import { TaskRuntime } from "./TaskRuntime";
import { redactSecrets } from "./redactSecrets";
import { BuiltInToolNames } from "../tools/builtIn";
import { draftCompletionContract } from "./completionContract";

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
  it("keeps simple tasks light without making edited work inspection-only", () => {
    const contract = draftCompletionContract({
      scope: "simple",
      confidence: 0.95,
      impliedDeliverables: ["bounded fix"],
    });

    expect(contract.criteria[0].evidencePolicy).toEqual(["focused_check"]);
  });

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

  it("requires fresh criterion evidence before a contract task can complete", async () => {
    const { runtime } = createRuntime();
    const task = await runtime.start({
      sessionId: "s",
      workspaceId: "w",
      workspaceRevision: 1,
      goal: "Contract task",
      contract: draftCompletionContract({
        scope: "medium",
        confidence: 0.9,
        impliedDeliverables: ["public API works"],
      }),
    });
    await runtime.transition(task.id, "executing");
    await runtime.recordMutation(task.id, ["src/index.ts"]);
    await runtime.transition(task.id, "verifying");
    await expect(runtime.transition(task.id, "completed")).rejects.toThrow(
      "Completion contract is missing fresh passed evidence",
    );
    await runtime.recordEvidence(task.id, {
      criterionId: "public-api-works",
      kind: "test",
      status: "passed",
      summary: "Focused API test passed",
    });
    const completed = await runtime.transition(task.id, "completed");
    expect(completed.contract?.criteria[0].status).toBe("passed");
  });

  it("stales passed evidence after a later mutation", async () => {
    const { runtime } = createRuntime();
    const task = await runtime.start({
      sessionId: "s",
      workspaceId: "w",
      workspaceRevision: 1,
      goal: "Stale evidence",
      contract: draftCompletionContract({
        scope: "simple",
        confidence: 1,
        impliedDeliverables: ["focused fix"],
      }),
    });
    await runtime.recordMutation(task.id, ["src/fix.ts"]);
    await runtime.recordEvidence(task.id, {
      criterionId: "focused-fix",
      kind: "test",
      status: "passed",
      summary: "Passed before the next edit",
    });
    await runtime.recordMutation(task.id, ["src/other.ts"]);
    expect(runtime.get(task.id)?.contract?.criteria[0].status).toBe("stale");
    await runtime.transition(task.id, "verifying");
    await expect(runtime.transition(task.id, "completed")).rejects.toThrow(
      "Completion contract is missing fresh passed evidence",
    );
  });

  it("records explicit criterion correction and skip decisions", async () => {
    const { runtime } = createRuntime();
    const task = await runtime.start({
      sessionId: "s",
      workspaceId: "w",
      workspaceRevision: 1,
      goal: "Decision receipts",
      contract: draftCompletionContract({
        scope: "medium",
        confidence: 0.8,
        impliedDeliverables: ["original outcome", "optional outcome"],
      }),
    });
    await runtime.recordCriterionDecision({
      taskId: task.id,
      criterionId: "original-outcome",
      decision: "corrected",
      statement: "Corrected outcome is verified",
      reason: "User clarified the intended result",
    });
    await runtime.recordCriterionDecision({
      taskId: task.id,
      criterionId: "optional-outcome",
      decision: "skipped",
      reason: "User explicitly deferred this outcome",
    });
    const current = runtime.get(task.id)!;
    expect(current.criterionDecisions).toHaveLength(2);
    expect(current.contract?.criteria[0].provenance).toBe("user_explicit");
    expect(current.contract?.criteria[1].status).toBe("user_skipped");
  });

  it("allows completion only after every skipped criterion has an explicit receipt", async () => {
    const { runtime } = createRuntime();
    const task = await runtime.start({
      sessionId: "s",
      workspaceId: "w",
      workspaceRevision: 1,
      goal: "Explicit skips",
      contract: draftCompletionContract({
        scope: "simple",
        confidence: 1,
        impliedDeliverables: ["outcome one", "outcome two"],
      }),
    });
    await runtime.recordCriterionDecision({
      taskId: task.id,
      criterionId: "outcome-one",
      decision: "skipped",
      reason: "User approved deferral",
    });
    await runtime.recordCriterionDecision({
      taskId: task.id,
      criterionId: "outcome-two",
      decision: "skipped",
      reason: "User approved deferral",
    });
    await runtime.transition(task.id, "verifying");
    const completed = await runtime.transition(task.id, "completed");
    expect(
      completed.contract?.criteria.every(
        (item) => item.status === "user_skipped",
      ),
    ).toBe(true);
  });

  it("rejects absolute paths from persisted contract evidence text", async () => {
    const { runtime } = createRuntime();
    await expect(
      runtime.start({
        sessionId: "s",
        workspaceId: "w",
        workspaceRevision: 1,
        goal: "Unsafe criterion",
        contract: {
          ...draftCompletionContract({
            scope: "simple",
            confidence: 1,
            impliedDeliverables: ["C:\\Users\\USER\\secret.txt"],
          }),
        },
      }),
    ).rejects.toThrow("absolute path");
  });

  it("upgrades a legacy journal without adding a contract", async () => {
    const { runtime, directory } = createRuntime();
    const task = await runtime.start({
      sessionId: "s",
      workspaceId: "w",
      workspaceRevision: 1,
      goal: "Legacy task",
    });
    const file = path.join(directory, `${task.id}.json`);
    const legacy = JSON.parse(fs.readFileSync(file, "utf8"));
    delete legacy.schemaVersion;
    delete legacy.evidence;
    delete legacy.mutationGeneration;
    fs.writeFileSync(file, JSON.stringify(legacy));
    const restored = new TaskRuntime(directory).get(task.id);
    expect(restored?.schemaVersion).toBe(2);
    expect(restored?.contract).toBeUndefined();
    expect(restored?.evidence).toEqual([]);
    expect(JSON.parse(fs.readFileSync(file, "utf8")).schemaVersion).toBe(2);
  });

  it("fails safe on an unknown newer journal schema and supports deletion", async () => {
    const { runtime, directory } = createRuntime();
    const task = await runtime.start({
      sessionId: "s",
      workspaceId: "w",
      workspaceRevision: 1,
      goal: "Schema task",
    });
    const file = path.join(directory, `${task.id}.json`);
    const newer = JSON.parse(fs.readFileSync(file, "utf8"));
    newer.schemaVersion = 99;
    fs.writeFileSync(file, JSON.stringify(newer));
    expect(() => new TaskRuntime(directory).get(task.id)).toThrow(
      "Unsupported newer agent task schema",
    );
    await runtime.delete(task.id);
    expect(fs.existsSync(file)).toBe(false);
    expect(fs.existsSync(path.join(directory, `${task.id}.events.jsonl`))).toBe(
      false,
    );
  });

  it("binds a contract to the task identity and preserves it across restart", async () => {
    const { runtime, directory } = createRuntime();
    const task = await runtime.start({
      sessionId: "s",
      workspaceId: "workspace-a",
      workspaceRevision: 7,
      goal: "Bound contract",
      contract: draftCompletionContract({
        scope: "simple",
        confidence: 0.95,
        impliedDeliverables: ["focused outcome"],
      }),
    });
    expect(task.contract).toMatchObject({
      taskId: task.id,
      workspaceId: "workspace-a",
      goalVersion: 1,
    });
    const restarted = new TaskRuntime(directory);
    const resumed = restarted.listResumable("workspace-a", "s");
    expect(resumed).toHaveLength(1);
    expect(resumed[0].contract?.id).toBe(task.contract?.id);
    await expect(
      restarted.revalidateWorkspace(task.id, "workspace-b", 8),
    ).rejects.toThrow("workspace identity");
  });

  it("stales contract evidence when a resumed workspace revision changed", async () => {
    const { runtime } = createRuntime();
    const task = await runtime.start({
      sessionId: "s",
      workspaceId: "workspace-a",
      workspaceRevision: 1,
      goal: "External edit",
      contract: draftCompletionContract({
        scope: "simple",
        confidence: 1,
        impliedDeliverables: ["focused outcome"],
      }),
    });
    await runtime.recordEvidence(task.id, {
      criterionId: "focused-outcome",
      kind: "test",
      status: "passed",
      summary: "Focused test passed",
    });
    const revalidated = await runtime.revalidateWorkspace(
      task.id,
      "workspace-a",
      2,
    );
    expect(revalidated.contract?.criteria[0].status).toBe("stale");
    expect(revalidated.changedSurface).toBeUndefined();
  });

  it("does not offer canceled or completed tasks as resumable", async () => {
    const { runtime } = createRuntime();
    const canceled = await runtime.start({
      sessionId: "s",
      workspaceId: "w",
      workspaceRevision: 1,
      goal: "Canceled",
    });
    await runtime.transition(canceled.id, "canceled", "User stopped");
    const failed = await runtime.start({
      sessionId: "s",
      workspaceId: "w",
      workspaceRevision: 1,
      goal: "Failed",
    });
    await runtime.transition(failed.id, "failed", "Verification failed");
    expect(runtime.listResumable("w", "s")).toEqual([]);
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

  it("enforces dependency order and deterministic merge order", async () => {
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
    // A moved revision (the agents' own edits) no longer blocks a subagent.
    await runtime.startSubagent(task.id, first.id, 10);
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
