/**
 * Formulas for ranges too large to read into the add-in. Excel computes the result over every row
 * with dynamic-array functions (FILTER, SORTBY, TAKE, ...), so the size of the data never matters.
 * Every column number is a validated index and every text is escaped: no model output is ever
 * pasted into a formula.
 */
import { columnLetter } from "./transform.js";

export type LargeRef = {
  sheetName: string;
  startColumn: number;
  startRow: number;
  endRow: number;
  columns: number;
};

const quoteSheet = (name: string) => `'${name.replace(/'/g, "''")}'`;

/** An Excel text literal: quotes doubled, so the text can never end the string early. */
export function excelText(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

/** The data rows (without the header row) of the whole source range. */
export function dataRef(range: LargeRef): string {
  const first = columnLetter(range.startColumn);
  const last = columnLetter(range.startColumn + range.columns - 1);
  return `${quoteSheet(range.sheetName)}!$${first}$${range.startRow + 2}:$${last}$${range.endRow + 1}`;
}

export function headerRef(range: LargeRef): string {
  const first = columnLetter(range.startColumn);
  const last = columnLetter(range.startColumn + range.columns - 1);
  return `${quoteSheet(range.sheetName)}!$${first}$${range.startRow + 1}:$${last}$${range.startRow + 1}`;
}

export type LargeViewSpec = {
  sort?: { index: number; direction: "asc" | "desc" };
  filter?: {
    index: number;
    operator: ">" | ">=" | "<" | "<=" | "=" | "!=" | "contains";
    value: string | number;
  };
  limit?: number;
};

const assertIndex = (index: unknown, columns: number) => {
  if (
    !Number.isInteger(index) ||
    (index as number) < 0 ||
    (index as number) >= columns
  )
    throw new Error("column index is outside the source range");
};

/** One spilled formula: filter, then sort, then keep the first rows (each step named once). */
export function viewFormula(range: LargeRef, spec: LargeViewSpec): string {
  const steps: string[] = [`d,${dataRef(range)}`];
  let current = "d";
  if (spec.filter) {
    const { index, operator, value } = spec.filter;
    assertIndex(index, range.columns);
    const column = `INDEX(d,,${index + 1})`;
    let test: string;
    if (operator === "contains") {
      if (typeof value !== "string") throw new Error("contains needs text");
      test = `ISNUMBER(SEARCH(${excelText(value)},${column}))`;
    } else {
      if (typeof value === "number" && !Number.isFinite(value))
        throw new Error("filter value is not a finite number");
      const operand =
        typeof value === "number" ? String(value) : excelText(value);
      test = `${column}${operator === "!=" ? "<>" : operator}${operand}`;
    }
    steps.push(`f,FILTER(d,${test},"")`);
    current = "f";
  }
  if (spec.sort) {
    assertIndex(spec.sort.index, range.columns);
    steps.push(
      `s,SORTBY(${current},INDEX(${current},,${spec.sort.index + 1}),${spec.sort.direction === "desc" ? -1 : 1})`,
    );
    current = "s";
  }
  if (spec.limit !== undefined) {
    if (!Number.isInteger(spec.limit) || spec.limit < 1)
      throw new Error("limit must be a positive whole number");
    steps.push(`t,TAKE(${current},${spec.limit})`);
    current = "t";
  }
  return `=LET(${steps.join(",")},IFERROR(${current},"No rows match"))`;
}
