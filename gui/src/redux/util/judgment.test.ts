import { ChatHistoryItem } from "core";
import { describe, expect, it } from "vitest";

import {
  PREMORTEM_GUIDANCE,
  pendingPremortem,
  reviewerModel,
} from "./judgment";

function user(content: string, isAutoPrompt = false): ChatHistoryItem {
  return {
    message: { role: "user", content, id: content },
    contextItems: [],
    isAutoPrompt,
  } as ChatHistoryItem;
}

function editTurn(...files: string[]): ChatHistoryItem {
  return {
    message: { role: "assistant", content: "", id: files.join() },
    contextItems: [],
    toolCallStates: files.map((filepath, i) => ({
      toolCallId: `${filepath}-${i}`,
      status: "done",
      parsedArgs: { filepath },
      toolCall: {
        id: `${filepath}-${i}`,
        type: "function",
        function: { name: "multi_edit", arguments: "{}" },
      },
    })),
  } as unknown as ChatHistoryItem;
}

describe("pendingPremortem", () => {
  it("careful asks once a turn changed two files", () => {
    const history = [user("fix it"), editTurn("a.ts", "b.ts")];
    expect(pendingPremortem(history, "careful")).toEqual({
      files: ["a.ts", "b.ts"],
    });
    expect(
      pendingPremortem([user("fix it"), editTurn("a.ts")], "careful"),
    ).toBeUndefined();
  });

  it("max asks for a single-file change; fast never asks", () => {
    const history = [user("fix it"), editTurn("a.ts")];
    expect(pendingPremortem(history, "max")).toEqual({ files: ["a.ts"] });
    expect(pendingPremortem(history, "fast")).toBeUndefined();
  });

  it("asks only once per prompt", () => {
    const history = [
      user("fix it"),
      editTurn("a.ts", "b.ts"),
      user(PREMORTEM_GUIDANCE, true),
      editTurn("c.ts"),
    ];
    expect(pendingPremortem(history, "max")).toBeUndefined();
    expect(
      pendingPremortem(
        [...history, user("next task"), editTurn("d.ts")],
        "max",
      ),
    ).toEqual({ files: ["d.ts"] });
  });
});

describe("reviewerModel", () => {
  const flash = { title: "Flash", model: "deepseek-flash", apiBase: "v" };
  const pro = { title: "Pro", model: "deepseek-v4-pro", apiBase: "v" };
  const otherPro = { title: "X", model: "deepseek-v4-pro", apiBase: "x" };

  it("uses V4 Pro from the same provider only at max", () => {
    expect(reviewerModel(flash, [flash, pro], "max")).toBe(pro);
    expect(reviewerModel(flash, [flash, pro], "careful")).toBe(flash);
    expect(reviewerModel(flash, [flash, otherPro], "max")).toBe(flash);
  });
});
