import type { ChatHistoryItem } from "core";
import {
  MAX_AUTONOMOUS_STEPS,
  REPEAT_LIMIT_ERROR,
  STEP_LIMIT_ERROR,
} from "core/agent/guardErrors";
import { describe, expect, it } from "vitest";
import {
  failureFingerprint,
  guardErrorForModel,
  isRecoverableGuardError,
  NO_CHANGE_LIMIT,
  progressCounters,
  progressPause,
  SAME_FAILURE_LIMIT,
  SAME_FAILURE_MARKER,
  SAME_FAILURE_NUDGE,
  sameFailureNudge,
  sameFailureStreak,
  STALL_LIMIT,
} from "./agentProgress";

const item = (message: any, extra: any = {}) =>
  ({ message, contextItems: [], ...extra }) as ChatHistoryItem;
const user = (text: string, isAutoPrompt = false) =>
  item({ role: "user", content: text }, { isAutoPrompt });
const text = (content: string) => item({ role: "assistant", content });
const round = (
  name: string,
  args: unknown,
  status = "done",
  output?: unknown,
) =>
  item(
    {
      role: "assistant",
      content: "",
      toolCalls: [
        { id: "t", type: "function", function: { name, arguments: "" } },
      ],
    },
    {
      toolCallStates: [
        {
          status,
          toolCall: {
            id: "t",
            type: "function",
            function: { name, arguments: "" },
          },
          parsedArgs: args,
          output,
        },
      ],
    },
  );
const write = (n: number) =>
  round("create_new_file", { filepath: `src/f${n}.js` });
const read = (n: number) => round("read_file", { filepath: `src/f${n}.js` });
/**
 * A new file as the session really holds it: preprocessing leaves only
 * `resolvedPath`, and that is null because the file does not exist yet.
 */
const writeNew = (n: number) => {
  const item = write(n);
  (item.toolCallStates![0] as any).processedArgs = { resolvedPath: null };
  return item;
};
/** What the terminal tool returns: the result is in `status`, not in the text. */
const run = (command: string, failed: boolean, content: string) =>
  round("run_terminal_command", { command }, "done", [
    {
      name: "Terminal",
      description: "Terminal command output",
      status: failed ? "Command failed with exit code 1" : "Command completed",
      content,
    },
  ]);
const passing = (content = "5 passed", command = "npm test") =>
  run(command, false, content);
const failing = (content: string, command = "npm test") =>
  run(command, true, content);
const todos = (...statuses: string[]) =>
  round("update_todo_list", {
    todos: statuses.map((status, i) => ({ content: `item ${i}`, status })),
  });
const FAIL = "1 failed: cart total is NaN";

describe("progressCounters", () => {
  it("never pauses a long build that keeps writing files", () => {
    const history = [
      user("build a shop"),
      ...Array.from({ length: 120 }, (_, i) => write(i)),
    ];
    expect(progressCounters(history)).toEqual({ idle: 0, unchanged: 0 });
    expect(progressPause(history)).toBeUndefined();
  });

  it("tells new files apart when preprocessing left only a null path", () => {
    // Seen in a shop build: eleven files written in a row, then "stalled".
    const history = [
      user("build a shop"),
      ...Array.from({ length: 20 }, (_, i) => writeNew(i)),
    ];
    expect(progressCounters(history)).toEqual({ idle: 0, unchanged: 0 });
    expect(progressPause(history)).toBeUndefined();
  });

  it("counts failed calls and exact repeats as learning nothing", () => {
    const history = [
      user("fix it"),
      write(1),
      passing(),
      passing(),
      passing(),
      round("read_file", { filepath: "missing.js" }, "errored"),
    ];
    // The first test run is new information; the repeats and the error are not.
    expect(progressCounters(history).idle).toBe(3);
  });

  it("does not take writing the same change again for progress", () => {
    const history = [user("fix it"), write(1), write(1), write(1)];
    expect(progressCounters(history)).toEqual({ idle: 2, unchanged: 2 });
  });

  it("pauses a turn that only repeats itself", () => {
    const history = [
      user("fix it"),
      ...Array.from({ length: STALL_LIMIT + 1 }, () => passing()),
    ];
    expect(progressPause(history)).toBe("stalled");
  });

  it("lets the agent read widely, but not without end", () => {
    const reads = (n: number) => Array.from({ length: n }, (_, i) => read(i));
    const exploring = [user("how does checkout work?"), ...reads(20)];
    expect(progressCounters(exploring)).toEqual({ idle: 0, unchanged: 20 });
    expect(progressPause(exploring)).toBeUndefined();
    expect(
      progressPause([user("fix checkout"), ...reads(NO_CHANGE_LIMIT)]),
    ).toBe("no_change");
  });

  it("does not call a plan-mode investigation 'no change'", () => {
    // Plan mode has no edit tools, so nothing there can ever count as a change.
    const reads = Array.from({ length: NO_CHANGE_LIMIT + 5 }, (_, i) =>
      read(i),
    );
    const history = [user("plan the checkout rewrite"), ...reads];
    expect(progressPause(history, "plan")).toBeUndefined();
    expect(progressPause(history, "agent")).toBe("no_change");
  });

  it("counts an edit, a check turning green and a closed todo as change", () => {
    const base = [
      user("fix it"),
      ...Array.from({ length: 12 }, (_, i) => read(i)),
    ];
    expect(progressCounters(base).unchanged).toBe(12);
    expect(progressCounters([...base, write(1)]).unchanged).toBe(0);
    expect(
      progressCounters([...base, failing(FAIL), passing()]).unchanged,
    ).toBe(0);
    // A check that was never failing learns something but changes nothing.
    expect(progressCounters([...base, passing()]).unchanged).toBe(13);
    expect(
      progressCounters([
        ...base,
        todos("completed", "pending"),
        todos("completed", "completed"),
      ]).unchanged,
    ).toBe(0);
    // Re-sending the same list is not a change.
    expect(
      progressCounters([
        ...base,
        todos("completed", "pending"),
        todos("completed", "pending"),
      ]).unchanged,
    ).toBe(1);
  });

  it("leaves answers with no tool call out of both counts", () => {
    const history = [
      user("build"),
      write(1),
      text("Done."),
      user("[todo-gate] finish", true),
      text("They cannot be done because the API key is missing."),
      user("[verification-gate] check", true),
      text("No check applies."),
    ];
    expect(progressCounters(history)).toEqual({ idle: 0, unchanged: 0 });
  });

  it("starts again at the user's next prompt, not at an automatic one", () => {
    const stuck = [user("a"), passing(), passing(), passing()];
    expect(
      progressCounters([...stuck, user("[todo-gate] finish", true)]).idle,
    ).toBe(2);
    expect(progressCounters([...stuck, user("continue")]).idle).toBe(0);
  });
});

describe("failureFingerprint", () => {
  const print = (content: string) =>
    failureFingerprint([{ name: "t", description: "", content }]);

  it("ignores what moves between two runs of the same failure", () => {
    expect(print("a.ts:12:34 - error TS2304\nDuration 3.2s at 10:42:07")).toBe(
      print("a.ts:156:78 - error TS2304\nDuration 4.9s at 10:43:55"),
    );
    expect(print("src/a.ts(12,34): error TS2304")).toBe(
      print("src/a.ts(112,4): error TS2304"),
    );
    expect(print("listening on port 51234, pid 8812 at 0x7ffd3a")).toBe(
      print("listening on port 60001, pid 9140 at 0x7ffe10"),
    );
  });

  it("keeps what tells two failures apart", () => {
    expect(print("1 failed: cart total is NaN")).not.toBe(
      print("1 failed: stock is negative"),
    );
    expect(print("3 failed, 2 passed")).not.toBe(print("1 failed, 4 passed"));
    expect(print("Cannot find module './cart'")).not.toBe(
      print("Cannot find module './orders'"),
    );
  });
});

describe("sameFailureStreak", () => {
  it("counts the same failure across edits and moving line numbers", () => {
    const history: ChatHistoryItem[] = [user("fix it")];
    for (let i = 0; i < 6; i++)
      history.push(
        write(i),
        failing(`cart.test.js:${10 + i * 40}:5\n${FAIL}\nDuration ${i}.4s`),
      );
    expect(sameFailureStreak(history)).toEqual({
      command: "npm test",
      streak: 6,
    });
  });

  it("is not reset by another check passing or failing in between", () => {
    const history: ChatHistoryItem[] = [user("fix it")];
    for (let i = 0; i < 6; i++)
      history.push(
        write(i),
        failing(FAIL),
        passing("no errors", "npx tsc --noEmit"),
        failing(`lint: ${i} problems`, "npx eslint src"),
      );
    expect(sameFailureStreak(history)).toEqual({
      command: "npm test",
      streak: 6,
    });
  });

  it("starts again when the failure changes or the check passes", () => {
    const history = [
      user("fix it"),
      failing(FAIL),
      write(1),
      failing(FAIL),
      write(2),
      failing("1 failed: stock is negative"),
    ];
    expect(sameFailureStreak(history)?.streak).toBe(1);
    expect(
      sameFailureStreak([...history, write(3), passing()]),
    ).toBeUndefined();
  });

  it("does not take a passing run that prints the word failed for a failure", () => {
    const history: ChatHistoryItem[] = [user("build")];
    for (const out of [
      "Tests: 5 passed, 0 failed",
      "test result: ok. 5 passed; 0 failed",
      "Failed: 0, Passed: 5",
      "✓ rejects the order when payment failed",
      "✓ returns 408 when the upstream timed out",
    ])
      for (let i = 0; i < SAME_FAILURE_LIMIT; i++)
        history.push(write(history.length), passing(out));
    expect(sameFailureStreak(history)).toBeUndefined();
    expect(progressPause(history)).toBeUndefined();
  });
});

describe("same failure: a note first, a pause later", () => {
  const loop = (times: number) => {
    const history: ChatHistoryItem[] = [user("fix it")];
    for (let i = 0; i < times; i++) history.push(write(i), failing(FAIL));
    return history;
  };

  it("says nothing while the failure is young", () => {
    expect(sameFailureNudge(loop(SAME_FAILURE_NUDGE - 1))).toBeUndefined();
  });

  it("tells the model once and does not pause yet", () => {
    const history = loop(SAME_FAILURE_NUDGE);
    const nudge = sameFailureNudge(history)!;
    expect(nudge.startsWith(SAME_FAILURE_MARKER)).toBe(true);
    expect(nudge).toContain("`npm test`");
    expect(progressPause(history)).toBeUndefined();

    history.push(user(nudge, true), write(99), failing(FAIL));
    expect(sameFailureNudge(history)).toBeUndefined();
  });

  it("pauses when the failure goes on after the note", () => {
    // Every answer edited a new file, so nothing else would stop this loop.
    const history = loop(SAME_FAILURE_LIMIT);
    expect(progressCounters(history).idle).toBe(0);
    expect(progressPause(history)).toBe("same_failure");
  });

  it("is not a pause for a build whose failures keep changing", () => {
    const history: ChatHistoryItem[] = [user("build a shop")];
    for (let i = 0; i < 60; i++)
      history.push(write(i), failing(`${60 - i} failed`));
    expect(progressPause(history)).toBeUndefined();
  });
});

describe("the core's guard refusals", () => {
  it("are recognised by the texts the core throws", () => {
    expect(isRecoverableGuardError(`Error: ${STEP_LIMIT_ERROR}`)).toBe(true);
    expect(isRecoverableGuardError(REPEAT_LIMIT_ERROR)).toBe(true);
    expect(isRecoverableGuardError("Task is terminal")).toBe(false);
    expect(guardErrorForModel(REPEAT_LIMIT_ERROR)).toContain("3 times");
  });

  it("pause the turn once when a call is refused at the action limit", () => {
    const refused = round("read_file", { filepath: "a.js" }, "errored", [
      {
        name: "error",
        description: "",
        content: guardErrorForModel(STEP_LIMIT_ERROR),
      },
    ]);
    expect(progressPause([user("build"), write(1), refused])).toBe("actions");
    expect(progressPause([user("build"), write(1)])).toBeUndefined();
  });

  it("are replaced by a count here when the prompt has no task", () => {
    // A failed task start leaves no task, so no call is authorized by the
    // core and its action net never fires.
    const build = (calls: number) => [
      user("old prompt"),
      write(0),
      user("build"),
      ...Array.from({ length: calls }, (_, i) => write(i + 1)),
    ];
    expect(progressPause(build(MAX_AUTONOMOUS_STEPS), "agent", false)).toBe(
      "actions",
    );
    expect(
      progressPause(build(MAX_AUTONOMOUS_STEPS - 1), "agent", false),
    ).toBeUndefined();
    // With a task the core counts; the GUI does not pause on its own count.
    expect(
      progressPause(build(MAX_AUTONOMOUS_STEPS + 5), "agent", true),
    ).toBeUndefined();
  });
});
