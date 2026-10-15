/**
 * A person-readable picture of what a plan will create. The raw plan stays available under
 * "Technical details"; this is what the preview card shows first: a headline, where it goes, and a
 * small visual built from the person's own selected data (nothing is simulated or invented).
 */

export interface OutcomeChart {
  type: string;
  categories: string[];
  series: Array<{ name: string; values: number[] }>;
}

export interface OutcomeTable {
  headers: string[];
  rows: string[][];
}

export interface OutcomeItem {
  kind: string;
  title: string;
  where: string;
  chart?: OutcomeChart;
  table?: OutcomeTable;
}

const MAX_POINTS = 12;
const MAX_TABLE_ROWS = 4;
const MAX_TABLE_COLUMNS = 5;

const KIND_TITLES: Record<string, string> = {
  chart: "Chart",
  "pivot-table": "PivotTable",
  table: "Formatted table",
  "new-sheet": "Result sheet",
  clean: "Cleaned copy of the data",
  "add-column": "Calculated column",
  view: "Filtered view",
  summary: "Summary by group",
  format: "Presentable copy",
  quality: "Data quality report",
};

function cell(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).slice(0, 24);
}

function numeric(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function buildOutcomes(
  actions: Array<{
    kind: string;
    targetSheet?: string;
    spec?: Record<string, any>;
  }>,
  headers: string[],
  rows: unknown[][],
): OutcomeItem[] {
  return actions.map((action) => {
    const spec = action.spec ?? {};
    const item: OutcomeItem = {
      kind: action.kind,
      title: KIND_TITLES[action.kind] ?? action.kind,
      where: String(action.targetSheet ?? ""),
    };
    if (action.kind === "chart" && Number.isInteger(spec.valueIndex)) {
      const valueIndexes = [
        spec.valueIndex,
        ...(Array.isArray(spec.extraValueIndexes)
          ? spec.extraValueIndexes
          : []),
      ].filter((index) => Number.isInteger(index));
      const categoryIndex = Number.isInteger(spec.categoryIndex)
        ? spec.categoryIndex
        : 0;
      const slice = rows.slice(0, MAX_POINTS);
      item.chart = {
        type: String(spec.chartType ?? "column"),
        categories: slice.map((row) => cell(row[categoryIndex])),
        series: valueIndexes.map((index: number) => ({
          name: String(headers[index] ?? `Column ${index + 1}`),
          values: slice.map((row) => numeric(row[index])),
        })),
      };
      const names = item.chart.series.map((entry) => entry.name).join(", ");
      item.title = `${item.chart.type[0].toUpperCase()}${item.chart.type.slice(1)} chart: ${names} by ${headers[categoryIndex] ?? "category"}`;
    } else {
      const columns = Math.min(headers.length, MAX_TABLE_COLUMNS);
      item.table = {
        headers: headers.slice(0, columns).map(cell),
        rows: rows
          .slice(0, MAX_TABLE_ROWS)
          .map((row) => row.slice(0, columns).map(cell)),
      };
    }
    return item;
  });
}
