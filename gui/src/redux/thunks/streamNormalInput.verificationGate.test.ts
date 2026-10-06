import { AssistantChatMessage, PromptLog } from "core";
import type { AgentTask } from "core/agent/types";
import { serializeTool } from "core/tools";
import { runTerminalCommandTool } from "core/tools/definitions";
import { describe, expect, it, vi } from "vitest";
import { createMockStore } from "../../util/test/mockStore";
import { getRootStateWithClaude } from "../../util/test/rootStateWithClaude";
import { RootState } from "../store";
import { VERIFICATION_GATE_MARKER } from "../util/verificationGate";
import { streamNormalInput } from "./streamNormalInput";

const terminalTool = serializeTool(runTerminalCommandTool);

function replies(...texts: string[]) {
  let call = 0;
  return vi.fn().mockImplementation(() => {
    const text = texts[call++] ?? "done";
    return (async function* (): AsyncGenerator<
      AssistantChatMessage[],
      PromptLog
    > {
      yield [{ role: "assistant", content: text }];
      return {
        prompt: "p",
        completion: text,
        modelTitle: "Claude",
        modelProvider: "anthropic",
      };
    })();
  });
}

/** A turn that already edited src/auth.ts in an earlier round. */
function storeAfterEdit(mode: "agent" | "chat" = "agent") {
  const state = getRootStateWithClaude();
  state.session.mode = mode;
  state.session.isStreaming = true;
  state.config.config.tools = [terminalTool];
  state.session.history = [
    {
      message: { id: "u1", role: "user", content: "fix the login bug" },
      contextItems: [],
    },
    {
      message: { id: "a1", role: "assistant", content: "" },
      contextItems: [],
      toolCallStates: [
        {
          toolCallId: "e1",
          status: "done",
          parsedArgs: { filepath: "src/auth.ts" },
          toolCall: {
            id: "e1",
            type: "function",
            function: { name: "single_find_and_replace", arguments: "{}" },
          },
        },
      ],
    },
    {
      message: { id: "t1", role: "tool", content: "edited", toolCallId: "e1" },
      contextItems: [],
    },
  ] as any;
  const store = createMockStore(state);
  const messenger = store.mockIdeMessenger;
  messenger.responses["llm/compileChat"] = {
    compiledChatMessages: [],
    didPrune: false,
    contextPercentage: 0.1,
  };
  messenger.responseHandlers["workspace/getVerificationPlan"] = async () => [
    {
      id: "c1",
      rootId: "r1",
      rootName: "app",
      kind: "test",
      command: "npm test",
      source: "package.json",
      confidence: "high",
      requiresApproval: true,
    },
  ];
  return { store, messenger };
}

function autoPrompts(store: ReturnType<typeof createMockStore>) {
  return (store.getState() as RootState).session.history.filter(
    (item) => item.isAutoPrompt,
  );
}

function storeWithActiveMutationTask(hasEvidence: boolean) {
  const state = getRootStateWithClaude();
  state.session.mode = "agent";
  state.session.isStreaming = true;
  state.session.activeTaskId = "task-1";
  state.config.config.tools = [];
  state.session.history = [
    {
      message: { id: "u1", role: "user", content: "finish the change" },
      contextItems: [],
    },
  ] as any;
  const now = 10;
  const task = {
    id: "task-1",
    sessionId: state.session.id,
    workspaceId: "mock-workspace",
    workspaceRevision: 1,
    state: "executing",
    goalDigest: "digest",
    approvals: [
      {
        id: "approval-1",
        toolCallId: "edit-1",
        toolName: "multi_edit",
        risk: "R2",
        decision: "approved",
        approvedAt: now,
        scopeDigest: "scope",
      },
    ],
    checkpoints: [],
    verification: hasEvidence
      ? [
          {
            id: "test-1",
            kind: "test",
            status: "passed",
            summary: "Focused test passed",
            createdAt: now + 1,
          },
        ]
      : [],
    executionGuard: {
      autonomousSteps: 1,
      maxAutonomousSteps: 200,
      repeatedActionLimit: 3,
      actionDigests: {},
      cancelRequested: false,
    },
    budget: {
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      maxInputTokens: 200_000,
      maxOutputTokens: 32_000,
      maxCostUsd: 3,
    },
    plan: {
      version: 1,
      createdAt: now,
      updatedAt: now,
      steps: [
        {
          id: "act",
          summary: "Apply the approved edit",
          kind: "edit",
          risk: "R2",
          dependsOn: [],
          state: "running",
          attempts: 1,
          maxAttempts: 2,
          verificationRequired: true,
          createdAt: now,
          updatedAt: now,
        },
        {
          id: "verify",
          summary: "Run verification",
          kind: "test",
          risk: "R0",
          dependsOn: ["act"],
          state: "pending",
          attempts: 0,
          maxAttempts: 1,
          verificationRequired: true,
          createdAt: now,
          updatedAt: now,
        },
      ],
    },
    subagents: [],
    createdAt: now,
    updatedAt: now,
  } as AgentTask;
  const store = createMockStore(state);
  const messenger = store.mockIdeMessenger;
  const completeSteps: string[] = [];
  const transitions: string[] = [];
  const recordedVerification: string[] = [];
  messenger.responseHandlers["agent/task/get"] = async () => task;
  messenger.responseHandlers["agent/task/recordVerification"] = async (
    data,
  ) => {
    recordedVerification.push(data.result.status);
    return task;
  };
  messenger.responseHandlers["agent/plan/completeStep"] = async (data) => {
    completeSteps.push(data.stepId);
    const step = task.plan?.steps.find(
      (candidate) => candidate.id === data.stepId,
    );
    if (step) step.state = "succeeded";
    return task;
  };
  messenger.responseHandlers["agent/plan/next"] = async () => {
    const verify = task.plan?.steps.find(
      (candidate) => candidate.id === "verify",
    );
    return verify?.state === "pending"
      ? { action: "execute", step: verify }
      : { action: "complete" };
  };
  messenger.responseHandlers["agent/plan/startStep"] = async (data) => {
    const step = task.plan?.steps.find(
      (candidate) => candidate.id === data.stepId,
    );
    if (step) {
      step.state = "running";
      step.attempts += 1;
    }
    return task;
  };
  messenger.responseHandlers["agent/task/transition"] = async (data) => {
    transitions.push(data.state);
    task.state = data.state;
    return task;
  };
  return { completeSteps, messenger, recordedVerification, store, transitions };
}

describe("verification gate", () => {
  it("asks once for a check when an agent turn ends with unverified edits", async () => {
    const { store, messenger } = storeAfterEdit();
    messenger.llmStreamChat = replies(
      "Fixed the bug.",
      "No test covers auth yet; manual check only.",
    );

    await (store.dispatch as any)(streamNormalInput({ depth: 1 }));

    expect(messenger.llmStreamChat).toHaveBeenCalledTimes(2);
    const gates = autoPrompts(store);
    expect(gates).toHaveLength(1);
    const text = gates[0].message.content as string;
    expect(text.startsWith(VERIFICATION_GATE_MARKER)).toBe(true);
    expect(text).toContain("src/auth.ts");
    expect(text).toContain("`npm test`");
    expect((store.getState() as RootState).session.isStreaming).toBe(false);
  });

  it("does not gate outside agent mode", async () => {
    const { store, messenger } = storeAfterEdit("chat");
    messenger.llmStreamChat = replies("Here is the fix.");

    await (store.dispatch as any)(streamNormalInput({ depth: 1 }));

    expect(messenger.llmStreamChat).toHaveBeenCalledTimes(1);
    expect(autoPrompts(store)).toHaveLength(0);
  });

  it("keeps a mutation task verifying when its active work lacks evidence", async () => {
    const {
      completeSteps,
      messenger,
      recordedVerification,
      store,
      transitions,
    } = storeWithActiveMutationTask(false);
    messenger.llmStreamChat = replies("The edit is complete.");

    await (store.dispatch as any)(streamNormalInput({ depth: 1 }));

    expect(completeSteps).toEqual([]);
    expect(recordedVerification).toEqual(["skipped"]);
    expect(transitions).toEqual(["verifying", "verifying"]);
  });

  it("completes the active verify step only after real evidence exists", async () => {
    const {
      completeSteps,
      messenger,
      recordedVerification,
      store,
      transitions,
    } = storeWithActiveMutationTask(true);
    messenger.llmStreamChat = replies("The focused test passed.");

    await (store.dispatch as any)(streamNormalInput({ depth: 1 }));

    expect(completeSteps).toEqual(["act", "verify"]);
    expect(recordedVerification).toEqual(["passed"]);
    expect(transitions).toEqual(["verifying", "completed"]);
  });
});
