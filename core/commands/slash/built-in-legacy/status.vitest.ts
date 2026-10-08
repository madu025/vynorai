import { describe, expect, it, vi } from "vitest";

import { addInfoSlashCommands, MemoryCommand, StatusCommand } from "./status";

async function collect(gen: AsyncGenerator<string | undefined>) {
  const parts: string[] = [];
  for await (const part of gen) if (typeof part === "string") parts.push(part);
  return parts.join("");
}

function sdk(overrides: Record<string, unknown> = {}) {
  return {
    ide: {
      getWorkspaceDirs: vi.fn().mockResolvedValue(["file:///w/alpha"]),
      getCurrentFile: vi.fn().mockResolvedValue(undefined),
      getBranch: vi.fn().mockResolvedValue("main"),
      isWorkspaceTrusted: vi.fn().mockResolvedValue(true),
    },
    config: {
      selectedModelByRole: { chat: { title: "VynorAI Auto" } },
      disableIndexing: false,
      rules: [],
    },
    activeWorkspaceDir: undefined,
    ...overrides,
  } as any;
}

describe("/status", () => {
  it("reports the project, branch, trust, model and index without absolute paths", async () => {
    const text = await collect(StatusCommand.run(sdk()));
    expect(text).toContain("Active project: **alpha** (branch `main`)");
    expect(text).toContain("Workspace trust: trusted");
    expect(text).toContain("Chat model: VynorAI Auto");
    expect(text).toContain("Codebase index: enabled");
    expect(text).not.toContain("file:///");
  });

  it("names the pinned root and lists all roots when several are open", async () => {
    const s = sdk({ activeWorkspaceDir: "file:///w/beta" });
    s.ide.getWorkspaceDirs.mockResolvedValue([
      "file:///w/alpha",
      "file:///w/beta",
    ]);
    const text = await collect(StatusCommand.run(s));
    expect(text).toContain("Active project: **beta**");
    expect(text).toContain("Open roots: alpha, beta");
  });

  it("flags a disabled index and a restricted workspace", async () => {
    const s = sdk();
    s.config.disableIndexing = true;
    s.ide.isWorkspaceTrusted.mockResolvedValue(false);
    const text = await collect(StatusCommand.run(s));
    expect(text).toContain("Codebase index: disabled");
    expect(text).toContain("restricted");
  });

  it("says so when no folder is open", async () => {
    const s = sdk();
    s.ide.getWorkspaceDirs.mockResolvedValue([]);
    expect(await collect(StatusCommand.run(s))).toContain("no folder is open");
  });

  it("counts loaded instruction files", async () => {
    const s = sdk();
    s.config.rules = [
      {
        source: "agentFile",
        sourceFile: "file:///w/alpha/AGENTS.md",
        rule: "x",
      },
      {
        source: "colocated-markdown",
        sourceFile: "file:///w/alpha/pkg/CLAUDE.md",
        rule: "y",
      },
      {
        source: "rules-block",
        sourceFile: "file:///w/alpha/.vynorai/rules/a.md",
        rule: "z",
      },
    ];
    expect(await collect(StatusCommand.run(s))).toContain(
      "Instruction files loaded: 2",
    );
  });
});

describe("/memory", () => {
  it("points to /init when nothing is loaded", async () => {
    expect(await collect(MemoryCommand.run(sdk()))).toContain("Run /init");
  });

  it("lists files grouped by kind with relative paths, scopes and sizes", async () => {
    const s = sdk();
    s.config.rules = [
      {
        source: "agentFile",
        sourceFile: "file:///w/alpha/AGENTS.md",
        rule: "12345",
      },
      {
        source: "colocated-markdown",
        sourceFile: "file:///w/alpha/packages/api/AGENTS.md",
        globs: "packages/api/**",
        rule: "abc",
      },
      {
        source: "rules-block",
        sourceFile: "file:///home/me/.vynorai/rules/style.md",
        rule: "zz",
      },
      { source: "default-agent", rule: "built in, no file" },
    ];
    const text = await collect(MemoryCommand.run(s));

    expect(text).toContain("Project instruction files (always applied)");
    expect(text).toContain("`AGENTS.md`, 5 characters");
    expect(text).toContain(
      "`packages/api/AGENTS.md` (applies to packages/api/**), 3 characters",
    );
    expect(text).toContain("`style.md (global)`");
    expect(text).not.toContain("file:///");
    expect(text).not.toContain("built in, no file");
  });
});

describe("addInfoSlashCommands", () => {
  it("adds /status and /memory once", () => {
    const list: any[] = [{ name: "init" }];
    addInfoSlashCommands(list);
    addInfoSlashCommands(list);
    expect(list.map((c) => c.name)).toEqual(["init", "status", "memory"]);
  });

  it("keeps a command the user defined with the same name", () => {
    const custom = { name: "status", description: "mine" };
    const list: any[] = [custom];
    addInfoSlashCommands(list);
    expect(list.filter((c) => c.name === "status")).toEqual([custom]);
    expect(list.map((c) => c.name)).toContain("memory");
  });
});
