import { describe, expect, test } from "vitest";

import {
  pendingVerificationRepair,
  verificationRepairPrompt,
} from "./verificationRepair";

const failedTest = {
  status: "done",
  toolCall: { function: { name: "run_terminal_command" } },
  parsedArgs: { command: "npm test" },
  output: [
    {
      name: "Terminal",
      description: "Command failed with exit code 1",
      content: "Expected true to be false",
    },
  ],
};

describe("verification repair gate", () => {
  test("requests a minimal repair after a failed verification command", () => {
    const repair = pendingVerificationRepair([
      { message: { role: "user", content: "fix the test" } },
      {
        message: { role: "assistant", content: "" },
        toolCallStates: [failedTest],
      },
    ] as any);
    expect(repair).toMatchObject({ command: "npm test", attempt: 1 });
    expect(verificationRepairPrompt(repair!)).toContain("Expected true");
  });

  test("does not prompt twice for the same failed check", () => {
    const repair = pendingVerificationRepair([
      { message: { role: "user", content: "fix the test" } },
      {
        message: { role: "assistant", content: "" },
        toolCallStates: [failedTest],
      },
      {
        message: {
          role: "user",
          content: "[verification-repair] repair this",
        },
        isAutoPrompt: true,
      },
    ] as any);
    expect(repair).toBeUndefined();
  });

  test("ends automatic repair after the second failed check", () => {
    const repair = pendingVerificationRepair([
      { message: { role: "user", content: "fix the test" } },
      {
        message: { role: "assistant", content: "" },
        toolCallStates: [failedTest],
      },
      {
        message: { role: "user", content: "[verification-repair] first" },
        isAutoPrompt: true,
      },
      {
        message: { role: "assistant", content: "" },
        toolCallStates: [failedTest],
      },
    ] as any);
    expect(repair).toMatchObject({ attempt: 2, limitReached: true });
    expect(verificationRepairPrompt(repair!)).toContain("Do not claim");
  });
});
