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

// --- computed columns -----------------------------------------------------------------------

import type { ExprNode } from "./expression.js";
import { expressionToFormula } from "./expression.js";

/** The data rows of one source column, as a range reference. */
export function columnRef(range: LargeRef, index: number): string {
  assertIndex(index, range.columns);
  const letter = columnLetter(range.startColumn + index);
  return `${quoteSheet(range.sheetName)}!$${letter}$${range.startRow + 2}:$${letter}$${range.endRow + 1}`;
}

function astColumns(node: ExprNode, found: Set<number> = new Set()): number[] {
  switch (node.t) {
    case "col":
      found.add(node.i);
      break;
    case "neg":
      astColumns(node.a, found);
      break;
    case "bin":
    case "cat":
    case "cmp":
      astColumns(node.a, found);
      astColumns(node.b, found);
      break;
    case "fn":
      for (const argument of node.args) astColumns(argument, found);
      break;
    default:
      break;
  }
  return [...found].sort((a, b) => a - b);
}

/** Runs a per-row formula over whole columns: MAP keeps every function working row by row. */
function mapRows(
  range: LargeRef,
  columns: number[],
  body: (name: (index: number) => string) => string,
): string {
  const names = new Map(columns.map((index) => [index, `_v${index}`]));
  const refs = columns.map((index) => columnRef(range, index));
  const lambda = `LAMBDA(${columns.map((index) => names.get(index)).join(",")},${body((index) => names.get(index) ?? "")})`;
  return `=MAP(${refs.join(",")},${lambda})`;
}

export type LargeAddColumnSpec = {
  leftIndex?: number;
  operator?: "+" | "-" | "*" | "/";
  rightIndex?: number;
  derived?:
    | "running-total"
    | "rank"
    | "percent-change"
    | "moving-average"
    | "yoy"
    | "date-group"
    | "combine";
  sourceIndex?: number;
  sourceIndex2?: number;
  lag?: number;
  window?: number;
  group?: string;
  separator?: string;
  lookup?: {
    sheet: string;
    sourceKeyIndexes: number[];
    lookupKeyIndexes: number[];
    returnIndex: number;
    rows: number;
    matchMode: "exact" | "approximate";
  };
};

const positive = (value: unknown, what: string): number => {
  if (!Number.isInteger(value) || (value as number) < 1)
    throw new Error(`${what} is missing from the approved plan`);
  return value as number;
};

/** One spilled formula for a computed column over every row of a very large range. */
export function addColumnFormula(
  range: LargeRef,
  spec: LargeAddColumnSpec,
  ast?: ExprNode,
): string {
  if (ast) {
    const columns = astColumns(ast);
    return mapRows(range, columns, (name) =>
      expressionToFormula(ast, name).replace(/^=/, ""),
    );
  }
  if (spec.lookup) {
    const { lookup } = spec;
    const sheet = quoteSheet(lookup.sheet);
    const last = positive(lookup.rows, "The lookup row count") + 1;
    const other = (index: number) => {
      const letter = columnLetter(index);
      return `${sheet}!$${letter}$2:$${letter}$${last}`;
    };
    const keys = lookup.sourceKeyIndexes;
    if (keys.length !== lookup.lookupKeyIndexes.length || keys.length < 1)
      throw new Error("The lookup keys are missing from the approved plan");
    return mapRows(range, keys, (name) => {
      if (keys.length === 1)
        return `IFERROR(INDEX(${other(lookup.returnIndex)},MATCH(${name(keys[0])},${other(lookup.lookupKeyIndexes[0])},${lookup.matchMode === "approximate" ? 1 : 0})),"")`;
      const test = keys
        .map(
          (key, at) => `(${other(lookup.lookupKeyIndexes[at])}=${name(key)})`,
        )
        .join("*");
      return `IFERROR(XLOOKUP(1,${test},${other(lookup.returnIndex)},""),"")`;
    });
  }
  if (spec.derived) {
    const source = spec.sourceIndex;
    if (!Number.isInteger(source))
      throw new Error("The source column is missing from the approved plan");
    const column = columnRef(range, source as number);
    switch (spec.derived) {
      case "running-total":
        return `=SCAN(0,${column},LAMBDA(a,b,IF(ISNUMBER(b),a+b,a)))`;
      case "rank":
        return `=XMATCH(${column},SORT(${column},,-1))`;
      case "percent-change":
        return `=LET(cur,${column},prev,VSTACK(NA(),DROP(cur,-1)),IFERROR((cur-prev)/prev,""))`;
      case "yoy": {
        const lag = positive(spec.lag, "The YoY lag");
        return `=LET(cur,${column},prev,VSTACK(SEQUENCE(${lag},1,NA(),0),DROP(cur,-${lag})),IFERROR((cur-prev)/prev,""))`;
      }
      case "moving-average": {
        const window = positive(spec.window, "The moving-average window");
        return `=LET(cur,${column},run,SCAN(0,cur,LAMBDA(a,b,IF(ISNUMBER(b),a+b,a))),behind,VSTACK(SEQUENCE(${window},1,0,0),DROP(run,-${window})),IF(SEQUENCE(ROWS(cur))<${window},"",(run-behind)/${window}))`;
      }
      case "date-group": {
        if (!["month", "quarter", "year"].includes(String(spec.group)))
          throw new Error("The date group is missing from the approved plan");
        const body =
          spec.group === "month"
            ? `TEXT(${column},"yyyy-mm")`
            : spec.group === "year"
              ? `YEAR(${column})`
              : `"Q"&ROUNDUP(MONTH(${column})/3,0)&" "&YEAR(${column})`;
        return `=${body}`;
      }
      case "combine": {
        if (!Number.isInteger(spec.sourceIndex2) || spec.separator !== " - ")
          throw new Error(
            "The combine sources are missing from the approved plan",
          );
        return `=${column}&" - "&${columnRef(range, spec.sourceIndex2 as number)}`;
      }
    }
  }
  if (
    !Number.isInteger(spec.leftIndex) ||
    !Number.isInteger(spec.rightIndex) ||
    !["+", "-", "*", "/"].includes(String(spec.operator))
  )
    throw new Error(
      "The columns to compute are missing from the approved plan",
    );
  const left = spec.leftIndex as number;
  const right = spec.rightIndex as number;
  return mapRows(range, [left, right], (name) =>
    spec.operator === "/"
      ? `IF(${name(right)}=0,"",${name(left)}/${name(right)})`
      : `${name(left)}${spec.operator}${name(right)}`,
  );
}

/** The first source column as a spilled copy, so every computed row can be matched to its record. */
export function keyColumnFormula(range: LargeRef): string {
  return `=LET(a,${columnRef(range, 0)},IF(a="","",a))`;
}

// --- clean-up --------------------------------------------------------------------------------

/** A cleaned copy is bounded (about a million cells) so Excel on the web can hold it. */
export const LARGE_CLEAN_MAX_CELLS = 500_000;
export const LARGE_CLEAN_MAX_ROWS = 50_000;
export const LARGE_FORMAT_ROWS = 5000;

export function largeCleanRows(columns: number): number {
  return Math.max(
    1000,
    Math.min(
      LARGE_CLEAN_MAX_ROWS,
      Math.floor(LARGE_CLEAN_MAX_CELLS / Math.max(1, columns)),
    ),
  );
}

export type LargeCleanSpec = {
  operations: readonly string[];
  fillBlanks?: string | number;
  fillBlanksColumnIndex?: number;
};

/** One spilled formula that trims, converts, fills and de-duplicates every row Excel-side. */
export function cleanFormula(range: LargeRef, spec: LargeCleanSpec): string {
  const has = (operation: string) => spec.operations.includes(operation);
  if (has("fuzzy-dedupe"))
    throw new Error(
      "Fuzzy duplicate removal needs the rows in the add-in, so it is limited to 100,000 cells.",
    );
  const steps: string[] = [
    `d,TAKE(${dataRef(range)},${largeCleanRows(range.columns)})`,
  ];
  let current = "d";
  const step = (name: string, body: string) => {
    steps.push(`${name},${body}`);
    current = name;
  };
  if (has("trim"))
    step("t", `IF(ISTEXT(${current}),TRIM(${current}),${current})`);
  if (has("text-to-number"))
    step(
      "n",
      `IF(ISTEXT(${current})*ISERROR(DATEVALUE(${current}))*(((LEFT(${current},1)<>"0")+(MID(${current},2,1)=".")>0)*(LEN(${current})<16)),IFERROR(VALUE(SUBSTITUTE(TRIM(${current}),",","")),${current}),${current})`,
    );
  if (has("text-to-date"))
    step(
      "y",
      `IF(ISTEXT(${current}),IFERROR(DATEVALUE(${current}),${current}),${current})`,
    );
  if (has("fill-blanks") && spec.fillBlanks !== undefined) {
    const fill =
      typeof spec.fillBlanks === "number"
        ? (() => {
            if (!Number.isFinite(spec.fillBlanks))
              throw new Error("The fill value is not a finite number");
            return String(spec.fillBlanks);
          })()
        : excelText(spec.fillBlanks);
    const filled = `IF(${current}="",${fill},${current})`;
    if (spec.fillBlanksColumnIndex === undefined) step("b", filled);
    else {
      assertIndex(spec.fillBlanksColumnIndex, range.columns);
      step(
        "b",
        `IF(SEQUENCE(1,COLUMNS(${current}))=${spec.fillBlanksColumnIndex + 1},${filled},${current})`,
      );
    }
  } else step("k", `IF(${current}="","",${current})`);
  if (has("dedupe")) step("u", `UNIQUE(${current})`);
  return `=LET(${steps.join(",")},${current})`;
}

// --- data quality report ---------------------------------------------------------------------

/** A small table of per-column counts, every cell a live formula over the whole column. */
export function qualityReportCells(
  range: LargeRef,
  headers: string[],
): string[][] {
  const head = [
    "Column",
    "Filled cells",
    "Blank cells",
    "Numbers",
    "Text cells",
    "Distinct values",
    "Repeated values",
    "Text that looks like a number",
    "Text with extra spaces",
    "Smallest number",
    "Largest number",
  ];
  const rows = headers.map((header, index) => {
    const ref = columnRef(range, index);
    const at = index + 4;
    return [
      header,
      `=ROWS(${ref})-COUNTBLANK(${ref})`,
      `=COUNTBLANK(${ref})`,
      `=COUNT(${ref})`,
      `=SUMPRODUCT(--ISTEXT(${ref}))`,
      `=IFERROR(ROWS(UNIQUE(FILTER(${ref},${ref}<>""))),0)`,
      `=MAX(0,B${at}-F${at})`,
      `=SUMPRODUCT(ISTEXT(${ref})*ISNUMBER(--SUBSTITUTE(${ref},",","")))`,
      `=SUMPRODUCT(ISTEXT(${ref})*(LEN(${ref})<>LEN(TRIM(${ref}))))`,
      `=IF(COUNT(${ref})>0,MIN(${ref}),"")`,
      `=IF(COUNT(${ref})>0,MAX(${ref}),"")`,
    ];
  });
  return [
    [
      "Data quality of every row (calculated by Excel; your data is not changed)",
    ],
    [`Rows`, `=ROWS(${columnRef(range, 0)})`],
    head,
    ...rows,
  ];
}

// --- split a name column -----------------------------------------------------------------------

/** The source column and its two parts (before and after the first space), spilled over every row. */
export function splitColumnFormulas(
  range: LargeRef,
  sourceIndex: number,
): { source: string; first: string; last: string } {
  const column = columnRef(range, sourceIndex);
  return {
    source: `=LET(a,${column},IF(a="","",a))`,
    first: `=MAP(${column},LAMBDA(v,IFERROR(LEFT(v,FIND(" ",v&" ")-1),"")))`,
    last: `=MAP(${column},LAMBDA(v,IFERROR(TRIM(MID(v,FIND(" ",v&" ")+1,999)),"")))`,
  };
}

// --- unpivot ----------------------------------------------------------------------------------

/** An unpivoted copy is bounded like a cleaned copy, counted in output cells. */
export function unpivotRows(
  outputColumns: number,
  valueColumns: number,
): number {
  return Math.max(
    1000,
    Math.floor(
      LARGE_CLEAN_MAX_CELLS / Math.max(1, outputColumns * valueColumns),
    ),
  );
}

/** One spilled formula: the kept columns, the value column's header and its value, per value column. */
export function unpivotFormula(
  range: LargeRef,
  spec: {
    dimensions: number[];
    values: number[];
    valueHeaders: string[];
  },
): string {
  if (!spec.dimensions.length || spec.values.length < 2)
    throw new Error("An unpivot needs kept columns and two value columns.");
  if (spec.values.length !== spec.valueHeaders.length)
    throw new Error("Every value column needs its header.");
  const rows = unpivotRows(spec.dimensions.length + 2, spec.values.length);
  const keep = `CHOOSECOLS(d,${spec.dimensions.map((index) => index + 1).join(",")})`;
  const parts = spec.values.map(
    (index, at) =>
      `HSTACK(${keep},IF(SEQUENCE(ROWS(d)),${excelText(spec.valueHeaders[at])}),INDEX(d,,${index + 1}))`,
  );
  return `=LET(d,TAKE(${dataRef(range)},${rows}),IFERROR(VSTACK(${parts.join(",")}),""))`;
}

// --- histogram ---------------------------------------------------------------------------------

/** Ten equal-width bins over the whole column; Excel counts every row with COUNTIFS. */
export function histogramCells(
  range: LargeRef,
  valueIndex: number,
  header: string,
  bins = 10,
): string[][] {
  const column = columnRef(range, valueIndex);
  const span = `(MAX(${column})-MIN(${column}))/${bins}`;
  const out: string[][] = [[header, "Count", "From", "To"]];
  for (let bin = 0; bin < bins; bin += 1) {
    const row = bin + 2;
    const last = bin === bins - 1;
    out.push([
      `=TEXT(C${row},"#,##0.##")&" - "&TEXT(D${row},"#,##0.##")`,
      `=COUNTIFS(${column},">="&C${row},${column},"${last ? "<=" : "<"}"&D${row})`,
      `=MIN(${column})+${bin}*${span}`,
      `=C${row}+${span}`,
    ]);
  }
  return out;
}
