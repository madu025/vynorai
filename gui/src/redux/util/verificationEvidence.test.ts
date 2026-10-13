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

  // The verification gate had its own list and took these for checks, while
  // the repair gate did not know them: a failing run got no repair prompt.
  test.each([
    ["node --test", "test"],
    ["node --test test/", "test"],
    ["node shop.test.js", "test"],
    ["python -m unittest", "test"],
    ["python3 -m pytest -q", "test"],
    ["make test", "test"],
    ["npx playwright test", "test"],
    ["deno test", "test"],
    ["php artisan test", "test"],
    ["npx tsx --test test/*.test.ts", "test"],
    ["yarn jest --ci", "test"],
    ["npm t", "test"],
    ["npm --prefix web run test:unit", "test"],
    ["cargo check", "typecheck"],
    ["go vet ./...", "lint"],
    ["./gradlew assemble", "build"],
    ["node_modules\\.bin\\tsc.cmd --noEmit", "typecheck"],
    ['powershell -Command "& { npm test }"', "test"],
    ["python -m build", "build"],
  ])("knows the runner in %s", (command, kind) => {
    expect(classifyVerificationCommand(command)).toBe(kind);
  });

  // A word somewhere in the command is not a check: these were test and lint
  // evidence, or satisfied the verification gate.
  test.each([
    "npm install --save-dev jest",
    "pnpm add -D vitest",
    "yarn add eslint",
    "npm ci",
    "cat eslint.config.js",
    "ls tests",
    "dir build",
    "mkdir build",
    "rm -rf build",
    "type jest.config.js",
    "cd tests",
    "echo npm test",
    'echo "run; npm test"',
    'grep -r "npm test" .',
    "findstr /s lint *.json",
    "node server.js",
    "git commit -m test",
  ])("does not take %s for a check", (command) => {
    expect(classifyVerificationCommand(command)).toBeUndefined();
  });

  // PowerShell separates with `;`, bash with `&&`, and a command may be
  // wrapped in `cmd /c "..."`.
  test.each([
    ["cd shop; npm test", "test"],
    ["cd shop && npm test", "test"],
    ["$env:CI='1'; npm run lint", "lint"],
    ["npm test 2>&1 | Select-Object -Last 20", "test"],
    ['cmd /c "cd shop && npm test"', "test"],
    ['powershell -NoProfile -Command "npm run build"', "build"],
    ["bash -lc 'npm run typecheck'", "typecheck"],
    ["CI=1 npm test", "test"],
    ["npm run build; npm test", "test"],
    ["npm install; mkdir build", undefined],
    ['cmd /c "npm install jest"', undefined],
  ])("reads each command of %s", (command, kind) => {
    expect(classifyVerificationCommand(command)).toBe(kind);
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
