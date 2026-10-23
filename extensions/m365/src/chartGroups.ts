/**
 * Pure grouping for a chart that is drawn from the selected rows (no Office.js).
 *
 * The result-sheet writer (`officeExcel.ts`) and the pane preview (`outcome.ts`) both use this, so
 * the picture a person approves is built exactly like the chart that is written: one row per
 * category, the chosen aggregation, optionally only the N largest or smallest groups.
 */

export type ChartAggregation = "sum" | "count" | "average" | "min" | "max";

export interface ChartGroupOptions {
  /** Default "sum". */
  aggregation?: ChartAggregation;
  /** Keep only this many groups (ranked by the first value column). */
  topN?: number;
  /** With topN: keep the N smallest instead of the N largest. */
  lowest?: boolean;
}

export interface ChartGroup {
  key: string;
  /** One aggregated number per value column, in the order of `valueIndexes`. */
  values: number[];
}

/** A cell that counts as a number: blanks and text are skipped, never read as 0. */
export function chartCellNumber(cell: unknown): number | undefined {
  if (cell === null || cell === undefined || typeof cell === "boolean")
    return undefined;
  if (typeof cell === "string" && cell.trim() === "") return undefined;
  const value = Number(cell);
  return Number.isFinite(value) ? value : undefined;
}

export function aggregateNumbers(
  values: number[],
  aggregation: ChartAggregation = "sum",
): number {
  if (!values.length) return 0;
  if (aggregation === "count") return values.length;
  if (aggregation === "min") return Math.min(...values);
  if (aggregation === "max") return Math.max(...values);
  const total = values.reduce((sum, value) => sum + value, 0);
  return aggregation === "average" ? total / values.length : total;
}

/**
 * One group per distinct category (in the order first seen), each value column aggregated.
 * With `topN` the groups are ranked by the first value column and cut to N.
 */
export function groupChartRows(
  rows: unknown[][],
  categoryIndex: number,
  valueIndexes: number[],
  options: ChartGroupOptions = {},
): ChartGroup[] {
  const buckets = new Map<string, number[][]>();
  for (const row of rows) {
    const key = String(row[categoryIndex] ?? "");
    const bucket = buckets.get(key) ?? valueIndexes.map(() => [] as number[]);
    valueIndexes.forEach((index, at) => {
      const value = chartCellNumber(row[index]);
      if (value !== undefined) bucket[at].push(value);
    });
    buckets.set(key, bucket);
  }
  let groups: ChartGroup[] = [...buckets].map(([key, bucket]) => ({
    key,
    values: bucket.map((values) =>
      aggregateNumbers(values, options.aggregation ?? "sum"),
    ),
  }));
  const topN = options.topN;
  if (topN !== undefined && Number.isInteger(topN) && topN > 0) {
    // Array.prototype.sort is stable, so ties keep the order the categories first appeared in.
    groups = [...groups]
      .sort((a, b) =>
        options.lowest
          ? (a.values[0] ?? 0) - (b.values[0] ?? 0)
          : (b.values[0] ?? 0) - (a.values[0] ?? 0),
      )
      .slice(0, topN);
  }
  return groups;
}

/** Category names that mean "a point in time": those charts keep one point per row, not per name. */
const TIME_CATEGORY = /date|day|week|month|quarter|year|period|time/i;

/**
 * Whether a chart groups its rows by category before drawing. It always does when the person asked
 * for a summary (a non-default aggregation, or a top-N); otherwise only when a category repeats and
 * is not a time axis, or when a follow-up asked for the totals (`forceAggregate`).
 */
export function chartNeedsGrouping(
  rows: unknown[][],
  categoryIndex: number,
  categoryColumn: string,
  options: ChartGroupOptions = {},
  forceAggregate = false,
): boolean {
  if (options.topN !== undefined) return true;
  if (options.aggregation && options.aggregation !== "sum") return true;
  if (forceAggregate) return true;
  const seen = rows.map((row) => String(row[categoryIndex] ?? ""));
  return (
    new Set(seen).size < seen.length && !TIME_CATEGORY.test(categoryColumn)
  );
}
