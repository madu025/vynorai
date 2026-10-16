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
  const slope = linearSlope(values);
  if (slope === undefined) return [];
  const my = values.reduce((t, v) => t + v, 0) / n;
  const intercept = my - slope * ((n + 1) / 2);
  return Array.from(
    { length: periods },
    (_, step) => Math.round((intercept + slope * (n + step + 1)) * 100) / 100,
  );
}

/** Slope for equally-spaced observations numbered 1..n. */
function linearSlope(values: number[]): number | undefined {
  const n = values.length;
  if (n < 3) return undefined;
  const mx = (n + 1) / 2;
  const my = values.reduce((t, v) => t + v, 0) / n;
  let sxy = 0;
  let sxx = 0;
  values.forEach((value, at) => {
    sxy += (at + 1 - mx) * (value - my);
    sxx += (at + 1 - mx) ** 2;
  });
  return sxx === 0 ? 0 : sxy / sxx;
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

export interface InsightReportPreview {
  headers: [string, string];
  rows: Array<[string, string]>;
}

/**
 * The preview counterpart of the live insight-report formulas. It is deliberately deterministic:
 * no workbook values leave Excel, and the apply layer re-creates the same measures as formulas.
 */
export function buildInsightReportPreview(
  rows: Cell[][],
  headers: string[],
  valueIndex: number,
  categoryIndex?: number,
  dateIndex?: number,
): InsightReportPreview {
  const series = toNumbers(rows, valueIndex);
  const values = [...series].sort((a, b) => a - b);
  const count = values.length;
  const first = series[0];
  const last = series.at(-1);
  const q1 = quantile(values, 0.25);
  const q3 = quantile(values, 0.75);
  const iqr = q3 - q1;
  const slope = linearSlope(series) ?? 0;
  const anomalies =
    count && Number.isFinite(iqr)
      ? values.filter(
          (value) => value < q1 - 1.5 * iqr || value > q3 + 1.5 * iqr,
        ).length
      : 0;
  const report: Array<[string, string]> = [
    ["Data rows", String(count)],
    [
      "Average",
      String(round(values.reduce((total, value) => total + value, 0) / count)),
    ],
    [
      "Percent change",
      first !== undefined && first !== 0 && last !== undefined
        ? `${round(((last - first) / Math.abs(first)) * 100)}%`
        : "",
    ],
    ["IQR anomalies", String(anomalies)],
    ["Trend", slope > 0 ? "Rising" : slope < 0 ? "Falling" : "Flat"],
  ];
  const forecast = linearForecast(series, 1)[0];
  if (forecast !== undefined)
    report.push(["Next-period estimate", String(forecast)]);
  report.push([
    "Suggested next action",
    first !== undefined && last !== undefined && last < first
      ? "Review the declining trend and lowest contributor"
      : "Review the largest contributor and unusual values",
  ]);
  if (dateIndex !== undefined)
    report.push([
      "Seasonality hint",
      rows.length >= 12
        ? "At least 12 periods: review seasonal pattern"
        : "Need 12 periods for seasonal hint",
    ]);
  if (categoryIndex !== undefined) {
    const totals = new Map<string, number>();
    for (const row of rows) {
      const category = String(row[categoryIndex] ?? "").trim();
      const value = row[valueIndex];
      if (category && typeof value === "number")
        totals.set(category, (totals.get(category) ?? 0) + value);
    }
    const ranked = [...totals.entries()].sort(
      (left, right) => right[1] - left[1],
    );
    if (ranked.length)
      report.push(
        ["Top contributor", `${ranked[0][0]} (${round(ranked[0][1])})`],
        [
          "Bottom contributor",
          `${ranked.at(-1)![0]} (${round(ranked.at(-1)![1])})`,
        ],
      );
  }
  return { headers: ["Insight", "Result"], rows: report };
}

/** Live, source-referencing formulas for the deterministic insight report result sheet. */
export function buildInsightReportCells(
  range: RangeInfo,
  headers: string[],
  valueIndex: number,
  categoryIndex?: number,
  dateIndex?: number,
): string[][] {
  const value = columnRange(range, valueIndex);
  const cells: string[][] = [
    ["Insight", `Result for ${headers[valueIndex]}`],
    ["Data rows", `=COUNT(${value})`],
    ["Average", `=IFERROR(AVERAGE(${value}),"")`],
    [
      "Percent change",
      `=IFERROR((INDEX(${value},ROWS(${value}))-INDEX(${value},1))/ABS(INDEX(${value},1)),"")`,
    ],
    [
      "IQR anomalies",
      `=LET(vals,${value},lowerQ,QUARTILE.INC(vals,1),upperQ,QUARTILE.INC(vals,3),spread,upperQ-lowerQ,COUNTIF(vals,"<"&(lowerQ-1.5*spread))+COUNTIF(vals,">"&(upperQ+1.5*spread)))`,
    ],
    [
      "Trend",
      `=IFERROR(IF(COUNT(${value})<3,"Flat",IF(SLOPE(${value},SEQUENCE(ROWS(${value})))>0,"Rising",IF(SLOPE(${value},SEQUENCE(ROWS(${value})))<0,"Falling","Flat"))),"Flat")`,
    ],
    [
      "Next-period estimate",
      `=IFERROR(FORECAST(ROWS(${value})+1,${value},SEQUENCE(ROWS(${value}))),"")`,
    ],
    [
      "Suggested next action",
      '=IF(B4<0,"Review the declining trend and lowest contributor","Review the largest contributor and unusual values")',
    ],
  ];
  if (dateIndex !== undefined) {
    const date = columnRange(range, dateIndex);
    cells.push([
      "Seasonality hint",
      `=IF(COUNTA(${date})>=12,"At least 12 periods: review seasonal pattern","Need 12 periods for seasonal hint")`,
    ]);
  }
  if (categoryIndex !== undefined) {
    const category = columnRange(range, categoryIndex);
    const totals = `LET(cats,UNIQUE(${category}),sums,SUMIF(${category},cats,${value})`;
    cells.push(
      ["Top contributor", `=${totals},INDEX(cats,MATCH(MAX(sums),sums,0)))`],
      ["Top contribution", `=${totals},MAX(sums))`],
      ["Bottom contributor", `=${totals},INDEX(cats,MATCH(MIN(sums),sums,0)))`],
      ["Bottom contribution", `=${totals},MIN(sums))`],
    );
  }
  return cells;
}

/**
 * A forecast of a very large column: the last rows as actuals and the next periods as the trend
 * line, which Excel fits over every row once (SLOPE and INTERCEPT), so nothing is copied row by row.
 */
export function buildForecastCellsLarge(
  range: RangeInfo,
  headers: string[],
  index: number,
  periods: number,
  shownActuals = 30,
): string[][] {
  const count = range.endRow - range.startRow;
  const letter = columnLetter(range.startColumn + index);
  const column = `${quoted(range.sheetName)}$${letter}$${range.startRow + 2}:$${letter}$${range.endRow + 1}`;
  const first = Math.max(1, count - shownActuals + 1);
  const out: string[][] = [
    [
      "Period",
      `Actual ${headers[index]}`,
      "Forecast",
      "Trend over every row",
      "Value",
    ],
  ];
  for (let period = first; period <= count; period += 1)
    out.push([String(period), `=INDEX(${column},${period})`, "", "", ""]);
  const intercept = "$E$3";
  const slope = "$E$2";
  for (let step = 1; step <= periods; step += 1) {
    const row = out.length + 1;
    out.push([
      String(count + step),
      "",
      `=${intercept}+${slope}*A${row}`,
      "",
      "",
    ]);
  }
  out[1][3] = "Slope";
  out[1][4] = `=SLOPE(${column},SEQUENCE(ROWS(${column})))`;
  out[2][3] = "Intercept";
  out[2][4] = `=INTERCEPT(${column},SEQUENCE(ROWS(${column})))`;
  out[3][3] = "Rows";
  out[3][4] = `=ROWS(${column})`;
  return out;
}
