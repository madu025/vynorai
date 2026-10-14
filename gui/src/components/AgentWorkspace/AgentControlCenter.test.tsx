import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { AgentTask } from "core/agent/types";
import { Provider } from "react-redux";
import { describe, expect, it, vi } from "vitest";

import { IdeMessengerContext } from "../../context/IdeMessenger";
import { MockIdeMessenger } from "../../context/MockIdeMessenger";
import { createMockStore, getEmptyRootState } from "../../util/test/mockStore";
import { AgentControlCenter } from "./AgentControlCenter";

const now = Date.now();
const task: AgentTask = {
  id: "00000000-0000-4000-8000-000000000001",
  sessionId: "session-1",
  workspaceId: "mock-workspace",
  workspaceRevision: 1,
  goalVersion: 1,
  state: "executing",
  goalDigest: "digest",
  approvals: [],
  checkpoints: [],
  verification: [
    {
      id: "verification-1",
      kind: "test",
      status: "passed",
      summary: "test evidence from run_terminal_command: passed",
      createdAt: now,
    },
  ],
  evidence: [
    {
      id: "evidence-1",
      criterionId: "api-behavior",
      kind: "test",
      status: "passed",
      summary: "Focused API test passed",
      mutationGeneration: 1,
      createdAt: now,
    },
  ],
  mutationGeneration: 1,
  changedSurface: {
    generation: 1,
    files: ["backend/src/api.ts"],
    digest: "a".repeat(64),
    capturedAt: now,
  },
  contract: {
    id: "contract-1",
    version: 1,
    taskId: "00000000-0000-4000-8000-000000000001",
    goalVersion: 1,
    workspaceId: "mock-workspace",
    scope: "medium",
    confidence: 0.9,
    criteria: [
      {
        id: "api-behavior",
        statement: "API behavior is verified",
        provenance: "inferred",
        required: true,
        evidencePolicy: ["focused_check"],
        status: "pending",
      },
    ],
    createdAt: now,
    updatedAt: now,
  },
  budget: {
    inputTokens: 10,
    outputTokens: 5,
    costUsd: 0.01,
    maxInputTokens: 1000,
    maxOutputTokens: 1000,
    maxCostUsd: 3,
  },
  executionGuard: {
    autonomousSteps: 2,
    maxAutonomousSteps: 24,
    repeatedActionLimit: 3,
    actionDigests: {},
    cancelRequested: false,
  },
  plan: {
    version: 1,
    createdAt: now,
    updatedAt: now,
    steps: [
      {
        id: "understand",
        summary: "Inspect workspace",
        kind: "inspect",
        risk: "R0",
        dependsOn: [],
        state: "succeeded",
        attempts: 1,
        maxAttempts: 1,
        verificationRequired: false,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "act",
        summary: "Implement change",
        kind: "act",
        risk: "R0",
        dependsOn: ["understand"],
        state: "running",
        attempts: 1,
        maxAttempts: 2,
        verificationRequired: true,
        createdAt: now,
        updatedAt: now,
      },
    ],
  },
  createdAt: now,
  updatedAt: now,
};

describe("AgentControlCenter", () => {
  it("renders persisted plan progress and approval-required verification", async () => {
    const messenger = new MockIdeMessenger();
    messenger.responses["agent/task/get"] = task;
    messenger.responses["workspace/getVerificationPlan"] = [
      {
        id: "verify-1",
        rootId: "mock-root",
        rootName: "workspace1",
        kind: "test",
        command: "npm run test",
        source: "package.json#scripts.test",
        confidence: "high",
        requiresApproval: true,
      },
    ];
    const initial = getEmptyRootState();
    const store = createMockStore(
      {
        session: {
          ...initial.session,
          id: "session-1",
          mode: "agent",
          activeTaskId: task.id,
          activeTaskState: "executing",
        },
        workspace: {
          loading: false,
          snapshot: messenger.responses["workspace/getSnapshot"],
        },
      },
      messenger,
    );
    const requestSpy = vi.spyOn(messenger, "request");

    render(
      <Provider store={store}>
        <IdeMessengerContext.Provider value={messenger}>
          <AgentControlCenter />
        </IdeMessengerContext.Provider>
      </Provider>,
    );

    expect(await screen.findByText("Implement change")).toBeInTheDocument();
    expect(screen.getByText(/50% · 2\/24 actions/)).toBeInTheDocument();
    expect(screen.getByText("npm run test")).toBeInTheDocument();
    expect(screen.getByText(/approval required/i)).toBeInTheDocument();
    expect(screen.getByText("Run evidence")).toBeInTheDocument();
    expect(screen.getByText("API behavior is verified")).toBeInTheDocument();
    expect(screen.getByText("evidence")).toBeInTheDocument();
    expect(screen.getByLabelText("Changed surface")).toHaveTextContent(
      "backend/src/api.ts",
    );
    expect(
      screen.getByText("test evidence from run_terminal_command: passed"),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(requestSpy).toHaveBeenCalledWith(
        "workspace/getVerificationPlan",
        undefined,
      ),
    );
    expect(requestSpy).not.toHaveBeenCalledWith(
      "tools/call",
      expect.anything(),
    );
  });

  it("contains a supporting-data request failure and shows a diagnostic alert", async () => {
    const messenger = new MockIdeMessenger();
    messenger.responses["agent/task/get"] = task;
    messenger.responseHandlers["workspace/getVerificationPlan"] = async () => {
      throw new Error("extension host unavailable");
    };
    const initial = getEmptyRootState();
    const store = createMockStore(
      {
        session: {
          ...initial.session,
          id: "session-1",
          mode: "agent",
          activeTaskId: task.id,
          activeTaskState: "executing",
        },
        workspace: {
          loading: false,
          snapshot: messenger.responses["workspace/getSnapshot"],
        },
      },
      messenger,
    );

    render(
      <Provider store={store}>
        <IdeMessengerContext.Provider value={messenger}>
          <AgentControlCenter />
        </IdeMessengerContext.Provider>
      </Provider>,
    );

    expect(await screen.findByText("Implement change")).toBeInTheDocument();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Unable to refresh agent details. Open diagnostics.",
    );
  });

  it("contains a cancellation request failure and keeps the task visible", async () => {
    const messenger = new MockIdeMessenger();
    messenger.responses["agent/task/get"] = task;
    messenger.responseHandlers["agent/task/cancel"] = async () => {
      throw new Error("extension host unavailable");
    };
    const initial = getEmptyRootState();
    const store = createMockStore(
      {
        session: {
          ...initial.session,
          id: "session-1",
          mode: "agent",
          activeTaskId: task.id,
          activeTaskState: "executing",
        },
        workspace: {
          loading: false,
          snapshot: messenger.responses["workspace/getSnapshot"],
        },
      },
      messenger,
    );

    render(
      <Provider store={store}>
        <IdeMessengerContext.Provider value={messenger}>
          <AgentControlCenter />
        </IdeMessengerContext.Provider>
      </Provider>,
    );

    expect(await screen.findByText("Implement change")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel agent task" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not cancel agent task. Try again.",
    );
    expect(screen.getByText("Implement change")).toBeInTheDocument();
  });

  it("requires an explicit confirmation before recording a criterion skip", async () => {
    const messenger = new MockIdeMessenger();
    messenger.responses["agent/task/get"] = task;
    messenger.responseHandlers["agent/task/recordCriterionDecision"] = async (
      input,
    ) => {
      expect(input.decision.decision).toBe("skipped");
      return {
        ...task,
        contract: {
          ...task.contract!,
          criteria: task.contract!.criteria.map((criterion) => ({
            ...criterion,
            status: "user_skipped" as const,
          })),
        },
      };
    };
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const initial = getEmptyRootState();
    const store = createMockStore(
      {
        session: {
          ...initial.session,
          id: "session-1",
          mode: "agent",
          activeTaskId: task.id,
          activeTaskState: "executing",
        },
        workspace: {
          loading: false,
          snapshot: messenger.responses["workspace/getSnapshot"],
        },
      },
      messenger,
    );

    render(
      <Provider store={store}>
        <IdeMessengerContext.Provider value={messenger}>
          <AgentControlCenter />
        </IdeMessengerContext.Provider>
      </Provider>,
    );

    const skip = await screen.findByRole("button", {
      name: /Skip verification for API behavior/i,
    });
    fireEvent.click(skip);
    await waitFor(() =>
      expect(confirm).toHaveBeenCalledWith(
        "Skip this verification criterion? The task will show it as user-skipped, not passed.",
      ),
    );
    expect(await screen.findByText("user skipped")).toBeInTheDocument();
    confirm.mockRestore();
  });
});
