/**
 * Deterministic analyst calculations used by the Excel report builders.
 * These functions never call a model, never write a workbook and never require raw
 * workbook values to leave the add-in. The apply layer writes the corresponding
 * report or formulas only after approval.
 */

export type AnalystCell = string | number | boolean | null;

export interface ForecastResult {
  forecast: number[];
  lower: number[];
  upper: number[];
  slope: number;
  residualStdDev: number;
  seasonality: number[];
  warning?: string;
}

const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const rounded = (value: number, digits = 4): number => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return NaN;
  const position = (sorted.length - 1) * p;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function regression(values: number[]): {
  slope: number;
  intercept: number;
  residualStdDev: number;
} {
  const n = values.length;
  if (n < 2) return { slope: 0, intercept: values[0] ?? 0, residualStdDev: 0 };
  const meanX = (n + 1) / 2;
  const meanY = values.reduce((sum, value) => sum + value, 0) / n;
  let xx = 0;
  let xy = 0;
  for (let index = 0; index < n; index += 1) {
    const x = index + 1 - meanX;
    xx += x * x;
    xy += x * (values[index] - meanY);
  }
  const slope = xx ? xy / xx : 0;
  const intercept = meanY - slope * meanX;
  const residuals = values.map(
    (value, index) => value - (intercept + slope * (index + 1)),
  );
  const residualStdDev =
    residuals.length > 1
      ? Math.sqrt(
          residuals.reduce((sum, value) => sum + value * value, 0) /
            (residuals.length - 1),
        )
      : 0;
  return { slope, intercept, residualStdDev };
}

/** Linear forecast with a transparent 95% interval and optional seasonal indices. */
export function advancedForecast(
  rawValues: unknown[],
  periods: number,
  seasonLength = 12,
): ForecastResult {
  const values = rawValues.filter(finite);
  const horizon = Math.max(1, Math.min(52, Math.trunc(periods)));
  const { slope, intercept, residualStdDev } = regression(values);
  const seasonal = Math.max(1, Math.min(12, Math.trunc(seasonLength)));
  const seasonality = Array.from({ length: seasonal }, (_, bucket) => {
    const bucketValues = values.filter(
      (_, index) => index % seasonal === bucket,
    );
    const mean = bucketValues.length
      ? bucketValues.reduce((sum, value) => sum + value, 0) /
        bucketValues.length
      : 0;
    const overall = values.length
      ? values.reduce((sum, value) => sum + value, 0) / values.length
      : 0;
    return overall ? rounded(mean / overall, 4) : 1;
  });
  const forecast = Array.from({ length: horizon }, (_, offset) => {
    const x = values.length + offset + 1;
    return rounded(
      (intercept + slope * x) * (seasonality[(x - 1) % seasonal] || 1),
    );
  });
  const margin = 1.96 * residualStdDev;
  return {
    forecast,
    lower: forecast.map((value) => rounded(value - margin)),
    upper: forecast.map((value) => rounded(value + margin)),
    slope: rounded(slope),
    residualStdDev: rounded(residualStdDev),
    seasonality,
    ...(values.length < 12
      ? {
          warning:
            "Seasonality is indicative because fewer than 12 observations were supplied.",
        }
      : {}),
  };
}

export interface CohortRow {
  cohort: string;
  period: string;
  customers: number;
  retention: number;
}

const dateKey = (value: unknown): string | undefined => {
  const date = value instanceof Date ? value : new Date(String(value ?? ""));
  if (!Number.isFinite(date.getTime())) return undefined;
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
};

/** Builds a month cohort table from customer/date rows without exposing customer values. */
export function buildCohortRetention(
  rows: AnalystCell[][],
  customerColumn: number,
  dateColumn: number,
): CohortRow[] {
  const activity = new Map<string, Set<string>>();
  for (const row of rows) {
    const customer = String(row[customerColumn] ?? "").trim();
    const period = dateKey(row[dateColumn]);
    if (!customer || !period) continue;
    const key = `${customer}\u0000${period}`;
    if (!activity.has(key)) activity.set(key, new Set());
    activity.get(key)!.add(customer);
  }
  const customerPeriods = new Map<string, Set<string>>();
  for (const key of activity.keys()) {
    const separator = key.lastIndexOf("\u0000");
    const customer = key.slice(0, separator);
    const period = key.slice(separator + 1);
    if (!customerPeriods.has(customer))
      customerPeriods.set(customer, new Set());
    customerPeriods.get(customer)!.add(period);
  }
  const cohorts = new Map<string, Set<string>>();
  for (const [customer, periods] of customerPeriods) {
    const first = [...periods].sort()[0];
    if (!first) continue;
    if (!cohorts.has(first)) cohorts.set(first, new Set());
    cohorts.get(first)!.add(customer);
  }
  const periods = [
    ...new Set([...customerPeriods.values()].flatMap((set) => [...set])),
  ].sort();
  return [...cohorts.entries()].flatMap(([cohort, customers]) =>
    periods
      .filter((period) => period >= cohort)
      .map((period) => {
        const active = [...customers].filter((customer) =>
          customerPeriods.get(customer)?.has(period),
        ).length;
        return {
          cohort,
          period,
          customers: active,
          retention: customers.size ? rounded(active / customers.size, 4) : 0,
        };
      }),
  );
}

export interface SensitivityCell {
  values: number[];
  result: number;
}

/** Deterministic Cartesian sensitivity matrix; the caller supplies the business formula. */
export function buildSensitivityMatrix(
  variables: number[][],
  calculate: (values: number[]) => number,
): SensitivityCell[] {
  if (!variables.length) return [];
  const output: SensitivityCell[] = [];
  const visit = (index: number, values: number[]) => {
    if (index === variables.length) {
      const result = calculate(values);
      if (Number.isFinite(result))
        output.push({ values: [...values], result: rounded(result) });
      return;
    }
    for (const value of variables[index]) {
      if (Number.isFinite(value)) visit(index + 1, [...values, value]);
    }
  };
  visit(0, []);
  return output;
}

export interface FinancialMetrics {
  revenue: number;
  cogs: number;
  operatingExpenses: number;
  netIncome: number;
  grossProfit: number;
  grossMargin: number;
  operatingMargin: number;
  roi?: number;
  ebitda?: number;
}

export function financialMetrics(input: {
  revenue: number;
  cogs: number;
  operatingExpenses: number;
  depreciation?: number;
  interest?: number;
  taxes?: number;
  investedCapital?: number;
}): FinancialMetrics {
  const revenue = Number.isFinite(input.revenue) ? input.revenue : 0;
  const cogs = Number.isFinite(input.cogs) ? input.cogs : 0;
  const operatingExpenses = Number.isFinite(input.operatingExpenses)
    ? input.operatingExpenses
    : 0;
  const depreciation = input.depreciation ?? 0;
  const interest = input.interest ?? 0;
  const taxes = input.taxes ?? 0;
  const grossProfit = revenue - cogs;
  const ebitda = grossProfit - operatingExpenses;
  const netIncome = ebitda - depreciation - interest - taxes;
  return {
    revenue: rounded(revenue),
    cogs: rounded(cogs),
    operatingExpenses: rounded(operatingExpenses),
    netIncome: rounded(netIncome),
    grossProfit: rounded(grossProfit),
    grossMargin: revenue ? rounded(grossProfit / revenue) : 0,
    operatingMargin: revenue ? rounded(ebitda / revenue) : 0,
    ...(input.investedCapital && input.investedCapital !== 0
      ? { roi: rounded(netIncome / input.investedCapital) }
      : {}),
    ebitda: rounded(ebitda),
  };
}

export interface FuzzyMatch {
  left: string;
  right: string;
  similarity: number;
}

export interface FraudRiskResult {
  score: number;
  level: "low" | "medium" | "high";
  reasons: string[];
}

/** Explainable screening score; it is never a fraud determination. */
export function scoreFraudRisk(input: {
  amount?: number;
  amountMedian?: number;
  amountQ3?: number;
  duplicateKey?: boolean;
  velocityCount?: number;
  unusualHour?: boolean;
}): FraudRiskResult {
  let score = 0;
  const reasons: string[] = [];
  if (
    Number.isFinite(input.amount) &&
    Number.isFinite(input.amountQ3) &&
    input.amount! > input.amountQ3!
  ) {
    score += 35;
    reasons.push("amount_above_q3");
  }
  if (
    Number.isFinite(input.amount) &&
    Number.isFinite(input.amountMedian) &&
    input.amount! > input.amountMedian! * 3
  ) {
    score += 25;
    reasons.push("amount_over_three_times_median");
  }
  if (input.duplicateKey) {
    score += 20;
    reasons.push("duplicate_transaction_key");
  }
  if ((input.velocityCount ?? 0) >= 5) {
    score += 15;
    reasons.push("high_transaction_velocity");
  }
  if (input.unusualHour) {
    score += 10;
    reasons.push("unusual_transaction_hour");
  }
  score = Math.min(100, score);
  return {
    score,
    level: score >= 70 ? "high" : score >= 35 ? "medium" : "low",
    reasons,
  };
}

export interface RootCauseRow {
  category: string;
  current: number;
  previous: number;
  change: number;
  contribution: number;
}

/** Ranks period/category deltas; contribution is evidence, not causal proof. */
export function compareRootCauses(
  rows: Array<{ category: string; current: number; previous: number }>,
): RootCauseRow[] {
  const deltas = rows
    .filter(
      (row) => Number.isFinite(row.current) && Number.isFinite(row.previous),
    )
    .map((row) => ({ ...row, change: row.current - row.previous }));
  const total = deltas.reduce((sum, row) => sum + Math.abs(row.change), 0);
  return deltas
    .map((row) => ({
      ...row,
      contribution: total ? rounded(Math.abs(row.change) / total, 4) : 0,
    }))
    .sort((left, right) => Math.abs(right.change) - Math.abs(left.change));
}

export interface SplitValue {
  original: string;
  parts: Record<string, string>;
  pattern: "address" | "phone" | "date" | "identifier" | "generic";
}

/** Splits common fields locally while keeping the original untouched. */
export function splitStructuredValue(value: unknown): SplitValue {
  const original = String(value ?? "").trim();
  const phone = /^(?:\+94|0094|0)?\s*(7\d)\s*([0-9]{3})\s*([0-9]{4})$/.exec(
    original.replace(/[ -]/g, ""),
  );
  if (phone)
    return {
      original,
      pattern: "phone",
      parts: { prefix: phone[1], number: `${phone[2]}${phone[3]}` },
    };
  const date = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(original);
  if (date)
    return {
      original,
      pattern: "date",
      parts: { year: date[1], month: date[2], day: date[3] },
    };
  const id = /^([A-Za-z]+)[-_ ]?(\d+)$/.exec(original);
  if (id)
    return {
      original,
      pattern: "identifier",
      parts: { prefix: id[1], number: id[2] },
    };
  const address = /^(.+?)[,;]\s*(.+?)(?:[,;]\s*(.+))?$/.exec(original);
  if (address)
    return {
      original,
      pattern: "address",
      parts: {
        line1: address[1],
        line2: address[2],
        ...(address[3] ? { line3: address[3] } : {}),
      },
    };
  const words = original.split(/\s+/).filter(Boolean);
  return {
    original,
    pattern: "generic",
    parts: { first: words[0] ?? "", rest: words.slice(1).join(" ") },
  };
}

export function groupSimilarValues(
  values: string[],
  threshold = 0.82,
): string[][] {
  const groups: string[][] = [];
  for (const value of values) {
    const match = groups.find(
      (group) => valueSimilarity(value, group[0]) >= threshold,
    );
    if (match) match.push(value);
    else groups.push([value]);
  }
  return groups;
}

const normalize = (value: string): string =>
  value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .trim();

function editDistance(left: string, right: string): number {
  const row = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    let diagonal = row[0];
    row[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      const above = row[j];
      row[j] =
        left[i - 1] === right[j - 1]
          ? diagonal
          : 1 + Math.min(diagonal, row[j], row[j - 1]);
      diagonal = above;
    }
  }
  return row[right.length];
}

function valueSimilarity(left: string, right: string): number {
  const normalizedLeft = normalize(left);
  const normalizedRight = normalize(right);
  const scale = Math.max(normalizedLeft.length, normalizedRight.length);
  return scale ? 1 - editDistance(normalizedLeft, normalizedRight) / scale : 0;
}

export function findFuzzyMatches(
  values: string[],
  threshold = 0.82,
): FuzzyMatch[] {
  const output: FuzzyMatch[] = [];
  for (let leftIndex = 0; leftIndex < values.length; leftIndex += 1) {
    const left = values[leftIndex];
    const normalizedLeft = normalize(left);
    if (!normalizedLeft) continue;
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < values.length;
      rightIndex += 1
    ) {
      const right = values[rightIndex];
      const normalizedRight = normalize(right);
      if (!normalizedRight || normalizedLeft === normalizedRight) continue;
      const scale = Math.max(normalizedLeft.length, normalizedRight.length);
      const similarity = scale
        ? 1 - editDistance(normalizedLeft, normalizedRight) / scale
        : 0;
      if (similarity >= threshold)
        output.push({ left, right, similarity: rounded(similarity) });
    }
  }
  return output;
}

export interface AnomalyResult {
  index: number;
  value: number;
  score: number;
  reason: "low" | "high";
}

export function findAnomalies(values: unknown[]): AnomalyResult[] {
  const numeric = values
    .map((value, index) => ({ index, value }))
    .filter((entry): entry is { index: number; value: number } =>
      finite(entry.value),
    );
  const sorted = numeric.map((entry) => entry.value).sort((a, b) => a - b);
  if (sorted.length < 4) return [];
  const q1 = percentile(sorted, 0.25);
  const q3 = percentile(sorted, 0.75);
  const iqr = q3 - q1;
  if (!Number.isFinite(iqr) || iqr === 0) return [];
  const lower = q1 - 1.5 * iqr;
  const upper = q3 + 1.5 * iqr;
  return numeric
    .filter((entry) => entry.value < lower || entry.value > upper)
    .map((entry) => ({
      index: entry.index,
      value: entry.value,
      score: rounded(
        entry.value < lower
          ? (lower - entry.value) / iqr
          : (entry.value - upper) / iqr,
      ),
      reason: entry.value < lower ? "low" : "high",
    }));
}

export interface ClusterResult {
  labels: number[];
  centroids: number[][];
  iterations: number;
  warning?: string;
}

/** Small deterministic k-means implementation for selected numeric features. */
export function clusterNumeric(
  rows: number[][],
  requestedK: number,
  maxIterations = 30,
): ClusterResult {
  const data = rows.filter(
    (row) => row.length > 0 && row.every(Number.isFinite),
  );
  if (!data.length)
    return {
      labels: [],
      centroids: [],
      iterations: 0,
      warning: "No complete numeric rows.",
    };
  const dimensions = data[0].length;
  const k = Math.max(1, Math.min(Math.trunc(requestedK), data.length, 12));
  const centroids = Array.from({ length: k }, (_, index) => [
    ...data[Math.floor((index * data.length) / k)],
  ]);
  let labels = Array(data.length).fill(0) as number[];
  let iterations = 0;
  const distance = (left: number[], right: number[]) =>
    left.reduce((sum, value, index) => sum + (value - right[index]) ** 2, 0);
  for (; iterations < Math.max(1, maxIterations); iterations += 1) {
    const next = data.map((row) => {
      let best = 0;
      let bestDistance = distance(row, centroids[0]);
      for (let index = 1; index < centroids.length; index += 1) {
        const candidate = distance(row, centroids[index]);
        if (candidate < bestDistance) {
          best = index;
          bestDistance = candidate;
        }
      }
      return best;
    });
    if (next.every((label, index) => label === labels[index]) && iterations > 0)
      break;
    labels = next;
    const sums = Array.from(
      { length: k },
      () => Array(dimensions).fill(0) as number[],
    );
    const counts = Array(k).fill(0) as number[];
    data.forEach((row, index) => {
      const label = labels[index];
      counts[label] += 1;
      row.forEach((value, dimension) => (sums[label][dimension] += value));
    });
    centroids.forEach((centroid, index) => {
      if (counts[index])
        centroid.forEach(
          (_, dimension) =>
            (centroid[dimension] = rounded(
              sums[index][dimension] / counts[index],
            )),
        );
    });
  }
  return { labels, centroids, iterations };
}

const POSITIVE = new Set([
  "good",
  "great",
  "excellent",
  "love",
  "happy",
  "fast",
  "helpful",
  "අගෙයි",
  "හොඳ",
]);
const NEGATIVE = new Set([
  "bad",
  "poor",
  "terrible",
  "hate",
  "angry",
  "slow",
  "broken",
  "නරක",
  "අසාර්ථක",
]);

export function classifySentiment(
  text: string,
): "positive" | "negative" | "neutral" {
  const words = text
    .toLocaleLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
  const score = words.reduce(
    (sum, word) => sum + (POSITIVE.has(word) ? 1 : NEGATIVE.has(word) ? -1 : 0),
    0,
  );
  return score > 0 ? "positive" : score < 0 ? "negative" : "neutral";
}

export function keywordCounts(
  texts: string[],
  limit = 20,
): Array<{ keyword: string; count: number }> {
  const counts = new Map<string, number>();
  for (const text of texts) {
    for (const word of text.toLocaleLowerCase().split(/[^\p{L}\p{N}]+/u)) {
      if (word.length < 3) continue;
      counts.set(word, (counts.get(word) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort(
      (left, right) => right[1] - left[1] || left[0].localeCompare(right[0]),
    )
    .slice(0, Math.max(1, Math.min(100, limit)))
    .map(([keyword, count]) => ({ keyword, count }));
}
