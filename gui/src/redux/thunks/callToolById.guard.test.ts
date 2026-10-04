import { describe, expect, it } from "vitest";
import { createMockStore } from "../../util/test/mockStore";
import { getRootStateWithClaude } from "../../util/test/rootStateWithClaude";
import { callToolById } from "./callToolById";

function storeWithGuardError(guardError: string) {
  const root = getRootStateWithClaude();
  const store = createMockStore({
    ...root,
    session: {
      ...root.session,
      id: "s1",
      isStreaming: true,
      activeTaskId: "task-1",
      history: [
        {
          message: { id: "u1", role: "user", content: "fix the test" },
          contextItems: [],
        },
        {
          message: { id: "a1", role: "assistant", content: "" },
          contextItems: [],
          toolCallStates: [
            {
              toolCallId: "t1",
              status: "generated",
              parsedArgs: { command: "npm test" },
              toolCall: {
                id: "t1",
                type: "function",
                function: {
                  name: "run_terminal_command",
                  arguments: '{"command":"npm test"}',
                },
              },
            },
          ],
        },
      ] as any,
    },
  });
  const messenger = store.mockIdeMessenger;
  const toolCalls: unknown[] = [];
  const hookCalls: unknown[] = [];
  messenger.responseHandlers["tools/call"] = async (data: unknown) => {
    toolCalls.push(data);
    return { contextItems: [], errorMessage: undefined };
  };
  messenger.responseHandlers["hooks/run"] = async (data: unknown) => {
    hookCalls.push(data);
    return { blocked: false, warnings: [], ran: 0 };
  };
  const request = messenger.request.bind(messenger);
  messenger.request = (async (type: string, data: unknown) =>
    type === "agent/task/authorizeAction"
      ? { status: "error", error: guardError, done: true }
      : request(type as any, data as any)) as typeof messenger.request;
  return { store, toolCalls, hookCalls };
}

function toolOutput(store: ReturnType<typeof createMockStore>) {
  const assistant = (store.getState() as any).session.history.find(
    (h: any) => h.message.id === "a1",
  );
  return assistant.toolCallStates[0].output
    .map((o: any) => o.content)
    .join("\n");
}

describe("callToolById safety guard", () => {
  it("returns a repeated-action refusal to the model instead of failing the turn", async () => {
    const { store, toolCalls, hookCalls } = storeWithGuardError(
      "Repeated tool action limit reached",
    );

    const result = await (store.dispatch as any)(
      callToolById({ toolCallId: "t1" }),
    );

    expect(result.error).toBeUndefined();
    expect(toolCalls).toHaveLength(0);
    expect(hookCalls.filter((p: any) => /ToolUse$/.test(p.event))).toHaveLength(
      0,
    );
    expect(toolOutput(store)).toContain("already run 3 times");
  });

  it("never leaves a blocked call hanging: the refusal goes to the model", async () => {
    const { store, toolCalls } = storeWithGuardError(
      "Workspace changed since task start",
    );

    const result = await (store.dispatch as any)(
      callToolById({ toolCallId: "t1" }),
    );

    expect(result.error).toBeUndefined();
    expect(toolCalls).toHaveLength(0);
    expect(toolOutput(store)).toContain("Workspace changed since task start");
  });
});

describe("callToolById never leaves a call hanging", () => {
  function storeWith(override: (type: string) => unknown) {
    const { store } = storeWithGuardError("unused");
    const messenger = store.mockIdeMessenger;
    const base = messenger.request.bind(messenger);
    messenger.request = (async (type: string, data: unknown) => {
      if (type === "agent/task/authorizeAction")
        return { status: "success", content: {}, done: true };
      const res = override(type);
      if (res !== undefined) return res;
      return base(type as any, data as any);
    }) as typeof messenger.request;
    return store;
  }
  const status = (store: any) =>
    store.getState().session.history[1].toolCallStates[0].status;

  it("a failed core tool call becomes the tool's error", async () => {
    const store = storeWith((type) =>
      type === "tools/call"
        ? { status: "error", error: "core crashed", done: true }
        : undefined,
    );
    const result = await (store.dispatch as any)(
      callToolById({ toolCallId: "t1" }),
    );
    expect(result.error).toBeUndefined();
    expect(status(store)).toBe("errored");
    expect(toolOutput(store)).toContain("core crashed");
  });

  it("an unexpected exception still errors the call instead of hanging", async () => {
    const store = storeWith((type) => {
      if (type === "hooks/run") throw new Error("hook runner exploded");
      return undefined;
    });
    await (store.dispatch as any)(callToolById({ toolCallId: "t1" }));
    expect(status(store)).not.toBe("generated");
    expect(status(store)).not.toBe("calling");
  });
});
