import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import type { Problem } from "../..";
import { formatDiagnostics, getDiagnosticsImpl } from "./getDiagnostics";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "vynor-diag-"));
fs.writeFileSync(path.join(root, "a.ts"), "const x: number = 'a';\n");
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
const rootUri = pathToFileURL(root).href;

const problem = (over: Partial<Problem> = {}): Problem => ({
  filepath: `${rootUri}/a.ts`,
  range: {
    start: { line: 0, character: 6 },
    end: { line: 0, character: 7 },
  },
  message: "Type 'string' is not assignable to type 'number'.",
  severity: "error",
  source: "ts",
  ...over,
});

describe("formatDiagnostics", () => {
  it("lists errors before warnings with 1-based positions and relative paths", () => {
    const text = formatDiagnostics(
      [
        problem({ severity: "warning", message: "unused" }),
        problem({ message: "boom" }),
      ],
      [rootUri],
    );
    const lines = text.split("\n");
    expect(lines[0]).toBe("1 error(s), 1 other problem(s)");
    expect(lines[1]).toBe("error a.ts:1:7 [ts]: boom");
    expect(lines[2]).toContain("warning a.ts:1:7");
    expect(text).not.toContain(os.tmpdir());
  });

  it("says so when there is nothing to report", () => {
    expect(formatDiagnostics([], [rootUri])).toBe(
      "No errors or warnings reported.",
    );
  });

  it("caps the list and says how many were left out", () => {
    const many = Array.from({ length: 55 }, (_, i) =>
      problem({
        message: `m${i}`,
        range: {
          start: { line: i, character: 0 },
          end: { line: i, character: 1 },
        },
      }),
    );
    const text = formatDiagnostics(many, [rootUri]);
    expect(text.split("\n")).toHaveLength(1 + 40 + 1);
    expect(text).toContain("and 15 more not shown");
  });

  it("treats a problem without severity as an error", () => {
    const text = formatDiagnostics(
      [problem({ severity: undefined })],
      [rootUri],
    );
    expect(text.split("\n")[0]).toBe("1 error(s), 0 other problem(s)");
  });
});

describe("getDiagnosticsImpl (real files)", () => {
  const ide = (seen: Array<string | undefined>) =>
    ({
      getWorkspaceDirs: async () => [rootUri],
      fileExists: async (uri: string) => fs.existsSync(new URL(uri)),
      getProblems: async (uri?: string) => {
        seen.push(uri);
        return [problem()];
      },
      readFile: async (uri: string) => fs.readFileSync(new URL(uri), "utf8"),
    }) as any;

  it("resolves a relative path against the workspace before asking the editor", async () => {
    const seen: Array<string | undefined> = [];
    const [item] = await getDiagnosticsImpl({ filepath: "a.ts" }, {
      ide: ide(seen),
    } as any);
    expect(seen[0]).toContain("a.ts");
    expect(item.content).toContain("error a.ts:1:7");
  });

  it("asks for the open file when no path is given", async () => {
    const seen: Array<string | undefined> = [];
    await getDiagnosticsImpl({}, { ide: ide(seen) } as any);
    expect(seen).toEqual([undefined]);
  });

  it("reports a file that does not exist instead of guessing", async () => {
    await expect(
      getDiagnosticsImpl({ filepath: "nope.ts" }, { ide: ide([]) } as any),
    ).rejects.toThrow(/does not exist/);
  });
});
