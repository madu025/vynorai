/**
 * Live-formula plans for combining two tables, behind the agent's `combine_tables` tool: join
 * (bring columns from a second table by a key), append (stack a second table under the first,
 * matching columns by header) and reconcile (which keys are in both lists, only in the first, only
 * in the second, and, with amount columns, which matched keys disagree). Pure: Office.js reads the
 * header rows and writes the result in `officeAgentActions.ts`. Every result is an Excel formula,
 * so it updates when the source changes and an expert can check it.
 */
import { AgentToolError, columnLetters, parseA1 } from "./agent.js";

export const COMBINE_MODES = ["join", "append", "reconcile"] as const;
export type CombineMode = (typeof COMBINE_MODES)[number];

/** A table: its sheet, its address including the header row, and the header names read from it. */
export interface CombineTable {
  sheet: string;
  address: string;
  headers: string[];
}

export interface CombineSpec {
  mode: CombineMode;
  left: CombineTable;
  right: CombineTable;
  /** Key header in the left table (join, reconcile). */
  key?: string;
  /** Key header in the right table; defaults to `key`. */
  rightKey?: string;
  /** Right-table headers to bring across (join); all non-key columns when empty. */
  columns?: string[];
  /** Amount header in the left table (reconcile); compares matched keys when given. */
  amount?: string;
  /** Amount header in the right table; defaults to `amount`. */
  rightAmount?: string;
}

/** One formula to write, at a cell offset from the target cell. */
export interface CombineCell {
  row: number;
  column: number;
  formula: string;
}

const quote = (sheet: string) => `'${sheet.replace(/'/g, "''")}'`;
const text = (value: string) => `"${value.replace(/"/g, '""')}"`;

/** Match the guard's case/space/leading-zero policy inside the workbook formula too. */
export function normalizedKeyFormula(reference: string): string {
  return `LET(v,${reference},IF(TRIM(v)="","",IFERROR(TEXT(VALUE(v),"0"),LOWER(TRIM(v)))))`;
}

function index(table: CombineTable, header: string, what: string): number {
  const wanted = header.trim().toLowerCase();
  const found = table.headers.findIndex(
    (name) => String(name).trim().toLowerCase() === wanted,
  );
  if (found < 0)
    throw new AgentToolError(
      `${what} "${header}" is not a header of '${table.sheet}'!${table.address}. Headers: ${table.headers.join(", ")}.`,
    );
  return found;
}

function bounds(table: CombineTable) {
  const box = parseA1(table.address);
  if (box.lastRow <= box.row)
    throw new AgentToolError(
      `'${table.sheet}'!${table.address} needs a header row and at least one data row.`,
    );
  return box;
}

/** Sheet-qualified data rows of one column (0-based within the table), without the header. */
export function dataColumn(table: CombineTable, column: number): string {
  const box = bounds(table);
  const letter = columnLetters(box.column + column);
  return `${quote(table.sheet)}!${letter}${box.row + 1}:${letter}${box.lastRow}`;
}

/** Sheet-qualified data rows of the whole table, without the header. */
export function dataBlock(table: CombineTable): string {
  const box = bounds(table);
  return `${quote(table.sheet)}!${columnLetters(box.column)}${box.row + 1}:${columnLetters(box.lastColumn)}${box.lastRow}`;
}

/** Sheet-qualified header row of the table. */
export function headerRow(table: CombineTable): string {
  const box = bounds(table);
  return `${quote(table.sheet)}!${columnLetters(box.column)}${box.row}:${columnLetters(box.lastColumn)}${box.row}`;
}

/** The formulas that build the combined result, placed relative to the target cell. */
export function combineCells(spec: CombineSpec): CombineCell[] {
  const { left, right } = spec;
  if (spec.mode === "append") {
    // Columns of the second table in the first table's order, matched by header name.
    const order = left.headers.map(
      (header) => index(right, header, "Column of the first table") + 1,
    );
    return [
      {
        row: 0,
        column: 0,
        formula: `=VSTACK(${headerRow(left)},${dataBlock(left)},CHOOSECOLS(${dataBlock(right)},${order.join(",")}))`,
      },
    ];
  }
  if (!spec.key) throw new AgentToolError(`${spec.mode} needs key.`);
  const leftKey = dataColumn(left, index(left, spec.key, "key"));
  const rightKey = dataColumn(
    right,
    index(right, spec.rightKey || spec.key, "right_key"),
  );
  const normalizedLeftKey = normalizedKeyFormula(leftKey);
  const normalizedRightKey = normalizedKeyFormula(rightKey);
  if (spec.mode === "join") {
    const keyIndex = index(right, spec.rightKey || spec.key, "right_key");
    const bring = spec.columns?.length
      ? spec.columns.map((header) => index(right, header, "Column"))
      : right.headers.map((_, i) => i).filter((i) => i !== keyIndex);
    if (!bring.length)
      throw new AgentToolError("join needs at least one column to bring.");
    const looked = bring.map(
      (i) =>
        `XLOOKUP(${normalizedLeftKey},${normalizedRightKey},${dataColumn(right, i)},"Not found")`,
    );
    const names = bring.map((i) => text(String(right.headers[i])));
    return [
      {
        row: 0,
        column: 0,
        formula: `=VSTACK(HSTACK(${headerRow(left)},${names.join(",")}),HSTACK(${dataBlock(left)},${looked.join(",")}))`,
      },
    ];
  }
  const inRight = `ISNUMBER(XMATCH(${normalizedLeftKey},${normalizedRightKey}))`;
  const inLeft = `ISNUMBER(XMATCH(${normalizedRightKey},${normalizedLeftKey}))`;
  const cells: CombineCell[] = [
    { row: 0, column: 0, formula: `=${text("In both")}` },
    { row: 1, column: 0, formula: `=SUM(--${inRight})` },
    { row: 2, column: 0, formula: `=FILTER(${leftKey},${inRight},"None")` },
    { row: 0, column: 1, formula: `=${text(`Only in ${left.sheet}`)}` },
    { row: 1, column: 1, formula: `=SUM(--NOT(${inRight}))` },
    {
      row: 2,
      column: 1,
      formula: `=FILTER(${leftKey},NOT(${inRight}),"None")`,
    },
    { row: 0, column: 2, formula: `=${text(`Only in ${right.sheet}`)}` },
    { row: 1, column: 2, formula: `=SUM(--NOT(${inLeft}))` },
    {
      row: 2,
      column: 2,
      formula: `=FILTER(${rightKey},NOT(${inLeft}),"None")`,
    },
  ];
  if (spec.amount) {
    const a = dataColumn(left, index(left, spec.amount, "amount"));
    const b = dataColumn(
      right,
      index(right, spec.rightAmount || spec.amount, "right_amount"),
    );
    cells.push(
      { row: 0, column: 4, formula: `=${text("Amount differs")}` },
      {
        row: 1,
        column: 4,
        formula: `=${text("Key, first, second, difference")}`,
      },
      {
        row: 2,
        column: 4,
        formula: `=LET(k,${leftKey},nk,${normalizedLeftKey},a,${a},b,XLOOKUP(nk,${normalizedRightKey},${b},0),m,${inRight},FILTER(HSTACK(k,a,b,a-b),m*(a<>b),"None"))`,
      },
    );
  }
  return cells;
}
