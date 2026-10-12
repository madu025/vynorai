import { describe, expect, it } from "vitest";
import {
  MAX_VERIFICATION_GATES,
  unverifiedEdits,
  VERIFICATION_GATE_MARKER,
  verificationGatePrompt,
} from "./verificationGate";

function user(content: string, isAutoPrompt = false) {
  return {
    message: { role: "user", content },
    contextItems: [],
    isAutoPrompt,
  } as any;
}

function tools(...calls: [string, object, string?][]) {
  return {
    message: { role: "assistant", content: "" },
    contextItems: [],
    toolCallStates: calls.map(([name, parsedArgs, status = "done"], i) => ({
      toolCallId: `${name}-${i}`,
      status,
      parsedArgs,
      toolCall: {
        id: `${name}-${i}`,
        type: "function",
        function: { name, arguments: JSON.stringify(parsedArgs) },
      },
    })),
  } as any;
}

const edit = (filepath: string): [string, object] => [
  "single_find_and_replace",
  { filepath },
];
const run = (command: string): [string, object] => [
  "run_terminal_command",
  { command },
];

describe("unverifiedEdits", () => {
  it("flags edits with no check after the last edit", () => {
    const history = [
      user("fix login"),
      tools(edit("src/auth.ts"), edit("src/login.ts")),
    ];
    expect(unverifiedEdits(history)).toEqual({
      files: ["src/auth.ts", "src/login.ts"],
    });
  });

  it("passes when a check ran after the last edit", () => {
    const history = [
      user("fix login"),
      tools(edit("src/auth.ts")),
      tools(run("npx vitest run auth")),
    ];
    expect(unverifiedEdits(history)).toBeUndefined();
  });

  it("flags again when a file is edited after the check", () => {
    const history = [
      user("fix"),
      tools(edit("a.ts")),
      tools(run("npm test")),
      tools(edit("b.ts")),
    ];
    // a.ts was covered by the check; only b.ts is left to verify.
    expect(unverifiedEdits(history)).toEqual({ files: ["b.ts"] });
  });

  it("ignores non-check commands, failed edits and earlier prompts", () => {
    expect(
      unverifiedEdits([
        user("x"),
        tools(edit("a.ts")),
        tools(run("git status")),
      ]),
    ).toEqual({ files: ["a.ts"] });
    expect(
      unverifiedEdits([user("x"), tools([...edit("a.ts"), "errored"] as any)]),
    ).toBeUndefined();
    expect(
      unverifiedEdits([
        user("old"),
        tools(edit("a.ts")),
        user("question only"),
      ]),
    ).toBeUndefined();
  });

  it("asks once about the same edits", () => {
    const history = [
      user("fix"),
      tools(edit("a.ts")),
      user(`${VERIFICATION_GATE_MARKER} ...`, true),
      {
        message: { role: "assistant", content: "No check applies: docs only." },
        contextItems: [],
      } as any,
    ];
    expect(unverifiedEdits(history)).toBeUndefined();
  });

  it("asks again when files are edited after the question", () => {
    const history = [
      user("fix"),
      tools(edit("a.ts")),
      user(`${VERIFICATION_GATE_MARKER} ...`, true),
      tools(edit("b.ts")),
    ];
    expect(unverifiedEdits(history)).toEqual({ files: ["a.ts", "b.ts"] });
  });

  it("is not switched off by an earlier prompt of another kind", () => {
    const history = [
      user("build"),
      tools(edit("a.ts")),
      tools(run("npm test")),
      user("[verification-repair] The check `npm test` failed", true),
      tools(run("npm test")),
      ...Array.from({ length: 20 }, (_, i) => tools(edit(`src/f${i}.ts`))),
    ];
    expect(unverifiedEdits(history)?.files).toHaveLength(20);
  });

  it("stops asking after the limit", () => {
    const history = [user("build")];
    for (let i = 0; i < MAX_VERIFICATION_GATES; i++) {
      history.push(tools(edit(`f${i}.ts`)));
      expect(unverifiedEdits(history)).toBeDefined();
      history.push(user(`${VERIFICATION_GATE_MARKER} ...`, true));
    }
    history.push(tools(edit("last.ts")));
    expect(unverifiedEdits(history)).toBeUndefined();
  });
});

describe("verificationGatePrompt", () => {
  it("names the files and detected commands", () => {
    const prompt = verificationGatePrompt(
      ["src/a.ts"],
      [
        { command: "npm test", kind: "test" } as any,
        { command: "npm test", kind: "test" } as any,
        { command: "npx tsc --noEmit", kind: "typecheck" } as any,
      ],
    );
    expect(prompt).toContain("src/a.ts");
    expect(prompt).toContain("`npm test`, `npx tsc --noEmit`");
    expect(prompt.startsWith(VERIFICATION_GATE_MARKER)).toBe(true);
  });
});
