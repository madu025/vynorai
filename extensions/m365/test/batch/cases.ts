/**
 * The batch test matrix. One row per case; docs/BATCH_TEST_MATRIX.md is generated from it
 * (npx tsx test/batch/gen-matrix.ts). `proven` names the id used in docs/BATCH_PROVEN.md.
 */
export type Size = "small" | "50k" | "520k";
export interface BatchCase {
  id: string;
  area: string;
  en: string;
  si?: string;
  size: Size;
  /** Action kind(s) the plan must contain, "answer" for a local answer, "refuse" or "gap". */
  expect: string;
  files: string[];
  proven?: string;
}

const intent = ["extensions/m365/src/intent.ts"];
const plan = [
  "extensions/m365/src/excel.ts",
  "backend/src/services/m365ExcelPlan.ts",
];
const apply = ["extensions/m365/src/officeExcel.ts"];
const large = ["extensions/m365/src/largeRange.ts"];
const base = [...intent, ...plan, ...apply];

const c = (
  id: string,
  area: string,
  en: string,
  expect: string,
  extra: Partial<BatchCase> = {},
): BatchCase => ({
  id,
  area,
  en,
  size: "small",
  expect,
  files: base,
  ...extra,
});

export const CASES: BatchCase[] = [
  // --- questions -------------------------------------------------------------------------------
  c(
    "q-top",
    "question",
    "which RTOM has the highest total Requested Quantity?",
    "answer",
    {
      si: "වැඩිම Requested Quantity ඇති RTOM කුමක්ද?",
      files: [...intent, "extensions/m365/src/taskpane.ts"],
    },
  ),
  c(
    "q-large",
    "question",
    "which RTOM has the highest total Requested Quantity?",
    "refuse",
    {
      size: "520k",
      files: [...intent, "extensions/m365/src/taskpane.ts"],
      proven: "question-large",
    },
  ),
  c("q-count", "question", "how many rows are there?", "answer"),
  c("q-avg", "question", "what is the average Requested Quantity?", "answer"),
  c("q-sum", "question", "what is the total Issued Quantity?", "answer"),
  c(
    "q-lowest",
    "question",
    "which Status has the lowest total Requested Quantity?",
    "answer",
  ),
  // --- formulas and computed columns ------------------------------------------------------------
  c(
    "f-sum",
    "add-column",
    "add a column Total that is Requested Quantity + Issued Quantity",
    "add-column",
    {
      size: "520k",
      files: [...base, ...large],
      proven: "add-column",
    },
  ),
  c(
    "f-ratio",
    "add-column",
    "add a column Fill Rate that is Issued Quantity / Requested Quantity",
    "add-column",
    {
      size: "50k",
    },
  ),
  c(
    "f-if",
    "add-column",
    "add a column Short that is yes if Issued Quantity < Requested Quantity otherwise no",
    "add-column",
  ),
  c(
    "f-text",
    "add-column",
    "add a column Region that is the first 3 letters of RTOM",
    "add-column",
  ),
  c(
    "f-year",
    "add-column",
    "add a column Year from PAT Complete Date",
    "add-column",
  ),
  c(
    "f-explain",
    "formula",
    "explain the formula in the selected cell",
    "formula-inspector",
    {
      files: [
        "extensions/m365/src/formulaInspector.ts",
        "extensions/m365/src/taskpane.ts",
      ],
    },
  ),
  // --- pivot -----------------------------------------------------------------------------------
  c(
    "p-one",
    "pivot",
    "pivot table of total Requested Quantity by RTOM",
    "pivot-table",
    {
      si: "RTOM අනුව Requested Quantity එකතුව pivot table එකක් හදන්න",
      size: "520k",
      proven: "pivot-1",
    },
  ),
  c(
    "p-two",
    "pivot",
    "pivot table of total Requested Quantity and Issued Quantity by Status",
    "pivot-table",
    {
      size: "520k",
      proven: "pivot-2",
    },
  ),
  c(
    "p-top",
    "pivot",
    "pivot of total Requested Quantity by RTOM top 5",
    "pivot-table",
    {
      size: "520k",
      proven: "pivot-topn",
    },
  ),
  c(
    "p-cols",
    "pivot",
    "pivot of total Requested Quantity by RTOM and Status",
    "pivot-table",
  ),
  c(
    "p-avg",
    "pivot",
    "pivot of average Requested Quantity by Status",
    "pivot-table",
  ),
  c(
    "p-count",
    "pivot",
    "pivot table counting Service ID by Status",
    "pivot-table",
    { size: "520k" },
  ),
  c(
    "p-pct",
    "pivot",
    "pivot of Requested Quantity by RTOM as percent of total",
    "pivot-table",
  ),
  c(
    "p-singlish",
    "pivot",
    "RTOM walin Requested Quantity total ekak pivot ekak hadanna",
    "pivot-table",
  ),
  c(
    "p-sinhala-status",
    "pivot",
    "Status අනුව Issued Quantity එකතුව pivot table එකක්",
    "pivot-table",
    {
      si: "Status අනුව Issued Quantity එකතුව pivot table එකක්",
    },
  ),
  // --- charts ----------------------------------------------------------------------------------
  c("c-column", "chart", "chart of total Requested Quantity by RTOM", "chart", {
    size: "520k",
    proven: "chart-pivot",
  }),
  c(
    "c-line",
    "chart",
    "line chart of Requested Quantity by PAT Complete Date",
    "chart",
    { size: "520k" },
  ),
  c("c-bar", "chart", "bar chart of Requested Quantity by Status", "chart"),
  c("c-pie", "chart", "pie chart of Requested Quantity by Status", "chart"),
  c("c-hist", "chart", "histogram of Requested Quantity", "chart", {
    size: "520k",
    files: [...base, ...large],
  }),
  c(
    "c-stacked",
    "chart",
    "stacked column chart of Requested Quantity by RTOM and Status",
    "chart",
  ),
  c(
    "c-combo",
    "chart",
    "combo chart of Requested Quantity and Issued Quantity by Status",
    "chart",
  ),
  // --- summary and statistics --------------------------------------------------------------------
  c(
    "s-summary",
    "summary",
    "summary of Requested Quantity by RTOM",
    "pivot-table",
    { size: "520k", proven: "summary" },
  ),
  c(
    "st-describe",
    "statistics",
    "describe Requested Quantity and Issued Quantity",
    "statistics",
    {
      size: "520k",
      files: [...base, "extensions/m365/src/statistics.ts"],
      proven: "stats-describe",
    },
  ),
  c(
    "st-corr",
    "statistics",
    "correlation between Requested Quantity and Issued Quantity",
    "statistics",
    {
      files: [...base, "extensions/m365/src/statistics.ts"],
    },
  ),
  c(
    "st-forecast",
    "statistics",
    "forecast Requested Quantity for the next 5 periods",
    "statistics",
    {
      size: "520k",
      files: [...base, "extensions/m365/src/statistics.ts"],
      proven: "forecast",
    },
  ),
  c(
    "st-insights",
    "statistics",
    "insights about Requested Quantity by RTOM",
    "statistics",
    {
      size: "520k",
      files: [...base, "extensions/m365/src/statistics.ts"],
    },
  ),
  // --- view -----------------------------------------------------------------------------------
  c("v-top", "view", "show the top 3 rows by Issued Quantity", "view", {
    size: "520k",
    files: [...base, ...large],
    proven: "view",
  }),
  c("v-filter", "view", "show rows where Status is S", "view", {
    size: "520k",
    files: [...base, ...large],
  }),
  c("v-sort", "view", "sort by Requested Quantity descending", "view", {
    files: [...base, ...large],
  }),
  // --- clean ---------------------------------------------------------------------------------
  c("cl-trim", "clean", "clean the data: trim extra spaces", "clean", {
    size: "520k",
    files: [...base, ...large, "extensions/m365/src/transform.ts"],
    proven: "clean-bounded",
  }),
  c("cl-num", "clean", "convert text to numbers", "clean", {
    files: [...base, "extensions/m365/src/transform.ts"],
  }),
  c("cl-date", "clean", "convert text to dates", "clean", {
    files: [...base, "extensions/m365/src/transform.ts"],
  }),
  c("cl-dupe", "clean", "remove duplicate rows", "clean", {
    files: [...base, "extensions/m365/src/transform.ts"],
  }),
  c("cl-fill", "clean", "fill blank cells with 0", "clean", {
    files: [...base, "extensions/m365/src/transform.ts"],
  }),
  c(
    "cl-zero-id",
    "clean",
    "clean the data: trim extra spaces (IDs with leading zeros must survive)",
    "clean",
    {
      size: "50k",
      files: [...base, "extensions/m365/src/transform.ts"],
    },
  ),
  // --- format, conditional formats, validation ----------------------------------------------------
  c(
    "fm-format",
    "format",
    "format the data nicely with a bold header and banded rows",
    "format",
    { size: "520k", proven: "format" },
  ),
  c(
    "cf-scale",
    "conditional",
    "highlight Requested Quantity with a color scale and add data bars to Issued Quantity",
    "format",
    { size: "520k", proven: "cf-scale-bars" },
  ),
  c("cf-icons", "conditional", "add icon sets to Requested Quantity", "format"),
  c(
    "cf-neg",
    "conditional",
    "highlight negative Issued Quantity in red",
    "format",
  ),
  c(
    "cf-topn",
    "conditional",
    "highlight the top 10 Requested Quantity",
    "view",
  ),
  c(
    "cf-contains",
    "conditional",
    "highlight cells in UoM containing km",
    "format",
  ),
  c("cf-dupes", "conditional", "highlight duplicates in Service ID", "format"),
  c(
    "cf-above",
    "conditional",
    "highlight Requested Quantity above 10",
    "format",
  ),
  c(
    "cf-dates",
    "conditional",
    "highlight PAT Complete Date between 2025-03-01 and 2025-03-31",
    "format",
  ),
  c(
    "val-list",
    "validation",
    "add a dropdown list to the Status column",
    "format",
    { size: "50k", proven: "val-dropdown" },
  ),
  c(
    "val-range",
    "validation",
    "allow only numbers between 0 and 100 in Requested Quantity",
    "format",
  ),
  c(
    "val-date",
    "validation",
    "allow only dates in PAT Complete Date",
    "format",
  ),
  c(
    "val-dependent",
    "validation",
    "make LEA a dependent dropdown of RTOM",
    "format",
  ),
  // --- quality, dashboard, named range, export ---------------------------------------------------
  c("ql-data", "quality", "check the data quality of this data", "quality", {
    size: "520k",
    files: [...base, ...large],
    proven: "quality-data",
  }),
  c("ql-formula", "quality", "audit the formulas in this sheet", "quality"),
  c("ql-repair", "quality", "repair the data problems", "quality"),
  c(
    "d-dash",
    "dashboard",
    "create a dashboard with total Requested Quantity by RTOM",
    "dashboard",
    { size: "520k", proven: "dashboard" },
  ),
  c(
    "nr-name",
    "named-range",
    "name the Requested Quantity column Requested",
    "named-range",
  ),
  c("ex-csv", "export", "export this data as CSV", "export-csv"),
  c("ex-pdf", "export", "export a PDF of the dashboard", "export-pdf"),
  // --- lookup, split, unpivot -----------------------------------------------------------------
  c(
    "lk-lookup",
    "lookup",
    "add RTOM Name from the Lookup sheet by RTOM",
    "add-column",
    { files: [...base, ...large] },
  ),
  c("sp-name", "split", "split Item Code into two columns", "split-column", {
    size: "520k",
    proven: "split",
  }),
  c(
    "un-unpivot",
    "unpivot",
    "unpivot Requested Quantity and Issued Quantity into Measure and Amount",
    "unpivot",
  ),
  // --- refusals -------------------------------------------------------------------------------
  c("r-table", "refuse", "create a table from this data", "table", {
    size: "520k",
  }),
  c("r-slicer", "refuse", "add a slicer for Status", "slicer"),
  c("r-newsheet", "refuse", "copy this data to a new sheet", "view", {
    size: "520k",
  }),
  // --- sinhala / singlish ---------------------------------------------------------------------
  c("si-clean", "sinhala", "clean the data", "clean", {
    si: "දත්ත පිරිසිදු කරන්න",
  }),
  c("si-chart", "sinhala", "chart of Requested Quantity by RTOM", "chart", {
    si: "RTOM අනුව Requested Quantity ප්‍රස්තාරයක්",
  }),
  c(
    "si-pivot",
    "sinhala",
    "pivot of Requested Quantity by RTOM",
    "pivot-table",
    {
      si: "RTOM අනුව Requested Quantity එකතුව pivot table එකක් හදන්න",
      size: "520k",
      proven: "si-pivot",
    },
  ),
  c(
    "si-question",
    "sinhala",
    "which RTOM has the highest total Requested Quantity?",
    "answer",
    { si: "වැඩිම Requested Quantity RTOM එක කුමක්ද?" },
  ),
  // --- edge data ------------------------------------------------------------------------------
  c(
    "e-spaced",
    "edge",
    "pivot of total Requested Quantity by PAT Complete Date",
    "pivot-table",
    { size: "520k" },
  ),
  c(
    "e-blank",
    "edge",
    "describe Issued Quantity (the column has blanks)",
    "statistics",
    { files: [...base, "extensions/m365/src/statistics.ts"] },
  ),
  // --- pane behaviour -------------------------------------------------------------------------
  c("ui-undo", "ui", "Undo then Remove removes only the result sheet", "ui", {
    files: ["extensions/m365/src/taskpane.ts"],
  }),
  c(
    "ui-newchat",
    "ui",
    "New chat starts empty and keeps the old chat in the list",
    "ui",
    {
      files: [
        "extensions/m365/src/taskpane.ts",
        "extensions/m365/src/chatSessions.ts",
      ],
      proven: "new-chat",
    },
  ),
  c(
    "ui-session",
    "ui",
    "Reloading the page does not ask to sign in again",
    "ui",
    {
      files: [
        "extensions/m365/src/taskpane.ts",
        "backend/src/services/m365Policy.ts",
      ],
      proven: "session",
    },
  ),
  c(
    "ui-ai",
    "ui",
    "Analyze with AI shows consent, then recommendations",
    "ui",
    {
      files: [
        "extensions/m365/src/taskpane.ts",
        "extensions/m365/src/analysis.ts",
        "backend/src/services/m365Analysis.ts",
      ],
      proven: "ai-analysis",
    },
  ),
  // --- gaps -----------------------------------------------------------------------------------
  c(
    "g-script",
    "gap",
    "write an Office Script that adds a Total column",
    "gap",
    { files: [] },
  ),
  c("g-vba", "gap", "write a VBA macro that sorts the sheet", "gap", {
    files: [],
  }),
];
