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

export interface SpearmanResult {
  pairs: number;
  rho: number | "";
  rhoSquared: number | "";
}

function averageRanks(values: number[]): number[] {
  const ordered = values
    .map((value, index) => ({ value, index }))
    .sort((left, right) => left.value - right.value);
  const ranks = Array<number>(values.length);
  for (let start = 0; start < ordered.length; ) {
    let end = start + 1;
    while (end < ordered.length && ordered[end].value === ordered[start].value)
      end += 1;
    const rank = (start + 1 + end) / 2;
    for (let at = start; at < end; at += 1) ranks[ordered[at].index] = rank;
    start = end;
  }
  return ranks;
}

/** Spearman rank correlation, using average ranks for ties and complete numeric pairs. */
export function spearmanCorrelation(
  rows: Cell[][],
  left: number,
  right: number,
): SpearmanResult {
  const pairs = rows
    .map((row) => [row[left], row[right]] as const)
    .filter(
      (pair): pair is readonly [number, number] =>
        typeof pair[0] === "number" &&
        Number.isFinite(pair[0]) &&
        typeof pair[1] === "number" &&
        Number.isFinite(pair[1]),
    );
  if (pairs.length < 3) return { pairs: pairs.length, rho: "", rhoSquared: "" };
  const x = averageRanks(pairs.map(([value]) => value));
  const y = averageRanks(pairs.map(([, value]) => value));
  const rankRows = x.map((value, index) => [value, y[index]] as Cell[]);
  const result = correlation(rankRows, 0, 1);
  return { pairs: pairs.length, rho: result.r, rhoSquared: result.rSquared };
}

/** Pearson correlation matrix for selected numeric columns using complete pairs per cell. */
export function correlationMatrix(
  rows: Cell[][],
  indexes: number[],
): Array<Array<number | "">> {
  return indexes.map((left) =>
    indexes.map((right) => correlation(rows, left, right).r),
  );
}

export interface RegressionResult {
  pairs: number;
  correlation: number | "";
  rSquared: number | "";
  slope: number | "";
  intercept: number | "";
  residualStdError: number | "";
  relationship: "positive" | "negative" | "flat" | "insufficient";
}

/**
 * Least-squares regression of the second selected column on the first.
 * Only rows with two finite numeric values participate; text and blanks are not
 * silently coerced.  The preview uses this same calculation as the live report
 * formulas written by buildRegressionCells.
 */
export function regression(
  rows: Cell[][],
  predictor: number,
  response: number,
): RegressionResult {
  const pairs = rows
    .map((row) => [row[predictor], row[response]] as const)
    .filter(
      (pair): pair is readonly [number, number] =>
        typeof pair[0] === "number" &&
        Number.isFinite(pair[0]) &&
        typeof pair[1] === "number" &&
        Number.isFinite(pair[1]),
    );
  const empty = {
    pairs: pairs.length,
    correlation: "" as const,
    rSquared: "" as const,
    slope: "" as const,
    intercept: "" as const,
    residualStdError: "" as const,
    relationship: "insufficient" as const,
  };
  if (pairs.length < 3) return empty;
  const n = pairs.length;
  const meanX = pairs.reduce((total, [x]) => total + x, 0) / n;
  const meanY = pairs.reduce((total, [, y]) => total + y, 0) / n;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const [x, y] of pairs) {
    const dx = x - meanX;
    const dy = y - meanY;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }
  if (sxx === 0 || syy === 0) return empty;
  const slope = sxy / sxx;
  const intercept = meanY - slope * meanX;
  const r = sxy / Math.sqrt(sxx * syy);
  const residualStdError =
    n > 2
      ? Math.sqrt(
          pairs.reduce((total, [x, y]) => {
            const residual = y - (intercept + slope * x);
            return total + residual * residual;
          }, 0) /
            (n - 2),
        )
      : NaN;
  return {
    pairs: n,
    correlation: round(r),
    rSquared: round(r * r),
    slope: round(slope),
    intercept: round(intercept),
    residualStdError: round(residualStdError),
    relationship: slope > 0 ? "positive" : slope < 0 ? "negative" : "flat",
  };
}

export interface PairedTTestResult {
  pairs: number;
  meanDifference: number | "";
  differenceStdDev: number | "";
  tStatistic: number | "";
  degreesOfFreedom: number | "";
  pValue: number | "";
  interpretation: "significant" | "not-significant" | "insufficient";
}

// Lanczos approximation and a continued fraction are sufficient for the
// bounded preview p-value; Excel's T.TEST remains the live-sheet authority.
function logGamma(value: number): number {
  const coefficients = [
    676.5203681218851, -1259.1392167224028, 771.3234287776531,
    -176.6150291621406, 12.507343278686905, -0.13857109526572012,
    9.984369578019572e-6, 1.5056327351493116e-7,
  ];
  if (value < 0.5)
    return (
      Math.log(Math.PI) -
      Math.log(Math.sin(Math.PI * value)) -
      logGamma(1 - value)
    );
  const shifted = value - 1;
  let sum = 0.9999999999998099;
  coefficients.forEach((coefficient, index) => {
    sum += coefficient / (shifted + index + 1);
  });
  const t = shifted + coefficients.length - 0.5;
  return (
    0.5 * Math.log(2 * Math.PI) +
    (shifted + 0.5) * Math.log(t) -
    t +
    Math.log(sum)
  );
}

function betaContinuedFraction(x: number, a: number, b: number): number {
  const maxIterations = 200;
  const epsilon = 3e-14;
  const tiny = 1e-300;
  let c = 1;
  let d = 1 - ((a + b) * x) / (a + 1);
  d = Math.abs(d) < tiny ? tiny : d;
  d = 1 / d;
  let h = d;
  for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
    const m = iteration;
    const m2 = 2 * m;
    let numerator = (m * (b - m) * x) / ((a + m2 - 1) * (a + m2));
    d = 1 + numerator * d;
    d = Math.abs(d) < tiny ? tiny : d;
    c = 1 + numerator / c;
    c = Math.abs(c) < tiny ? tiny : c;
    d = 1 / d;
    h *= d * c;
    numerator = -((a + m) * (a + b + m) * x) / ((a + m2) * (a + m2 + 1));
    d = 1 + numerator * d;
    d = Math.abs(d) < tiny ? tiny : d;
    c = 1 + numerator / c;
    c = Math.abs(c) < tiny ? tiny : c;
    d = 1 / d;
    const delta = d * c;
    h *= delta;
    if (Math.abs(delta - 1) < epsilon) break;
  }
  return h;
}

function regularizedBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const factor = Math.exp(
    a * Math.log(x) +
      b * Math.log(1 - x) +
      logGamma(a + b) -
      logGamma(a) -
      logGamma(b),
  );
  if (x < (a + 1) / (a + b + 2))
    return Math.min(
      1,
      Math.max(0, (factor * betaContinuedFraction(x, a, b)) / a),
    );
  return Math.min(
    1,
    Math.max(0, 1 - (factor * betaContinuedFraction(1 - x, b, a)) / b),
  );
}

function twoTailedPValue(t: number, degreesOfFreedom: number): number {
  if (!Number.isFinite(t) || degreesOfFreedom <= 0) return NaN;
  const x = degreesOfFreedom / (degreesOfFreedom + t * t);
  return regularizedBeta(x, degreesOfFreedom / 2, 0.5);
}

/** Paired two-tailed t-test over rows with two finite numeric values. */
export function pairedTTest(
  rows: Cell[][],
  left: number,
  right: number,
): PairedTTestResult {
  const differences = rows
    .map((row) => [row[left], row[right]] as const)
    .filter(
      (pair): pair is readonly [number, number] =>
        typeof pair[0] === "number" &&
        Number.isFinite(pair[0]) &&
        typeof pair[1] === "number" &&
        Number.isFinite(pair[1]),
    )
    .map(([a, b]) => a - b);
  const empty: PairedTTestResult = {
    pairs: differences.length,
    meanDifference: "",
    differenceStdDev: "",
    tStatistic: "",
    degreesOfFreedom: "",
    pValue: "",
    interpretation: "insufficient",
  };
  if (differences.length < 2) return empty;
  const n = differences.length;
  const mean = differences.reduce((total, value) => total + value, 0) / n;
  const variance =
    differences.reduce((total, value) => total + (value - mean) ** 2, 0) /
    (n - 1);
  const standardDeviation = Math.sqrt(variance);
  const degreesOfFreedom = n - 1;
  if (standardDeviation === 0) return empty;
  const t = mean / (standardDeviation / Math.sqrt(n));
  const p = twoTailedPValue(t, degreesOfFreedom);
  return {
    pairs: n,
    meanDifference: round(mean),
    differenceStdDev: round(standardDeviation),
    tStatistic: round(t),
    degreesOfFreedom,
    pValue: Number.isFinite(p) ? Math.round(p * 10000) / 10000 : "",
    interpretation: p < 0.05 ? "significant" : "not-significant",
  };
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

export function buildSpearmanCells(
  range: RangeInfo,
  headers: string[],
  left: number,
  right: number,
): string[][] {
  const a = columnRange(range, left);
  const b = columnRange(range, right);
  const valid = `ISNUMBER(${a})*ISNUMBER(${b})`;
  return [
    ["Pair", "Spearman rho", "Rho squared", "Observations"],
    [
      `${headers[left]} and ${headers[right]}`,
      `=IFERROR(LET(x,FILTER(${a},${valid}),y,FILTER(${b},${valid}),CORREL(RANK.AVG(x,x,1),RANK.AVG(y,y,1))),"")`,
      `=IFERROR(B2^2,"")`,
      `=SUMPRODUCT(--${valid})`,
    ],
  ];
}

export function buildCorrelationMatrixCells(
  range: RangeInfo,
  headers: string[],
  indexes: number[],
): string[][] {
  return [
    ["Column", ...indexes.map((index) => headers[index])],
    ...indexes.map((left) => [
      headers[left],
      ...indexes.map((right) => {
        const a = columnRange(range, left);
        const b = columnRange(range, right);
        return `=IFERROR(CORREL(${a},${b}),"")`;
      }),
    ]),
  ];
}

export function buildRegressionCells(
  range: RangeInfo,
  headers: string[],
  predictor: number,
  response: number,
): string[][] {
  const x = columnRange(range, predictor);
  const y = columnRange(range, response);
  return [
    ["Regression metric", "Value", "Evidence"],
    ["Predictor", headers[predictor], "X variable"],
    ["Response", headers[response], "Y variable"],
    [
      "Observations",
      `=SUMPRODUCT(--ISNUMBER(${x}),--ISNUMBER(${y}))`,
      "Rows with numeric X and Y",
    ],
    [
      "Correlation (r)",
      `=IFERROR(CORREL(${x},${y}),"")`,
      "Pearson correlation",
    ],
    ["R squared", `=IFERROR(RSQ(${y},${x}),"")`, "Explained variance"],
    ["Slope", `=IFERROR(SLOPE(${y},${x}),"")`, "Change in Y per X"],
    [
      "Intercept",
      `=IFERROR(INTERCEPT(${y},${x}),"")`,
      "Expected Y when X is zero",
    ],
    [
      "Residual std. error",
      `=IFERROR(STEYX(${y},${x}),"")`,
      "Typical unexplained Y error",
    ],
    [
      "Interpretation",
      '=IF(B7>0,"Positive relationship",IF(B7<0,"Negative relationship","Flat relationship"))',
      "Association is not causation",
    ],
  ];
}

export function buildPairedTTestCells(
  range: RangeInfo,
  headers: string[],
  left: number,
  right: number,
): string[][] {
  const a = columnRange(range, left);
  const b = columnRange(range, right);
  const differences = `FILTER(${a}-${b},ISNUMBER(${a})*ISNUMBER(${b}))`;
  const observations = `SUMPRODUCT(--ISNUMBER(${a}),--ISNUMBER(${b}))`;
  return [
    ["Paired t-test metric", "Value", "Evidence"],
    ["First sample", headers[left], "Paired observations"],
    ["Second sample", headers[right], "Paired observations"],
    [
      "Observations",
      `=${observations}`,
      "Rows with numeric values in both columns",
    ],
    [
      "Mean difference",
      `=IFERROR(AVERAGE(${differences}),"")`,
      `${headers[left]} - ${headers[right]}`,
    ],
    [
      "Difference std. dev.",
      `=IFERROR(STDEV.S(${differences}),"")`,
      "Sample standard deviation of paired differences",
    ],
    [
      "t statistic",
      `=IFERROR(B5/(B6/SQRT(B4)),"")`,
      "Mean difference / standard error",
    ],
    ["Degrees of freedom", "=MAX(0,B4-1)", "Observations - 1"],
    [
      "Two-tailed p-value",
      `=IFERROR(T.TEST(${a},${b},2,1),"")`,
      "Excel paired t-test",
    ],
    [
      "Interpretation",
      '=IF(B9<0.05,"Statistically significant at 5%","Not statistically significant at 5%")',
      "Evidence of a mean difference; not a causal claim",
    ],
  ];
}

export interface AnovaResult {
  groups: number;
  observations: number;
  betweenDf: number | "";
  withinDf: number | "";
  betweenSumSquares: number | "";
  withinSumSquares: number | "";
  fStatistic: number | "";
  pValue: number | "";
  etaSquared: number | "";
  interpretation: "significant" | "not-significant" | "insufficient";
}

export interface AnovaGroupSummary {
  group: string;
  observations: number;
  mean: number | "";
  standardDeviation: number | "";
}

function collectAnovaGroups(
  rows: Cell[][],
  category: number,
  value: number,
): Map<string, number[]> {
  const groups = new Map<string, number[]>();
  for (const row of rows) {
    const label = String(row[category] ?? "").trim();
    const amount = row[value];
    if (label && typeof amount === "number" && Number.isFinite(amount)) {
      const values = groups.get(label) ?? [];
      values.push(amount);
      groups.set(label, values);
    }
  }
  return groups;
}

/** Per-category evidence for ANOVA; blanks and non-numeric measures are excluded. */
export function anovaGroupSummary(
  rows: Cell[][],
  category: number,
  value: number,
): AnovaGroupSummary[] {
  return [...collectAnovaGroups(rows, category, value).entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([group, values]) => {
      const mean =
        values.reduce((total, amount) => total + amount, 0) / values.length;
      const standardDeviation =
        values.length > 1
          ? Math.sqrt(
              values.reduce(
                (total, amount) => total + (amount - mean) ** 2,
                0,
              ) /
                (values.length - 1),
            )
          : NaN;
      return {
        group,
        observations: values.length,
        mean: round(mean),
        standardDeviation: round(standardDeviation),
      };
    });
}

/** One-way ANOVA over a categorical column and a numeric measure column. */
export function anovaOneWay(
  rows: Cell[][],
  category: number,
  value: number,
): AnovaResult {
  const groups = collectAnovaGroups(rows, category, value);
  const usable = [...groups.values()];
  const observations = usable.reduce(
    (total, values) => total + values.length,
    0,
  );
  const empty: AnovaResult = {
    groups: usable.length,
    observations,
    betweenDf: "",
    withinDf: "",
    betweenSumSquares: "",
    withinSumSquares: "",
    fStatistic: "",
    pValue: "",
    etaSquared: "",
    interpretation: "insufficient",
  };
  if (usable.length < 2 || observations <= usable.length) return empty;
  const grandMean =
    usable.flat().reduce((total, amount) => total + amount, 0) / observations;
  const betweenSumSquares = usable.reduce((total, values) => {
    const mean =
      values.reduce((sum, amount) => sum + amount, 0) / values.length;
    return total + values.length * (mean - grandMean) ** 2;
  }, 0);
  const withinSumSquares = usable.reduce((total, values) => {
    const mean =
      values.reduce((sum, amount) => sum + amount, 0) / values.length;
    return (
      total + values.reduce((sum, amount) => sum + (amount - mean) ** 2, 0)
    );
  }, 0);
  const betweenDf = usable.length - 1;
  const withinDf = observations - usable.length;
  if (withinSumSquares === 0) {
    const fStatistic = betweenSumSquares > 0 ? Infinity : 0;
    return {
      ...empty,
      betweenDf,
      withinDf,
      betweenSumSquares: round(betweenSumSquares),
      withinSumSquares: 0,
      fStatistic: betweenSumSquares > 0 ? "" : 0,
      pValue: betweenSumSquares > 0 ? 0 : 1,
      etaSquared: betweenSumSquares + 0 > 0 ? 1 : 0,
      interpretation: fStatistic > 0 ? "significant" : "not-significant",
    };
  }
  const fStatistic =
    betweenSumSquares / betweenDf / (withinSumSquares / withinDf);
  const pValue = regularizedBeta(
    withinDf / (withinDf + betweenDf * fStatistic),
    withinDf / 2,
    betweenDf / 2,
  );
  return {
    groups: usable.length,
    observations,
    betweenDf,
    withinDf,
    betweenSumSquares: round(betweenSumSquares),
    withinSumSquares: round(withinSumSquares),
    fStatistic: round(fStatistic),
    pValue: Number.isFinite(pValue) ? Math.round(pValue * 10000) / 10000 : "",
    etaSquared:
      betweenSumSquares + withinSumSquares > 0
        ? round(betweenSumSquares / (betweenSumSquares + withinSumSquares))
        : "",
    interpretation: pValue < 0.05 ? "significant" : "not-significant",
  };
}

export function buildAnovaCells(
  range: RangeInfo,
  headers: string[],
  category: number,
  value: number,
): string[][] {
  const categories = columnRange(range, category);
  const values = columnRange(range, value);
  const usableCategories = `FILTER(${categories},ISNUMBER(${values})*(${categories}<>""))`;
  const usableValues = `FILTER(${values},ISNUMBER(${values})*(${categories}<>""))`;
  const groups = `UNIQUE(${usableCategories})`;
  const counts = `MAP(${groups},LAMBDA(group,COUNTIF(${usableCategories},group)))`;
  const means = `MAP(${groups},LAMBDA(group,AVERAGEIF(${usableCategories},group,${usableValues})))`;
  const grandMean = `AVERAGE(${usableValues})`;
  const between = `SUM(${counts}*(${means}-${grandMean})^2)`;
  const within = `SUM(MAP(${groups},LAMBDA(group,SUMPRODUCT(--(${usableCategories}=group),(${usableValues}-AVERAGEIF(${usableCategories},group,${usableValues}))^2))))`;
  return [
    ["ANOVA metric", "Value", "Evidence"],
    ["Category", headers[category], "Grouping column"],
    ["Measure", headers[value], "Numeric response"],
    ["Groups", `=COUNTA(${groups})`, "Distinct non-blank categories"],
    ["Observations", `=COUNT(${usableValues})`, "Numeric rows with a category"],
    ["Between-group df", "=B4-1", "Groups - 1"],
    ["Within-group df", "=B5-B4", "Observations - groups"],
    [
      "Between-group SS",
      `=IFERROR(${between},"")`,
      "Variation between group means",
    ],
    ["Within-group SS", `=IFERROR(${within},"")`, "Variation within groups"],
    [
      "Eta-squared",
      '=IFERROR(B8/(B8+B9),"")',
      "Share of numeric variation associated with the category; effect size, not causation",
    ],
    ["F statistic", '=IFERROR((B8/B6)/(B9/B7),"")', "Between MS / within MS"],
    [
      "p-value",
      '=IFERROR(F.DIST.RT(B11,INDEX($B:$B,6),INDEX($B:$B,7)),"")',
      "Right-tail F probability",
    ],
    [
      "Interpretation",
      '=IF(B12<0.05,"Group means differ significantly at 5%","No significant group-mean difference at 5%")',
      "Association test; not proof of causation",
    ],
    [],
    ["Group summary", "Observations", "Mean", "Std dev"],
    [
      `=IFERROR(SORT(UNIQUE(FILTER(${usableCategories},ISNUMBER(${usableValues})*(${usableCategories}<>"")))),"")`,
      `=IFERROR(COUNTIF(${usableCategories},A16#),"")`,
      `=IFERROR(AVERAGEIF(${usableCategories},A16#,${usableValues}),"")`,
      `=IFERROR(MAP(A16#,LAMBDA(group,STDEV.S(FILTER(${usableValues},(${usableCategories}=group)*ISNUMBER(${usableValues}))))),"")`,
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

/** Forecast report with an Excel ETS primary path and a linear fallback. */
export function buildAdvancedForecastCells(
  range: RangeInfo,
  headers: string[],
  index: number,
  periods: number,
  dateIndex?: number,
): string[][] {
  const count = range.endRow - range.startRow;
  const valueLetter = columnLetter(range.startColumn + index);
  const dateLetter =
    dateIndex === undefined
      ? undefined
      : columnLetter(range.startColumn + dateIndex);
  const values = `${quoted(range.sheetName)}$${valueLetter}$${range.startRow + 1}:$${valueLetter}$${range.endRow}`;
  const out: string[][] = [
    [
      "Period",
      `Actual ${headers[index]}`,
      "Forecast",
      "Lower 95%",
      "Upper 95%",
      "Detected seasonality",
    ],
  ];
  for (let at = 1; at <= count; at += 1)
    out.push([
      dateIndex === undefined
        ? String(at)
        : `=${quoted(range.sheetName)}${dateLetter}${range.startRow + at}`,
      `=${quoted(range.sheetName)}${valueLetter}${range.startRow + at}`,
      "",
      "",
      "",
      "",
    ]);
  const known = `$B$2:$B$${count + 1}`;
  const periodsRange = `$A$2:$A$${count + 1}`;
  for (let step = 1; step <= periods; step += 1) {
    const row = count + 1 + step;
    const forecast = `IFERROR(FORECAST.ETS(A${row},${known},${periodsRange},12,1,1),FORECAST(A${row},${known},${periodsRange}))`;
    const conf = `IFERROR(FORECAST.ETS.CONFINT(A${row},${known},${periodsRange},0.95,12,1,1),0)`;
    const futurePeriod =
      dateIndex === undefined
        ? String(count + step)
        : `=MAX($A$2:$A$${count + 1})+${step}`;
    out.push([
      futurePeriod,
      "",
      `=${forecast}`,
      `=C${row}-${conf}`,
      `=C${row}+${conf}`,
      `=IFERROR(FORECAST.ETS.SEASONALITY(${known},${periodsRange},1,1),12)`,
    ]);
  }
  return out;
}

/** Financial KPI report. Column indexes are revenue, COGS, operating expenses, then optional fields. */
export function buildFinancialCells(
  range: RangeInfo,
  headers: string[],
  indexes: number[],
): string[][] {
  const ref = (index: number) => columnRange(range, index);
  const revenue = ref(indexes[0]);
  const cogs = ref(indexes[1]);
  const operating = ref(indexes[2]);
  const depreciation =
    indexes[3] === undefined ? "0" : `SUM(${ref(indexes[3])})`;
  const interest = indexes[4] === undefined ? "0" : `SUM(${ref(indexes[4])})`;
  const taxes = indexes[5] === undefined ? "0" : `SUM(${ref(indexes[5])})`;
  const capital =
    indexes[6] === undefined ? undefined : `SUM(${ref(indexes[6])})`;
  const ebitda = `SUM(${revenue})-SUM(${cogs})-SUM(${operating})`;
  const net = `${ebitda}-${depreciation}-${interest}-${taxes}`;
  return [
    ["Metric", "Value", "Evidence"],
    ["Revenue", `=SUM(${revenue})`, headers[indexes[0]]],
    ["COGS", `=SUM(${cogs})`, headers[indexes[1]]],
    ["Operating expenses", `=SUM(${operating})`, headers[indexes[2]]],
    ["Gross profit", "=B2-B3", "Revenue - COGS"],
    ["Gross margin", '=IFERROR(B5/B2,"")', "Gross profit / Revenue"],
    ["EBITDA", `=${ebitda}`, "Revenue - COGS - Operating expenses"],
    ["Operating margin", '=IFERROR(B7/B2,"")', "EBITDA / Revenue"],
    ["Net income", `=${net}`, "EBITDA - depreciation - interest - taxes"],
    [
      "ROI",
      capital ? `=IFERROR(B9/${capital},"")` : "",
      capital ? headers[indexes[6]] : "No invested-capital column supplied",
    ],
  ];
}

/** Explainable IQR anomaly report; Excel calculates it over the full source range. */
export function buildAnomalyCells(
  range: RangeInfo,
  headers: string[],
  index: number,
): string[][] {
  const value = columnRange(range, index);
  const q1 = `QUARTILE.INC(${value},1)`;
  const q3 = `QUARTILE.INC(${value},3)`;
  const iqr = `(${q3}-${q1})`;
  return [
    ["Anomaly metric", "Value", "Evidence"],
    ["Column", headers[index], "Selected numeric column"],
    ["Q1", `=${q1}`, "25th percentile"],
    ["Q3", `=${q3}`, "75th percentile"],
    ["IQR", `=${iqr}`, "Q3 - Q1"],
    ["Lower fence", `=${q1}-1.5*${iqr}`, "Q1 - 1.5 × IQR"],
    ["Upper fence", `=${q3}+1.5*${iqr}`, "Q3 + 1.5 × IQR"],
    [
      "Anomaly count",
      `=COUNTIF(${value},"<"&B6)+COUNTIF(${value},">"&B7)`,
      "Values outside the fences",
    ],
    [
      "Interpretation",
      '=IF(B8=0,"No IQR outliers detected","Review flagged low/high values")',
      "Screening only; not proof of fraud",
    ],
  ];
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
