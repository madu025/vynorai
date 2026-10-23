/**
 * The three key figures at the top of the preview card, worked out from the plan and the data the
 * person selected (never from a model, never invented):
 *
 * - a chart, PivotTable, summary or dashboard: the total (or average, count, smallest, largest) of the
 *   measure, the top group with its share of the total, and the number of rows;
 * - a data quality report: columns checked, columns clean and problems to review, from the same
 *   report builder that writes the sheet.
 *
 * A tile is returned only when it can be computed. A very large range is previewed from a sample,
 * so a total over it would be wrong: then only the real row count is shown.
 */

import {
  aggregateNumbers,
  chartCellNumber,
  groupChartRows,
  type ChartAggregation,
} from "./chartGroups.js";
import { buildQualityReport } from "./transform.js";

export interface PreviewKpi {
  id: "total" | "top" | "rows" | "checked" | "clean" | "review";
  /** Already in the pane language. */
  label: string;
  value: string;
  /** A second, smaller line (a column name, a share, a unit). */
  sub?: string;
  /** The full, unabbreviated value for a tooltip. */
  title?: string;
  /** Draws the tile in the warning colour. */
  warn?: boolean;
}

export interface PreviewKpiInput {
  actions: Array<{ kind: string; spec?: Record<string, any> }>;
  headers: string[];
  /** The selected data rows (no header row). */
  rows: unknown[][];
  /** Set when `rows` is only a sample of a much larger range. */
  sample?: { totalRows: number; sampledRows: number };
  /** The plan reads a reshaped copy, so the rows here are not what it uses. */
  normalized?: boolean;
  /** Translates an English word or phrase of this module; defaults to English. */
  tr?: (text: string) => string;
}

/** 12,345 stays whole; 123,456 becomes 123.5K; 1,234,567 becomes 1.23M. */
export function compactNumber(value: number): string {
  if (!Number.isFinite(value)) return "";
  const size = Math.abs(value);
  const fixed = (n: number, digits: number) =>
    String(Math.round(n * 10 ** digits) / 10 ** digits);
  if (size >= 1e9) return `${fixed(value / 1e9, 2)}B`;
  if (size >= 1e6) return `${fixed(value / 1e6, 2)}M`;
  if (size >= 1e5) return `${fixed(value / 1e3, 1)}K`;
  return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function full(value: number): string {
  return value.toLocaleString("en-US", { maximumFractionDigits: 4 });
}

interface Source {
  measure: number;
  group?: number;
  aggregation: ChartAggregation;
  lowest: boolean;
}

const AGGREGATION_LABEL: Record<ChartAggregation, string> = {
  sum: "Total",
  average: "Average",
  count: "Count",
  min: "Smallest",
  max: "Largest",
};

function asAggregation(value: unknown): ChartAggregation {
  return value === "average" ||
    value === "count" ||
    value === "min" ||
    value === "max"
    ? value
    : "sum";
}

/** What the plan summarizes: the measure column, the group column and how rows are combined. */
function sourceOf(actions: PreviewKpiInput["actions"]): Source | undefined {
  const find = (kind: string) => actions.find((action) => action.kind === kind);
  const pivot = find("pivot-table")?.spec;
  if (
    pivot &&
    Number.isInteger(pivot.valuesIndex) &&
    Number.isInteger(pivot.rowsIndex)
  )
    return {
      measure: pivot.valuesIndex,
      group: pivot.rowsIndex,
      aggregation: asAggregation(pivot.aggregation),
      lowest: pivot.topN !== undefined && pivot.lowest === true,
    };
  const chart = find("chart")?.spec;
  if (chart && Number.isInteger(chart.valueIndex)) {
    const raw =
      chart.chartType === "histogram" || chart.chartType === "waterfall";
    return {
      measure: chart.valueIndex,
      ...(!raw && Number.isInteger(chart.categoryIndex)
        ? { group: chart.categoryIndex }
        : {}),
      aggregation: asAggregation(chart.aggregation),
      lowest: chart.topN !== undefined && chart.lowest === true,
    };
  }
  const summary = find("summary")?.spec;
  const first = summary?.summaryValues?.[0];
  if (
    summary &&
    first &&
    Number.isInteger(first.index) &&
    Number.isInteger(summary.groupIndex)
  )
    return {
      measure: first.index,
      group: summary.groupIndex,
      aggregation: asAggregation(first.aggregation),
      lowest: false,
    };
  const dashboard = find("dashboard")?.spec?.dashboard;
  if (
    dashboard &&
    Number.isInteger(dashboard.values?.[0]?.index) &&
    Number.isInteger(dashboard.category?.index)
  )
    return {
      measure: dashboard.values[0].index,
      group: dashboard.category.index,
      aggregation: asAggregation(dashboard.aggregation),
      lowest: false,
    };
  return undefined;
}

function isBlank(cell: unknown): boolean {
  return (
    cell === null ||
    cell === undefined ||
    (typeof cell === "string" && cell.trim() === "")
  );
}

function amountKpis(
  source: Source,
  input: PreviewKpiInput,
  tr: (text: string) => string,
): PreviewKpi[] {
  const { rows, headers } = input;
  const out: PreviewKpi[] = [];
  const { aggregation } = source;
  // "Count" counts filled cells of any kind, like a PivotTable; the others read numbers only.
  const numbers = rows
    .map((row) =>
      aggregation === "count"
        ? isBlank(row[source.measure])
          ? undefined
          : 1
        : chartCellNumber(row[source.measure]),
    )
    .filter((value): value is number => value !== undefined);
  const groups =
    source.group === undefined
      ? []
      : groupChartRows(
          aggregation === "count"
            ? rows.map((row) => [
                row[source.group!],
                isBlank(row[source.measure]) ? null : 1,
              ])
            : rows,
          aggregation === "count" ? 0 : source.group,
          [aggregation === "count" ? 1 : source.measure],
          { aggregation: aggregation === "count" ? "sum" : aggregation },
        );
  if (numbers.length) {
    const overall =
      aggregation === "count"
        ? numbers.length
        : aggregateNumbers(numbers, aggregation);
    out.push({
      id: "total",
      label: tr(AGGREGATION_LABEL[aggregation]),
      value: compactNumber(overall),
      title: full(overall),
      ...(headers[source.measure] ? { sub: headers[source.measure] } : {}),
    });
    if (groups.length >= 2) {
      const ranked = [...groups].sort((a, b) =>
        source.lowest ? a.values[0] - b.values[0] : b.values[0] - a.values[0],
      );
      const top = ranked[0];
      const name = top.key.trim() === "" ? tr("(blank)") : top.key.trim();
      const amount = top.values[0];
      // A share only makes sense when the groups add up to the total.
      const adds = aggregation === "sum" || aggregation === "count";
      const total = groups.reduce((sum, group) => sum + group.values[0], 0);
      const shareable =
        adds && total > 0 && groups.every((group) => group.values[0] >= 0);
      const percent = shareable
        ? Math.round((amount / total) * 1000) / 10
        : undefined;
      out.push({
        id: "top",
        label: tr(source.lowest ? "Lowest group" : "Top group"),
        value: name,
        sub:
          percent !== undefined
            ? `${percent}% ${tr("of total")}`
            : compactNumber(amount),
        title: `${name}: ${full(amount)}`,
      });
    }
  }
  const rowCount = input.sample ? input.sample.totalRows : rows.length;
  out.push({
    id: "rows",
    label: tr("Rows"),
    value: rowCount.toLocaleString("en-US"),
    ...(groups.length >= 2 && numbers.length
      ? { sub: `${groups.length} ${tr("groups")}` }
      : {}),
  });
  return out;
}

function qualityKpis(
  input: PreviewKpiInput,
  tr: (text: string) => string,
): PreviewKpi[] {
  const report = buildQualityReport(input.headers, input.rows as any);
  const checked = input.headers.length;
  const clean = checked - report.columnsWithFindings;
  return [
    {
      id: "checked",
      label: tr("Checked"),
      value: checked.toLocaleString("en-US"),
      sub: tr("columns"),
    },
    {
      id: "clean",
      label: tr("Clean"),
      value: clean.toLocaleString("en-US"),
      sub: tr("columns"),
    },
    {
      id: "review",
      label: tr("To review"),
      value: report.issueCount.toLocaleString("en-US"),
      sub: tr("findings"),
      ...(report.issueCount > 0 ? { warn: true } : {}),
    },
  ];
}

/** The tiles for this plan and data; an empty list when none can be computed honestly. */
export function buildPreviewKpis(input: PreviewKpiInput): PreviewKpi[] {
  const tr = input.tr ?? ((text: string) => text);
  const quality = input.actions.find((action) => action.kind === "quality");
  if (quality) {
    const mode = quality.spec?.qualityMode;
    // The formula audit and the repair copy read formulas, which are not in these values.
    if (
      input.sample ||
      input.normalized ||
      (mode !== undefined && mode !== "data") ||
      input.headers.length === 0
    )
      return [];
    return qualityKpis(input, tr);
  }
  if (input.normalized) return [];
  const source = sourceOf(input.actions);
  if (!source || input.headers[source.measure] === undefined) return [];
  // Totals over a sample are not the real totals: show only the real row count.
  if (input.sample)
    return [
      {
        id: "rows",
        label: tr("Rows"),
        value: input.sample.totalRows.toLocaleString("en-US"),
      },
    ];
  return amountKpis(source, input, tr);
}
