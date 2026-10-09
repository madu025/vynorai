import { describe, expect, it, vi } from "vitest";

import type { IDE } from "..";
import {
  evaluatePermissionRules,
  loadPermissionRulesDetailed,
  normalizeCommand,
  parsePermissionRulesDetailed,
  splitCommands,
} from "./permissionRules";

const rules = (r: { ask?: string[]; deny?: string[] }) => ({
  allow: [],
  ask: r.ask ?? [],
  deny: r.deny ?? [],
});
const bash = (command: string) => ({
  toolName: "run_terminal_command",
  args: { command },
});
const edit = (filepath: string) => ({
  toolName: "edit_existing_file",
  args: { filepath },
});

describe("deny rules cannot be dodged with shell tricks (code review)", () => {
  const deny = rules({ deny: ["Bash(rm:*)"] });

  it.each([
    "echo ok & rm -rf build",
    "echo ok &rm -rf build",
    "/bin/rm -rf build",
    "C:\\Windows\\System32\\rm.exe -rf build",
    "sudo rm -rf build",
    "sudo -n /bin/rm -rf build",
    "env FOO=1 rm -rf build",
    "FOO=1 BAR=2 rm -rf build",
    "ls | xargs rm",
    "nohup rm -rf build",
    "timeout 5 rm -rf build",
    "time rm x",
    "ls\r\nrm x",
    "(rm -rf build)",
    "{ rm x; }",
  ])("denies %s", (command) => {
    expect(evaluatePermissionRules(deny, bash(command))?.decision).toBe("deny");
  });

  it("still allows commands that only look similar", () => {
    for (const command of [
      "rmdir build",
      "echo rm",
      "npm run rm-cache",
      "sudo ls",
      "firm -x",
    ]) {
      expect(evaluatePermissionRules(deny, bash(command))).toBeUndefined();
    }
  });

  it("normalizes wrappers, assignments and program paths", () => {
    expect(normalizeCommand("sudo -n /usr/bin/git push origin")).toBe(
      "git push origin",
    );
    expect(normalizeCommand("A=1 env B=2 nice -n 5 rm x")).toBe("rm x");
    expect(normalizeCommand("sudo")).toBe("");
    expect(splitCommands("a & b && c")).toEqual(["a", "b", "c"]);
  });

  it("applies the same normalization to ask rules", () => {
    expect(
      evaluatePermissionRules(
        rules({ ask: ["Bash(git push:*)"] }),
        bash("sudo git push --force"),
      )?.decision,
    ).toBe("ask");
  });
});

describe("path rules handle URIs, .. segments and root files (code review)", () => {
  it("matches a file: URI against a plain-path rule", () => {
    const r = rules({ deny: ["Edit(secrets/**)"] });
    const roots = ["/proj"];
    expect(
      evaluatePermissionRules(r, edit("file:///proj/secrets/key.txt"), roots)
        ?.decision,
    ).toBe("deny");
    expect(
      evaluatePermissionRules(
        r,
        edit("file:///d%3A/My%20Proj/secrets/key.txt"),
        ["d:\\My Proj"],
      )?.decision,
    ).toBe("deny");
  });

  it("collapses .. so a rule cannot be dodged", () => {
    const r = rules({ deny: ["Edit(secrets/**)"] });
    expect(
      evaluatePermissionRules(r, edit("src/../secrets/a.txt"))?.decision,
    ).toBe("deny");
  });

  it("**/ matches zero directories, so a root .env is covered", () => {
    const r = rules({ deny: ["Edit(**/.env)"] });
    expect(evaluatePermissionRules(r, edit(".env"))?.decision).toBe("deny");
    expect(evaluatePermissionRules(r, edit("a/b/.env"))?.decision).toBe("deny");
    expect(
      evaluatePermissionRules(r, edit("a/b/.environment")),
    ).toBeUndefined();
    const dir = rules({ deny: ["Read(**/secrets/**)"] });
    expect(
      evaluatePermissionRules(dir, {
        toolName: "read_file",
        args: { filepath: "secrets/k" },
      })?.decision,
    ).toBe("deny");
  });
});

describe("a rules file that cannot be used is reported, not ignored (code review)", () => {
  it("explains a syntax error", () => {
    const parsed = parsePermissionRulesDetailed(
      '{"ask": ["Bash(git push:*)"],}',
    );
    expect(parsed.rules.ask).toEqual([]);
    expect(parsed.error).toBeTruthy();
    expect(
      parsePermissionRulesDetailed('{"deny":["Bash"]}').error,
    ).toBeUndefined();
  });

  it("lists broken and unreadable files as problems", async () => {
    const files: Record<string, string> = {
      "file:///w/a/.vynorai/permissions.json": '{"ask": ["Bash"],}',
      "file:///w/b/.vynorai/permissions.json": '{"deny":["Bash(rm:*)"]}',
    };
    const ide = {
      getWorkspaceDirs: vi
        .fn()
        .mockResolvedValue(["file:///w/a", "file:///w/b", "file:///w/c"]),
      fileExists: vi.fn(
        async (uri: string) => uri in files || uri.includes("/c/"),
      ),
      readFile: vi.fn(async (uri: string) => {
        if (uri.includes("/c/")) throw new Error("EACCES");
        return files[uri];
      }),
    } as unknown as IDE;

    const loaded = await loadPermissionRulesDetailed(ide);
    expect(loaded.rules.deny).toEqual(["Bash(rm:*)"]);
    expect(loaded.problems).toHaveLength(2);
    expect(loaded.problems.join(" ")).toMatch(/EACCES/);
  });

  it("tolerates getWorkspaceDirs returning nothing", async () => {
    const ide = {
      getWorkspaceDirs: vi.fn().mockResolvedValue(undefined),
      fileExists: vi.fn(),
      readFile: vi.fn(),
    } as unknown as IDE;
    expect((await loadPermissionRulesDetailed(ide)).problems).toEqual([]);
  });
});
