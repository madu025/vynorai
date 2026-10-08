import { describe, expect, it } from "vitest";

import { IDE } from "../..";
import {
  expandInstructionImports,
  MAX_IMPORT_DEPTH,
  resolveImportUri,
} from "./expandInstructionImports";

const ROOT = "file:///w/repo";

function ide(files: Record<string, string>) {
  return {
    fileExists: async (uri: string) => uri in files,
    readFile: async (uri: string) => files[uri],
  } as unknown as IDE;
}

describe("resolveImportUri", () => {
  it("resolves relative to the importing file and stays inside the root", () => {
    expect(resolveImportUri(`${ROOT}/pkg/AGENTS.md`, "docs/a.md", ROOT)).toBe(
      `${ROOT}/pkg/docs/a.md`,
    );
    expect(
      resolveImportUri(`${ROOT}/pkg/AGENTS.md`, "../shared.md", ROOT),
    ).toBe(`${ROOT}/shared.md`);
    expect(
      resolveImportUri(`${ROOT}/AGENTS.md`, "../outside.md", ROOT),
    ).toBeNull();
    expect(
      resolveImportUri(`${ROOT}/AGENTS.md`, "../../../etc/x.md", ROOT),
    ).toBeNull();
  });

  it("does not treat a sibling folder with the same prefix as inside the root", () => {
    expect(
      resolveImportUri(`${ROOT}/AGENTS.md`, "../repo-other/x.md", ROOT),
    ).toBeNull();
  });
});

describe("expandInstructionImports", () => {
  it("inlines an import and marks where it came from", async () => {
    const out = await expandInstructionImports(
      "# Rules\nSee @docs/style.md for style.",
      `${ROOT}/AGENTS.md`,
      ROOT,
      ide({ [`${ROOT}/docs/style.md`]: "Use tabs." }),
    );
    expect(out).toContain("<!-- imported from docs/style.md -->");
    expect(out).toContain("Use tabs.");
    expect(out).toContain("for style.");
    expect(out).not.toContain("@docs/style.md for");
  });

  it("resolves nested imports relative to the file that contains them", async () => {
    const out = await expandInstructionImports(
      "@docs/a.md",
      `${ROOT}/AGENTS.md`,
      ROOT,
      ide({
        [`${ROOT}/docs/a.md`]: "A then @sub/b.md",
        [`${ROOT}/docs/sub/b.md`]: "B then @../c.md",
        [`${ROOT}/docs/c.md`]: "C body",
      }),
    );
    expect(out).toContain("C body");
  });

  it("follows at most four levels of imports", async () => {
    const files: Record<string, string> = {};
    for (let i = 1; i <= MAX_IMPORT_DEPTH + 2; i++) {
      files[`${ROOT}/f${i}.md`] = `level ${i} @f${i + 1}.md`;
    }
    const out = await expandInstructionImports(
      "root @f1.md",
      `${ROOT}/AGENTS.md`,
      ROOT,
      ide(files),
    );
    expect(out).toContain("level 4");
    expect(out).not.toContain("level 5");
    expect(out).toContain("@f5.md");
  });

  it("ignores imports inside inline code and fenced blocks", async () => {
    const text =
      "Use `@docs/a.md` literally.\n```\n@docs/a.md\n```\nreal: @docs/a.md";
    const out = await expandInstructionImports(
      text,
      `${ROOT}/AGENTS.md`,
      ROOT,
      ide({ [`${ROOT}/docs/a.md`]: "IMPORTED" }),
    );
    expect(out.match(/IMPORTED/g)).toHaveLength(1);
    expect(out).toContain("`@docs/a.md`");
    expect(out).toContain("```\n@docs/a.md\n```");
  });

  it("never reads outside the workspace root", async () => {
    let reads = 0;
    const out = await expandInstructionImports(
      "@../secret.md and @../../x/y.txt",
      `${ROOT}/AGENTS.md`,
      ROOT,
      {
        fileExists: async () => true,
        readFile: async () => {
          reads++;
          return "SECRET";
        },
      } as unknown as IDE,
    );
    expect(reads).toBe(0);
    expect(out).toBe("@../secret.md and @../../x/y.txt");
  });

  it("leaves missing files, emails, scoped packages and cycles untouched", async () => {
    const out = await expandInstructionImports(
      "@missing.md me@example.md @types/node @a.md",
      `${ROOT}/AGENTS.md`,
      ROOT,
      ide({ [`${ROOT}/a.md`]: "A -> @a.md" }),
    );
    expect(out).toContain("@missing.md");
    expect(out).toContain("me@example.md");
    expect(out).toContain("@types/node");
    expect(out).toContain("A -> @a.md"); // self import left as text
  });

  it("inlines a file imported twice only once", async () => {
    const out = await expandInstructionImports(
      "@a.md\n@a.md",
      `${ROOT}/AGENTS.md`,
      ROOT,
      ide({ [`${ROOT}/a.md`]: "ONCE" }),
    );
    expect(out.match(/ONCE/g)).toHaveLength(1);
  });

  it("skips an oversized import and returns content unchanged when there are none", async () => {
    const big = "x".repeat(70 * 1024);
    const out = await expandInstructionImports(
      "@big.md",
      `${ROOT}/AGENTS.md`,
      ROOT,
      ide({ [`${ROOT}/big.md`]: big }),
    );
    expect(out).toBe("@big.md");
    expect(
      await expandInstructionImports(
        "plain",
        `${ROOT}/AGENTS.md`,
        ROOT,
        ide({}),
      ),
    ).toBe("plain");
  });
});
