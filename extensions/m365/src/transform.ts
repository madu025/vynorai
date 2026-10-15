type Cell = string | number | boolean | null;

export type CleanOperation = "trim" | "text-to-number" | "dedupe";
export const CLEAN_OPERATIONS: readonly CleanOperation[] = [
  "trim",
  "text-to-number",
  "dedupe",
];

export type ComputeOperator = "+" | "-" | "*" | "/";
export const COMPUTE_OPERATORS: readonly ComputeOperator[] = [
  "+",
  "-",
  "*",
  "/",
];

export interface CleanChanges {
  trimmed: number;
  converted: number;
  duplicatesRemoved: number;
}

const NUMBER_TEXT = /^-?\d{1,3}(?:,\d{3})+(?:\.\d+)?$|^-?\d+(?:\.\d+)?$/;

/**
 * Deterministic clean-up of the data rows. Headers are never touched here; the result is written
 * to a separate result sheet, so the source cells stay exactly as they were.
 */
export function cleanRows(
  rows: Cell[][],
  operations: readonly CleanOperation[],
): { rows: Cell[][]; changes: CleanChanges } {
  const changes: CleanChanges = {
    trimmed: 0,
    converted: 0,
    duplicatesRemoved: 0,
  };
  let next = rows.map((row) =>
    row.map((cell) => {
      let value: Cell = cell;
      if (operations.includes("trim") && typeof value === "string") {
        const trimmed = value.replace(/\s+/g, " ").trim();
        if (trimmed !== value) {
          changes.trimmed += 1;
          value = trimmed;
        }
      }
      if (operations.includes("text-to-number") && typeof value === "string") {
        const candidate = value.trim();
        if (NUMBER_TEXT.test(candidate)) {
          changes.converted += 1;
          value = Number(candidate.replace(/,/g, ""));
        }
      }
      return value;
    }),
  );
  if (operations.includes("dedupe")) {
    const seen = new Set<string>();
    const kept: Cell[][] = [];
    for (const row of next) {
      const key = JSON.stringify(row);
      if (seen.has(key)) {
        changes.duplicatesRemoved += 1;
        continue;
      }
      seen.add(key);
      kept.push(row);
    }
    next = kept;
  }
  return { rows: next, changes };
}

/** Column index to A1 letters (0 -> A, 26 -> AA). */
export function columnLetter(index: number): string {
  let value = index;
  let letters = "";
  do {
    letters = String.fromCharCode(65 + (value % 26)) + letters;
    value = Math.floor(value / 26) - 1;
  } while (value >= 0);
  return letters;
}

/**
 * Builds the formula for one data row. Division is guarded so an empty or zero divisor produces
 * an empty cell instead of #DIV/0!. The formula text is produced here from validated indexes and a
 * fixed operator list; no model output is ever placed in a formula.
 */
export function computedColumnFormula(
  rowNumber: number,
  leftIndex: number,
  operator: ComputeOperator,
  rightIndex: number,
): string {
  const left = `${columnLetter(leftIndex)}${rowNumber}`;
  const right = `${columnLetter(rightIndex)}${rowNumber}`;
  if (operator === "/") return `=IF(${right}=0,"",${left}/${right})`;
  return `=${left}${operator}${right}`;
}

/** A header text can never start a formula, so a column name cannot inject one. */
export function isSafeColumnName(name: unknown): name is string {
  return (
    typeof name === "string" &&
    name.trim().length > 0 &&
    name.length <= 40 &&
    !/^[=+\-@\t\r]/.test(name.trim()) &&
    !/[\r\n]/.test(name)
  );
}
