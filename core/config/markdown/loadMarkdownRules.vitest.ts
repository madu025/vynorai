import { markdownToRule } from "@continuedev/config-yaml";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { IDE } from "../..";
import { getAllDotContinueDefinitionFiles } from "../loadLocalAssistants";
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
