import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyDiffImpl, renameSymbolImpl } from "./patchTools";

let root: string;
const extras = () =>
  ({
    ide: { getWorkspaceDirs: async () => [pathToFileURL(root).href] },
  }) as any;
const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf-8");
const write = (rel: string, text: string) => {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), text, "utf-8");
};
const text = (items: any[]) => items.map((i) => i.content).join("\n");

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "vynor-patch-"));
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

const DIFF = `--- a/src/a.ts
+++ b/src/a.ts
@@ -1,2 +1,3 @@
 export const one = 1;
+export const two = 2;
 export const three = 3;
`;

describe("apply_diff", () => {
  it("dry run reports the change and writes nothing", async () => {
    write("src/a.ts", "export const one = 1;\nexport const three = 3;\n");
    const out = text(
      await applyDiffImpl({ diff: DIFF, dry_run: true }, extras()),
    );
    expect(out).toMatch(/dry run, nothing written/);
    expect(out).toContain("src/a.ts");
    expect(read("src/a.ts")).not.toContain("two");
  });

  it("applies the diff to disk", async () => {
    write("src/a.ts", "export const one = 1;\nexport const three = 3;\n");
    await applyDiffImpl({ diff: DIFF }, extras());
    expect(read("src/a.ts")).toContain("export const two = 2;");
  });

  it("tolerates drifted line numbers", async () => {
    write(
      "src/a.ts",
      "// header\n// more\n// lines\nexport const one = 1;\nexport const three = 3;\n",
    );
    await applyDiffImpl({ diff: DIFF }, extras());
    expect(read("src/a.ts")).toContain("export const two = 2;");
  });

  it("writes nothing when one file does not apply", async () => {
    write("src/a.ts", "export const one = 1;\nexport const three = 3;\n");
    const bad = `${DIFF}--- a/src/missing.ts
+++ b/src/missing.ts
@@ -1,1 +1,1 @@
-nothing here
+changed
`;
    await expect(applyDiffImpl({ diff: bad }, extras())).rejects.toThrow(
      /Nothing was written/,
    );
    expect(read("src/a.ts")).not.toContain("two");
  });

  it("refuses a path outside the workspace", async () => {
    const outside = path.join(os.tmpdir(), `vynor-outside-${Date.now()}.ts`);
    fs.writeFileSync(outside, "export const x = 1;\n");
    try {
      const d = `--- a/../${path.basename(outside)}
+++ b/../${path.basename(outside)}
@@ -1,1 +1,2 @@
 export const x = 1;
+export const y = 2;
`;
      await expect(applyDiffImpl({ diff: d }, extras())).rejects.toThrow();
      expect(fs.readFileSync(outside, "utf-8")).not.toContain("y");
    } finally {
      fs.rmSync(outside, { force: true });
    }
  });

  it("will not touch a secrets file", async () => {
    write(".env", "TOKEN=abc\n");
    const d = `--- a/.env
+++ b/.env
@@ -1,1 +1,2 @@
 TOKEN=abc
+OTHER=1
`;
    await expect(applyDiffImpl({ diff: d }, extras())).rejects.toThrow(
      /secrets/,
    );
    expect(read(".env")).toBe("TOKEN=abc\n");
  });

  it("needs a diff and a local workspace", async () => {
    await expect(applyDiffImpl({}, extras())).rejects.toThrow(/diff/);
    const remote = {
      ide: { getWorkspaceDirs: async () => ["vscode-remote://x"] },
    } as any;
    await expect(applyDiffImpl({ diff: DIFF }, remote)).rejects.toThrow(
      /local workspace/,
    );
  });
});

describe("rename_symbol", () => {
  beforeEach(() => {
    write(
      "src/util.ts",
      "export function computeTotal(n: number) {\n  return n * 2;\n}\n",
    );
    write(
      "src/use.ts",
      'import { computeTotal } from "./util";\nexport const v = computeTotal(2);\nexport const label = "computeTotal";\n',
    );
  });

  it("dry run lists files and writes nothing", async () => {
    const out = text(
      await renameSymbolImpl(
        {
          symbol: "computeTotal",
          new_name: "sumTotal",
          defining_file: "src/util.ts",
          dry_run: true,
        },
        extras(),
      ),
    );
    expect(out).toMatch(/Would rename/);
    expect(out).toContain("util.ts");
    expect(read("src/util.ts")).toContain("computeTotal");
  });

  it("renames definition and imports, leaves strings alone", async () => {
    await renameSymbolImpl(
      {
        symbol: "computeTotal",
        new_name: "sumTotal",
        defining_file: "src/util.ts",
      },
      extras(),
    );
    expect(read("src/util.ts")).toContain("function sumTotal");
    expect(read("src/use.ts")).toContain("import { sumTotal }");
    expect(read("src/use.ts")).toContain("sumTotal(2)");
    expect(read("src/use.ts")).toContain('"computeTotal"');
  });

  it("rejects an invalid new name and an escaping defining_file", async () => {
    await expect(
      renameSymbolImpl(
        { symbol: "computeTotal", new_name: "not valid" },
        extras(),
      ),
    ).rejects.toThrow(/valid identifier/);
    await expect(
      renameSymbolImpl(
        {
          symbol: "computeTotal",
          new_name: "x",
          defining_file: "../../etc/passwd",
        },
        extras(),
      ),
    ).rejects.toThrow(/outside the workspace/);
  });
});
