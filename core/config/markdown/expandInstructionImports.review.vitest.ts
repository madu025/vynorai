import { beforeEach, describe, expect, it, vi } from "vitest";

import { IDE } from "../..";
import { getAllDotContinueDefinitionFiles } from "../loadLocalAssistants";
import { expandInstructionImports } from "./expandInstructionImports";
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

const ROOT = "file:///w/repo";

function ide(files: Record<string, string>) {
  return {
    getWorkspaceDirs: vi.fn().mockResolvedValue([ROOT]),
    fileExists: vi.fn(async (uri: string) => uri in files),
    readFile: vi.fn(async (uri: string) => files[uri]),
  } as unknown as IDE;
}

describe("sibling agent files are not repeated through @imports (code review)", () => {
  beforeEach(() => {
    vi.mocked(getAllDotContinueDefinitionFiles).mockResolvedValue([]);
  });

  it("CLAUDE.md that only imports AGENTS.md does not duplicate its content", async () => {
    const result = await loadMarkdownRules(
      ide({
        [`${ROOT}/AGENTS.md`]: "# Rules\nUse tabs.",
        [`${ROOT}/CLAUDE.md`]: "@AGENTS.md",
      }),
    );

    const all = result.rules.map((r) => r.rule).join("\n");
    expect(result.rules.map((r) => r.sourceFile)).toEqual([
      `${ROOT}/AGENTS.md`,
      `${ROOT}/CLAUDE.md`,
    ]);
    expect(all.match(/Use tabs\./g)).toHaveLength(1);
    // the import stays visible as text, pointing at the file that is loaded
    expect(result.rules[1].rule).toContain("@AGENTS.md");
  });

  it("still inlines a non-agent file that a sibling imports", async () => {
    const result = await loadMarkdownRules(
      ide({
        [`${ROOT}/AGENTS.md`]: "See @docs/style.md",
        [`${ROOT}/docs/style.md`]: "Two spaces.",
      }),
    );
    expect(result.rules[0].rule).toContain("Two spaces.");
  });
});

describe("a skipped or over-budget import does not poison later references (code review)", () => {
  it("honours skipUris explicitly", async () => {
    const out = await expandInstructionImports(
      "a @one.md b",
      `${ROOT}/CLAUDE.md`,
      ROOT,
      ide({ [`${ROOT}/one.md`]: "ONE" }),
      { skipUris: [`${ROOT}/one.md`] },
    );
    expect(out).toBe("a @one.md b");
  });

  it("an import that does not fit the budget leaves room for a smaller one", async () => {
    const huge = "H".repeat(60_000); // under the per-file cap
    const files: Record<string, string> = { [`${ROOT}/small.md`]: "small" };
    for (let i = 0; i < 4; i++) files[`${ROOT}/huge${i}.md`] = huge;
    // 4 x 60k does not fit 200k, the 4th is refused; a later small import must still work
    const text = "@huge0.md @huge1.md @huge2.md @huge3.md and then @small.md";
    const out = await expandInstructionImports(
      text,
      `${ROOT}/AGENTS.md`,
      ROOT,
      ide(files),
    );
    expect(out).toContain("@huge3.md");
    expect(out).toContain("small");
    expect(out).not.toContain("@small.md");
  });
});
