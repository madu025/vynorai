/**
 * The agent's `analyze_columns` tool: runs the deterministic analyst calculations of
 * `advancedAnalytics.ts` over rows read on the device and returns a small summary for the model
 * (row numbers, counts, top items), never the rows themselves. Read-only: nothing is written.
 * Pure: `agent.ts` reads the range and calls `runColumnAnalysis`.
 */
import { AgentToolError } from "./agent.js";
import {
  type AnalystCell,
  buildCohortRetention,
  clusterNumeric,
  compareRootCauses,
  findAnomalies,
  findFuzzyMatches,
  scoreFraudRisk,
  splitStructuredValue,
} from "./advancedAnalytics.js";

export const ANALYSIS_KINDS = [
  "anomalies",
  "fuzzy_matches",
  "clusters",
  "cohort_retention",
  "root_cause",
  "fraud_screen",
  "split_values",
] as const;
export type AnalysisKind = (typeof ANALYSIS_KINDS)[number];

/** Rows one analysis reads (from the top of the range); the result says when it stopped short. */
export const ANALYZE_MAX_ROWS = 5000;
/** Items (rows, pairs, categories) one result lists. */
export const ANALYZE_MAX_ITEMS = 25;
/** Distinct values compared for fuzzy matches (each pair is compared). */
const FUZZY_MAX_VALUES = 1000;

/** Which columns each kind needs, in order. */
const NEEDS: Record<AnalysisKind, string> = {
  anomalies: "one numeric column",
  fuzzy_matches: "one text column",
  clusters: "one to six numeric columns",
  cohort_retention: "a customer column, then a date column",
  root_cause: "a category column, then the current and previous amount columns",
  fraud_screen: "an amount column, optionally followed by a transaction key column",
  split_values: "one text column",
};

const number = (value: AnalystCell): number | undefined => {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value !== "string" || !value.trim()) return undefined;
  const parsed = Number(value.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : undefined;
};
/** Excel stores dates as serial numbers; the cohort code needs a date it can parse. */
const dateValue = (value: AnalystCell): AnalystCell =>
  typeof value === "number" && value > 20000 && value < 80000
    ? new Date(Math.round((value - 25569) * 86_400_000)).toISOString()
    : value;
const round = (value: number) => Math.round(value * 100) / 100;

function columnIndexes(
  kind: AnalysisKind,
  headers: string[],
  columns: string[],
): number[] {
  const indexes = columns.map((name) => {
    const wanted = name.trim().toLowerCase();
    const found = headers.findIndex(
      (header) => String(header).trim().toLowerCase() === wanted,
    );
    if (found < 0)
      throw new AgentToolError(
        `"${name}" is not a header of this range. Headers: ${headers.join(", ")}.`,
      );
    return found;
  });
  const [min, max] =
    kind === "clusters"
      ? [1, 6]
      : kind === "cohort_retention"
        ? [2, 2]
        : kind === "root_cause"
          ? [3, 3]
          : kind === "fraud_screen"
            ? [1, 2]
            : [1, 1];
  if (indexes.length < min || indexes.length > max)
    throw new AgentToolError(`${kind} needs ${NEEDS[kind]}.`);
  return indexes;
}

/**
 * Runs one analysis. `rows` are the data rows (no header); `firstRow` is the sheet row of the
 * first one, so results can name real rows.
 */
export function runColumnAnalysis(
  kind: AnalysisKind,
  headers: string[],
  rows: AnalystCell[][],
  options: { columns: string[]; firstRow: number; k?: number },
): Record<string, unknown> {
  const indexes = columnIndexes(kind, headers, options.columns);
  const sheetRow = (index: number) => options.firstRow + index;
  const column = (i: number) => rows.map((row) => row[indexes[i]] ?? null);
  switch (kind) {
    case "anomalies": {
      const found = findAnomalies(column(0).map((value) => number(value)));
      return {
        column: headers[indexes[0]],
        rowsChecked: rows.length,
        outliers: found.length,
        method: "IQR: below Q1 - 1.5*IQR or above Q3 + 1.5*IQR",
        top: [...found]
          .sort((a, b) => b.score - a.score)
          .slice(0, ANALYZE_MAX_ITEMS)
          .map((entry) => ({
            row: sheetRow(entry.index),
            value: entry.value,
            side: entry.reason,
            iqrsBeyond: entry.score,
          })),
      };
    }
    case "fuzzy_matches": {
      const distinct = [
        ...new Set(
          column(0)
            .map((value) => String(value ?? "").trim())
            .filter(Boolean),
        ),
      ];
      const compared = distinct.slice(0, FUZZY_MAX_VALUES);
      const pairs = findFuzzyMatches(compared).sort(
        (a, b) => b.similarity - a.similarity,
      );
      return {
        column: headers[indexes[0]],
        distinctValues: distinct.length,
        ...(distinct.length > compared.length
          ? { note: `Only the first ${compared.length} distinct values were compared.` }
          : {}),
        similarPairs: pairs.length,
        top: pairs.slice(0, ANALYZE_MAX_ITEMS),
        caution: "Similar spelling is a candidate, not proof: never merge without approval.",
      };
    }
    case "clusters": {
      const k = Math.min(8, Math.max(2, Math.round(options.k ?? 3)));
      const data = rows
        .map((row) => indexes.map((i) => number(row[i])))
        .filter((row): row is number[] => row.every((v) => v !== undefined));
      const result = clusterNumeric(data, k);
      const sizes = result.centroids.map(
        (_, cluster) => result.labels.filter((label) => label === cluster).length,
      );
      return {
        columns: indexes.map((i) => headers[i]),
        rowsUsed: data.length,
        clusters: result.centroids.map((centre, cluster) => ({
          cluster: cluster + 1,
          rows: sizes[cluster],
          centre: Object.fromEntries(
            centre.map((value, i) => [headers[indexes[i]], round(value)]),
          ),
        })),
        ...(result.warning ? { warning: result.warning } : {}),
      };
    }
    case "cohort_retention": {
      const prepared = rows.map((row) =>
        row.map((value, i) => (i === indexes[1] ? dateValue(value) : value)),
      );
      const table = buildCohortRetention(prepared, indexes[0], indexes[1]);
      return {
        customerColumn: headers[indexes[0]],
        dateColumn: headers[indexes[1]],
        cohorts: new Set(table.map((row) => row.cohort)).size,
        rows: table.slice(0, ANALYZE_MAX_ITEMS * 2),
        ...(table.length > ANALYZE_MAX_ITEMS * 2
          ? { note: `Showing ${ANALYZE_MAX_ITEMS * 2} of ${table.length} cohort-period rows.` }
          : {}),
      };
    }
    case "root_cause": {
      const totals = new Map<string, { current: number; previous: number }>();
      for (const row of rows) {
        const category = String(row[indexes[0]] ?? "").trim() || "(blank)";
        const entry = totals.get(category) ?? { current: 0, previous: 0 };
        entry.current += number(row[indexes[1]]) ?? 0;
        entry.previous += number(row[indexes[2]]) ?? 0;
        totals.set(category, entry);
      }
      const ranked = compareRootCauses(
        [...totals].map(([category, sums]) => ({ category, ...sums })),
      );
      return {
        category: headers[indexes[0]],
        current: headers[indexes[1]],
        previous: headers[indexes[2]],
        categories: ranked.length,
        top: ranked.slice(0, ANALYZE_MAX_ITEMS).map((row) => ({
          ...row,
          current: round(row.current),
          previous: round(row.previous),
          change: round(row.change),
        })),
        caution: "Contribution is the share of the total change, not proof of cause.",
      };
    }
    case "fraud_screen": {
      const amounts = column(0).map((value) => number(value));
      const sorted = amounts
        .filter((value): value is number => value !== undefined)
        .sort((a, b) => a - b);
      const at = (p: number) =>
        sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))] : NaN;
      const median = at(0.5);
      const q3 = at(0.75);
      const keys = indexes[1] === undefined ? [] : column(1).map((v) => String(v ?? "").trim());
      const seen = new Map<string, number>();
      for (const key of keys) if (key) seen.set(key, (seen.get(key) ?? 0) + 1);
      const scored = amounts.map((amount, index) => ({
        row: sheetRow(index),
        amount,
        ...scoreFraudRisk({
          amount,
          amountMedian: median,
          amountQ3: q3,
          duplicateKey: keys[index] ? (seen.get(keys[index]) ?? 0) > 1 : false,
        }),
      }));
      const count = (level: string) => scored.filter((s) => s.level === level).length;
      return {
        amountColumn: headers[indexes[0]],
        ...(indexes[1] !== undefined ? { keyColumn: headers[indexes[1]] } : {}),
        rowsChecked: rows.length,
        median: round(median),
        q3: round(q3),
        levels: { high: count("high"), medium: count("medium"), low: count("low") },
        top: scored
          .filter((s) => s.level !== "low")
          .sort((a, b) => b.score - a.score)
          .slice(0, ANALYZE_MAX_ITEMS),
        caution: "A risk score is a reason to look, not a finding of fraud.",
      };
    }
    case "split_values": {
      const values = column(0)
        .map((value) => String(value ?? "").trim())
        .filter(Boolean);
      const split = values.map((value) => splitStructuredValue(value));
      const patterns: Record<string, number> = {};
      for (const entry of split)
        patterns[entry.pattern] = (patterns[entry.pattern] ?? 0) + 1;
      return {
        column: headers[indexes[0]],
        valuesChecked: values.length,
        patterns,
        examples: split.slice(0, 5),
      };
    }
  }
}
