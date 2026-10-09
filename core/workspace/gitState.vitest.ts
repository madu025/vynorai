import { execFileSync, execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  parseGitState,
  readGitState,
  resetGitStateCache,
  resetGitStateCacheForTests,
} from "./gitState";

// A real git repository in a temp folder, real git commands: no mocks.
const repo = fs.mkdtempSync(path.join(os.tmpdir(), "vynor-git-"));
const git = (...args: string[]) =>
  execFileSync("git", args, { cwd: repo, encoding: "utf8" });
git("init", "-q");
git("config", "user.email", "t@example.com");
git("config", "user.name", "Test");
fs.writeFileSync(path.join(repo, "a.ts"), "1\n");
fs.writeFileSync(path.join(repo, "b.ts"), "1\n");
git("add", ".");
git("commit", "-q", "-m", "first commit");
fs.writeFileSync(path.join(repo, "b.ts"), "2\n");
fs.writeFileSync(path.join(repo, "new.ts"), "x\n");
fs.writeFileSync(path.join(repo, ".env"), "TOKEN=abc\n");
afterAll(() => fs.rmSync(repo, { recursive: true, force: true }));
beforeEach(() => resetGitStateCacheForTests());

const run = (command: string, cwd?: string) =>
  [
    execSync(command, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }),
    "",
  ] as [string, string];
const ide = {
  subprocess: async (command: string, cwd?: string) => run(command, cwd),
} as any;

describe("readGitState (real repository)", () => {
  it("reports changed files and recent commits with relative paths", async () => {
    const state = await readGitState(ide, pathToFileURL(repo).href);
    expect(state?.changedTotal).toBe(3);
    expect(state?.changed.join("\n")).toContain("M b.ts");
    expect(state?.changed.join("\n")).toContain("?? new.ts");
    expect(state?.recent[0]).toMatch(/^[0-9a-f]+ first commit$/);
    expect(JSON.stringify(state)).not.toContain(os.tmpdir());
  });

  it("counts a secrets file but never lists it", async () => {
    const state = await readGitState(ide, pathToFileURL(repo).href);
    expect(state?.changedTotal).toBe(3);
    expect(state?.changed.join("\n")).not.toContain(".env");
  });

  it("is undefined for a folder that is not a git repository", async () => {
    const plain = fs.mkdtempSync(path.join(os.tmpdir(), "vynor-nogit-"));
    try {
      const state = await readGitState(ide, pathToFileURL(plain).href);
      expect(state).toBeUndefined();
    } finally {
      fs.rmSync(plain, { recursive: true, force: true });
    }
  });

  it("is undefined for a remote folder and an IDE without subprocess", async () => {
    expect(
      await readGitState(ide, "vscode-remote://ssh/home/x"),
    ).toBeUndefined();
    expect(
      await readGitState({} as any, pathToFileURL(repo).href),
    ).toBeUndefined();
  });
});

describe("parseGitState", () => {
  it("keeps the new name of a rename and caps the listed files", () => {
    const status = [
      "R  old.ts -> new.ts",
      ...Array.from({ length: 20 }, (_, i) => ` M f${i}.ts`),
    ].join("\n");
    const state = parseGitState(status, "");
    expect(state.changed[0]).toBe("R new.ts");
    expect(state.changed).toHaveLength(15);
    expect(state.changedTotal).toBe(21);
  });
});

describe("review fixes: git state", () => {
  it("never lists a secrets file whose name git has to quote", () => {
    const status = [
      '?? "my app/.env"',
      '?? "certs/prod key.pem"',
      '?? "docs/notes file.md"',
    ].join("\n");
    const state = parseGitState(status, "");
    expect(state.changedTotal).toBe(3);
    expect(state.changed).toHaveLength(1);
    expect(state.changed[0]).toContain("docs/notes file.md");
  });

  it("a repository with no commits still reports its changes", async () => {
    const fresh = fs.mkdtempSync(path.join(os.tmpdir(), "vynor-nocommit-"));
    try {
      execFileSync("git", ["init", "-q"], { cwd: fresh });
      fs.writeFileSync(path.join(fresh, "x.txt"), "x\n");
      const state = await readGitState(ide, pathToFileURL(fresh).href);
      expect(state?.changedTotal).toBe(1);
      expect(state?.recent).toEqual([]);
    } finally {
      fs.rmSync(fresh, { recursive: true, force: true });
    }
  });

  it("parallel callers share one read, and a reset forces a fresh one", async () => {
    let calls = 0;
    const counting = {
      subprocess: async (command: string, cwd?: string) => {
        calls += 1;
        return run(command, cwd);
      },
    } as any;
    const uri = pathToFileURL(repo).href;
    await Promise.all([
      readGitState(counting, uri),
      readGitState(counting, uri),
      readGitState(counting, uri),
    ]);
    expect(calls).toBe(2); // status + log, once
    resetGitStateCache();
    await readGitState(counting, uri);
    expect(calls).toBe(4);
  });

  it("uses --no-optional-locks so polling never holds the index lock", async () => {
    const commands: string[] = [];
    const spy = {
      subprocess: async (command: string, cwd?: string) => {
        commands.push(command);
        return run(command, cwd);
      },
    } as any;
    await readGitState(spy, pathToFileURL(repo).href);
    expect(commands.length).toBe(2);
    expect(commands.every((c) => c.includes("--no-optional-locks"))).toBe(true);
  });
});
