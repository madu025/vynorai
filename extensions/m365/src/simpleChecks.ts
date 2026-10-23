/**
 * Rule-based check of the plainest formula there is: a total, average, count, minimum or maximum
 * over one column on the same sheet. It reads the column and compares the range with the numbers
 * that are really there (first and last numeric row) and with the column the result sits under.
 * This is what lets a small change skip the reviewer models: the mistakes they are best at
 * catching in such a change (a range one row short, the wrong column) are checked here.
 * `isSimpleAggregate` is the gate: a formula this check cannot verify is not low risk.
 */
import type { AgentHost, StagedChange } from "./agent.js";

const AGG =
  /^=\s*(SUM|AVERAGE|COUNT|MAX|MIN|MEDIAN)\(\s*\$?([A-Z]{1,3})\$?(\d+)\s*:\s*\$?([A-Z]{1,3})\$?(\d+)\s*\)\s*$/i;
const CELL = /^\$?([A-Z]{1,3})\$?(\d+)$/i;
/** Columns are read up to this row; a total further down is not verified here (so not low risk). */
export const SIMPLE_MAX_ROW = 5000;

export function isSimpleAggregate(
  change: Extract<StagedChange, { kind: "write_formula" }>,
): boolean {
  if (change.fillRange) return false;
  const match = AGG.exec(change.formula);
  const cell = CELL.exec(change.cell);
  if (!match || !cell) return false;
  if (match[2].toUpperCase() !== match[4].toUpperCase()) return false;
  return Number(cell[2]) <= SIMPLE_MAX_ROW;
}

const columnNumber = (letters: string) =>
  [...letters.toUpperCase()].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);

export async function checkSimpleFormulas(
  changes: readonly { change: StagedChange }[],
  host: AgentHost,
): Promise<string[]> {
  const issues: string[] = [];
  for (const { change } of changes) {
    if (change.kind !== "write_formula" || !isSimpleAggregate(change)) continue;
    const match = AGG.exec(change.formula)!;
    const cell = CELL.exec(change.cell)!;
    const column = match[2].toUpperCase();
    const start = Number(match[3]);
    const end = Number(match[5]);
    const cellRow = Number(cell[2]);
    const where = `'${change.sheet}'!${change.cell}`;
    if (cellRow > 1 && cellRow - 1 >= end) {
      // The result sits under its range: it must be under the same column.
      if (cellRow === end + 1 && cell[1].toUpperCase() !== column)
        issues.push(
          `${where}: ${change.formula} sums column ${column} but the result sits under column ${cell[1].toUpperCase()}.`,
        );
    }
    try {
      const read = await host.readRange(
        change.sheet,
        `${column}1:${column}${Math.max(cellRow - 1, end, 1)}`,
        false,
      );
      const numbers: number[] = [];
      read.values.forEach((row, index) => {
        const value = (row as unknown[])[0];
        if (typeof value === "number" && Number.isFinite(value)) numbers.push(index + 1);
      });
      const inside = numbers.filter((row) => row < cellRow || row <= end);
      if (!inside.length) {
        issues.push(`${where}: column ${column} holds no numbers in ${change.formula}.`);
        continue;
      }
      const first = Math.min(...inside);
      const last = Math.max(...inside.filter((row) => row < cellRow || cellRow <= start));
      if (end < last && last < cellRow)
        issues.push(
          `${where}: ${change.formula} stops at row ${end} but the numbers in column ${column} run to row ${last}.`,
        );
      if (start > first)
        issues.push(
          `${where}: ${change.formula} starts at row ${start} but the numbers in column ${column} start at row ${first}.`,
        );
    } catch {
      // A column that cannot be read is not judged here.
    }
  }
  return issues;
}

/**
 * True when a small write would replace cells that already hold something (outside a sheet this
 * plan creates). That is a change the reviewer models should look at, so it is not low risk.
 */
export async function overwritesExisting(
  changes: readonly { change: StagedChange }[],
  host: AgentHost,
): Promise<boolean> {
  const created = new Set(
    changes.flatMap(({ change }) => (change.kind === "create_sheet" ? [change.name] : [])),
  );
  for (const { change } of changes) {
    if (change.kind !== "write_values" || created.has(change.sheet)) continue;
    const cell = CELL.exec(change.cell);
    if (!cell) return true;
    const rows = change.values.length;
    const columns = Math.max(1, ...change.values.map((row) => row.length));
    const last = `${columnLetters(columnNumber(cell[1]) + columns - 1)}${Number(cell[2]) + rows - 1}`;
    try {
      const read = await host.readRange(change.sheet, `${cell[1]}${cell[2]}:${last}`, false);
      if (
        read.values.some((row) =>
          (row as unknown[]).some((v) => v !== null && v !== undefined && String(v).trim() !== ""),
        )
      )
        return true;
    } catch {
      return true;
    }
  }
  return false;
}

const columnLetters = (n: number): string => {
  let out = "";
  for (let v = n; v > 0; v = Math.floor((v - 1) / 26)) out = String.fromCharCode(65 + ((v - 1) % 26)) + out;
  return out;
};
