import { ChatHistoryItem } from "core";
import { describe, expect, it } from "vitest";

import {
  diffForFiles,
  parseSideReview,
  SIDE_REVIEW_MAX_DIFF_CHARS,
  sideReviewPrompt,
  turnEdits,
} from "./sideReview";

const user = (content: string, isAutoPrompt = false) =>
  ({
    message: { role: "user", content },
    contextItems: [],
    isAutoPrompt,
  }) as ChatHistoryItem;
const editCall = (name: string, filepath: string, status = "done") =>
  ({
    message: { role: "assistant", content: "" },
    contextItems: [],
    toolCallStates: [
      { status, toolCall: { function: { name } }, parsedArgs: { filepath } },
    ],
  }) as unknown as ChatHistoryItem;

describe("side review", () => {
  it("collects files this turn changed, past auto prompts, with the real request", () => {
    const history = [
      user("old request"),
      editCall("multi_edit", "old.ts"),
      user("add login validation"),
      editCall("multi_edit", "src/auth.ts"),
      editCall("read_file", "src/db.ts"),
      editCall("create_new_file", "src/auth.test.ts"),
      editCall("multi_edit", "src/failed.ts", "errored"),
      user("[verification-gate] run the tests", true),
    ];
    expect(turnEdits(history)).toEqual({
      files: ["src/auth.ts", "src/auth.test.ts"],
      request: "add login validation",
    });
  });

  it("keeps only the changed files' hunks and caps the diff", () => {
    const diffs = [
      "diff --git a/src/auth.ts b/src/auth.ts\n+const key='x'\n",
      "diff --git a/README.md b/README.md\n+docs\n",
    ];
    const d = diffForFiles(diffs, ["src/auth.ts"]);
    expect(d).toContain("src/auth.ts");
    expect(d).not.toContain("README.md");
    const huge = diffForFiles(
      ["diff --git a/a.ts b/a.ts\n" + "x".repeat(20000)],
      ["a.ts"],
    );
    expect(huge.length).toBeLessThan(SIDE_REVIEW_MAX_DIFF_CHARS + 50);
  });

  it("shows nothing for NONE and at most three bullet lines otherwise", () => {
    expect(parseSideReview("NONE")).toBeNull();
    expect(parseSideReview("none.")).toBeNull();
    expect(parseSideReview("Looks fine overall.")).toBeNull();
    expect(
      parseSideReview("Here:\n- src/auth.ts: API key hardcoded\n- a\n- b\n- c"),
    ).toBe("- src/auth.ts: API key hardcoded\n- a\n- b");
    expect(sideReviewPrompt("x", "diff")).toMatch(/reply exactly: NONE/);
  });
});
