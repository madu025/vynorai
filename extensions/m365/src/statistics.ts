/**
 * Descriptive statistics, correlation and a linear forecast. Pure functions: the add-in writes
 * live formulas into the result sheet, and the preview uses these values to show the answer.
 */
import { columnLetter } from "./transform.js";

export type Cell = string | number | boolean | null;

export interface StatsRow {
  measure: string;
  values: Array<number | "">;
}

const toNumbers = (rows: Cell[][], index: number): number[] =>
  rows
    .map((row) => row[index])
    .filter((value): value is number => typeof value === "number")
    .filter((value) => Number.isFinite(value));

function quantile(sorted: number[], p: number): number {
  if (!sorted.length) return NaN;
  const position = (sorted.length - 1) * p;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

const round = (value: number): number | "" =>
  Number.isFinite(value) ? Math.round(value * 100) / 100 : "";

/** The same measures as the formulas written to the sheet, computed locally for the preview. */
export function describeColumns(rows: Cell[][], indexes: number[]): StatsRow[] {
  const series = indexes.map((index) => toNumbers(rows, index));
  const each = (fn: (values: number[]) => number): Array<number | ""> =>
    series.map((values) => (values.length ? round(fn(values)) : ""));
  const mean = (values: number[]) =>
    values.reduce((total, value) => total + value, 0) / values.length;
  const sorted = series.map((values) => [...values].sort((a, b) => a - b));
  const at = (fn: (values: number[]) => number) =>
    sorted.map((values) => (values.length ? round(fn(values)) : ""));
  return [
    { measure: "Count", values: series.map((values) => values.length) },
    { measure: "Mean", values: each(mean) },
    { measure: "Median", values: at((values) => quantile(values, 0.5)) },
    {
      measure: "Std dev",
      values: each((values) => {
        if (values.length < 2) return NaN;
        const m = mean(values);
        return Math.sqrt(
          values.reduce((total, value) => total + (value - m) ** 2, 0) /
            (values.length - 1),
        );
      }),
    },
    { measure: "Min", values: at((values) => values[0]) },
    { measure: "Q1", values: at((values) => quantile(values, 0.25)) },
    { measure: "Q3", values: at((values) => quantile(values, 0.75)) },
    { measure: "Max", values: at((values) => values[values.length - 1]) },
  ];
}

/** Pearson correlation of two columns over the rows where both are numbers. */
export function correlation(
  rows: Cell[][],
  left: number,
  right: number,
): { r: number | ""; rSquared: number | ""; pairs: number } {
  const pairs = rows
    .map((row) => [row[left], row[right]] as const)
    .filter(
      (pair): pair is readonly [number, number] =>
        typeof pair[0] === "number" && typeof pair[1] === "number",
    );
  if (pairs.length < 3) return { r: "", rSquared: "", pairs: pairs.length };
  const n = pairs.length;
  const mx = pairs.reduce((t, [x]) => t + x, 0) / n;
  const my = pairs.reduce((t, [, y]) => t + y, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (const [x, y] of pairs) {
    sxy += (x - mx) * (y - my);
    sxx += (x - mx) ** 2;
    syy += (y - my) ** 2;
  }
  if (sxx === 0 || syy === 0) return { r: "", rSquared: "", pairs: n };
  const r = sxy / Math.sqrt(sxx * syy);
  return { r: round(r), rSquared: round(r * r), pairs: n };
}

/** Least-squares line through (1..n, values); returns the next `periods` values. */
export function linearForecast(values: number[], periods: number): number[] {
  const n = values.length;
  if (n < 3) return [];
  const mx = (n + 1) / 2;
  const my = values.reduce((t, v) => t + v, 0) / n;
  let sxy = 0;
  let sxx = 0;
  values.forEach((value, at) => {
    sxy += (at + 1 - mx) * (value - my);
    sxx += (at + 1 - mx) ** 2;
  });
  const slope = sxx === 0 ? 0 : sxy / sxx;
  const intercept = my - slope * mx;
  return Array.from(
    { length: periods },
    (_, step) => Math.round((intercept + slope * (n + step + 1)) * 100) / 100,
  );
}

export function numericSeries(rows: Cell[][], index: number): number[] {
  return toNumbers(rows, index);
}

interface RangeInfo {
  sheetName: string;
  startColumn: number;
  startRow: number;
  endRow: number;
}

const quoted = (name: string) => `'${name.replace(/'/g, "''")}'!`;

function columnRange(range: RangeInfo, index: number): string {
  const letter = columnLetter(range.startColumn + index);
  return `${quoted(range.sheetName)}$${letter}$${range.startRow + 1}:$${letter}$${range.endRow}`;
}

/** Cells (strings; formulas start with "=") for the three result layouts. */
export function buildDescribeCells(
  range: RangeInfo,
  headers: string[],
  indexes: number[],
): string[][] {
  const measures: Array<[string, (ref: string) => string]> = [
    ["Count", (ref) => `=COUNT(${ref})`],
    ["Mean", (ref) => `=AVERAGE(${ref})`],
    ["Median", (ref) => `=MEDIAN(${ref})`],
    ["Std dev", (ref) => `=IFERROR(STDEV.S(${ref}),"")`],
    ["Min", (ref) => `=MIN(${ref})`],
    ["Q1", (ref) => `=QUARTILE.INC(${ref},1)`],
    ["Q3", (ref) => `=QUARTILE.INC(${ref},3)`],
    ["Max", (ref) => `=MAX(${ref})`],
  ];
  return [
    ["Measure", ...indexes.map((index) => headers[index])],
    ...measures.map(([label, make]) => [
      label,
      ...indexes.map((index) => make(columnRange(range, index))),
    ]),
  ];
}

export function buildCorrelationCells(
  range: RangeInfo,
  headers: string[],
  left: number,
  right: number,
): string[][] {
  const a = columnRange(range, left);
  const b = columnRange(range, right);
  return [
    ["Pair", "Correlation (r)", "R squared", "Slope", "Intercept"],
    [
      `${headers[left]} and ${headers[right]}`,
      `=IFERROR(CORREL(${a},${b}),"")`,
      `=IFERROR(RSQ(${b},${a}),"")`,
      `=IFERROR(SLOPE(${b},${a}),"")`,
      `=IFERROR(INTERCEPT(${b},${a}),"")`,
    ],
  ];
}

export function buildForecastCells(
  range: RangeInfo,
  headers: string[],
  index: number,
  periods: number,
): string[][] {
  const count = range.endRow - range.startRow;
  const letter = columnLetter(range.startColumn + index);
  const out: string[][] = [["Period", `Actual ${headers[index]}`, "Forecast"]];
  for (let at = 1; at <= count; at += 1)
    out.push([
      String(at),
      `=${quoted(range.sheetName)}${letter}${range.startRow + 1 + at - 1}`,
      "",
    ]);
  const known = `$B$2:$B$${count + 1}`;
  const periodsRange = `$A$2:$A$${count + 1}`;
  for (let step = 1; step <= periods; step += 1) {
    const row = count + 1 + step;
    out.push([
      String(count + step),
      "",
      `=FORECAST(A${row},${known},${periodsRange})`,
    ]);
  }
  return out;
}
