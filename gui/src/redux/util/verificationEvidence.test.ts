import { describe, expect, test } from "vitest";
import {
  classifyVerificationCommand,
  verificationFromToolResult,
} from "./verificationEvidence";

describe("verification evidence", () => {
  test.each([
    ["npm test", "test"],
    ["npx vitest run", "test"],
    ["npm run typecheck", "typecheck"],
    ["npx eslint src", "lint"],
    ["pnpm build", "build"],
  ])("classifies %s", (command, kind) => {
    expect(classifyVerificationCommand(command)).toBe(kind);
  });

  test("does not treat arbitrary terminal commands as verification", () => {
    expect(classifyVerificationCommand("git status")).toBeUndefined();
  });

  test("fails evidence when the tool status reports a non-zero exit", () => {
    expect(
      verificationFromToolResult({
        toolName: "run_terminal_command",
        command: "npm test",
        output: [
          {
            name: "Terminal",
            description: "Terminal output",
            content: "",
            status: "Command failed with exit code 1",
          },
        ],
        failed: false,
      })?.status,
    ).toBe("failed");
  });

  test("accepts an inspected diff as review evidence", () => {
    expect(
      verificationFromToolResult({
        toolName: "view_diff",
        output: [],
        failed: false,
      }),
    ).toMatchObject({ kind: "review", status: "passed" });
  });
});
