import { markdownToRule } from "@continuedev/config-yaml";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { IDE } from "../..";
import { getAllDotContinueDefinitionFiles } from "../loadLocalAssistants";
import { setActiveRootUriProvider } from "../../workspace/activeRootProvider";
import { loadMarkdownRules } from "./loadMarkdownRules";

vi.mock("@continuedev/config-yaml", () => ({
  markdownToRule: vi.fn((content: string) => ({
    name: content,
    rule: content,
  })),
}));

vi.mock("../loadLocalAssistants", () => ({
  getAllDotContinueDefinitionFiles: vi.fn().mockResolvedValue([]),
}));

describe("loadMarkdownRules agent files", () => {
  const existingFiles = new Set([
    "file:///workspace-a/CLAUDE.md",
    "file:///workspace-b/AGENTS.md",
  ]);
  const ide = {
    getWorkspaceDirs: vi
      .fn()
      .mockResolvedValue(["file:///workspace-a", "file:///workspace-b"]),
    fileExists: vi.fn(async (uri: string) => existingFiles.has(uri)),
    readFile: vi.fn(async (uri: string) => `rules from ${uri}`),
  } as unknown as IDE;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAllDotContinueDefinitionFiles).mockResolvedValue([]);
  });

  it("falls back to supported filenames and loads each workspace", async () => {
    const result = await loadMarkdownRules(ide);

    expect(result.rules).toHaveLength(2);
    expect(result.rules.map((rule) => rule.sourceFile)).toEqual([
      "file:///workspace-a/CLAUDE.md",
      "file:///workspace-b/AGENTS.md",
    ]);
    expect(result.rules.every((rule) => rule.alwaysApply)).toBe(true);
    expect(markdownToRule).toHaveBeenCalledTimes(2);
  });
});

describe("loadMarkdownRules merges agent files in one root", () => {
  function ideWith(files: Record<string, string>) {
    return {
      getWorkspaceDirs: vi.fn().mockResolvedValue(["file:///root"]),
      fileExists: vi.fn(async (uri: string) => uri in files),
      readFile: vi.fn(async (uri: string) => files[uri]),
    } as unknown as IDE;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAllDotContinueDefinitionFiles).mockResolvedValue([]);
  });

  it("loads AGENTS.md and CLAUDE.md when both exist with different content", async () => {
    const result = await loadMarkdownRules(
      ideWith({
        "file:///root/AGENTS.md": "# Shared conventions",
        "file:///root/CLAUDE.md": "# Claude specific notes",
      }),
    );

    expect(result.rules.map((rule) => rule.sourceFile)).toEqual([
      "file:///root/AGENTS.md",
      "file:///root/CLAUDE.md",
    ]);
    expect(result.rules.every((rule) => rule.alwaysApply)).toBe(true);
  });

  it("skips a file whose content is identical to one already loaded", async () => {
    const result = await loadMarkdownRules(
      ideWith({
        "file:///root/AGENTS.md": "# Same\n",
        "file:///root/AGENT.md": "# Same",
        "file:///root/CLAUDE.md": "# Different",
      }),
    );

    expect(result.rules.map((rule) => rule.sourceFile)).toEqual([
      "file:///root/AGENTS.md",
      "file:///root/CLAUDE.md",
    ]);
  });

  it("does not dedupe identical files across different roots", async () => {
    const ide = {
      getWorkspaceDirs: vi.fn().mockResolvedValue(["file:///a", "file:///b"]),
      fileExists: vi.fn(async (uri: string) => uri.endsWith("AGENTS.md")),
      readFile: vi.fn(async () => "# Same everywhere"),
    } as unknown as IDE;

    const result = await loadMarkdownRules(ide);
    expect(result.rules).toHaveLength(2);
  });
});

describe("loadMarkdownRules orders agent files by the active root", () => {
  const files = new Set([
    "file:///w/alpha/AGENTS.md",
    "file:///w/beta/AGENTS.md",
    "file:///w/gamma/CLAUDE.md",
  ]);
  const ide = {
    getWorkspaceDirs: vi
      .fn()
      .mockResolvedValue([
        "file:///w/alpha",
        "file:///w/beta",
        "file:///w/gamma",
      ]),
    fileExists: vi.fn(async (uri: string) => files.has(uri)),
    readFile: vi.fn(async (uri: string) => `rules from ${uri}`),
  } as unknown as IDE;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAllDotContinueDefinitionFiles).mockResolvedValue([]);
    setActiveRootUriProvider(undefined);
  });

  it("keeps workspace order when no root is active", async () => {
    const { rules } = await loadMarkdownRules(ide);
    expect(rules.map((r) => r.sourceFile)).toEqual([
      "file:///w/alpha/AGENTS.md",
      "file:///w/beta/AGENTS.md",
      "file:///w/gamma/CLAUDE.md",
    ]);
  });

  it("puts the active root first and still loads every root", async () => {
    setActiveRootUriProvider(async () => "file:///w/gamma");
    const { rules } = await loadMarkdownRules(ide);
    expect(rules.map((r) => r.sourceFile)).toEqual([
      "file:///w/gamma/CLAUDE.md",
      "file:///w/alpha/AGENTS.md",
      "file:///w/beta/AGENTS.md",
    ]);
  });

  it("is not fooled by a root whose name starts with the active root's name", async () => {
    setActiveRootUriProvider(async () => "file:///w/al");
    const { rules } = await loadMarkdownRules(ide);
    expect(rules.map((r) => r.sourceFile)).toEqual([
      "file:///w/alpha/AGENTS.md",
      "file:///w/beta/AGENTS.md",
      "file:///w/gamma/CLAUDE.md",
    ]);
  });

  it("ignores a provider that throws", async () => {
    setActiveRootUriProvider(async () => {
      throw new Error("not ready");
    });
    const { rules } = await loadMarkdownRules(ide);
    expect(rules).toHaveLength(3);
  });
});

describe("loadMarkdownRules inlines @path imports from agent files", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAllDotContinueDefinitionFiles).mockResolvedValue([]);
    setActiveRootUriProvider(undefined);
  });

  it("expands an import in a root AGENTS.md", async () => {
    const files: Record<string, string> = {
      "file:///r/AGENTS.md": "# Project\nFollow @docs/style.md",
      "file:///r/docs/style.md": "Use two spaces.",
    };
    const ide = {
      getWorkspaceDirs: vi.fn().mockResolvedValue(["file:///r"]),
      fileExists: vi.fn(async (uri: string) => uri in files),
      readFile: vi.fn(async (uri: string) => files[uri]),
    } as unknown as IDE;

    const { rules } = await loadMarkdownRules(ide);

    expect(rules).toHaveLength(1);
    expect(rules[0].rule).toContain("Use two spaces.");
    expect(rules[0].rule).toContain("<!-- imported from docs/style.md -->");
  });
});
