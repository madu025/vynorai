import fs from "fs";
import os from "os";
import path from "path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { ImplementationSubagentScheduler } from "./ImplementationSubagentScheduler";
import { TaskRuntime } from "./TaskRuntime";

const directories: string[] = [];
function runtimeFixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "vynor-scheduler-"));
  directories.push(directory);
  return new TaskRuntime(directory);
}
afterEach(() => {
  for (const directory of directories.splice(0))
    fs.rmSync(directory, { recursive: true, force: true });
});

describe("ImplementationSubagentScheduler", () => {
  it("runs dependency-ready model turns and persists verified handoffs", async () => {
    const runtime = runtimeFixture();
    const task = await runtime.start({
      sessionId: "s",
      workspaceId: "w",
      workspaceRevision: 2,
      goal: "Implement feature",
    });
    const base = {
      taskId: task.id,
      authority: { read: true, write: true, command: false, network: false },
      budget: {
        maxInputTokens: 5_000,
        maxOutputTokens: 1_000,
        maxCostUsd: 0.2,
      },
    };
    const backend = await runtime.createSubagent({
      ...base,
      role: "backend",
      objective: "Implement API",
      fileScope: ["backend/src"],
    });
    const qa = await runtime.createSubagent({
      ...base,
      role: "qa",
      objective: "Verify API",
      fileScope: ["backend/test"],
      dependsOn: [backend.id],
    });
    const order: string[] = [];
    const scheduler = new ImplementationSubagentScheduler(
      runtime,
      async (agent) => {
        order.push(agent.id);
        return {
          summary: "implemented and verified",
          changedFiles: [
            agent.role === "backend"
              ? "backend/src/api.ts"
              : "backend/test/api.ts",
          ],
          verification: [
            {
              id: `v-${agent.id}`,
              kind: "test",
              status: "passed",
              summary: "passed",
              createdAt: Date.now(),
            },
          ],
          usage: { inputTokens: 100, outputTokens: 20, costUsd: 0.01 },
        };
      },
    );
    const result = await scheduler.run(
      task.id,
      2,
      new AbortController().signal,
    );
    expect(order).toEqual([backend.id, qa.id]);
    expect(result).toEqual({
      completed: [backend.id, qa.id],
      failed: [],
      blocked: [],
    });
    expect(runtime.get(task.id)?.budget.inputTokens).toBe(200);
  });

  it("isolates a failed turn and reports dependents as blocked", async () => {
    const runtime = runtimeFixture();
    const task = await runtime.start({
      sessionId: "s",
      workspaceId: "w",
      workspaceRevision: 1,
      goal: "Failure isolation",
    });
    const first = await runtime.createSubagent({
      taskId: task.id,
      role: "backend",
      objective: "Fail",
      authority: { read: true, write: false, command: false, network: false },
      fileScope: ["backend"],
      budget: {
        maxInputTokens: 5_000,
        maxOutputTokens: 1_000,
        maxCostUsd: 0.2,
      },
    });
    const dependent = await runtime.createSubagent({
      taskId: task.id,
      role: "qa",
      objective: "Wait",
      authority: { read: true, write: false, command: false, network: false },
      fileScope: ["backend"],
      dependsOn: [first.id],
      budget: {
        maxInputTokens: 5_000,
        maxOutputTokens: 1_000,
        maxCostUsd: 0.2,
      },
    });
    const runner = vi.fn().mockRejectedValue(new Error("MODEL_FAILED"));
    const result = await new ImplementationSubagentScheduler(
      runtime,
      runner,
    ).run(task.id, 1, new AbortController().signal);
    expect(result.failed).toEqual([first.id]);
    expect(result.blocked).toEqual([dependent.id]);
    expect(runtime.get(task.id)?.subagents?.[0].status).toBe("failed");
  });
});
