import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { afterEach, describe, expect, it } from "vitest";

import { AgentOrchestrator } from "./AgentOrchestrator";
import { MAX_AUTONOMOUS_STEPS, TaskRuntime } from "./TaskRuntime";

const temporaryDirectories: string[] = [];

async function createTask() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "vynor-agent-test-"));
  temporaryDirectories.push(directory);
  const runtime = new TaskRuntime(directory);
  const orchestrator = new AgentOrchestrator(runtime);
  const task = await runtime.start({
    sessionId: "session-1",
    workspaceId: "workspace-1",
    workspaceRevision: 7,
    goal: "Implement and verify a production change",
  });
  return { directory, runtime, orchestrator, task };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("AgentOrchestrator", () => {
  it("executes a dependency plan in deterministic order", async () => {
    const { orchestrator, task } = await createTask();
    await orchestrator.createPlan(task.id, [
      {
        id: "inspect",
        summary: "Inspect relevant code",
        kind: "inspect",
        risk: "R0",
      },
      {
        id: "edit",
        summary: "Apply focused changes",
        kind: "edit",
        risk: "R2",
        dependsOn: ["inspect"],
      },
    ]);

    expect(orchestrator.next(task.id, "workspace-1", 7)).toMatchObject({
      action: "execute",
      step: { id: "inspect" },
    });
    await orchestrator.startStep(task.id, "inspect");
    await orchestrator.completeStep(task.id, "inspect");
    expect(orchestrator.next(task.id, "workspace-1", 7)).toMatchObject({
      action: "await_approval",
      step: { id: "edit" },
    });
    await orchestrator.startStep(task.id, "edit", true);
    await orchestrator.completeStep(task.id, "edit", "src/service.ts");
    expect(orchestrator.next(task.id, "workspace-1", 7)).toEqual({
      action: "complete",
    });
  });

  it("rejects cycles, unknown dependencies, and workspace drift", async () => {
    const { orchestrator, task } = await createTask();
    await expect(
      orchestrator.createPlan(task.id, [
        {
          id: "one",
          summary: "One",
          kind: "inspect",
          risk: "R0",
          dependsOn: ["two"],
        },
      ]),
    ).rejects.toThrow("Invalid dependency");

    await orchestrator.createPlan(task.id, [
      { id: "one", summary: "One", kind: "inspect", risk: "R0" },
    ]);
    expect(orchestrator.next(task.id, "workspace-2", 8)).toEqual({
      action: "blocked",
      reason: "Workspace changed since this task was planned",
    });
    // The agent's own edits move the revision; only another workspace blocks.
    await expect(
      orchestrator.authorizeAction(task.id, "workspace-1", 8, "read:a"),
    ).resolves.toBeTruthy();
    await expect(
      orchestrator.authorizeAction(task.id, "workspace-2", 8, "read:b"),
    ).rejects.toThrow("Workspace changed");
  });

  it("retries bounded failures then blocks dependents", async () => {
    const { orchestrator, runtime, task } = await createTask();
    await orchestrator.createPlan(task.id, [
      {
        id: "build",
        summary: "Build extension",
        kind: "build",
        risk: "R1",
        maxAttempts: 2,
      },
      {
        id: "review",
        summary: "Review result",
        kind: "review",
        risk: "R0",
        dependsOn: ["build"],
      },
    ]);

    await orchestrator.startStep(task.id, "build");
    const retry = await orchestrator.failStep(task.id, "build", "BUILD_FAILED");
    expect(retry.plan?.steps[0]).toMatchObject({
      state: "pending",
      attempts: 1,
    });
    await orchestrator.startStep(task.id, "build");
    const failed = await orchestrator.failStep(
      task.id,
      "build",
      "BUILD_FAILED",
    );
    expect(failed.state).toBe("failed");
    expect(failed.plan?.steps).toMatchObject([
      { state: "failed", attempts: 2 },
      { state: "blocked" },
    ]);
    expect(runtime.listResumable("workspace-1")).toHaveLength(0);
  });

  it("enforces repeated-action and total autonomous-action limits", async () => {
    const { orchestrator, task } = await createTask();
    for (let index = 0; index < 3; index += 1) {
      await orchestrator.authorizeAction(
        task.id,
        "workspace-1",
        7,
        "read_file:same.ts",
      );
    }
    await expect(
      orchestrator.authorizeAction(
        task.id,
        "workspace-1",
        7,
        "read_file:same.ts",
      ),
    ).rejects.toThrow("Repeated tool action limit");

    for (let index = 0; index < MAX_AUTONOMOUS_STEPS - 3; index += 1) {
      await orchestrator.authorizeAction(
        task.id,
        "workspace-1",
        7,
        `read_file:file-${index}.ts`,
      );
    }
    await expect(
      orchestrator.authorizeAction(
        task.id,
        "workspace-1",
        7,
        "read_file:overflow.ts",
      ),
    ).rejects.toThrow("Autonomous step limit");
  });

  it("resets repeat counts after a file edit so fix loops can re-run tests", async () => {
    const { orchestrator, task } = await createTask();
    const test = JSON.stringify({
      tool: "run_terminal_command",
      arguments: { command: "npm test" },
    });
    const edit = (n: number) =>
      JSON.stringify({
        tool: "single_find_and_replace",
        arguments: { filepath: "a.ts", newString: `${n}` },
      });
    for (let round = 0; round < 5; round += 1) {
      await orchestrator.authorizeAction(task.id, "workspace-1", 7, test);
      await orchestrator.authorizeAction(
        task.id,
        "workspace-1",
        7,
        edit(round),
      );
    }
    for (let index = 0; index < 3; index += 1) {
      await orchestrator.authorizeAction(task.id, "workspace-1", 7, test);
    }
    await expect(
      orchestrator.authorizeAction(task.id, "workspace-1", 7, test),
    ).rejects.toThrow("Repeated tool action limit");
  });

  it("cancels all active steps and safely resumes interrupted work", async () => {
    const first = await createTask();
    await first.orchestrator.createPlan(first.task.id, [
      { id: "inspect", summary: "Inspect", kind: "inspect", risk: "R0" },
    ]);
    await first.orchestrator.startStep(first.task.id, "inspect");
    const resumed = await first.orchestrator.resume(
      first.task.id,
      "workspace-1",
      7,
    );
    expect(resumed.state).toBe("planning");
    expect(resumed.plan?.steps[0].state).toBe("pending");

    const subagent = await first.runtime.createSubagent({
      taskId: first.task.id,
      role: "qa",
      objective: "Verify the delegated change",
      authority: { read: true, write: false, command: false, network: false },
      fileScope: ["core/agent"],
      budget: {
        maxInputTokens: 5_000,
        maxOutputTokens: 1_000,
        maxCostUsd: 0.1,
      },
    });
    await first.runtime.startSubagent(first.task.id, subagent.id);

    const recovered = await first.orchestrator.resume(
      first.task.id,
      "workspace-1",
      7,
    );
    expect(recovered.subagents?.[0].status).toBe("queued");
    await first.runtime.startSubagent(first.task.id, subagent.id);

    const canceled = await first.orchestrator.cancel(first.task.id);
    expect(canceled.state).toBe("canceled");
    expect(canceled.executionGuard.cancelRequested).toBe(true);
    expect(canceled.plan?.steps[0].state).toBe("canceled");
    expect(canceled.subagents?.[0].status).toBe("canceled");
  });

  it("persists only redacted, bounded plan summaries", async () => {
    const { directory, orchestrator, task } = await createTask();
    await orchestrator.createPlan(task.id, [
      {
        id: "inspect",
        summary: "Inspect api_key=do-not-store-this\nthen continue",
        kind: "inspect",
        risk: "R0",
      },
    ]);
    const persisted = fs.readFileSync(
      path.join(directory, `${task.id}.json`),
      "utf8",
    );
    expect(persisted).not.toContain("do-not-store-this");
    expect(persisted).toContain("[REDACTED]");
  });
});
