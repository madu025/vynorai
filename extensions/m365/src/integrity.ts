/**
 * After a result sheet is written, the add-in reads a bounded part of it back and compares it with
 * what it meant to write. A mismatch is reported to the person instead of being sent on silently:
 * lost leading zeros, a text ID turned into a number, a changed number, a wrong row count.
 */
type Cell = string | number | boolean | null;

export type IntegrityIssue = {
  kind: "row-count" | "leading-zero" | "text-became-number" | "value-changed";
  message: string;
};

const blank = (cell: unknown) =>
  cell === null || cell === undefined || cell === "";

/** Excel returns an empty cell as "" and a typed boolean as a boolean; compare on a common footing. */
const same = (expected: Cell, actual: unknown): boolean => {
  if (blank(expected) && blank(actual)) return true;
  if (typeof expected === "number" && typeof actual === "number")
    return Math.abs(expected - actual) < 1e-9 * Math.max(1, Math.abs(expected));
  return expected === actual;
};

/**
 * `expected` and `actual` are the data rows (no header). `sampleRows` rows from the top and the last
 * rows are compared; a check never reads the whole sheet.
 */
export function compareWrittenRows(
  expected: readonly Cell[][],
  actual: readonly unknown[][],
  headers: readonly string[],
  actualRowCount: number = actual.length,
): IntegrityIssue[] {
  const issues: IntegrityIssue[] = [];
  if (actualRowCount !== expected.length)
    issues.push({
      kind: "row-count",
      message: `Expected ${expected.length} data rows but the result sheet has ${actualRowCount}.`,
    });
  const counts = {
    zero: new Map<number, number>(),
    text: new Map<number, number>(),
    value: new Map<number, number>(),
  };
  const bump = (map: Map<number, number>, column: number) =>
    map.set(column, (map.get(column) ?? 0) + 1);
  const limit = Math.min(expected.length, actual.length);
  for (let row = 0; row < limit; row += 1) {
    const want = expected[row];
    const got = actual[row] ?? [];
    for (let column = 0; column < want.length; column += 1) {
      const e = want[column];
      const a = got[column];
      if (same(e, a)) continue;
      if (
        typeof e === "string" &&
        /^0\d+$/.test(e.trim()) &&
        typeof a === "number"
      )
        bump(counts.zero, column);
      else if (typeof e === "string" && typeof a === "number")
        bump(counts.text, column);
      else bump(counts.value, column);
    }
  }
  const name = (column: number) => headers[column] || `column ${column + 1}`;
  for (const [column, count] of counts.zero)
    issues.push({
      kind: "leading-zero",
      message: `"${name(column)}": ${count} value(s) lost their leading zeros in the result.`,
    });
  for (const [column, count] of counts.text)
    issues.push({
      kind: "text-became-number",
      message: `"${name(column)}": ${count} text value(s) were turned into numbers in the result.`,
    });
  for (const [column, count] of counts.value)
    issues.push({
      kind: "value-changed",
      message: `"${name(column)}": ${count} value(s) differ from what was written.`,
    });
  return issues;
}

/** One sentence for the pane, or undefined when the result matches. */
export function describeIntegrityIssues(
  issues: readonly IntegrityIssue[],
): string | undefined {
  if (!issues.length) return undefined;
  return `Check the result before using it: ${issues.map((issue) => issue.message).join(" ")} Your original data is untouched; undo and clean again, or fix those columns.`;
}
