import { ChatHistoryItem } from "core";
import { describe, expect, it } from "vitest";
import { collectSubagents } from "./AgentMap";

const call = (id: string, name: string, args: any, status: any, output?: any) =>
  ({
    message: { role: "assistant", content: "", id },
    contextItems: [],
    toolCallStates: [
      {
        toolCallId: id,
        toolCall: { id, type: "function", function: { name, arguments: "{}" } },
        parsedArgs: args,
        status,
        output,
      },
    ],
  }) as unknown as ChatHistoryItem;

describe("collectSubagents", () => {
  it("lists only subagent calls, in order, with agent names and progress", () => {
    const entries = collectSubagents([
      call("a", "read_file", { filepath: "x" }, "done"),
      call("b", "run_subagent", { description: "Map billing" }, "done"),
      call(
        "c",
        "run_subagent",
        { description: "Review auth", agent: "sec-reviewer" },
        "calling",
        [{ name: "x", description: "Subagent · 3 tool calls", content: "" }],
      ),
    ]);
    expect(entries.map((e) => e.id)).toEqual(["b", "c"]);
    expect(entries[1]).toMatchObject({
      label: "Review auth",
      agent: "sec-reviewer",
      status: "calling",
      detail: "Subagent · 3 tool calls",
    });
  });

  it("is empty when no subagent was started", () => {
    expect(collectSubagents([])).toEqual([]);
  });
});
