/** Pure decisions for the task pane's unified Run button and selection-aware suggestions. */

export type SmartMode = "smart" | "local" | "agent";
export type SmartPath = "local" | "agent";

export interface WorkspaceSelection {
  address: string;
  rows: number;
  columns: number;
  /** A local-only fact used to avoid suggesting work against an empty active cell. */
  isBlank?: boolean;
}

/** Local-only facts inferred from a bounded selection sample. No cell values are retained. */
export interface WorkspaceSchema {
  hasMeasure: boolean;
  hasDate: boolean;
  hasCategory: boolean;
  hasText: boolean;
  sampleRows: number;
  columns?: Array<{ name: string; role: string }>;
}

export interface WorkspaceBadgeLabels {
  row: string;
  rows: string;
  column: string;
  columns: string;
  largeRange: string;
  localPreview: string;
}

export interface WorkspaceSuggestion {
  id:
    | "chart"
    | "pivot"
    | "dashboard"
    | "quality"
    | "formulas"
    | "forecast"
    | "clean";
  label: string;
  instruction: string;
  reason: string;
}

const COMPLEX_REQUEST =
  /\b(?:another|other|multiple|across|between)\s+(?:sheet|table)|\b(?:join|reconcile|relationship|root cause|cohort|cluster|segmentation|fraud|scenario|goal seek)\b|\bwhy\s+(?:did|has|is|are)\b/i;
const MULTI_STEP =
  /\b(?:and then|then|after that|before that|first.+then|clean.+(?:chart|pivot|dashboard)|(?:chart|pivot|dashboard).+(?:email|send|share))\b/i;

/** Smart stays local for ordinary work and uses the agent for workbook-wide reasoning. */
export function chooseSmartPath(
  request: string,
  mode: SmartMode,
  agentAvailable: boolean,
): SmartPath {
  if (mode === "local" || !agentAvailable) return "local";
  if (mode === "agent") return "agent";
  const text = String(request ?? "").trim();
  return COMPLEX_REQUEST.test(text) ||
    MULTI_STEP.test(text) ||
    text.length > 240
    ? "agent"
    : "local";
}

/** Suggestions use range dimensions plus local aggregate schema facts; no cell value is retained or sent. */
export function suggestionsForSelection(
  selection: WorkspaceSelection | undefined,
  schema?: WorkspaceSchema,
): WorkspaceSuggestion[] {
  if (!selection?.address || selection.rows < 1 || selection.columns < 1)
    return [];
  if (selection.isBlank) return [];
  if (selection.rows === 1 && selection.columns === 1)
    return [
      {
        id: "formulas",
        label: "Inspect formulas",
        instruction: "Inspect selected formulas and formula errors.",
        reason:
          "Useful for checking the active cell and nearby formula pattern.",
      },
    ];

  const cells = selection.rows * selection.columns;
  const suggestions: WorkspaceSuggestion[] = [
    {
      id: "quality",
      label: "Check data quality",
      instruction: "Create a data quality report for the selected data.",
      reason:
        "Find blanks, duplicates and inconsistent values before reporting.",
    },
  ];
  const knowsSchema = Boolean(schema && schema.sampleRows > 0);
  if (schema?.hasDate && schema.hasMeasure && selection.rows >= 5)
    suggestions.push({
      id: "forecast",
      label: "Forecast the trend",
      instruction:
        "Create an advanced forecast with trend and confidence interval for the selected data.",
      reason:
        "The local sample contains both a date and a numeric measure. No sample values leave Excel.",
    });
  if (
    (knowsSchema && schema?.hasCategory && schema.hasMeasure) ||
    (!knowsSchema && selection.columns >= 2)
  )
    suggestions.push({
      id: cells > 100_000 ? "pivot" : "chart",
      label: cells > 100_000 ? "Summarize large data" : "Create the best chart",
      instruction:
        cells > 100_000
          ? "Create a PivotTable that summarizes the selected data."
          : "Recommend and create the best chart for the selected data.",
      reason:
        cells > 100_000
          ? "A PivotTable lets Excel aggregate the full range efficiently."
          : "The selection has enough columns to compare a category and measure.",
    });
  if (
    (knowsSchema && schema?.hasCategory && schema.hasMeasure) ||
    (!knowsSchema && selection.rows >= 3 && selection.columns >= 3)
  )
    suggestions.push({
      id: "dashboard",
      label: "Build a dashboard",
      instruction: "Create a management dashboard from the selected data.",
      reason: knowsSchema
        ? "The local sample has a category and a measure for KPIs, a summary and a chart."
        : "The range can support KPIs, a summary and a chart on one result sheet.",
    });
  if (knowsSchema && schema?.hasText && !schema.hasMeasure)
    suggestions.push({
      id: "clean",
      label: "Clean text values",
      instruction: "Clean and standardize text values in the selected data.",
      reason:
        "The local sample has text fields but no numeric measure for a chart or forecast.",
    });
  return suggestions.slice(0, 3);
}

export function selectionBadges(
  selection: WorkspaceSelection,
  labels: WorkspaceBadgeLabels = {
    row: "row",
    rows: "rows",
    column: "column",
    columns: "columns",
    largeRange: "Large range",
    localPreview: "Local preview",
  },
): string[] {
  const cells = selection.rows * selection.columns;
  return [
    `${selection.rows.toLocaleString("en-US")} ${selection.rows === 1 ? labels.row : labels.rows}`,
    `${selection.columns.toLocaleString("en-US")} ${selection.columns === 1 ? labels.column : labels.columns}`,
    cells > 100_000 ? labels.largeRange : labels.localPreview,
  ];
}
