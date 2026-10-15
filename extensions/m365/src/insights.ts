import { buildSchemaSummary, type SchemaSummary } from "./analysis.js";
import { getExcelHeaderLayout } from "./excel.js";

type Cell = string | number | boolean | null;
interface RangeInput {
  workbookId: string;
  worksheetName: string;
  address: string;
  values: Cell[][];
  hasHeaders?: boolean;
}

export type ChartType = "column" | "line" | "bar" | "pie";

/** A deterministic, column-aware suggestion that can drive the existing preview plan. */
export interface ColumnSuggestion {
  kind: "chart" | "pivot-table";
  categoryIndex: number;
  valueIndex: number;
  chartType: ChartType;
  label: string;
}

export interface Insight {
  kind: "summary" | "top" | "bottom" | "trend" | "outlier" | "quality";
  title: string;
  detail: string;
  columns: number[];
}

export interface LocalInsights {
  insights: Insight[];
  suggestions: ColumnSuggestion[];
  summary: SchemaSummary;
}

const MAX_MEASURES = 4;

const round = (value: number) => Math.round(value * 100) / 100;
const format = (value: number) =>
  round(value).toLocaleString("en-US", { maximumFractionDigits: 2 });

function quantile(sorted: number[], fraction: number): number {
  const position = (sorted.length - 1) * fraction;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

/**
 * Local-only insights: computed in the task pane from the selection and shown to the person,
 * never sent anywhere. They give an instant, private "what is in this data" before any AI.
 */
export function buildLocalInsights(input: RangeInput): LocalInsights {
  const summary = buildSchemaSummary(input);
  const layout = getExcelHeaderLayout(input);
  const headers = layout.headers;
  const rows = input.values.slice(layout.headerRowCount);
  const column = (index: number) => rows.map((row) => row[index] ?? null);
  const roles = summary.columns.map((entry) => entry.roleHint);
  const measures = summary.columns
    .filter((entry) => entry.roleHint === "measure")
    .map((entry) => entry.index);
  const categoryIndex = roles.indexOf("category");
  const dateIndex = roles.indexOf("date");
  const insights: Insight[] = [];
  const suggestions: ColumnSuggestion[] = [];

  insights.push({
    kind: "summary",
    title: "What is in this selection",
    detail: `${rows.length} data rows and ${headers.length} columns: ${summary.columns
      .map((entry) => `${headers[entry.index]} (${entry.roleHint})`)
      .join(", ")}.`,
    columns: summary.columns.map((entry) => entry.index),
  });

  for (const index of measures.slice(0, MAX_MEASURES)) {
    const numbers = column(index).filter(
      (cell): cell is number => typeof cell === "number",
    );
    if (numbers.length === 0) continue;
    const sum = numbers.reduce((total, value) => total + value, 0);
    insights.push({
      kind: "summary",
      title: `${headers[index]}`,
      detail: `Total ${format(sum)}, average ${format(sum / numbers.length)}, from ${format(Math.min(...numbers))} to ${format(Math.max(...numbers))}.`,
      columns: [index],
    });
  }

  if (categoryIndex >= 0 && measures.length > 0) {
    const valueIndex = measures[0];
    const totals = new Map<string, number>();
    for (const row of rows) {
      const key = String(row[categoryIndex] ?? "").trim();
      const value = row[valueIndex];
      if (!key || typeof value !== "number") continue;
      totals.set(key, (totals.get(key) ?? 0) + value);
    }
    const ranked = [...totals.entries()].sort((a, b) => b[1] - a[1]);
    if (ranked.length >= 2) {
      const [topName, topValue] = ranked[0];
      const [lowName, lowValue] = ranked[ranked.length - 1];
      insights.push({
        kind: "top",
        title: `Top ${headers[categoryIndex]}`,
        detail: `${topName} has the highest ${headers[valueIndex]} (${format(topValue)}).`,
        columns: [categoryIndex, valueIndex],
      });
      insights.push({
        kind: "bottom",
        title: `Lowest ${headers[categoryIndex]}`,
        detail: `${lowName} has the lowest ${headers[valueIndex]} (${format(lowValue)}).`,
        columns: [categoryIndex, valueIndex],
      });
    }
    const distinct = summary.columns[categoryIndex].distinct ?? ranked.length;
    suggestions.push({
      kind: "chart",
      categoryIndex,
      valueIndex,
      chartType: "column",
      label: `Column chart: ${headers[valueIndex]} by ${headers[categoryIndex]}`,
    });
    if (
      distinct >= 2 &&
      distinct <= 6 &&
      column(valueIndex).every(
        (cell) => cell === null || (typeof cell === "number" && cell >= 0),
      )
    )
      suggestions.push({
        kind: "chart",
        categoryIndex,
        valueIndex,
        chartType: "pie",
        label: `Pie chart: share of ${headers[valueIndex]} by ${headers[categoryIndex]}`,
      });
    suggestions.push({
      kind: "pivot-table",
      categoryIndex,
      valueIndex,
      chartType: "column",
      label: `PivotTable: total ${headers[valueIndex]} by ${headers[categoryIndex]}`,
    });
  }

  if (dateIndex >= 0 && measures.length > 0) {
    const valueIndex = measures[0];
    const series = rows
      .map((row) => row[valueIndex])
      .filter((cell): cell is number => typeof cell === "number");
    if (series.length >= 4) {
      const half = Math.floor(series.length / 2);
      const mean = (items: number[]) =>
        items.reduce((total, value) => total + value, 0) / items.length;
      const early = mean(series.slice(0, half));
      const late = mean(series.slice(series.length - half));
      const change = early === 0 ? 0 : (late - early) / Math.abs(early);
      const direction =
        change > 0.05 ? "rising" : change < -0.05 ? "falling" : "flat";
      insights.push({
        kind: "trend",
        title: `${headers[valueIndex]} over ${headers[dateIndex]}`,
        detail: `Trend is ${direction}: the later half averages ${format(late)} against ${format(early)} earlier (${format(change * 100)}%).`,
        columns: [dateIndex, valueIndex],
      });
    }
    suggestions.push({
      kind: "chart",
      categoryIndex: dateIndex,
      valueIndex,
      chartType: "line",
      label: `Line chart: ${headers[valueIndex]} over ${headers[dateIndex]}`,
    });
  }

  for (const index of measures.slice(0, MAX_MEASURES)) {
    const numbers = column(index)
      .filter((cell): cell is number => typeof cell === "number")
      .sort((a, b) => a - b);
    if (numbers.length < 8) continue;
    const q1 = quantile(numbers, 0.25);
    const q3 = quantile(numbers, 0.75);
    const spread = q3 - q1;
    if (spread === 0) continue;
    const low = q1 - 1.5 * spread;
    const high = q3 + 1.5 * spread;
    const outliers = numbers.filter((value) => value < low || value > high);
    if (outliers.length)
      insights.push({
        kind: "outlier",
        title: `Unusual values in ${headers[index]}`,
        detail: `${outliers.length} value${outliers.length === 1 ? "" : "s"} fall outside the usual range ${format(low)} to ${format(high)}.`,
        columns: [index],
      });
  }

  const blanksByColumn = summary.columns.filter((entry) => entry.blank > 0);
  if (blanksByColumn.length)
    insights.push({
      kind: "quality",
      title: "Missing values",
      detail: blanksByColumn
        .map((entry) => `${headers[entry.index]}: ${entry.blank}`)
        .join(", "),
      columns: blanksByColumn.map((entry) => entry.index),
    });
  const seen = new Set<string>();
  let duplicateRows = 0;
  for (const row of rows) {
    const key = JSON.stringify(row);
    if (seen.has(key)) duplicateRows += 1;
    seen.add(key);
  }
  if (duplicateRows)
    insights.push({
      kind: "quality",
      title: "Duplicate rows",
      detail: `${duplicateRows} row${duplicateRows === 1 ? " is" : "s are"} exact duplicates of an earlier row.`,
      columns: [],
    });
  for (const entry of summary.columns) {
    if (entry.inferredType !== "text" || entry.containsPersonalData) continue;
    const present = column(entry.index).filter(
      (cell) => cell !== null && String(cell).trim() !== "",
    );
    const numericText = present.filter(
      (cell) =>
        typeof cell === "string" &&
        /^-?\d+(?:[.,]\d+)*$/.test(cell.trim().replace(/\s/g, "")),
    );
    if (present.length >= 3 && numericText.length / present.length >= 0.8)
      insights.push({
        kind: "quality",
        title: `Numbers stored as text in ${headers[entry.index]}`,
        detail:
          "Most values look like numbers but are text, so totals and charts will ignore them.",
        columns: [entry.index],
      });
  }

  return { insights, suggestions, summary };
}

/** Turns a local suggestion into the instruction and column choices the preview flow takes. */
export function suggestionToPlanInput(suggestion: ColumnSuggestion): {
  instruction: string;
  specs: {
    chart?: { category: number; value: number; chartType: ChartType };
    pivot?: { rows: number; values: number };
  };
} {
  if (suggestion.kind === "pivot-table")
    return {
      instruction: "Create a PivotTable.",
      specs: {
        pivot: {
          rows: suggestion.categoryIndex,
          values: suggestion.valueIndex,
        },
      },
    };
  return {
    instruction: "Create a chart.",
    specs: {
      chart: {
        category: suggestion.categoryIndex,
        value: suggestion.valueIndex,
        chartType: suggestion.chartType,
      },
    },
  };
}
