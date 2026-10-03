import { describe, expect, it } from "vitest";

import type { ChatMessage, ILLM, Tool, ToolCall } from "..";
import {
  accumulateToolCalls,
  runExploreSubagent,
  SubagentToolResult,
} from "./exploreSubagent";

function tool(name: string): Tool {
  return {
    type: "function",
    displayTitle: name,
    readonly: true,
    group: "Built-In",
    function: { name, parameters: { type: "object", properties: {} } },
  };
}

const TOOLS = ["read_file", "grep_search", "run_terminal_command"].map(tool);

/** Fake model: replays one scripted turn per call and records what it saw. */
function scriptedLlm(turns: ChatMessage[][]) {
  const seen: { messages: ChatMessage[]; tools?: Tool[] }[] = [];
  const llm = {
    async *streamChat(
      messages: ChatMessage[],
      _signal: AbortSignal,
      options: any,
    ) {
      seen.push({ messages: structuredClone(messages), tools: options.tools });
      for (const chunk of turns[seen.length - 1] ?? [
        { role: "assistant", content: "done" },
      ]) {
        yield chunk;
      }
    },
  } as unknown as ILLM;
  return { llm, seen };
}

function call(id: string, name: string, args: object): ChatMessage {
  return {
    role: "assistant",
    content: "",
    toolCalls: [
      {
        id,
        type: "function",
        function: { name, arguments: JSON.stringify(args) },
      },
    ],
  };
}

describe("runExploreSubagent", () => {
  it("runs tools in its own context and returns only the report", async () => {
    const { llm, seen } = scriptedLlm([
      [
        call("c1", "grep_search", { query: "settle" }),
        call("c2", "read_file", { filepath: "a.ts" }),
      ],
      [{ role: "assistant", content: "Credits settle in a.ts:10." }],
    ]);
    const executed: string[] = [];
    const progress: string[] = [];

    const result = await runExploreSubagent({
      task: "Where are credits settled?",
      llm,
      tools: TOOLS,
      signal: new AbortController().signal,
      onProgress: (line) => progress.push(line),
      callTool: async (
        _tool: Tool,
        toolCall: ToolCall,
      ): Promise<SubagentToolResult> => {
        executed.push(toolCall.function.name);
        return {
          contextItems: [
            {
              name: "out",
              description: "",
              content: `result of ${toolCall.id}`,
            },
          ],
        };
      },
    });

    expect(result).toEqual({
      report: "Credits settle in a.ts:10.",
      rounds: 2,
      toolCalls: 2,
    });
    expect(executed).toEqual(["grep_search", "read_file"]);
    expect(progress).toEqual(["grep_search settle", "read_file a.ts"]);
    // Only read-only tools are offered, and results are fed back by id.
    expect(seen[0].tools?.map((t) => t.function.name)).toEqual([
      "read_file",
      "grep_search",
    ]);
    const toolMessages = seen[1].messages.filter((m) => m.role === "tool");
    expect(toolMessages.map((m: any) => m.toolCallId)).toEqual(["c1", "c2"]);
  });

  it("refuses tools outside the read-only set without running them", async () => {
    const { llm, seen } = scriptedLlm([
      [call("c1", "run_terminal_command", { command: "rm -rf /" })],
      [{ role: "assistant", content: "Could not run commands." }],
    ]);
    const executed: string[] = [];

    await runExploreSubagent({
      task: "t",
      llm,
      tools: TOOLS,
      signal: new AbortController().signal,
      callTool: async (_t, c) => {
        executed.push(c.function.name);
        return { contextItems: [] };
      },
    });

    expect(executed).toEqual([]);
    const refusal = seen[1].messages.find((m) => m.role === "tool") as any;
    expect(refusal.content).toContain("not available to explore subagents");
  });

  it("forces a report without tools on the last round", async () => {
    const looping = [call("c", "grep_search", { query: "x" })];
    const { llm, seen } = scriptedLlm([
      looping,
      looping,
      [{ role: "assistant", content: "Partial findings." }],
    ]);

    const result = await runExploreSubagent({
      task: "t",
      llm,
      tools: TOOLS,
      maxRounds: 3,
      signal: new AbortController().signal,
      callTool: async () => ({ contextItems: [] }),
    });

    expect(result.report).toBe("Partial findings.");
    expect(seen[2].tools).toBeUndefined();
    expect(seen[2].messages.at(-1)?.content).toContain(
      "Research budget reached",
    );
  });

  it("stops when aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const { llm } = scriptedLlm([]);
    await expect(
      runExploreSubagent({
        task: "t",
        llm,
        tools: TOOLS,
        signal: controller.signal,
        callTool: async () => ({ contextItems: [] }),
      }),
    ).rejects.toThrow("canceled");
  });
});

describe("accumulateToolCalls", () => {
  it("joins streamed argument fragments onto the call that started them", () => {
    const calls: ToolCall[] = [];
    accumulateToolCalls(calls, [
      {
        id: "a",
        type: "function",
        function: { name: "read_file", arguments: '{"file' },
      },
    ]);
    accumulateToolCalls(calls, [{ function: { arguments: 'path":"x.ts"}' } }]);
    accumulateToolCalls(calls, [
      { id: "b", type: "function", function: { name: "ls", arguments: "{}" } },
    ]);
    expect(
      calls.map((c) => [c.id, c.function.name, c.function.arguments]),
    ).toEqual([
      ["a", "read_file", '{"filepath":"x.ts"}'],
      ["b", "ls", "{}"],
    ]);
  });
});
