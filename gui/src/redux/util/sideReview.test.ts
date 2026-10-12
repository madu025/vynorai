import { ChatHistoryItem } from "core";
import { describe, expect, it } from "vitest";

import { missingTodoGate } from "./completionGate";
import { pendingPremortem } from "./judgment";
import {
  diffForFiles,
  parseSideReview,
  SIDE_REVIEW_MAX_DIFF_CHARS,
  sideReviewPrompt,
  turnChanges,
  turnEdits,
} from "./sideReview";
import { unverifiedEdits } from "./verificationGate";

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

describe("one file, however its path is written", () => {
  const edit = (
    name: string,
    filepath: string,
    processedArgs?: object,
  ): ChatHistoryItem => {
    const item = editCall(name, filepath);
    (item.toolCallStates![0] as any).processedArgs = processedArgs;
    return item;
  };

  it("counts `src/a.ts` and `./src/a.ts` as one file in every gate", () => {
    const history = [
      user("fix the total"),
      edit("single_find_and_replace", "src/a.ts"),
      edit("single_find_and_replace", "./src/a.ts"),
    ];
    // Two spellings were two files: a one-file fix got the completion gate
    // and the pre-mortem, which are for changes of two files.
    expect(turnEdits(history).files).toEqual(["src/a.ts"]);
    expect(unverifiedEdits(history)).toEqual({ files: ["src/a.ts"] });
    expect(missingTodoGate(history)).toBe(false);
    expect(pendingPremortem(history, "careful")).toBeUndefined();
    expect([...turnChanges(history).keys()]).toEqual(["src/a.ts"]);
  });

  it("goes by the resolved URI, also for a file created in this turn", () => {
    const uri = "file:///d%3A/shop/src/a.ts";
    const history = [
      user("add the cart"),
      // A new file has no URI yet: preprocessing found nothing to resolve.
      edit("create_new_file", "src\\a.ts", { resolvedPath: null }),
      edit("single_find_and_replace", "./src/a.ts", { fileUri: uri }),
      edit("multi_edit", "d:/shop/src/a.ts", { resolvedPath: { uri } }),
      edit("multi_edit", "src/b.ts", {
        fileUri: "file:///d%3A/shop/src/b.ts",
      }),
    ];
    expect(turnEdits(history).files).toEqual(["src\\a.ts", "src/b.ts"]);
    expect(turnChanges(history).get("src\\a.ts")?.created).toBe(true);
  });

  it("keeps two files that only differ in case apart", () => {
    const history = [
      user("x"),
      edit("multi_edit", "src/Cart.ts"),
      edit("multi_edit", "src/cart.ts"),
    ];
    expect(turnEdits(history).files).toEqual(["src/Cart.ts", "src/cart.ts"]);
  });
});

describe("side review scope", () => {
  it("never falls back to unrelated diffs and finds new untracked files", async () => {
    const { diffForFiles, filesMissingFromDiff, newFileDiff } = await import(
      "./sideReview"
    );
    const other = "diff --git a/package-lock.json b/package-lock.json\n+x";
    const diff = diffForFiles([other], ["demo/math.js"]);
    expect(diff).toBe("");
    expect(filesMissingFromDiff(diff, ["demo/math.js"])).toEqual([
      "demo/math.js",
    ]);
    expect(newFileDiff("demo/math.js", "a\nb")).toContain(
      "+++ b/demo/math.js\n+a\n+b",
    );
  });
});

describe("turnChanges", () => {
  it("keeps only this turn's replacements for edited files", async () => {
    const { turnChanges, editsDiff } = await import("./sideReview");
    const history: any[] = [
      { message: { role: "user", content: "add subtract" }, contextItems: [] },
      {
        message: { role: "assistant", content: "" },
        contextItems: [],
        toolCallStates: [
          {
            status: "done",
            toolCall: { function: { name: "multi_edit" } },
            parsedArgs: {
              filepath: "demo/math.js",
              edits: [
                {
                  old_string: "module.exports = { add };",
                  new_string: "module.exports = { add, subtract };",
                },
              ],
            },
          },
        ],
      },
    ];
    const change = turnChanges(history).get("demo/math.js")!;
    expect(change.created).toBe(false);
    const diff = editsDiff("demo/math.js", change.edits);
    expect(diff).toContain("-module.exports = { add };");
    expect(diff).toContain("+module.exports = { add, subtract };");
  });
});
