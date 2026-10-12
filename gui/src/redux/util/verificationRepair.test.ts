import { describe, expect, test } from "vitest";

import {
  pendingVerificationRepair,
  unresolvedVerificationFailures,
  verificationFailed,
  verificationRepairPrompt,
} from "./verificationRepair";

/** What the terminal tool returns: the result is in `status`, not in the text. */
const check = (command: string, failed: boolean, content = "") => ({
  status: "done",
  toolCall: { function: { name: "run_terminal_command" } },
  parsedArgs: { command },
  output: [
    {
      name: "Terminal",
      description: "Terminal command output",
      status: failed ? "Command failed with exit code 1" : "Command completed",
      content,
    },
  ],
});
const failedTest = check("npm test", true, "Expected true to be false");
const passedTest = check("npm test", false, "5 passed");
const user = (content: string) => ({ message: { role: "user", content } });
const calls = (...toolCallStates: object[]) => ({
  message: { role: "assistant", content: "" },
  toolCallStates,
});
const answer = (content: string) => ({
  message: { role: "assistant", content },
});
/** The repair prompt as the gate sends it for the given history. */
const prompt = (history: object[]) => ({
  message: {
    role: "user",
    content: verificationRepairPrompt(
      pendingVerificationRepair(history as any)!,
    ),
  },
  isAutoPrompt: true,
});

describe("verificationFailed", () => {
  test("reads the tool's status line, never the output text", () => {
    for (const content of [
      "Tests: 5 passed, 0 failed",
      "test result: ok. 5 passed; 0 failed",
      "Failed: 0, Passed: 5",
      "✓ rejects the order when payment failed",
      "✓ returns 408 when the upstream timed out",
    ])
      expect(verificationFailed(check("npm test", false, content))).toBe(false);
    expect(verificationFailed(failedTest)).toBe(true);
    expect(
      verificationFailed({
        status: "done",
        output: [
          { name: "Terminal", description: "", status: "Command timed out" },
        ] as any,
      }),
    ).toBe(true);
    expect(verificationFailed({ status: "errored" })).toBe(true);
  });
});

describe("verification repair gate", () => {
  test("requests a minimal repair after a failed verification command", () => {
    const repair = pendingVerificationRepair([
      user("fix the test"),
      calls(failedTest),
    ] as any);
    expect(repair).toMatchObject({ command: "npm test", attempt: 1 });
    expect(verificationRepairPrompt(repair!)).toContain("Expected true");
  });

  test("does not prompt twice for the same failed check", () => {
    const history: object[] = [user("fix the test"), calls(failedTest)];
    history.push(prompt(history), answer("I could not fix it."));
    expect(pendingVerificationRepair(history as any)).toBeUndefined();
  });

  test("asks for a blocker report after two repair attempts, then stops", () => {
    const history: object[] = [user("fix the test"), calls(failedTest)];
    history.push(prompt(history), calls(failedTest));
    expect(pendingVerificationRepair(history as any)).toMatchObject({
      attempt: 2,
      limitReached: false,
    });

    history.push(prompt(history), calls(failedTest));
    const last = pendingVerificationRepair(history as any)!;
    expect(last.limitReached).toBe(true);
    expect(verificationRepairPrompt(last)).toContain("Do not claim");

    history.push(prompt(history), calls(failedTest));
    expect(pendingVerificationRepair(history as any)).toBeUndefined();
  });

  test("says nothing once the failing check has passed", () => {
    const history: object[] = [user("build the shop")];
    for (let i = 0; i < 6; i++) history.push(calls(failedTest));
    history.push(calls(passedTest), answer("Done."));
    expect(unresolvedVerificationFailures(history as any)).toEqual([]);
    expect(pendingVerificationRepair(history as any)).toBeUndefined();
  });

  test("still asks about a check left failing behind one that passed", () => {
    const repair = pendingVerificationRepair([
      user("build the shop"),
      calls(check("npm run build", true, "Cannot find module")),
      calls(failedTest),
      calls(passedTest),
      answer("Done."),
    ] as any);
    expect(repair).toMatchObject({ command: "npm run build", attempt: 1 });
  });

  test("keeps a failed check unverified until the same command passes", () => {
    const history = [user("fix the test"), calls(failedTest)] as any;
    expect(unresolvedVerificationFailures(history)).toEqual(["npm test"]);

    history.push(calls(passedTest));
    expect(unresolvedVerificationFailures(history)).toEqual([]);
  });
});
