import { describe, expect, it } from "vitest";
import { createMockStore } from "../../util/test/mockStore";
import { callToolById } from "./callToolById";
import { getRootStateWithClaude } from "../../util/test/rootStateWithClaude";

function storeWithPendingTool(
  toolName = "read_file",
  args: Record<string, unknown> = { filepath: "a.ts" },
) {
  const root = getRootStateWithClaude();
  const store = createMockStore({
    ...root,
    session: {
      ...root.session,
      id: "s1",
      isStreaming: true,
      history: [
        {
          message: { id: "u1", role: "user", content: "read a.ts" },
          contextItems: [],
        },
        {
          message: { id: "a1", role: "assistant", content: "" },
          contextItems: [],
          toolCallStates: [
            {
              toolCallId: "t1",
              status: "generated",
              parsedArgs: args,
              toolCall: {
                id: "t1",
                type: "function",
                function: {
                  name: toolName,
                  arguments: JSON.stringify(args),
                },
              },
            },
          ],
        },
      ] as any,
    },
  });
  const hookCalls: any[] = [];
  const toolCalls: any[] = [];
  store.mockIdeMessenger.responseHandlers["tools/call"] = async (data: any) => {
    toolCalls.push(data);
    return {
      contextItems: [
        { name: "a.ts", description: "a.ts", content: "export const a = 1;" },
      ],
      errorMessage: undefined,
    };
  };
  return { store, hookCalls, toolCalls };
}

function toolOutput(store: ReturnType<typeof createMockStore>) {
  const assistant = (store.getState() as any).session.history.find(
    (h: any) => h.message.id === "a1",
  );
  return assistant.toolCallStates[0].output
    .map((o: any) => o.content)
    .join("\n");
}

describe("callToolById lifecycle hooks", () => {
  it("a blocking PreToolUse hook stops the tool and tells the model why", async () => {
    const { store, hookCalls, toolCalls } = storeWithPendingTool();
    store.mockIdeMessenger.responseHandlers["hooks/run"] = async (
      payload: any,
    ) => {
      hookCalls.push(payload);
      return payload.event === "PreToolUse"
        ? {
            blocked: true,
            reason: "a.ts is generated; edit src/a.src instead",
            warnings: [],
            ran: 1,
          }
        : { blocked: false, warnings: [], ran: 0 };
    };

    await (store.dispatch as any)(callToolById({ toolCallId: "t1" }));

    expect(toolCalls).toHaveLength(0);
    expect(hookCalls[0]).toMatchObject({
      event: "PreToolUse",
      toolName: "read_file",
      toolInput: { filepath: "a.ts" },
    });
    expect(hookCalls.some((p) => p.event === "PostToolUse")).toBe(false);
    expect(toolOutput(store)).toContain(
      "Blocked by a PreToolUse hook: a.ts is generated; edit src/a.src instead",
    );
  });

  it("a blocking PostToolUse hook adds feedback next to the real output", async () => {
    const { store, hookCalls, toolCalls } = storeWithPendingTool();
    store.mockIdeMessenger.responseHandlers["hooks/run"] = async (
      payload: any,
    ) => {
      hookCalls.push(payload);
      return payload.event === "PostToolUse"
        ? {
            blocked: true,
            reason: "lint: unused export a",
            warnings: [],
            ran: 1,
          }
        : { blocked: false, warnings: [], ran: 0 };
    };

    await (store.dispatch as any)(callToolById({ toolCallId: "t1" }));

    expect(toolCalls).toHaveLength(1);
    const post = hookCalls.find((p) => p.event === "PostToolUse");
    expect(post.toolOutput).toContain("export const a = 1;");
    const output = toolOutput(store);
    expect(output).toContain("export const a = 1;");
    expect(output).toContain(
      "A PostToolUse hook reported: lint: unused export a",
    );
  });

  it("bounds a core tool request so an unresponsive extension host cannot strand the UI", async () => {
    const { store } = storeWithPendingTool();
    const request = store.mockIdeMessenger.request.bind(store.mockIdeMessenger);
    const calls: unknown[][] = [];
    store.mockIdeMessenger.request = (async (...args: unknown[]) => {
      calls.push(args);
      return (request as any)(...args);
    }) as typeof store.mockIdeMessenger.request;

    await (store.dispatch as any)(callToolById({ toolCallId: "t1" }));

    expect(calls.find(([type]) => type === "tools/call")?.[2]).toBe(120_000);
  });
});

describe("SubagentStop hook", () => {
  it("fires after a run_subagent tool call with its id and type, and does not block", async () => {
    const { store, hookCalls } = storeWithPendingTool("run_subagent", {
      prompt: "find x",
      agent: "reviewer",
    });
    store.mockIdeMessenger.responseHandlers["hooks/run"] = async (
      payload: any,
    ) => {
      hookCalls.push(payload);
      return payload.event === "SubagentStop"
        ? { blocked: true, reason: "ignored", warnings: [], ran: 1 }
        : { blocked: false, warnings: [], ran: 0 };
    };
    await (store.dispatch as any)(callToolById({ toolCallId: "t1" }));
    const stop = hookCalls.find((p) => p.event === "SubagentStop");
    expect(stop).toMatchObject({
      sessionId: "s1",
      subagentId: "t1",
      subagentType: "reviewer",
    });
    expect(toolOutput(store)).toContain("export const a = 1;");
  });

  it("does not fire for ordinary tools", async () => {
    const { store, hookCalls } = storeWithPendingTool();
    store.mockIdeMessenger.responseHandlers["hooks/run"] = async (
      payload: any,
    ) => {
      hookCalls.push(payload);
      return { blocked: false, warnings: [], ran: 0 };
    };
    await (store.dispatch as any)(callToolById({ toolCallId: "t1" }));
    expect(hookCalls.some((p) => p.event === "SubagentStop")).toBe(false);
  });
});
