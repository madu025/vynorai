import fs from "fs";
import os from "os";
import path from "path";
import { pathToFileURL } from "url";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import {
  HookRunner,
  matchesTool,
  parseHooksConfig,
  PROJECT_HOOKS_PATH,
} from "./HookRunner";

// Portable hook commands (cmd.exe and sh both accept double-quoted node -e).
const node = (js: string) => `node -e "${js.replace(/"/g, '\\"')}"`;
const ALLOW_WITH_CONTEXT = node("process.stdout.write('use pnpm, not npm')");
const BLOCK = node(
  "process.stderr.write('rm -rf is not allowed');process.exit(2)",
);
const CRASH = node("process.stderr.write('boom');process.exit(1)");
const ECHO_TOOL = node(
  "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const p=JSON.parse(s);process.stdout.write(p.event+':'+p.toolName)})",
);

let globalDir: string;
let workspace: string;

function writeHooks(dir: string, hooks: unknown) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "hooks.json"), JSON.stringify({ hooks }));
}

function runner(
  opts: { trusted?: boolean; allow?: boolean; asked?: string[][] } = {},
) {
  return new HookRunner({
    globalDir,
    getWorkspaceDirs: async () => [pathToFileURL(workspace).toString()],
    isWorkspaceTrusted: async () => opts.trusted ?? true,
    confirmProjectHooks: async (_file, commands) => {
      opts.asked?.push(commands);
      return opts.allow ?? true;
    },
  });
}

beforeEach(() => {
  globalDir = fs.mkdtempSync(path.join(os.tmpdir(), "vynor-hooks-global-"));
  workspace = fs.mkdtempSync(path.join(os.tmpdir(), "vynor-hooks-ws-"));
});

afterEach(() => {
  // A process killed on timeout can hold its cwd for a moment on Windows.
  for (const dir of [globalDir, workspace]) {
    try {
      fs.rmSync(dir, {
        recursive: true,
        force: true,
        maxRetries: 20,
        retryDelay: 100,
      });
    } catch {}
  }
});

describe("parseHooksConfig", () => {
  test("accepts the flat and the Claude Code nested formats", () => {
    const flat = parseHooksConfig(
      {
        hooks: {
          PreToolUse: [
            { matcher: "run_terminal_command", command: "a", timeout: 5 },
          ],
        },
      },
      "user",
    );
    expect(flat.PreToolUse).toEqual([
      {
        command: "a",
        matcher: "run_terminal_command",
        timeoutSeconds: 5,
        source: "user",
      },
    ]);

    const nested = parseHooksConfig(
      {
        hooks: {
          PostToolUse: [
            {
              matcher: "multi_edit",
              hooks: [{ type: "command", command: "b" }],
            },
          ],
        },
      },
      "project",
    );
    expect(nested.PostToolUse[0]).toMatchObject({
      command: "b",
      matcher: "multi_edit",
      timeoutSeconds: 30,
    });
  });

  test("ignores malformed entries and caps the timeout", () => {
    const config = parseHooksConfig(
      {
        hooks: {
          Stop: [
            { command: "" },
            { type: "http", command: "x" },
            { command: "ok", timeout: 9999 },
          ],
          Bogus: [{ command: "y" }],
        },
      },
      "user",
    );
    expect(config.Stop).toHaveLength(1);
    expect(config.Stop[0].timeoutSeconds).toBe(120);
  });
});

test("matchesTool treats the matcher as an anchored regex", () => {
  expect(matchesTool(undefined, "read_file")).toBe(true);
  expect(matchesTool("*", "read_file")).toBe(true);
  expect(matchesTool("multi_edit|create_new_file", "create_new_file")).toBe(
    true,
  );
  expect(matchesTool("edit", "multi_edit")).toBe(false);
  expect(matchesTool("run_.*", "run_terminal_command")).toBe(true);
});

describe("HookRunner.run", () => {
  test("exit 2 blocks with stderr as the reason and stops later hooks", async () => {
    writeHooks(globalDir, {
      PreToolUse: [
        { matcher: "run_terminal_command", command: BLOCK },
        { matcher: "run_terminal_command", command: ALLOW_WITH_CONTEXT },
      ],
    });
    const result = await runner().run({
      event: "PreToolUse",
      toolName: "run_terminal_command",
    });
    expect(result).toMatchObject({
      blocked: true,
      reason: "rm -rf is not allowed",
      ran: 1,
    });
  });

  test("matcher limits which tools a hook sees", async () => {
    writeHooks(globalDir, {
      PreToolUse: [{ matcher: "run_terminal_command", command: BLOCK }],
    });
    const result = await runner().run({
      event: "PreToolUse",
      toolName: "read_file",
    });
    expect(result).toEqual({ blocked: false, warnings: [], ran: 0 });
  });

  test("exit 0 stdout becomes context; the payload arrives on stdin", async () => {
    writeHooks(globalDir, { PostToolUse: [{ command: ECHO_TOOL }] });
    const result = await runner().run({
      event: "PostToolUse",
      toolName: "multi_edit",
    });
    expect(result).toMatchObject({
      blocked: false,
      context: "PostToolUse:multi_edit",
    });
  });

  test("other exit codes and timeouts are warnings, never blocks", async () => {
    writeHooks(globalDir, {
      Stop: [
        { command: CRASH },
        { command: node("setTimeout(()=>{},10000)"), timeout: 1 },
      ],
    });
    const started = Date.now();
    const result = await runner().run({ event: "Stop" });
    expect(result.blocked).toBe(false);
    expect(result.warnings).toHaveLength(2);
    expect(result.warnings[0]).toContain("exited with code 1: boom");
    expect(result.warnings[1]).toContain("timed out after 1s");
    // The timeout must actually end the wait, not just signal the shell.
    expect(Date.now() - started).toBeLessThan(6_000);
  }, 15_000);
});

describe("project hooks", () => {
  test("need a trusted workspace", async () => {
    writeHooks(path.dirname(path.join(workspace, PROJECT_HOOKS_PATH)), {
      Stop: [{ command: BLOCK }],
    });
    const asked: string[][] = [];
    const result = await runner({ trusted: false, asked }).run({
      event: "Stop",
    });
    expect(result.ran).toBe(0);
    expect(asked).toHaveLength(0);
  });

  test("are approved once per file content and re-asked when it changes", async () => {
    const dir = path.dirname(path.join(workspace, PROJECT_HOOKS_PATH));
    writeHooks(dir, { Stop: [{ command: ALLOW_WITH_CONTEXT }] });
    const asked: string[][] = [];

    expect((await runner({ asked }).run({ event: "Stop" })).ran).toBe(1);
    expect((await runner({ asked }).run({ event: "Stop" })).ran).toBe(1);
    expect(asked).toHaveLength(1);

    writeHooks(dir, { Stop: [{ command: BLOCK }] });
    await runner({ asked }).run({ event: "Stop" });
    expect(asked).toHaveLength(2);
  });

  test("a declined file is skipped without asking again in the session", async () => {
    writeHooks(path.dirname(path.join(workspace, PROJECT_HOOKS_PATH)), {
      Stop: [{ command: BLOCK }],
    });
    const asked: string[][] = [];
    const declining = runner({ allow: false, asked });
    expect((await declining.run({ event: "Stop" })).ran).toBe(0);
    expect((await declining.run({ event: "Stop" })).ran).toBe(0);
    expect(asked).toHaveLength(1);
  });
});
