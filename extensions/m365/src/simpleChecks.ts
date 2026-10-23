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

export interface SimpleCheck {
  issues: string[];
  /** A column could not be read: the change was not verified, so it must go to the reviewers. */
  unverified: boolean;
}

export async function checkSimpleFormulas(
  changes: readonly { change: StagedChange }[],
  host: AgentHost,
): Promise<SimpleCheck> {
  const issues: string[] = [];
  let unverified = false;
  for (const { change } of changes) {
    if (change.kind !== "write_formula" || !isSimpleAggregate(change)) continue;
    const match = AGG.exec(change.formula)!;
    const cell = CELL.exec(change.cell)!;
    const column = match[2].toUpperCase();
    const start = Number(match[3]);
    const end = Number(match[5]);
    const cellRow = Number(cell[2]);
    const sameColumn = cell[1].toUpperCase() === column;
    const where = `'${change.sheet}'!${change.cell}`;
    // The result sits directly under its range: it must be under the same column.
    if (cellRow === end + 1 && !sameColumn)
      issues.push(
        `${where}: ${change.formula} sums column ${column} but the result sits under column ${cell[1].toUpperCase()}.`,
      );
    try {
      const read = await host.readRange(change.sheet, `${column}1:${column}${SIMPLE_MAX_ROW}`, false);
      const numeric = new Set<number>();
      read.values.forEach((row, index) => {
        const value = (row as unknown[])[0];
        const row1 = index + 1;
        // The cell being written in this column is not data.
        if (typeof value === "number" && Number.isFinite(value) && !(sameColumn && row1 >= cellRow))
          numeric.add(row1);
      });
      // The block of numbers the range belongs to: the run that holds its last number at or above its end.
      const upTo = [...numeric].filter((row) => row <= end);
      if (!upTo.length) {
        issues.push(`${where}: column ${column} holds no numbers in ${change.formula}.`);
        continue;
      }
      let blockEnd = Math.max(...upTo);
      let blockStart = blockEnd;
      while (numeric.has(blockStart - 1)) blockStart -= 1;
      while (numeric.has(blockEnd + 1)) blockEnd += 1;
      if (end < blockEnd)
        issues.push(
          `${where}: ${change.formula} stops at row ${end} but the numbers in column ${column} run to row ${blockEnd}.`,
        );
      if (start > blockStart)
        issues.push(
          `${where}: ${change.formula} starts at row ${start} but the numbers in column ${column} start at row ${blockStart}.`,
        );
    } catch {
      unverified = true;
    }
  }
  return { issues, unverified };
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
    if (
      (change.kind !== "write_values" && change.kind !== "write_formula") ||
      created.has(change.sheet)
    )
      continue;
    if (change.kind === "write_formula" && change.fillRange) return true;
    const cell = CELL.exec(change.cell);
    if (!cell) return true;
    const rows = change.kind === "write_values" ? change.values.length : 1;
    const columns =
      change.kind === "write_values"
        ? Math.max(1, ...change.values.map((row) => row.length))
        : 1;
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
