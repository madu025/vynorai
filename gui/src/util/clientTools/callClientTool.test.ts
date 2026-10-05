import { ToolCallState } from "core";
import { BuiltInToolNames } from "core/tools/builtIn";
import { describe, expect, it, vi } from "vitest";
import { callClientTool } from "./callClientTool";
import { singleFindAndReplaceImpl } from "./singleFindAndReplaceImpl";

vi.mock("./singleFindAndReplaceImpl", () => ({
  singleFindAndReplaceImpl: vi.fn(),
}));

function call(id: string): ToolCallState {
  return {
    toolCallId: id,
    status: "calling",
    toolCall: {
      id,
      type: "function",
      function: {
        name: BuiltInToolNames.SingleFindAndReplace,
        arguments: "{}",
      },
    },
    parsedArgs: {},
  };
}

describe("callClientTool edit queue", () => {
  it("runs the second edit only after the first one's apply has closed", async () => {
    const statuses: Record<string, string> = { a: "calling", b: "calling" };
    const applyClosed: Record<string, boolean> = {};
    const aborter = new AbortController();
    const getState = () =>
      ({
        session: {
          streamAborter: aborter,
          history: [
            {
              message: { role: "assistant", content: "" },
              toolCallStates: ["a", "b"].map((id) => ({
                ...call(id),
                status: statuses[id],
              })),
            },
          ],
          codeBlockApplyStates: {
            states: Object.keys(applyClosed).map((id) => ({
              streamId: id,
              toolCallId: id,
              status: "closed",
            })),
          },
        },
      }) as any;

    const started: string[] = [];
    vi.mocked(singleFindAndReplaceImpl).mockImplementation(async (_a, id) => {
      started.push(id);
      return { respondImmediately: false, output: undefined };
    });

    const extras = { getState, dispatch: vi.fn(), ideMessenger: {} as any };
    const first = callClientTool(call("a"), extras);
    const second = callClientTool(call("b"), extras);
    await first;
    await new Promise((r) => setTimeout(r, 250));
    // Both edits read the file then rewrite it whole: b must wait for a.
    expect(started).toEqual(["a"]);

    applyClosed.a = true;
    statuses.a = "done";
    await second;
    expect(started).toEqual(["a", "b"]);
  });
});
