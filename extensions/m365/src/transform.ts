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

export interface QualityReport {
  values: Array<Array<string | number>>;
  findings: string[];
  headerRow: number;
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const position = (sorted.length - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

/**
 * A deterministic data quality report (blanks, duplicates, outliers, numbers stored as text,
 * stray spaces, mixed types). It reads values only, never writes to the source, and everything
 * in it is plain text or numbers.
 */
export function buildQualityReport(
  headers: string[],
  rows: Array<Array<string | number | boolean | null>>,
): QualityReport {
  const isBlank = (cell: unknown) =>
    cell === null || cell === undefined || String(cell).trim() === "";
  const seenRows = new Map<string, number>();
  let duplicateRows = 0;
  let blankCells = 0;
  for (const row of rows) {
    const key = JSON.stringify(
      headers.map((_, column) =>
        String(row[column] ?? "")
          .trim()
          .toLowerCase(),
      ),
    );
    const count = (seenRows.get(key) ?? 0) + 1;
    seenRows.set(key, count);
    if (count > 1) duplicateRows += 1;
  }
  const findings: string[] = [];
  const perColumn = headers.map((header, column) => {
    const cells = rows.map((row) => row[column]);
    const filled = cells.filter((cell) => !isBlank(cell));
    const blanks = cells.length - filled.length;
    blankCells += blanks;
    const numbers = filled.filter(
      (cell) => typeof cell === "number",
    ) as number[];
    const texts = filled.filter((cell) => typeof cell !== "number");
    const textNumbers = texts.filter((cell) =>
      /^-?[\d,]+(\.\d+)?$/.test(String(cell).trim()),
    ).length;
    const extraSpaces = texts.filter(
      (cell) =>
        String(cell) !== String(cell).trim() || /\s{2,}/.test(String(cell)),
    ).length;
    const type =
      filled.length === 0
        ? "empty"
        : numbers.length === filled.length
          ? "number"
          : numbers.length === 0
            ? "text"
            : "mixed";
    const sorted = [...numbers].sort((a, b) => a - b);
    let outliers = 0;
    if (sorted.length >= 4) {
      const q1 = quantile(sorted, 0.25);
      const q3 = quantile(sorted, 0.75);
      const spread = q3 - q1;
      outliers = sorted.filter(
        (value) => value < q1 - 1.5 * spread || value > q3 + 1.5 * spread,
      ).length;
    }
    const distinct = new Set(filled.map((cell) => String(cell).trim())).size;
    const average =
      numbers.length > 0
        ? Math.round(
            (numbers.reduce((sum, value) => sum + value, 0) / numbers.length) *
              100,
          ) / 100
        : "";
    if (blanks > 0)
      findings.push(
        header + ": " + blanks + " blank cell(s) of " + cells.length + ".",
      );
    if (type === "mixed")
      findings.push(header + ": numbers and text are mixed in one column.");
    if (type === "text" && textNumbers > 0)
      findings.push(
        header + ": " + textNumbers + " number(s) are stored as text.",
      );
    if (extraSpaces > 0)
      findings.push(
        header + ": " + extraSpaces + " value(s) have extra spaces.",
      );
    if (outliers > 0)
      findings.push(
        header +
          ": " +
          outliers +
          " unusual value(s) outside the normal range.",
      );
    return [
      header,
      type,
      filled.length,
      blanks,
      distinct,
      sorted.length ? sorted[0] : "",
      sorted.length ? sorted[sorted.length - 1] : "",
      average,
      outliers,
      textNumbers,
      extraSpaces,
    ] as Array<string | number>;
  });
  if (duplicateRows > 0)
    findings.unshift(duplicateRows + " duplicate row(s) found.");
  if (findings.length === 0)
    findings.push("No problems found in the selected data.");
  const values: Array<Array<string | number>> = [
    ["Data quality report"],
    [],
    ["Rows", rows.length],
    ["Columns", headers.length],
    ["Blank cells", blankCells],
    ["Duplicate rows", duplicateRows],
    [],
    [
      "Column",
      "Type",
      "Filled",
      "Blank",
      "Distinct",
      "Min",
      "Max",
      "Average",
      "Outliers",
      "Numbers as text",
      "Extra spaces",
    ],
    ...perColumn,
    [],
    ["Findings"],
    ...findings.map((text) => [text]),
  ];
  return { values, findings, headerRow: 7 };
}
