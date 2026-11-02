/** Pure decisions for the task pane's unified Run button and selection-aware suggestions. */

export type SmartMode = "smart" | "local" | "agent";
export type SmartPath = "local" | "agent";

export interface WorkspaceSelection {
  address: string;
  /** Worksheet owning the selected range, loaded from the live Excel host. */
  worksheetName?: string;
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
  /** Columns that have an empty cell in the sampled rows. */
  blankColumns?: string[];
  /** The table the schema was read from (the selection can be one cell inside it). */
  tableAddress?: string;
  /** Header names of the other sheets (first row only, at most 10 sheets), for cross-sheet suggestions. */
  otherSheets?: { name: string; headers: string[] }[];
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

// Each local action writes its own result, so "make a column, then act on that column" cannot chain.
const CHAINED_NEW_COLUMN =
  /\b(?:add|create|make|insert|new)\b[^.?]{0,60}\bcolumn\b[^.?]{0,80}\band\s+(?:then\s+)?(?:highlight|colou?r|shade|mark|flag|sort|filter|rank|chart)\b/i;
// A business ratio with no formula given: the local reader only takes explicit expressions.
const INFERRED_RATIO =
  /\b(?:add|create|make|insert|new|calculate|compute)\b[^.?]{0,60}\b(?:profit\s+)?(?:margin|markup)\b/i;
// "Which products are above average? Sort them": a filtered list, not one aggregate number.
const FILTERED_LIST =
  /^\s*(?:which|what|who|list|show|find)\b[^.?]{0,80}\b(?:above|below|over|under|more\s+than|less\s+than|higher\s+than|lower\s+than)\s+(?:the\s+)?average\b|\?\s*(?:and\s+)?(?:please\s+)?(?:sort|rank|order)\s+them\b|\baverage\b[^.?]{0,40}\band\s+(?:sort|rank|order)\s+them\b/i;
// Free-text extraction (city from an address, domain from an email) needs reading the text itself.
const TEXT_EXTRACTION =
  /\b(?:take|extract|get|pull|grab|split\s+out)\b[^.?]{0,40}\b(?:city|town|country|state|province|district|domain|first\s+name|last\s+name|surname|post\s*code|zip(?:\s*code)?|house\s+number|street)\b[^.?]{0,40}\bfrom\b/i;

// A change to something already built ("change the doughnut chart to a bar chart", "rename the
// dashboard title"): the local reader only builds new results, so it made a new dashboard or chart
// sheet instead (live run 2026-11-02). The agent has chart_action and cell edits for this.
const EDIT_EXISTING =
  /\b(?:change|modify|edit|update|rename|recolou?r|switch|convert|turn|make)\b[^.?]{0,60}\b(?:the|this|that|existing|current|my)\b[^.?]{0,40}\b(?:chart|graph|doughnut|donut|pie|title|heading|card|kpi|legend|axis|label|colou?rs?|font|dashboard|slicer|pivot\s*table|pivot)\b|\b(?:chart|graph|doughnut|donut|pie)\b[^.?]{0,40}\b(?:to|into)\s+an?\s+(?:bar|column|line|pie|doughnut|donut|area)\b/i;

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
    CHAINED_NEW_COLUMN.test(text) ||
    INFERRED_RATIO.test(text) ||
    FILTERED_LIST.test(text) ||
    TEXT_EXTRACTION.test(text) ||
    EDIT_EXISTING.test(text) ||
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
