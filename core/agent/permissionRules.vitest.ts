import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { describe, expect, it, vi } from "vitest";

import type { IDE } from "..";
import {
  evaluatePermissionRules,
  loadPermissionRules,
  mergePermissionRules,
  parsePermissionRules,
  splitCommands,
} from "./permissionRules";

const rules = (r: { allow?: string[]; ask?: string[]; deny?: string[] }) => ({
  allow: r.allow ?? [],
  ask: r.ask ?? [],
  deny: r.deny ?? [],
});

const bash = (command: string) => ({
  toolName: "run_terminal_command",
  args: { command },
});

describe("parsePermissionRules", () => {
  it("accepts a permissions object or top-level lists", () => {
    expect(
      parsePermissionRules('{"permissions":{"deny":["Bash(rm:*)"]}}').deny,
    ).toEqual(["Bash(rm:*)"]);
    expect(parsePermissionRules('{"ask":["Bash(git push:*)"]}').ask).toEqual([
      "Bash(git push:*)",
    ]);
  });

  it("ignores bad JSON, wrong types and blank entries", () => {
    expect(parsePermissionRules("not json")).toEqual(rules({}));
    expect(parsePermissionRules('{"deny":"Bash"}')).toEqual(rules({}));
    expect(
      parsePermissionRules('{"deny":["", 5, "Edit(.env*)"]}').deny,
    ).toEqual(["Edit(.env*)"]);
  });
});

describe("evaluatePermissionRules", () => {
  it("returns nothing when no rule matches", () => {
    expect(
      evaluatePermissionRules(
        rules({ deny: ["Bash(rm:*)"] }),
        bash("npm test"),
      ),
    ).toBeUndefined();
  });

  it("deny beats ask, in any order", () => {
    const decision = evaluatePermissionRules(
      rules({ ask: ["Bash(git push:*)"], deny: ["Bash(git push --force:*)"] }),
      bash("git push --force origin main"),
    );
    expect(decision).toEqual({
      decision: "deny",
      rule: "Bash(git push --force:*)",
    });
    expect(
      evaluatePermissionRules(
        rules({ ask: ["Bash(git push:*)"] }),
        bash("git push origin main"),
      ),
    ).toEqual({ decision: "ask", rule: "Bash(git push:*)" });
  });

  it("matches a prefix rule on whole words only", () => {
    const r = rules({ deny: ["Bash(rm:*)"] });
    expect(evaluatePermissionRules(r, bash("rm -rf build"))).toBeTruthy();
    expect(evaluatePermissionRules(r, bash("rm"))).toBeTruthy();
    expect(evaluatePermissionRules(r, bash("rmdir build"))).toBeUndefined();
    expect(evaluatePermissionRules(r, bash("npm run rmcache"))).toBeUndefined();
  });

  it("checks every command in a chain, pipe or substitution", () => {
    const r = rules({ deny: ["Bash(rm:*)"] });
    for (const command of [
      "git status && rm -rf build",
      "ls; rm x",
      "cat a | rm b",
      "echo $(rm x)",
      "echo \u0060rm x\u0060",
    ]) {
      expect(evaluatePermissionRules(r, bash(command))?.decision).toBe("deny");
    }
    expect(splitCommands("a && b || c; d | e")).toEqual([
      "a",
      "b",
      "c",
      "d",
      "e",
    ]);
  });

  it("an exact rule matches only that command; wildcards match patterns", () => {
    const exact = rules({ ask: ["Bash(npm test)"] });
    expect(evaluatePermissionRules(exact, bash("npm test"))).toBeTruthy();
    expect(
      evaluatePermissionRules(exact, bash("npm test -- --watch")),
    ).toBeUndefined();

    const glob = rules({ ask: ["Bash(git push*)"] });
    expect(evaluatePermissionRules(glob, bash("git push origin"))).toBeTruthy();
    expect(evaluatePermissionRules(glob, bash("git pull"))).toBeUndefined();
  });

  it("applies file rules to edit and write tools by name or by path", () => {
    const r = rules({ deny: ["Edit(.env*)", "Write(.env*)"] });
    const edit = (filepath: string) => ({
      toolName: "edit_existing_file",
      args: { filepath },
    });
    expect(evaluatePermissionRules(r, edit(".env"))?.decision).toBe("deny");
    expect(
      evaluatePermissionRules(r, edit("config/.env.local"))?.decision,
    ).toBe("deny");
    expect(evaluatePermissionRules(r, edit("src/env.ts"))).toBeUndefined();
    expect(
      evaluatePermissionRules(r, {
        toolName: "create_new_file",
        args: { filepath: ".env" },
      })?.decision,
    ).toBe("deny");
  });

  it("matches directory globs against workspace-relative and absolute paths", () => {
    const r = rules({ deny: ["Edit(src/**)"] });
    const roots = ["C:\\work\\repo"];
    const edit = (filepath: string) => ({
      toolName: "edit_existing_file",
      args: { filepath },
    });
    expect(
      evaluatePermissionRules(r, edit("src/a/b.ts"), roots)?.decision,
    ).toBe("deny");
    expect(
      evaluatePermissionRules(r, edit("C:\\work\\repo\\src\\a\\b.ts"), roots)
        ?.decision,
    ).toBe("deny");
    expect(
      evaluatePermissionRules(r, edit("docs/a.md"), roots),
    ).toBeUndefined();
    expect(
      evaluatePermissionRules(rules({ deny: ["Read(**/secrets/**)"] }), {
        toolName: "read_file",
        args: { filepath: "a/secrets/key.txt" },
      })?.decision,
    ).toBe("deny");
  });

  it("a rule with no specifier covers every call of that tool, by alias or exact name", () => {
    expect(
      evaluatePermissionRules(rules({ ask: ["Bash"] }), bash("anything"))
        ?.decision,
    ).toBe("ask");
    expect(
      evaluatePermissionRules(rules({ deny: ["grep_search"] }), {
        toolName: "grep_search",
        args: { query: "x" },
      })?.decision,
    ).toBe("deny");
    expect(
      evaluatePermissionRules(rules({ deny: ["mcp_*"] }), {
        toolName: "mcp_github_create_issue",
        args: {},
      })?.decision,
    ).toBe("deny");
  });

  it("allow rules never relax anything yet", () => {
    expect(
      evaluatePermissionRules(
        rules({ allow: ["Bash(rm:*)"] }),
        bash("rm -rf x"),
      ),
    ).toBeUndefined();
  });

  it("matches other tools on their main argument", () => {
    expect(
      evaluatePermissionRules(
        rules({ ask: ["WebFetch(https://evil.example/*)"] }),
        {
          toolName: "fetch_url_content",
          args: { url: "https://evil.example/page" },
        },
      )?.decision,
    ).toBe("ask");
  });
});

describe("loadPermissionRules", () => {
  it("merges project rules from every root with the global file", async () => {
    const globalDir = fs.mkdtempSync(path.join(os.tmpdir(), "vynor-perm-"));
    fs.writeFileSync(
      path.join(globalDir, "permissions.json"),
      '{"permissions":{"deny":["Bash(sudo:*)"]}}',
    );
    const files: Record<string, string> = {
      "file:///w/a/.vynorai/permissions.json": '{"ask":["Bash(git push:*)"]}',
      "file:///w/b/.vynorai/permissions.json": "{ broken",
    };
    const ide = {
      getWorkspaceDirs: vi
        .fn()
        .mockResolvedValue(["file:///w/a", "file:///w/b", "file:///w/c"]),
      fileExists: vi.fn(async (uri: string) => uri in files),
      readFile: vi.fn(async (uri: string) => files[uri]),
    } as unknown as IDE;

    const merged = await loadPermissionRules(ide, globalDir);
    expect(merged.ask).toEqual(["Bash(git push:*)"]);
    expect(merged.deny).toEqual(["Bash(sudo:*)"]);
  });

  it("returns no rules when there are no files", async () => {
    const ide = {
      getWorkspaceDirs: vi.fn().mockResolvedValue([]),
      fileExists: vi.fn(),
      readFile: vi.fn(),
    } as unknown as IDE;
    expect(await loadPermissionRules(ide)).toEqual(rules({}));
    expect(mergePermissionRules([])).toEqual(rules({}));
  });
});
