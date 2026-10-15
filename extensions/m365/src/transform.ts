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

export interface ViewSpec {
  sort?: { index: number; direction: "asc" | "desc" };
  filter?: {
    index: number;
    operator: ">" | ">=" | "<" | "<=" | "=" | "!=" | "contains";
    value: string | number;
  };
  highlight?: {
    index: number;
    rule:
      | "top-n"
      | "bottom-n"
      | "above-average"
      | "below-average"
      | "duplicates";
    n?: number;
  };
}

const isBlank = (cell: Cell) =>
  cell === null || (typeof cell === "string" && cell.trim() === "");

function compareCells(left: Cell, right: Cell): number {
  if (isBlank(left) && isBlank(right)) return 0;
  if (isBlank(left)) return 1;
  if (isBlank(right)) return -1;
  if (typeof left === "number" && typeof right === "number")
    return left - right;
  return String(left).localeCompare(String(right), undefined, {
    sensitivity: "base",
    numeric: true,
  });
}

/**
 * Deterministic sorted / filtered / highlighted copy of the data rows. The original rows are never
 * modified; the result is written to a separate view sheet.
 */
export function applyView(
  rows: Cell[][],
  spec: ViewSpec,
): { rows: Cell[][]; highlighted: number[] } {
  let result = rows.map((row) => [...row]);
  if (spec.filter) {
    const { index, operator, value } = spec.filter;
    result = result.filter((row) => {
      const cell = row[index];
      if (isBlank(cell)) return false;
      if (operator === "contains")
        return String(cell)
          .toLocaleLowerCase()
          .includes(String(value).toLocaleLowerCase());
      if (operator === "=" || operator === "!=") {
        const same =
          typeof cell === "number" && typeof value === "number"
            ? cell === value
            : String(cell).trim().toLocaleLowerCase() ===
              String(value).trim().toLocaleLowerCase();
        return operator === "=" ? same : !same;
      }
      if (typeof cell !== "number" || typeof value !== "number") return false;
      if (operator === ">") return cell > value;
      if (operator === ">=") return cell >= value;
      if (operator === "<") return cell < value;
      return cell <= value;
    });
  }
  if (spec.sort) {
    const { index, direction } = spec.sort;
    const factor = direction === "asc" ? 1 : -1;
    result = result
      .map((row, position) => ({ row, position }))
      .sort((a, b) => {
        const blankA = isBlank(a.row[index]);
        const blankB = isBlank(b.row[index]);
        if (blankA || blankB) return compareCells(a.row[index], b.row[index]);
        return (
          factor * compareCells(a.row[index], b.row[index]) ||
          a.position - b.position
        );
      })
      .map((entry) => entry.row);
  }
  const highlighted: number[] = [];
  if (spec.highlight) {
    const { index, rule, n } = spec.highlight;
    const numbers = result
      .map((row, position) => ({ value: row[index], position }))
      .filter(
        (entry): entry is { value: number; position: number } =>
          typeof entry.value === "number",
      );
    if (rule === "top-n" || rule === "bottom-n") {
      const ordered = [...numbers].sort((a, b) =>
        rule === "top-n" ? b.value - a.value : a.value - b.value,
      );
      for (const entry of ordered.slice(0, n ?? 1))
        highlighted.push(entry.position);
    } else if (rule === "above-average" || rule === "below-average") {
      const mean =
        numbers.reduce((total, entry) => total + entry.value, 0) /
        Math.max(1, numbers.length);
      for (const entry of numbers)
        if (rule === "above-average" ? entry.value > mean : entry.value < mean)
          highlighted.push(entry.position);
    } else {
      const counts = new Map<string, number>();
      for (const row of result) {
        if (isBlank(row[index])) continue;
        const key = String(row[index]).trim().toLocaleLowerCase();
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      result.forEach((row, position) => {
        if (isBlank(row[index])) return;
        if (
          (counts.get(String(row[index]).trim().toLocaleLowerCase()) ?? 0) > 1
        )
          highlighted.push(position);
      });
    }
    highlighted.sort((a, b) => a - b);
  }
  return { rows: result, highlighted };
}

export type SummaryAggregation = "sum" | "count" | "average" | "min" | "max";

export interface SummaryBuildInput {
  sheetName: string;
  /** Local A1 range of the selection, e.g. "A1:D6" (one header row). */
  localAddress: string;
  groupIndex: number;
  groups: string[];
  values: Array<{
    column: string;
    index: number;
    aggregation: SummaryAggregation;
  }>;
  groupHeader: string;
  includeTotal: boolean;
}

export function parseLocalRange(address: string): {
  startColumn: number;
  startRow: number;
  endColumn: number;
  endRow: number;
} {
  const match = /^\$?([A-Z]{1,3})\$?(\d+):\$?([A-Z]{1,3})\$?(\d+)$/.exec(
    address.trim().toUpperCase(),
  );
  if (!match)
    throw new Error("The selection must be a single rectangular range.");
  const toIndex = (letters: string) =>
    letters
      .split("")
      .reduce((sum, char) => sum * 26 + (char.charCodeAt(0) - 64), 0) - 1;
  return {
    startColumn: toIndex(match[1]),
    startRow: Number(match[2]),
    endColumn: toIndex(match[3]),
    endRow: Number(match[4]),
  };
}

const AGGREGATION_LABEL: Record<SummaryAggregation, string> = {
  sum: "Sum",
  count: "Count",
  average: "Average",
  min: "Min",
  max: "Max",
};

/**
 * Header row, one row per group, optional total row. Every number is a live formula over the
 * source range, so the table follows later edits of the source data. Group labels are written as
 * text, never as formulas.
 */
export function buildSummaryTable(input: SummaryBuildInput): {
  values: string[][];
  rowCount: number;
  columnCount: number;
  formulaRows: number;
} {
  const range = parseLocalRange(input.localAddress);
  const quoted = "'" + input.sheetName.replace(/'/g, "''") + "'!";
  const first = range.startRow + 1;
  const last = range.endRow;
  const col = (index: number) => {
    const letter = columnLetter(range.startColumn + index);
    return quoted + "$" + letter + "$" + first + ":$" + letter + "$" + last;
  };
  const header = [
    input.groupHeader,
    ...input.values.map(
      (value) => AGGREGATION_LABEL[value.aggregation] + " of " + value.column,
    ),
  ];
  const formulaFor = (
    value: SummaryBuildInput["values"][number],
    rowNumber: number,
  ) => {
    const criteria = col(input.groupIndex) + ",$A" + rowNumber;
    switch (value.aggregation) {
      case "sum":
        return "=SUMIFS(" + col(value.index) + "," + criteria + ")";
      case "count":
        return "=COUNTIFS(" + criteria + ")";
      case "average":
        return (
          "=IFERROR(AVERAGEIFS(" + col(value.index) + "," + criteria + '),"")'
        );
      case "min":
        return "=MINIFS(" + col(value.index) + "," + criteria + ")";
      case "max":
        return "=MAXIFS(" + col(value.index) + "," + criteria + ")";
    }
  };
  const rows = input.groups.map((group, offset) => [
    group,
    ...input.values.map((value) => formulaFor(value, offset + 2)),
  ]);
  const out: string[][] = [header, ...rows];
  if (input.includeTotal) {
    const firstGroupRow = 2;
    const lastGroupRow = rows.length + 1;
    out.push([
      "Total",
      ...input.values.map((value, position) => {
        const letter = columnLetter(position + 1);
        const own = letter + firstGroupRow + ":" + letter + lastGroupRow;
        switch (value.aggregation) {
          case "sum":
          case "count":
            return "=SUM(" + own + ")";
          case "average":
            return "=IFERROR(AVERAGE(" + col(value.index) + '),"")';
          case "min":
            return "=MIN(" + own + ")";
          case "max":
            return "=MAX(" + own + ")";
        }
      }),
    ]);
  }
  return {
    values: out,
    rowCount: out.length,
    columnCount: header.length,
    formulaRows: rows.length + (input.includeTotal ? 1 : 0),
  };
}
