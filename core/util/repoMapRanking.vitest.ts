import { describe, expect, it } from "vitest";

import {
  extractImportSpecifiers,
  rankRepoFiles,
  resolveImport,
  summarizeTree,
} from "./repoMapRanking";

describe("repo map ranking", () => {
  it("extracts JS/TS and Python imports", () => {
    expect(
      extractImportSpecifiers(
        "src/a.ts",
        `import { x } from "./util/x.js";\nexport * from '../types';\nconst y = require("./y");\nawait import("./lazy");\nimport "./side-effect";`,
      ),
    ).toEqual(["./util/x.js", "../types", "./y", "./lazy", "./side-effect"]);
    expect(
      extractImportSpecifiers(
        "pkg/mod.py",
        "from .helpers import a\nimport pkg.core\nfrom ..base import b",
      ),
    ).toEqual([".helpers", "..base", "pkg.core"]);
  });

  it("resolves relative imports to repo files, including ESM .js -> .ts", () => {
    const known = new Set([
      "src/util/x.ts",
      "src/types/index.ts",
      "pkg/helpers.py",
      "pkg/core/__init__.py",
    ]);
    expect(resolveImport("src/a.ts", "./util/x.js", known)).toBe(
      "src/util/x.ts",
    );
    expect(resolveImport("src/a/b.ts", "../types", known)).toBe(
      "src/types/index.ts",
    );
    expect(resolveImport("src/a.ts", "react", known)).toBeNull();
    expect(resolveImport("pkg/mod.py", ".helpers", known)).toBe(
      "pkg/helpers.py",
    );
    expect(resolveImport("pkg/mod.py", "pkg.core", known)).toBe(
      "pkg/core/__init__.py",
    );
  });

  it("puts widely imported source files first and tests, docs and builds last", () => {
    const files = [
      { path: "docs/guide.ts", content: "", signatureCount: 5 },
      { path: "dist/bundle.js", content: "", signatureCount: 50 },
      {
        path: "src/feature.test.ts",
        content: `import "./db";`,
        signatureCount: 8,
      },
      {
        path: "src/a.ts",
        content: `import { q } from "./db";`,
        signatureCount: 2,
      },
      {
        path: "src/b.ts",
        content: `import { q } from "./db";`,
        signatureCount: 2,
      },
      {
        path: "src/c.ts",
        content: `import { q } from "./db.js";`,
        signatureCount: 2,
      },
      { path: "src/db.ts", content: "", signatureCount: 3 },
    ];
    const ranked = rankRepoFiles(files);
    expect(ranked[0]).toBe("src/db.ts");
    expect(ranked.slice(-3)).toEqual([
      "src/feature.test.ts",
      "docs/guide.ts",
      "dist/bundle.js",
    ]);
    // Deterministic: same input, same order.
    expect(rankRepoFiles([...files].reverse())).toEqual(ranked);
  });

  it("summarizes leftover files as a folder outline, largest first", () => {
    expect(
      summarizeTree([
        "src/ui/a.tsx",
        "src/ui/b.tsx",
        "src/api/c.ts",
        "README.md",
        "scripts/x.sh",
      ]),
    ).toBe(
      "src/ui/ (2 files)\n./ (1 file)\nscripts/ (1 file)\nsrc/api/ (1 file)",
    );
  });
});
