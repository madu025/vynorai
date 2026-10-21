/** Pure decisions for the task pane's unified Run button and selection-aware suggestions. */

export type SmartMode = "smart" | "local" | "agent";
export type SmartPath = "local" | "agent";

export interface WorkspaceSelection {
  address: string;
  rows: number;
  columns: number;
}

export interface WorkspaceSuggestion {
  id: "chart" | "pivot" | "dashboard" | "quality" | "formulas";
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

/** Suggestions use only range dimensions; no workbook value is retained or sent. */
export function suggestionsForSelection(
  selection: WorkspaceSelection | undefined,
): WorkspaceSuggestion[] {
  if (!selection?.address || selection.rows < 1 || selection.columns < 1)
    return [];
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
  if (selection.columns >= 2)
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
  if (selection.rows >= 3 && selection.columns >= 3)
    suggestions.push({
      id: "dashboard",
      label: "Build a dashboard",
      instruction: "Create a management dashboard from the selected data.",
      reason:
        "The range can support KPIs, a summary and a chart on one result sheet.",
    });
  return suggestions.slice(0, 3);
}

export function selectionBadges(selection: WorkspaceSelection): string[] {
  const cells = selection.rows * selection.columns;
  return [
    `${selection.rows.toLocaleString("en-US")} rows`,
    `${selection.columns.toLocaleString("en-US")} columns`,
    cells > 100_000 ? "Large range" : "Local preview",
  ];
}
