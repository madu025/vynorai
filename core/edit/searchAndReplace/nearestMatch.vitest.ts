import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { describe, expect, it } from "vitest";
import { ContinueErrorReason } from "../../util/errors";
import { executeFindAndReplace } from "./performReplace";

function errorOf(fn: () => unknown): { message: string; reason?: string } {
  try {
    fn();
  } catch (e: any) {
    return { message: e.message, reason: e.reason };
  }
  throw new Error("expected the call to throw");
}

const FILE = [
  "import { a } from './a';",
  "",
  "export function compute(items: number[]) {",
  "  let total = 0;",
  "  for (const item of items) {",
  "    total += item * 2;",
  "  }",
  "  return total;",
  "}",
  "",
  "export const name = 'demo';",
].join("\n");

describe("string-not-found error: nearest match hint", () => {
  it("shows the closest block when indentation differs and a value is wrong", () => {
    const oldString = "for (const item of items) {\ntotal += item * 3;\n}";
    const { message, reason } = errorOf(() =>
      executeFindAndReplace(FILE, oldString, "x", false),
    );
    expect(reason).toBe(ContinueErrorReason.FindAndReplaceOldStringNotFound);
    expect(message).toContain("closest block in the file is at lines 5-7");
    expect(message).toContain("5:   for (const item of items) {");
    expect(message).toContain("6:     total += item * 2;");
    expect(message).toContain("nothing was changed");
    expect(message).toContain("Re-read the file, then retry only this edit");
  });

  it("shows the closest block when one word is wrong", () => {
    const oldString = "  let total = 0;\n  for (const item of list) {";
    const { message } = errorOf(() =>
      executeFindAndReplace(FILE, oldString, "x", false),
    );
    expect(message).toContain("lines 4-5");
    expect(message).toContain("5:   for (const item of items) {");
    // context before and after the match
    expect(message).toContain("3: export function compute");
    expect(message).toContain("7:   }");
  });

  it("truncates a long old_string in the echo", () => {
    const long = "zzqx ".repeat(400);
    const { message } = errorOf(() =>
      executeFindAndReplace(FILE, long, "x", false),
    );
    expect(message).toContain("[truncated, ");
    expect(message.length).toBeLessThan(900);
    expect(message).not.toContain(long.slice(0, 400));
  });

  it("keeps the original message when nothing is similar", () => {
    const { message } = errorOf(() =>
      executeFindAndReplace(FILE, "qqqqwwww xxxxyyyy", "x", false, 3),
    );
    expect(message).toBe(
      'Edit at index 3: string not found in the latest file contents. No edits from this multi_edit call were applied. Re-read the file, then retry only this edit with a smaller exact old_string and enough surrounding context to make it unique. old_string: "qqqqwwww xxxxyyyy"',
    );
  });

  it("stays fast on a big file and skips oversized ones", () => {
    const big = Array.from(
      { length: 4000 },
      (_, i) => `  const value${i} = compute(${i}, "item-${i}");`,
    ).join("\n");
    const old = Array.from({ length: 40 }, (_, i) => `  const v${i} = 1;`).join(
      "\n",
    );
    const start = Date.now();
    errorOf(() => executeFindAndReplace(big, old, "x", false));
    expect(Date.now() - start).toBeLessThan(1500);

    const huge = "line of text here\n".repeat(20000);
    const t2 = Date.now();
    const { message } = errorOf(() =>
      executeFindAndReplace(huge, "line of text herE!", "x", false),
    );
    expect(message).not.toContain("closest block");
    expect(Date.now() - t2).toBeLessThan(1500);
  });

  it("never modifies the file after a failed edit", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nearest-"));
    const file = path.join(dir, "a.ts");
    fs.writeFileSync(file, FILE);
    const before = fs.statSync(file).mtimeMs;
    const content = fs.readFileSync(file, "utf8");
    errorOf(() =>
      executeFindAndReplace(
        content,
        "for (const item of list) {",
        "replaced",
        false,
      ),
    );
    expect(fs.readFileSync(file, "utf8")).toBe(FILE);
    expect(fs.statSync(file).mtimeMs).toBe(before);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
