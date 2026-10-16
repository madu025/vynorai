import {
  canonicalExpression,
  numericColumnRefs,
  parseExpression,
  wantsPercentFormat,
} from "./expression.js";
import { isSafeColumnName } from "./transform.js";
type ExcelCell = string | number | boolean | null;
type ExcelRow = ExcelCell[];
type ExcelRangeInput = {
  workbookId: string;
  worksheetName: string;
  address: string;
  values: ExcelRow[];
  hasHeaders?: boolean;
  /** Set when `values` is a sample of a much larger range; `address` is still the whole range. */
  sample?: ExcelSampleInfo;
};
export type ExcelSampleInfo = { totalRows: number; sampledRows: number };
/** With a sampled (very large) range only results that Excel itself computes over every row are safe. */
export const SAMPLED_RANGE_ACTIONS: ReadonlySet<string> = new Set([
  "pivot-table",
  // Computed by Excel from the source itself, nothing is copied.
  "named-range",
  "add-column",
]);
export const SAMPLED_FINGERPRINT_ROWS = 3;

/** A chart is allowed on a sampled range only when it charts a PivotTable Excel computes. */
function sampledKindAllowed(
  kind: string,
  requested: ReadonlySet<string>,
  specs?: {
    chart?: { pivotResult?: boolean; chartType?: string };
    statistics?: { mode?: string };
    clean?: { operations?: string[] };
    quality?: { mode?: string };
  },
): boolean {
  if (SAMPLED_RANGE_ACTIONS.has(kind)) return true;
  // A view is one spilled FILTER/SORTBY/TAKE formula that Excel computes over every row.
  if (kind === "view") return true;
  // A clean-up covers a bounded number of rows (see the warning), so Excel on the web can hold it.
  if (kind === "clean")
    return !(specs?.clean?.operations ?? []).includes("fuzzy-dedupe");
  // Formatting is applied to the first rows only (see the warning).
  if (kind === "format") return true;
  // A column-by-column quality table is live formulas; formula audits need the cells themselves.
  if (kind === "quality")
    return !specs?.quality?.mode || specs.quality.mode === "data";
  // Lookups are spilled per returned column over the whole range.
  if (kind === "lookup-columns") return true;
  // A name split is a source column plus two spilled formulas.
  if (kind === "split-column") return true;
  // An unpivot is one spilled formula over the first rows.
  if (kind === "unpivot") return true;
  // A dashboard is totals, a category table and a PivotTable, all calculated by Excel over every row.
  if (kind === "dashboard") return true;
  // Describe and correlation are live formulas over whole columns; Excel computes them.
  if (kind === "statistics")
    return (
      specs?.statistics?.mode === "describe" ||
      specs?.statistics?.mode === "correlation" ||
      specs?.statistics?.mode === "forecast" ||
      specs?.statistics?.mode === "insights"
    );
  // A histogram is ten COUNTIFS bins over the whole column.
  if (kind === "chart" && specs?.chart?.chartType === "histogram") return true;
  return (
    kind === "chart" &&
    requested.has("pivot-table") &&
    specs?.chart?.pivotResult === true
  );
}

export class InvalidExcelRangeError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "InvalidExcelRangeError";
  }
}
type ExcelRangeProfile = {
  rowCount: number;
  columnCount: number;
  headerRowCount: number;
  headerCount: number;
  blankCells: number;
  duplicateHeaderNames: string[];
  chunkCount: number;
  sourceFingerprint: string;
  sample?: ExcelSampleInfo;
};
type ExcelHeaderNormalization = {
  headerRowCount: 2;
  headers: string[];
};
type ExcelActionPlan = {
  contractVersion: "2026-10-14.excel.v1";
  planId: string;
  workbookId: string;
  worksheetName: string;
  sourceAddress: string;
  sourceFingerprint: string;
  profile: ExcelRangeProfile;
  normalization?: ExcelHeaderNormalization;
  chunks: Array<{ index: number; startRow: number; rowCount: number }>;
  actions: Array<{
    kind:
      | "table"
      | "chart"
      | "new-sheet"
      | "named-range"
      | "slicer"
      | "pivot-table"
      | "clean"
      | "add-column"
      | "lookup-columns"
      | "split-column"
      | "unpivot"
      | "summary"
      | "format"
      | "quality"
      | "statistics"
      | "dashboard"
      | "view"
      | "export-csv"
      | "export-pdf";
    name: string;
    targetSheet: string;
    preservesSource: true;
    description: string;
    spec?: ExcelActionSpec;
  }>;
  warnings: string[];
  requiresConfirmation: true;
};

export type ExcelActionKind = ExcelActionPlan["actions"][number]["kind"];

const EXCEL_ACTION_ORDER: ExcelActionKind[] = [
  "new-sheet",
  "named-range",
  "slicer",
  "table",
  "chart",
  "pivot-table",
  "clean",
  "add-column",
  "lookup-columns",
  "split-column",
  "unpivot",
  "summary",
  "format",
  "quality",
  "statistics",
  "dashboard",
  "view",
  "export-csv",
  "export-pdf",
];

function orderExcelActions(
  requested: Set<ExcelActionKind>,
  pivotResult: boolean,
): ExcelActionKind[] {
  const ordered = EXCEL_ACTION_ORDER.filter((action) => requested.has(action));
  if (pivotResult && requested.has("pivot-table") && requested.has("chart")) {
    const pivot = ordered.indexOf("pivot-table");
    const chart = ordered.indexOf("chart");
    if (pivot > chart) {
      ordered.splice(pivot, 1);
      ordered.splice(chart, 0, "pivot-table");
    }
  }
  return ordered;
}

type ComparableExcelPlan = Omit<
  ExcelActionPlan,
  "planId" | "approvalToken" | "expiresAt"
>;

const DEFAULT_CHUNK_ROWS = 500;

export type ExcelChartType =
  | "column"
  | "line"
  | "bar"
  | "pie"
  | "stacked-column"
  | "stacked-bar"
  | "area"
  | "combo"
  | "histogram"
  | "waterfall";
export type ExcelAggregation = "sum" | "count" | "average" | "min" | "max";
export type ExcelFilterOperator =
  | ">"
  | ">="
  | "<"
  | "<="
  | "="
  | "!="
  | "contains";
export type ExcelHighlightRule =
  | "top-n"
  | "bottom-n"
  | "above-average"
  | "below-average"
  | "duplicates";

export interface ExcelColumnSpecs {
  statistics?: {
    mode: "describe" | "correlation" | "forecast" | "insights";
    columns?: number[];
    pair?: [number, number];
    value?: number;
    periods?: number;
    category?: number;
    date?: number;
  };
  dashboard?: {
    category: number;
    values: number[];
    aggregation?: ExcelAggregation;
  };
  quality?: { mode?: "data" | "formula" | "repair" };
  namedRange?: { source: number };
  slicer?: { source: number };
  chart?: {
    category: number;
    value: number;
    chartType: ExcelChartType;
    extraValues?: number[];
    showDataLabels?: boolean;
    pivotResult?: boolean;
  };
  pivot?: {
    rows: number;
    values: number;
    aggregation?: ExcelAggregation;
    columns?: number;
    filter?: number;
    /** More value fields (at most three) next to the first. */
    extraValues?: number[];
    showAs?: "percent-of-total" | "percent-of-column";
    topN?: number;
  };
  format?: {
    freezeHeader?: boolean;
    autofit?: boolean;
    numberFormats?: boolean;
    totalRow?: boolean;
    conditional?: Array<{
      column: number;
      rule:
        | "data-bars"
        | "color-scale"
        | "negative"
        | "duplicates"
        | "icon-set"
        | "custom-formula"
        | "top-n"
        | "bottom-n"
        | "text-contains"
        | "date-range";
      operator?: ">" | ">=" | "<" | "<=" | "=" | "<>";
      value?: number;
      n?: number;
      text?: string;
      startDate?: string;
      endDate?: string;
    }>;
    validation?: Array<{
      column: number;
      rule: "list" | "non-negative" | "between" | "max-length";
      min?: number;
      max?: number;
    }>;
    inputMessage?: { column: number; title?: string; message?: string };
    dependentDropdown?: { child: number; parent: number };
  };
  clean?: {
    operations: string[];
    fillBlanks?: string | number;
    fillBlanksColumn?: number;
  };
  addColumn?: {
    name: string;
    left?: number;
    operator?: "+" | "-" | "*" | "/";
    right?: number;
    /** A safe column expression; used instead of left/operator/right. */
    expression?: string;
    derived?:
      | "running-total"
      | "rank"
      | "percent-change"
      | "moving-average"
      | "yoy"
      | "date-group"
      | "combine";
    source?: number;
    source2?: number;
    window?: number;
    lag?: number;
    group?: "month" | "quarter" | "year";
    /** Bring a column in from another sheet by matching a key column. */
    lookup?: {
      sheet: string;
      sourceKey: number;
      keyIndex: number;
      keyHeader: string;
      returnIndex: number;
      returnHeader: string;
      rows: number;
      sourceKeys?: number[];
      keyIndexes?: number[];
      keyHeaders?: string[];
      matchMode?: "exact" | "approximate";
      method?: "index-match" | "xlookup";
    };
  };
  lookupColumns?: {
    names: string[];
    lookup: {
      sheet: string;
      sourceKey: number;
      keyIndex: number;
      keyHeader: string;
      returnIndexes: number[];
      returnHeaders: string[];
      rows: number;
      sourceKeys?: number[];
      keyIndexes?: number[];
      keyHeaders?: string[];
      matchMode?: "exact" | "approximate";
      method?: "index-match" | "xlookup";
    };
  };
  split?: { source: number; firstName: string; lastName: string };
  unpivot?: { values: number[]; name: string; value: string };
  summary?: {
    group: number;
    values: Array<{ column: number; aggregation: ExcelAggregation }>;
    total?: boolean;
  };
  view?: {
    sort?: { column: number; direction: "asc" | "desc" };
    filter?: {
      column: number;
      operator: ExcelFilterOperator;
      value: string | number;
    };
    highlight?: { column: number; rule: ExcelHighlightRule; n?: number };
    limit?: number;
  };
}

export interface ExcelActionSpec {
  statistics?: {
    mode: "describe" | "correlation" | "forecast" | "insights";
    columns?: Array<{ column: string; index: number }>;
    pair?: Array<{ column: string; index: number }>;
    value?: { column: string; index: number };
    periods?: number;
    category?: { column: string; index: number };
    date?: { column: string; index: number };
  };
  dashboard?: {
    category: { column: string; index: number };
    values: Array<{ column: string; index: number }>;
    aggregation: ExcelAggregation;
  };
  qualityMode?: "data" | "formula" | "repair";
  categoryColumn?: string;
  categoryIndex?: number;
  valueColumn?: string;
  valueIndex?: number;
  namedRangeColumn?: string;
  namedRangeIndex?: number;
  namedRangeName?: string;
  slicerColumn?: string;
  slicerIndex?: number;
  slicerName?: string;
  chartType?: ExcelChartType;
  showDataLabels?: boolean;
  pivotSourceName?: string;
  extraValueColumns?: string[];
  extraValueIndexes?: number[];
  secondaryIndexes?: number[];
  extraValuesColumns?: string[];
  extraValuesIndexes?: number[];
  showAs?: "percent-of-total" | "percent-of-column";
  topN?: number;
  rowsColumn?: string;
  rowsIndex?: number;
  valuesColumn?: string;
  valuesIndex?: number;
  aggregation?: ExcelAggregation;
  columnsColumn?: string;
  columnsIndex?: number;
  operations?: string[];
  fillBlanks?: string | number;
  fillBlanksColumn?: string;
  fillBlanksColumnIndex?: number;
  columnName?: string;
  leftColumn?: string;
  leftIndex?: number;
  operator?: "+" | "-" | "*" | "/";
  rightColumn?: string;
  rightIndex?: number;
  filterColumn?: string;
  filterIndex?: number;
  freezeHeader?: boolean;
  autofit?: boolean;
  totalRow?: boolean;
  columnFormats?: Array<{ index: number; column: string; format: string }>;
  conditional?: Array<{
    column: string;
    index: number;
    rule: string;
    operator?: string;
    value?: number;
    n?: number;
    text?: string;
  }>;
  validation?: Array<{
    column: string;
    index: number;
    rule: string;
    values?: string[];
    min?: number;
    max?: number;
  }>;
  inputMessage?: {
    column: string;
    index: number;
    title: string;
    message: string;
  };
  dependentDropdown?: {
    childColumn: string;
    childIndex: number;
    parentColumn: string;
    parentIndex: number;
    groups: Array<{ key: string; name: string; values: string[] }>;
  };
  groupColumn?: string;
  groupIndex?: number;
  groups?: string[];
  summaryValues?: Array<{
    column: string;
    index: number;
    aggregation: ExcelAggregation;
  }>;
  includeTotal?: boolean;
  lookupSheet?: string;
  sourceKeyColumn?: string;
  sourceKeyIndex?: number;
  sourceKeyColumns?: string[];
  sourceKeyIndexes?: number[];
  lookupKeyHeader?: string;
  lookupKeyIndex?: number;
  lookupKeyHeaders?: string[];
  lookupKeyIndexes?: number[];
  lookupMatchMode?: "exact" | "approximate";
  lookupMethod?: "index-match" | "xlookup";
  lookupReturnHeader?: string;
  lookupReturnIndex?: number;
  lookupReturnHeaders?: string[];
  lookupReturnIndexes?: number[];
  lookupRows?: number;
  expression?: string;
  canonical?: string;
  refs?: number[];
  percentFormat?: boolean;
  derived?:
    | "running-total"
    | "rank"
    | "percent-change"
    | "moving-average"
    | "yoy"
    | "date-group"
    | "combine";
  sourceColumn?: string;
  sourceIndex?: number;
  sourceColumn2?: string;
  sourceIndex2?: number;
  separator?: string;
  window?: number;
  lag?: number;
  group?: "month" | "quarter" | "year";
  splitSourceColumn?: string;
  splitSourceIndex?: number;
  splitFirstColumn?: string;
  splitLastColumn?: string;
  unpivotValueColumns?: string[];
  unpivotValueIndexes?: number[];
  unpivotNameColumn?: string;
  unpivotValueColumn?: string;
  sort?: { column: string; index: number; direction: "asc" | "desc" };
  filter?: {
    column: string;
    index: number;
    operator: ExcelFilterOperator;
    value: string | number;
  };
  highlight?: {
    column: string;
    index: number;
    rule: ExcelHighlightRule;
    n?: number;
  };
  limit?: number;
}

/**
 * Resolves requested column choices to header names. The same rules run in the add-in and on the
 * server, so a plan that differs between them is blocked before anything can be applied.
 */
function resolveColumnSpecs(
  headers: string[],
  dataRows: any[][],
  specs: ExcelColumnSpecs | undefined,
  requested: Set<string>,
): {
  chart?: ExcelActionSpec;
  pivot?: ExcelActionSpec;
  clean?: ExcelActionSpec;
  addColumn?: ExcelActionSpec;
  lookupColumns?: ExcelActionSpec;
  summary?: ExcelActionSpec;
  format?: ExcelActionSpec;
  view?: ExcelActionSpec;
  statistics?: ExcelActionSpec;
  quality?: ExcelActionSpec;
  dashboard?: ExcelActionSpec;
  namedRange?: ExcelActionSpec;
  slicer?: ExcelActionSpec;
  split?: ExcelActionSpec;
  unpivot?: ExcelActionSpec;
} {
  if (!specs) {
    if (requested.has("dashboard"))
      throw new InvalidExcelRangeError(
        "EXCEL_SPEC_INVALID",
        "A dashboard needs explicit column choices.",
      );
    return {};
  }
  const fail = (code: string, message: string): never => {
    throw new InvalidExcelRangeError(code, message);
  };
  const inRange = (index: unknown): index is number =>
    Number.isInteger(index) &&
    (index as number) >= 0 &&
    (index as number) < headers.length;
  const numeric = (index: number) => {
    const cells = dataRows
      .map((row) => row[index])
      .filter((cell) => cell !== null && cell !== undefined && cell !== "");
    return cells.length > 0 && cells.every((cell) => typeof cell === "number");
  };
  const resolved: {
    chart?: ExcelActionSpec;
    pivot?: ExcelActionSpec;
    clean?: ExcelActionSpec;
    addColumn?: ExcelActionSpec;
    lookupColumns?: ExcelActionSpec;
    summary?: ExcelActionSpec;
    format?: ExcelActionSpec;
    view?: ExcelActionSpec;
    statistics?: ExcelActionSpec;
    quality?: ExcelActionSpec;
    dashboard?: ExcelActionSpec;
    namedRange?: ExcelActionSpec;
    slicer?: ExcelActionSpec;
    split?: ExcelActionSpec;
    unpivot?: ExcelActionSpec;
  } = {};
  if (specs.quality) {
    if (!requested.has("quality"))
      fail("EXCEL_SPEC_UNUSED", "Quality options need the quality action.");
    const mode = specs.quality.mode ?? "data";
    if (mode !== "data" && mode !== "formula" && mode !== "repair")
      fail("EXCEL_SPEC_INVALID", "Choose a valid quality report mode.");
    resolved.quality = { qualityMode: mode };
  }
  if (requested.has("dashboard") && !specs.dashboard)
    fail("EXCEL_SPEC_INVALID", "A dashboard needs explicit column choices.");
  if (specs.namedRange) {
    if (!requested.has("named-range"))
      fail(
        "EXCEL_SPEC_UNUSED",
        "A named-range column choice needs a named-range action.",
      );
    if (!inRange(specs.namedRange.source))
      fail("EXCEL_SPEC_INVALID", "Choose a valid column for the named range.");
    const header = headers[specs.namedRange.source] ?? "Column";
    const safeHeader =
      header
        .replace(/[^A-Za-z0-9_]/g, "_")
        .replace(/^(\d)/, "_$1")
        .slice(0, 40) || "Column";
    resolved.namedRange = {
      namedRangeColumn: header,
      namedRangeIndex: specs.namedRange.source,
      namedRangeName: `VynorAI_${safeHeader}_${specs.namedRange.source + 1}`,
    };
  }
  if (specs.slicer) {
    if (!requested.has("slicer"))
      fail(
        "EXCEL_SPEC_UNUSED",
        "A slicer column choice needs a slicer action.",
      );
    if (!inRange(specs.slicer.source))
      fail("EXCEL_SPEC_INVALID", "Choose a valid column for the slicer.");
    const header = headers[specs.slicer.source] ?? "Column";
    const safeHeader =
      header
        .replace(/[^A-Za-z0-9_]/g, "_")
        .replace(/^(\d)/, "_$1")
        .slice(0, 40) || "Column";
    resolved.slicer = {
      slicerColumn: header,
      slicerIndex: specs.slicer.source,
      slicerName: `VynorAI_${safeHeader}_slicer`,
    };
  }
  const chartTypes = [
    "column",
    "line",
    "bar",
    "pie",
    "stacked-column",
    "stacked-bar",
    "area",
    "combo",
    "histogram",
    "waterfall",
  ];
  if (specs.chart) {
    if (!requested.has("chart"))
      fail("EXCEL_SPEC_UNUSED", "A chart column choice needs a chart action.");
    const { category, value, chartType } = specs.chart;
    const extra = specs.chart.extraValues ?? [];
    if (
      !inRange(category) ||
      !inRange(value) ||
      (category === value &&
        chartType !== "histogram" &&
        chartType !== "waterfall")
    )
      fail("EXCEL_SPEC_INVALID", "Choose two different columns for the chart.");
    if (!chartTypes.includes(chartType))
      fail("EXCEL_SPEC_INVALID", "Unsupported chart type.");
    if (!numeric(value))
      fail(
        "EXCEL_SPEC_VALUE_NOT_NUMERIC",
        "The chart value column must contain numbers.",
      );
    if (
      !Array.isArray(extra) ||
      extra.length > 4 ||
      (chartType === "histogram" && extra.length > 0) ||
      (chartType === "waterfall" && extra.length > 0) ||
      new Set(extra).size !== extra.length ||
      extra.some(
        (index) => !inRange(index) || index === category || index === value,
      )
    )
      fail("EXCEL_SPEC_INVALID", "Extra chart series must be other columns.");
    if (extra.some((index) => !numeric(index)))
      fail(
        "EXCEL_SPEC_VALUE_NOT_NUMERIC",
        "Every chart series column must contain numbers.",
      );
    const meanAbs = (index: number): number => {
      const values = dataRows
        .map((row) => row[index])
        .filter((cell): cell is number => typeof cell === "number")
        .map((cell) => Math.abs(cell));
      return values.length
        ? values.reduce((sum, cell) => sum + cell, 0) / values.length
        : 0;
    };
    const baseScale = meanAbs(value);
    const secondary =
      baseScale > 0
        ? extra.filter((index) => {
            const scale = meanAbs(index);
            return (
              scale > 0 && (scale / baseScale >= 20 || baseScale / scale >= 20)
            );
          })
        : [];
    resolved.chart = {
      categoryColumn: headers[category],
      categoryIndex: category,
      valueColumn: headers[value],
      valueIndex: value,
      chartType,
      ...(specs.chart.showDataLabels ? { showDataLabels: true } : {}),
      ...(extra.length
        ? {
            extraValueColumns: extra.map((index) => headers[index]),
            extraValueIndexes: extra,
            ...(secondary.length ? { secondaryIndexes: secondary } : {}),
          }
        : {}),
    };
  }
  if (specs.pivot) {
    if (!requested.has("pivot-table"))
      fail(
        "EXCEL_SPEC_UNUSED",
        "A PivotTable column choice needs a PivotTable action.",
      );
    const { rows, values } = specs.pivot;
    const extraValues = specs.pivot.extraValues ?? [];
    const showAs = specs.pivot.showAs;
    const topN = specs.pivot.topN;
    const aggregation = specs.pivot.aggregation ?? "sum";
    const columns = specs.pivot.columns;
    if (!inRange(rows) || !inRange(values) || rows === values)
      fail(
        "EXCEL_SPEC_INVALID",
        "Choose two different columns for the PivotTable.",
      );
    if (!["sum", "count", "average", "min", "max"].includes(aggregation))
      fail("EXCEL_SPEC_INVALID", "Unsupported PivotTable aggregation.");
    if (aggregation !== "count" && !numeric(values))
      fail(
        "EXCEL_SPEC_VALUE_NOT_NUMERIC",
        "The PivotTable value column must contain numbers.",
      );
    if (
      columns !== undefined &&
      (!inRange(columns) || columns === rows || columns === values)
    )
      fail(
        "EXCEL_SPEC_INVALID",
        "The PivotTable column field must be a different column.",
      );
    const filter = specs.pivot.filter;
    if (
      filter !== undefined &&
      (!inRange(filter) ||
        filter === rows ||
        filter === values ||
        filter === columns)
    )
      fail(
        "EXCEL_SPEC_INVALID",
        "The PivotTable filter field must be a different column.",
      );
    if (
      !Array.isArray(extraValues) ||
      extraValues.length > 3 ||
      new Set(extraValues).size !== extraValues.length ||
      extraValues.some(
        (index) =>
          !inRange(index) ||
          index === rows ||
          index === values ||
          index === columns ||
          index === filter,
      )
    )
      fail(
        "EXCEL_SPEC_INVALID",
        "Extra PivotTable values must be other columns (at most three).",
      );
    if (aggregation !== "count" && extraValues.some((index) => !numeric(index)))
      fail(
        "EXCEL_SPEC_VALUE_NOT_NUMERIC",
        "Every PivotTable value column must contain numbers.",
      );
    if (
      showAs !== undefined &&
      !["percent-of-total", "percent-of-column"].includes(showAs)
    )
      fail("EXCEL_SPEC_INVALID", "Unsupported PivotTable display option.");
    if (
      topN !== undefined &&
      (!Number.isInteger(topN) || topN < 1 || topN > 100)
    )
      fail(
        "EXCEL_SPEC_INVALID",
        "A PivotTable top N must be between 1 and 100.",
      );
    resolved.pivot = {
      rowsColumn: headers[rows],
      rowsIndex: rows,
      valuesColumn: headers[values],
      valuesIndex: values,
      aggregation,
      ...(extraValues.length
        ? {
            extraValuesColumns: extraValues.map((index) => headers[index]),
            extraValuesIndexes: extraValues,
          }
        : {}),
      ...(showAs ? { showAs } : {}),
      ...(topN !== undefined ? { topN } : {}),
      ...(filter !== undefined
        ? { filterColumn: headers[filter], filterIndex: filter }
        : {}),
      ...(columns !== undefined
        ? { columnsColumn: headers[columns], columnsIndex: columns }
        : {}),
    };
  }
  if (specs.clean) {
    if (!requested.has("clean"))
      fail("EXCEL_SPEC_UNUSED", "Clean options need the clean action.");
    const operations = specs.clean.operations;
    const allowed = [
      "trim",
      "text-to-number",
      "text-to-date",
      "fill-blanks",
      "dedupe",
      "fuzzy-dedupe",
    ];
    if (
      !Array.isArray(operations) ||
      operations.length === 0 ||
      new Set(operations).size !== operations.length ||
      operations.some((operation) => !allowed.includes(operation))
    )
      fail("EXCEL_SPEC_INVALID", "Choose valid, unique clean-up steps.");
    const fillBlanks = specs.clean.fillBlanks;
    const fillBlanksColumn = specs.clean.fillBlanksColumn;
    if (operations.includes("fill-blanks")) {
      if (
        !(
          (typeof fillBlanks === "string" &&
            fillBlanks.length > 0 &&
            fillBlanks.length <= 100 &&
            !/[\u0000-\u001f]/.test(fillBlanks) &&
            !/^[=+\-@]/.test(fillBlanks.trim())) ||
          (typeof fillBlanks === "number" && Number.isFinite(fillBlanks))
        )
      )
        fail(
          "EXCEL_SPEC_INVALID",
          "Fill blanks needs a safe replacement value.",
        );
    } else if (fillBlanks !== undefined) {
      fail("EXCEL_SPEC_UNUSED", "A fill value needs the fill-blanks step.");
    }
    if (
      fillBlanksColumn !== undefined &&
      (!Number.isInteger(fillBlanksColumn) ||
        fillBlanksColumn < 0 ||
        fillBlanksColumn >= headers.length)
    )
      fail("EXCEL_SPEC_INVALID", "Choose a valid column for filling blanks.");
    if (fillBlanksColumn !== undefined && !operations.includes("fill-blanks"))
      fail("EXCEL_SPEC_UNUSED", "A fill column needs the fill-blanks step.");
    if (operations.includes("fuzzy-dedupe") && dataRows.length > 5000)
      fail(
        "EXCEL_SPEC_TOO_LARGE",
        "Fuzzy deduplication is limited to 5,000 data rows.",
      );
    resolved.clean = {
      operations: allowed.filter((operation) => operations.includes(operation)),
      ...(fillBlanks !== undefined ? { fillBlanks } : {}),
      ...(fillBlanksColumn !== undefined
        ? {
            fillBlanksColumn: headers[fillBlanksColumn],
            fillBlanksColumnIndex: fillBlanksColumn,
          }
        : {}),
    };
  }
  if (specs.addColumn) {
    if (!requested.has("add-column"))
      fail(
        "EXCEL_SPEC_UNUSED",
        "A computed column needs the add-column action.",
      );
    const {
      name,
      left,
      operator,
      right,
      expression,
      derived,
      source,
      source2,
      window,
      lag,
      group,
    } = specs.addColumn;
    if (
      typeof name !== "string" ||
      name.trim().length === 0 ||
      name.length > 40 ||
      /^[=+\-@\t\r]/.test(name.trim()) ||
      /[\r\n]/.test(name)
    )
      fail("EXCEL_SPEC_INVALID", "The new column name is not allowed.");
    const lookup = (specs.addColumn as any).lookup as
      | {
          sheet: string;
          sourceKey: number;
          keyIndex: number;
          keyHeader: string;
          returnIndex: number;
          returnHeader: string;
          rows: number;
          sourceKeys?: number[];
          keyIndexes?: number[];
          keyHeaders?: string[];
          matchMode?: "exact" | "approximate";
          method?: "index-match" | "xlookup";
        }
      | undefined;
    if (derived !== undefined) {
      if (
        ![
          "running-total",
          "rank",
          "percent-change",
          "moving-average",
          "yoy",
          "date-group",
          "combine",
        ].includes(derived) ||
        expression !== undefined ||
        left !== undefined ||
        right !== undefined ||
        operator !== undefined ||
        lookup !== undefined
      )
        fail("EXCEL_SPEC_INVALID", "The derived column choice is not valid.");
      if (!inRange(source))
        fail(
          "EXCEL_SPEC_INVALID",
          "Choose a source column for the running total.",
        );
      const sourceIndex = source as number;
      if (derived === "combine") {
        if (!inRange(source2) || sourceIndex === source2)
          fail(
            "EXCEL_SPEC_INVALID",
            "Choose two different columns to combine.",
          );
        resolved.addColumn = {
          columnName: uniqueColumnName(name.trim(), headers),
          derived,
          sourceColumn: headers[sourceIndex],
          sourceIndex,
          sourceColumn2: headers[source2 as number],
          sourceIndex2: source2 as number,
          separator: " - ",
        };
      } else {
        if (
          derived === "moving-average" &&
          (!Number.isInteger(window) ||
            (window as number) < 2 ||
            (window as number) > 12)
        )
          fail(
            "EXCEL_SPEC_INVALID",
            "Choose a moving-average window from 2 to 12.",
          );
        if (derived === "yoy" && (!Number.isInteger(lag) || lag !== 12))
          fail("EXCEL_SPEC_INVALID", "YoY change requires a 12-period lag.");
        if (
          derived === "date-group" &&
          !["month", "quarter", "year"].includes(group as string)
        )
          fail("EXCEL_SPEC_INVALID", "Choose month, quarter or year grouping.");
        if (!numeric(sourceIndex))
          fail(
            "EXCEL_SPEC_VALUE_NOT_NUMERIC",
            `Column "${headers[sourceIndex]}" holds text, not numbers. Choose a numeric column.`,
          );
        resolved.addColumn = {
          columnName: uniqueColumnName(name.trim(), headers),
          derived,
          sourceColumn: headers[sourceIndex],
          sourceIndex,
          ...(derived === "moving-average" ? { window: window as number } : {}),
          ...(derived === "yoy" ? { lag: lag as number } : {}),
          ...(derived === "date-group" ? { group } : {}),
          ...(derived === "percent-change" || derived === "yoy"
            ? { percentFormat: true }
            : {}),
        };
      }
    } else if (lookup !== undefined) {
      if (
        expression !== undefined ||
        left !== undefined ||
        right !== undefined ||
        operator !== undefined
      )
        fail(
          "EXCEL_SPEC_INVALID",
          "A lookup column cannot also have an expression.",
        );
      const text = (value: unknown, max: number) =>
        typeof value === "string" &&
        value.trim().length > 0 &&
        value.length <= max &&
        !/[\u0000-\u001F]/.test(value);
      const sourceKeys = lookup.sourceKeys ?? [lookup.sourceKey];
      const keyIndexes = lookup.keyIndexes ?? [lookup.keyIndex];
      const keyHeaders = lookup.keyHeaders ?? [lookup.keyHeader];
      if (
        !text(lookup.sheet, 31) ||
        /[\[\]:*?/\\]/.test(lookup.sheet) ||
        sourceKeys.length < 1 ||
        sourceKeys.length > 5 ||
        sourceKeys.length !== keyIndexes.length ||
        sourceKeys.length !== keyHeaders.length ||
        sourceKeys.some((index) => !inRange(index)) ||
        new Set(sourceKeys).size !== sourceKeys.length ||
        keyIndexes.some(
          (index) => !Number.isInteger(index) || index < 0 || index > 99,
        ) ||
        new Set(keyIndexes).size !== keyIndexes.length ||
        (lookup.matchMode !== undefined &&
          !["exact", "approximate"].includes(lookup.matchMode)) ||
        (lookup.matchMode === "approximate" && sourceKeys.length !== 1) ||
        (lookup.method !== undefined &&
          !["index-match", "xlookup"].includes(lookup.method)) ||
        (lookup.method === "xlookup" && lookup.matchMode === "approximate") ||
        keyHeaders.some((header) => !text(header, 60)) ||
        !text(lookup.returnHeader, 60) ||
        !Number.isInteger(lookup.returnIndex) ||
        lookup.returnIndex < 0 ||
        lookup.returnIndex > 99 ||
        keyIndexes.includes(lookup.returnIndex) ||
        !Number.isInteger(lookup.rows) ||
        lookup.rows < 1 ||
        lookup.rows > 100000
      )
        fail("EXCEL_SPEC_INVALID", "The lookup choice is not valid.");
      resolved.addColumn = {
        columnName: uniqueColumnName(name.trim(), headers),
        lookupSheet: lookup.sheet,
        sourceKeyColumn: headers[lookup.sourceKey],
        sourceKeyIndex: lookup.sourceKey,
        sourceKeyColumns: sourceKeys.map((index) => headers[index]),
        sourceKeyIndexes: sourceKeys,
        lookupKeyHeader: lookup.keyHeader,
        lookupKeyIndex: lookup.keyIndex,
        lookupKeyHeaders: keyHeaders,
        lookupKeyIndexes: keyIndexes,
        ...(lookup.matchMode ? { lookupMatchMode: lookup.matchMode } : {}),
        ...(lookup.method ? { lookupMethod: lookup.method } : {}),
        lookupReturnHeader: lookup.returnHeader,
        lookupReturnIndex: lookup.returnIndex,
        lookupRows: lookup.rows,
      };
    } else if (expression !== undefined) {
      if (left !== undefined || right !== undefined || operator !== undefined)
        fail(
          "EXCEL_SPEC_INVALID",
          "Use either an expression or two columns, not both.",
        );
      let parsed: ReturnType<typeof parseExpression>;
      try {
        parsed = parseExpression(String(expression), headers);
      } catch (error) {
        return fail("EXCEL_SPEC_INVALID", (error as Error).message);
      }
      const notNumbers = numericColumnRefs(parsed.ast).filter(
        (column) => !numeric(column),
      );
      if (notNumbers.length)
        fail(
          "EXCEL_SPEC_VALUE_NOT_NUMERIC",
          `Column ${notNumbers.map((column) => `"${headers[column]}"`).join(", ")} holds text, not numbers. Use VALUE() or DATEVALUE() on it, or pick a numeric column.`,
        );
      resolved.addColumn = {
        columnName: uniqueColumnName(name.trim(), headers),
        expression: String(expression).trim(),
        canonical: canonicalExpression(parsed.ast),
        refs: parsed.refs,
        percentFormat: wantsPercentFormat(name),
      };
    } else {
      if (!["+", "-", "*", "/"].includes(operator as string))
        fail("EXCEL_SPEC_INVALID", "Unsupported operator.");
      if (!inRange(left) || !inRange(right) || left === right)
        fail("EXCEL_SPEC_INVALID", "Choose two different columns to combine.");
      if (!numeric(left as number) || !numeric(right as number))
        fail(
          "EXCEL_SPEC_VALUE_NOT_NUMERIC",
          "Both columns of a computed column must contain numbers.",
        );
      resolved.addColumn = {
        columnName: uniqueColumnName(name.trim(), headers),
        leftColumn: headers[left as number],
        leftIndex: left as number,
        operator,
        rightColumn: headers[right as number],
        rightIndex: right as number,
      };
    }
  }
  if (specs.lookupColumns) {
    if (!requested.has("lookup-columns"))
      fail(
        "EXCEL_SPEC_UNUSED",
        "Lookup columns need the lookup-columns action.",
      );
    const { names, lookup } = specs.lookupColumns;
    const text = (value: unknown, max: number) =>
      typeof value === "string" &&
      value.trim().length > 0 &&
      value.length <= max &&
      !/[\u0000-\u001F]/.test(value);
    const sourceKeys = lookup.sourceKeys ?? [lookup.sourceKey];
    const keyIndexes = lookup.keyIndexes ?? [lookup.keyIndex];
    const keyHeaders = lookup.keyHeaders ?? [lookup.keyHeader];
    const returnIndexes = lookup.returnIndexes;
    const returnHeaders = lookup.returnHeaders;
    if (
      !Array.isArray(names) ||
      names.length < 2 ||
      names.length > 5 ||
      !Array.isArray(returnIndexes) ||
      !Array.isArray(returnHeaders) ||
      returnIndexes.length !== names.length ||
      returnHeaders.length !== names.length ||
      !text(lookup.sheet, 31) ||
      /[\[\]:*?/\\]/.test(lookup.sheet) ||
      sourceKeys.length < 1 ||
      sourceKeys.length > 5 ||
      sourceKeys.length !== keyIndexes.length ||
      sourceKeys.length !== keyHeaders.length ||
      sourceKeys.some((index) => !inRange(index)) ||
      new Set(sourceKeys).size !== sourceKeys.length ||
      keyIndexes.some(
        (index) => !Number.isInteger(index) || index < 0 || index > 99,
      ) ||
      new Set(keyIndexes).size !== keyIndexes.length ||
      (lookup.matchMode !== undefined &&
        !["exact", "approximate"].includes(lookup.matchMode)) ||
      (lookup.matchMode === "approximate" && sourceKeys.length !== 1) ||
      (lookup.method !== undefined &&
        !["index-match", "xlookup"].includes(lookup.method)) ||
      (lookup.method === "xlookup" && lookup.matchMode === "approximate") ||
      keyHeaders.some((header) => !text(header, 60)) ||
      returnHeaders.some((header) => !text(header, 60)) ||
      names.some((name) => !text(name, 40)) ||
      returnIndexes.some(
        (index) =>
          !Number.isInteger(index) ||
          index < 0 ||
          index > 99 ||
          keyIndexes.includes(index),
      ) ||
      new Set(returnIndexes).size !== returnIndexes.length ||
      !Number.isInteger(lookup.rows) ||
      lookup.rows < 1 ||
      lookup.rows > 100000
    )
      fail("EXCEL_SPEC_INVALID", "The lookup column choices are not valid.");
    const outputNames: string[] = [];
    const taken = [...headers];
    for (const name of names) {
      const output = uniqueColumnName(name.trim(), taken);
      outputNames.push(output);
      taken.push(output);
    }
    resolved.lookupColumns = {
      columnName: outputNames[0],
      lookupSheet: lookup.sheet,
      sourceKeyColumn: headers[lookup.sourceKey],
      sourceKeyIndex: lookup.sourceKey,
      sourceKeyColumns: sourceKeys.map((index) => headers[index]),
      sourceKeyIndexes: sourceKeys,
      lookupKeyHeader: lookup.keyHeader,
      lookupKeyIndex: lookup.keyIndex,
      lookupKeyHeaders: keyHeaders,
      lookupKeyIndexes: keyIndexes,
      ...(lookup.matchMode ? { lookupMatchMode: lookup.matchMode } : {}),
      ...(lookup.method ? { lookupMethod: lookup.method } : {}),
      lookupReturnHeaders: returnHeaders,
      lookupReturnIndexes: returnIndexes,
      lookupRows: lookup.rows,
    };
  }
  if (specs.split) {
    if (!requested.has("split-column"))
      fail("EXCEL_SPEC_UNUSED", "A split needs the split-column action.");
    const { source, firstName, lastName } = specs.split;
    if (
      !inRange(source) ||
      typeof firstName !== "string" ||
      typeof lastName !== "string"
    )
      fail("EXCEL_SPEC_INVALID", "The split column choices are not valid.");
    if (
      firstName.trim() === lastName.trim() ||
      firstName.length > 40 ||
      lastName.length > 40
    )
      fail("EXCEL_SPEC_INVALID", "The split output names are not valid.");
    resolved.split = {
      splitSourceColumn: headers[source],
      splitSourceIndex: source,
      splitFirstColumn: uniqueColumnName(firstName.trim(), headers),
      splitLastColumn: uniqueColumnName(lastName.trim(), headers),
    };
  }
  if (specs.unpivot) {
    if (!requested.has("unpivot"))
      fail("EXCEL_SPEC_UNUSED", "Unpivot options need the unpivot action.");
    const { values, name, value } = specs.unpivot;
    if (
      !Array.isArray(values) ||
      values.length < 2 ||
      values.length > 20 ||
      values.some((index) => !inRange(index)) ||
      new Set(values).size !== values.length ||
      values.length >= headers.length
    )
      fail(
        "EXCEL_SPEC_INVALID",
        "Choose two or more value columns and keep at least one identifier column.",
      );
    if (
      typeof name !== "string" ||
      typeof value !== "string" ||
      !isSafeColumnName(name) ||
      !isSafeColumnName(value) ||
      name.trim() === value.trim()
    )
      fail("EXCEL_SPEC_INVALID", "The unpivot output names are not allowed.");
    resolved.unpivot = {
      unpivotValueColumns: values.map((index) => headers[index]),
      unpivotValueIndexes: values,
      unpivotNameColumn: uniqueColumnName(name.trim(), headers),
      unpivotValueColumn: uniqueColumnName(value.trim(), headers),
    };
  }
  if (specs.summary) {
    if (!requested.has("summary"))
      fail("EXCEL_SPEC_UNUSED", "Summary options need the summary action.");
    const { group, values, total } = specs.summary;
    if (!inRange(group))
      fail("EXCEL_SPEC_INVALID", "Choose a column to group by.");
    if (!Array.isArray(values) || values.length < 1 || values.length > 4)
      fail("EXCEL_SPEC_INVALID", "Choose between one and four value columns.");
    const aggregations = ["sum", "count", "average", "min", "max"];
    const picked: Array<{
      column: string;
      index: number;
      aggregation: ExcelAggregation;
    }> = [];
    for (const entry of values) {
      if (!inRange(entry.column) || entry.column === group)
        fail(
          "EXCEL_SPEC_INVALID",
          "A value column must differ from the group column.",
        );
      if (!aggregations.includes(entry.aggregation))
        fail("EXCEL_SPEC_INVALID", "Unsupported aggregation.");
      if (entry.aggregation !== "count" && !numeric(entry.column))
        fail(
          "EXCEL_SPEC_VALUE_NOT_NUMERIC",
          "A summary value column must contain numbers unless the aggregation is count.",
        );
      if (
        picked.some(
          (item) =>
            item.index === entry.column &&
            item.aggregation === entry.aggregation,
        )
      )
        fail(
          "EXCEL_SPEC_INVALID",
          "Each value and aggregation can be chosen once.",
        );
      picked.push({
        column: headers[entry.column],
        index: entry.column,
        aggregation: entry.aggregation,
      });
    }
    const seen: string[] = [];
    for (const row of dataRows) {
      const cell = row[group];
      if (cell === null || cell === undefined || cell === "") continue;
      const text = String(cell);
      if (!seen.includes(text)) seen.push(text);
      if (seen.length > 200)
        fail(
          "EXCEL_SPEC_INVALID",
          "Too many groups for a summary (limit 200).",
        );
    }
    if (seen.length === 0)
      fail("EXCEL_SPEC_INVALID", "The group column has no values.");
    resolved.summary = {
      groupColumn: headers[group],
      groupIndex: group,
      groups: seen,
      summaryValues: picked,
      includeTotal: total !== false,
    };
  }
  if (specs.format) {
    if (!requested.has("format"))
      fail("EXCEL_SPEC_UNUSED", "Format options need the format action.");
    const options = specs.format;
    const conditionalRules = [
      "data-bars",
      "color-scale",
      "negative",
      "duplicates",
      "icon-set",
      "custom-formula",
      "top-n",
      "bottom-n",
      "text-contains",
      "date-range",
    ];
    const conditional: Array<{
      column: string;
      index: number;
      rule: string;
      operator?: string;
      value?: number;
      n?: number;
      text?: string;
      startDate?: string;
      endDate?: string;
    }> = [];
    for (const entry of options.conditional ?? []) {
      if (!inRange(entry.column) || !conditionalRules.includes(entry.rule))
        fail("EXCEL_SPEC_INVALID", "Choose a valid column and highlight rule.");
      if (
        entry.rule !== "duplicates" &&
        entry.rule !== "text-contains" &&
        entry.rule !== "date-range" &&
        !numeric(entry.column)
      )
        fail(
          "EXCEL_SPEC_VALUE_NOT_NUMERIC",
          "That highlight rule needs a column of numbers.",
        );
      if (conditional.length >= 6)
        fail("EXCEL_SPEC_INVALID", "At most six highlight rules.");
      if (entry.rule === "custom-formula") {
        if (
          ![">", ">=", "<", "<=", "=", "<>"].includes(entry.operator ?? "") ||
          typeof entry.value !== "number" ||
          !Number.isFinite(entry.value) ||
          Math.abs(entry.value) > 1e12
        )
          fail(
            "EXCEL_SPEC_INVALID",
            "Custom conditional formats need a safe numeric comparison.",
          );
      }
      if (entry.rule === "top-n" || entry.rule === "bottom-n") {
        if (
          !Number.isInteger(entry.n) ||
          (entry.n ?? 0) < 1 ||
          (entry.n ?? 0) > 100
        )
          fail(
            "EXCEL_SPEC_INVALID",
            "Top or bottom highlights need a rank from 1 to 100.",
          );
      }
      if (entry.rule === "text-contains") {
        if (
          typeof entry.text !== "string" ||
          entry.text.trim().length < 1 ||
          entry.text.trim().length > 80 ||
          /[\r\n\u0000-\u001F]/.test(entry.text)
        )
          fail(
            "EXCEL_SPEC_INVALID",
            "Text conditional formats need 1 to 80 visible characters.",
          );
      }
      if (entry.rule === "date-range") {
        const parseDate = (value: unknown) => {
          if (typeof value !== "string") return undefined;
          const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
          if (!match) return undefined;
          const year = Number(match[1]);
          const month = Number(match[2]);
          const day = Number(match[3]);
          const stamp = Date.UTC(year, month - 1, day);
          const parsed = new Date(stamp);
          return year >= 1900 &&
            year <= 9999 &&
            parsed.getUTCFullYear() === year &&
            parsed.getUTCMonth() === month - 1 &&
            parsed.getUTCDate() === day
            ? stamp
            : undefined;
        };
        const start = parseDate(entry.startDate);
        const end = parseDate(entry.endDate);
        if (start === undefined || end === undefined || start > end)
          fail(
            "EXCEL_SPEC_INVALID",
            "Date conditional formats need valid ISO dates in ascending order.",
          );
      }
      if (
        conditional.some(
          (item) => item.index === entry.column && item.rule === entry.rule,
        )
      )
        fail(
          "EXCEL_SPEC_INVALID",
          "Each highlight rule can be chosen once per column.",
        );
      conditional.push({
        column: headers[entry.column],
        index: entry.column,
        rule: entry.rule,
        ...(entry.rule === "custom-formula"
          ? { operator: entry.operator, value: entry.value }
          : entry.rule === "top-n" || entry.rule === "bottom-n"
            ? { n: entry.n }
            : entry.rule === "text-contains"
              ? { text: entry.text!.trim() }
              : entry.rule === "date-range"
                ? {
                    startDate: entry.startDate!.trim(),
                    endDate: entry.endDate!.trim(),
                  }
                : {}),
      });
    }
    const validation: Array<{
      column: string;
      index: number;
      rule: string;
      values?: string[];
      min?: number;
      max?: number;
    }> = [];
    for (const entry of options.validation ?? []) {
      if (
        !inRange(entry.column) ||
        !["list", "non-negative", "between", "max-length"].includes(entry.rule)
      )
        fail(
          "EXCEL_SPEC_INVALID",
          "Choose a valid column and validation rule.",
        );
      if (validation.length >= 4)
        fail("EXCEL_SPEC_INVALID", "At most four validation rules.");
      if (entry.rule === "between" || entry.rule === "max-length") {
        const low = (entry as any).min;
        const high = (entry as any).max;
        if (entry.rule === "between") {
          if (!numeric(entry.column))
            fail(
              "EXCEL_SPEC_VALUE_NOT_NUMERIC",
              "Validation needs a column of numbers.",
            );
          if (
            !Number.isFinite(low) ||
            !Number.isFinite(high) ||
            low >= high ||
            Math.abs(low) > 1e12 ||
            Math.abs(high) > 1e12
          )
            fail(
              "EXCEL_SPEC_INVALID",
              "Give a smaller and a larger number for the allowed range.",
            );
        } else if (!Number.isInteger(high) || high < 1 || high > 255) {
          fail("EXCEL_SPEC_INVALID", "Choose a maximum length from 1 to 255.");
        }
        validation.push({
          column: headers[entry.column],
          index: entry.column,
          rule: entry.rule,
          ...(entry.rule === "between" ? { min: low } : {}),
          max: high,
        });
        continue;
      }
      if (entry.rule === "non-negative") {
        if (!numeric(entry.column))
          fail(
            "EXCEL_SPEC_VALUE_NOT_NUMERIC",
            "Validation needs a column of numbers.",
          );
        validation.push({
          column: headers[entry.column],
          index: entry.column,
          rule: entry.rule,
        });
      } else {
        const distinct: string[] = [];
        for (const row of dataRows) {
          const cell = row[entry.column];
          if (cell === null || cell === undefined || cell === "") continue;
          const text = String(cell);
          if (!distinct.includes(text)) distinct.push(text);
          if (distinct.length > 50)
            fail(
              "EXCEL_SPEC_INVALID",
              "A drop-down list can have at most 50 values.",
            );
        }
        if (
          distinct.length === 0 ||
          distinct.some((value) => /[,;"]/.test(value) || value.length > 80)
        )
          fail(
            "EXCEL_SPEC_INVALID",
            "That column cannot become a drop-down list (empty, too long, or values with commas).",
          );
        validation.push({
          column: headers[entry.column],
          index: entry.column,
          rule: "list",
          values: distinct,
        });
      }
    }
    let inputMessage:
      | { column: string; index: number; title: string; message: string }
      | undefined;
    if (options.inputMessage) {
      if (!inRange(options.inputMessage.column))
        fail(
          "EXCEL_SPEC_INVALID",
          "Choose a valid column for the input message.",
        );
      const column = headers[options.inputMessage.column];
      const title = String(
        options.inputMessage.title ?? "VynorAI guidance",
      ).trim();
      const message = String(
        options.inputMessage.message ?? `Choose a valid ${column} value.`,
      ).trim();
      if (!title || title.length > 32 || !message || message.length > 255)
        fail(
          "EXCEL_SPEC_INVALID",
          "Input message title or message is too long.",
        );
      inputMessage = {
        column,
        index: options.inputMessage.column,
        title,
        message,
      };
    }
    let dependentDropdown:
      | {
          childColumn: string;
          childIndex: number;
          parentColumn: string;
          parentIndex: number;
          groups: Array<{ key: string; name: string; values: string[] }>;
        }
      | undefined;
    if (options.dependentDropdown) {
      const { child, parent } = options.dependentDropdown;
      if (!inRange(child) || !inRange(parent) || child === parent)
        fail(
          "EXCEL_SPEC_INVALID",
          "Choose two different valid columns for the dependent drop-down.",
        );
      const groups = new Map<string, { name: string; values: string[] }>();
      const names = new Map<string, string>();
      const safeToken = (value: string) => {
        const token = value
          .replace(/[ -]+/g, "_")
          .replace(/[^A-Za-z0-9_]/g, "_")
          .replace(/^(\d)/, "_$1")
          .slice(0, 40);
        return token || "Blank";
      };
      for (const row of dataRows) {
        const key = String(row[parent] ?? "").trim();
        if (!key) continue;
        if (!/^[A-Za-z0-9 _-]{1,40}$/.test(key))
          fail(
            "EXCEL_SPEC_INVALID",
            "Dependent drop-down parent values must use letters, numbers, spaces, hyphens or underscores.",
          );
        const token = safeToken(key);
        const previous = names.get(token);
        if (previous && previous !== key)
          fail(
            "EXCEL_SPEC_INVALID",
            "Two parent values become the same safe drop-down name.",
          );
        names.set(token, key);
        const group = groups.get(key) ?? {
          name: `VynorAI_DD_${token}`,
          values: [],
        };
        const childValue = String(row[child] ?? "").trim();
        if (childValue && (childValue.length > 80 || /[,;\"]/.test(childValue)))
          fail(
            "EXCEL_SPEC_INVALID",
            "Dependent drop-down child values must be 80 characters or fewer and cannot contain commas, semicolons or quotes.",
          );
        if (childValue && !group.values.includes(childValue))
          group.values.push(childValue);
        if (group.values.length > 50)
          fail(
            "EXCEL_SPEC_INVALID",
            "A dependent drop-down can have at most 50 values per parent.",
          );
        groups.set(key, group);
      }
      const resolvedGroups = [...groups.entries()].map(([key, group]) => {
        if (group.values.length === 0)
          fail(
            "EXCEL_SPEC_INVALID",
            "Each dependent drop-down parent needs at least one child value.",
          );
        return { key, name: group.name, values: group.values };
      });
      if (resolvedGroups.length === 0)
        fail(
          "EXCEL_SPEC_INVALID",
          "The dependent drop-down parent column has no usable values.",
        );
      dependentDropdown = {
        childColumn: headers[child],
        childIndex: child,
        parentColumn: headers[parent],
        parentIndex: parent,
        groups: resolvedGroups,
      };
    }
    const columnFormats: Array<{
      index: number;
      column: string;
      format: string;
    }> = [];
    if (options.numberFormats !== false) {
      headers.forEach((header, index) => {
        if (!numeric(index)) return;
        const cells = dataRows
          .map((row) => row[index])
          .filter((cell) => cell !== null && cell !== undefined && cell !== "");
        const whole = cells.every((cell) => Number.isInteger(cell));
        const percent = /%|percent|\bpct\b/i.test(header);
        columnFormats.push({
          index,
          column: header,
          format: percent ? "0.0%" : whole ? "#,##0" : "#,##0.00",
        });
      });
    }
    resolved.format = {
      freezeHeader: options.freezeHeader !== false,
      autofit: options.autofit !== false,
      totalRow: options.totalRow === true,
      columnFormats,
      conditional,
      validation,
      ...(inputMessage ? { inputMessage } : {}),
      ...(dependentDropdown ? { dependentDropdown } : {}),
    };
  }
  if (specs.statistics) {
    if (!requested.has("statistics"))
      fail(
        "EXCEL_SPEC_UNUSED",
        "Statistics options need the statistics action.",
      );
    const stats = specs.statistics;
    if (
      !["describe", "correlation", "forecast", "insights"].includes(stats.mode)
    )
      fail(
        "EXCEL_SPEC_INVALID",
        "Choose describe, correlation, forecast or insights.",
      );
    const named = (index: number) => ({
      column: headers[index],
      index,
    });
    const checkNumeric = (index: unknown): number => {
      if (!inRange(index))
        fail(
          "EXCEL_SPEC_INVALID",
          "Choose existing columns for the statistics.",
        );
      if (!numeric(index as number))
        fail(
          "EXCEL_SPEC_VALUE_NOT_NUMERIC",
          "Statistics need numeric columns.",
        );
      return index as number;
    };
    const out: ExcelActionSpec = { statistics: { mode: stats.mode } };
    if (stats.mode === "describe") {
      const columns = (stats.columns ?? []).map(checkNumeric);
      if (!columns.length || new Set(columns).size !== columns.length)
        fail(
          "EXCEL_SPEC_INVALID",
          "Choose one or more different numeric columns.",
        );
      if (columns.length > 8)
        fail("EXCEL_SPEC_INVALID", "Choose at most 8 columns.");
      out.statistics!.columns = columns.map(named);
    } else if (stats.mode === "correlation") {
      const pair = stats.pair ?? [];
      if (pair.length !== 2 || pair[0] === pair[1])
        fail("EXCEL_SPEC_INVALID", "Choose two different numeric columns.");
      out.statistics!.pair = pair.map(checkNumeric).map(named);
    } else if (stats.mode === "forecast") {
      const value = checkNumeric(stats.value);
      const periods = stats.periods ?? 3;
      if (!Number.isInteger(periods) || periods < 1 || periods > 24)
        fail("EXCEL_SPEC_INVALID", "Choose 1 to 24 periods to forecast.");
      out.statistics!.value = named(value);
      out.statistics!.periods = periods;
    } else {
      const value = checkNumeric(stats.value);
      const checkOptional = (
        index: unknown,
        label: string,
      ): number | undefined => {
        if (index === undefined) return undefined;
        if (!inRange(index) || index === value)
          fail(
            "EXCEL_SPEC_INVALID",
            `Choose a different existing ${label} column.`,
          );
        return index as number;
      };
      const category = checkOptional(stats.category, "category");
      const date = checkOptional(stats.date, "date");
      if (category !== undefined && date !== undefined && category === date)
        fail(
          "EXCEL_SPEC_INVALID",
          "Choose different category and date columns.",
        );
      out.statistics!.value = named(value);
      if (category !== undefined) out.statistics!.category = named(category);
      if (date !== undefined) out.statistics!.date = named(date);
    }
    resolved.statistics = out;
  }
  if (specs.dashboard) {
    if (!requested.has("dashboard"))
      fail("EXCEL_SPEC_UNUSED", "Dashboard options need the dashboard action.");
    const { category, values, aggregation = "sum" } = specs.dashboard;
    if (!inRange(category))
      fail(
        "EXCEL_SPEC_INVALID",
        "Choose an existing dashboard category column.",
      );
    if (
      !Array.isArray(values) ||
      values.length < 1 ||
      values.length > 3 ||
      new Set(values).size !== values.length ||
      values.some((index) => !inRange(index) || index === category)
    )
      fail(
        "EXCEL_SPEC_INVALID",
        "Choose one to three different dashboard value columns.",
      );
    if (values.some((index) => !numeric(index)))
      fail(
        "EXCEL_SPEC_VALUE_NOT_NUMERIC",
        "Dashboard value columns must contain numbers.",
      );
    if (!["sum", "count", "average", "min", "max"].includes(aggregation))
      fail("EXCEL_SPEC_INVALID", "Choose a supported dashboard aggregation.");
    resolved.dashboard = {
      dashboard: {
        category: { column: headers[category], index: category },
        values: values.map((index) => ({ column: headers[index], index })),
        aggregation,
      },
    };
  }
  if (specs.view) {
    if (!requested.has("view"))
      fail("EXCEL_SPEC_UNUSED", "View options need the view action.");
    const { sort, filter, highlight, limit } = specs.view;
    if (!sort && !filter && !highlight && limit === undefined)
      fail("EXCEL_SPEC_INVALID", "A view needs a sort, filter or highlight.");
    const view: ExcelActionSpec = {};
    if (sort) {
      if (!inRange(sort.column) || !["asc", "desc"].includes(sort.direction))
        fail("EXCEL_SPEC_INVALID", "Choose a column and direction to sort by.");
      view.sort = {
        column: headers[sort.column],
        index: sort.column,
        direction: sort.direction,
      };
    }
    if (filter) {
      const operators = [">", ">=", "<", "<=", "=", "!=", "contains"];
      if (!inRange(filter.column) || !operators.includes(filter.operator))
        fail(
          "EXCEL_SPEC_INVALID",
          "Choose a column and operator to filter by.",
        );
      const isText = filter.operator === "contains";
      if (
        typeof filter.value === "string"
          ? filter.value.length === 0 || filter.value.length > 80
          : typeof filter.value !== "number" || !Number.isFinite(filter.value)
      )
        fail("EXCEL_SPEC_INVALID", "The filter value is not allowed.");
      if (
        (isText && typeof filter.value !== "string") ||
        ([">", ">=", "<", "<="].includes(filter.operator) &&
          (typeof filter.value !== "number" || !numeric(filter.column)))
      )
        fail(
          "EXCEL_SPEC_VALUE_NOT_NUMERIC",
          "Comparisons need a number and a numeric column.",
        );
      view.filter = {
        column: headers[filter.column],
        index: filter.column,
        operator: filter.operator,
        value: filter.value,
      };
    }
    if (highlight) {
      const rules = [
        "top-n",
        "bottom-n",
        "above-average",
        "below-average",
        "duplicates",
      ];
      if (!inRange(highlight.column) || !rules.includes(highlight.rule))
        fail("EXCEL_SPEC_INVALID", "Choose a column and rule to highlight.");
      if (highlight.rule !== "duplicates" && !numeric(highlight.column))
        fail(
          "EXCEL_SPEC_VALUE_NOT_NUMERIC",
          "This highlight rule needs a numeric column.",
        );
      const n = highlight.n;
      if (
        ["top-n", "bottom-n"].includes(highlight.rule) &&
        (!Number.isInteger(n) || (n as number) < 1 || (n as number) > 100)
      )
        fail(
          "EXCEL_SPEC_INVALID",
          "Choose how many rows to highlight (1-100).",
        );
      view.highlight = {
        column: headers[highlight.column],
        index: highlight.column,
        rule: highlight.rule,
        ...(["top-n", "bottom-n"].includes(highlight.rule) ? { n } : {}),
      };
    }
    if (limit !== undefined) {
      if (!Number.isInteger(limit) || limit < 1 || limit > 1000)
        fail("EXCEL_SPEC_INVALID", "Choose how many rows to show (1-1000).");
      view.limit = limit;
    }
    resolved.view = view;
  }
  return resolved;
}

const normalizedCell = (value: ExcelCell): string => String(value ?? "").trim();

type ExcelHeaderLayout = {
  headerRowCount: 0 | 1 | 2;
  headers: string[];
  normalization?: ExcelHeaderNormalization;
};

const noHeaderLayout: ExcelHeaderLayout = {
  headerRowCount: 0,
  headers: [],
};

/** A new column never repeats an existing header: "Region" becomes "Region (2)". */
function uniqueColumnName(name: string, headers: string[]): string {
  const taken = new Set(
    headers.map((header) => header.trim().toLocaleLowerCase()),
  );
  if (!taken.has(name.toLocaleLowerCase())) return name;
  for (let attempt = 2; attempt < 100; attempt += 1) {
    const candidate = `${name} (${attempt})`.slice(0, 40);
    if (!taken.has(candidate.toLocaleLowerCase())) return candidate;
  }
  return name;
}

function assertUniqueHeaders(headers: string[]): void {
  const normalizedHeaders = headers.map((header) => header.toLocaleLowerCase());
  if (new Set(normalizedHeaders).size !== normalizedHeaders.length) {
    const seen = new Set<string>();
    const repeated = [
      ...new Set(
        headers.filter((header, index) => {
          const key = normalizedHeaders[index];
          const again = seen.has(key);
          seen.add(key);
          return again;
        }),
      ),
    ];
    throw new InvalidExcelRangeError(
      "EXCEL_HEADERS_MUST_BE_UNIQUE",
      `Two columns are both named "${repeated.slice(0, 3).join('", "')}". Every column needs a unique header, so rename one and try again.`,
    );
  }
}

export function getExcelHeaderLayout(
  input: ExcelRangeInput,
): ExcelHeaderLayout {
  const firstRow = (input.values[0] ?? []).map(normalizedCell);
  if (!firstRow.length)
    throw new InvalidExcelRangeError(
      "EXCEL_HEADERS_REQUIRED",
      "Select a flat range with one complete header row.",
    );
  if (!firstRow.some((header) => !header)) {
    assertUniqueHeaders(firstRow);
    return { headerRowCount: 1, headers: firstRow };
  }
  if (input.values.length < 3)
    throw new InvalidExcelRangeError(
      "EXCEL_DATA_ROWS_REQUIRED",
      "Select the two header rows and at least one data row below them.",
    );
  const secondRow = (input.values[1] ?? []).map(normalizedCell);
  // A selected block can include a title/merged band above an otherwise flat header row.
  // If the second row is complete, use it as the header rather than rejecting a safe read.
  if (
    !firstRow[0] &&
    secondRow.length === firstRow.length &&
    secondRow.length > 0 &&
    secondRow.every(Boolean)
  ) {
    assertUniqueHeaders(secondRow);
    return {
      headerRowCount: 2,
      headers: secondRow,
      normalization: { headerRowCount: 2, headers: secondRow },
    };
  }
  const inheritedHeaders: string[] = [];
  let activeHeader = "";
  for (let index = 0; index < firstRow.length; index += 1) {
    if (firstRow[index]) activeHeader = firstRow[index];
    if (!activeHeader)
      throw new InvalidExcelRangeError(
        "EXCEL_HEADERS_REQUIRED",
        "The first selected row has a leading blank header cell. Select the complete merged header range.",
      );
    inheritedHeaders.push(activeHeader);
  }
  const headers = inheritedHeaders.map((topHeader, index) => {
    const childHeader = secondRow[index];
    return childHeader &&
      childHeader.toLocaleLowerCase() !== topHeader.toLocaleLowerCase()
      ? `${topHeader} ${childHeader}`
      : topHeader;
  });
  assertUniqueHeaders(headers);
  return {
    headerRowCount: 2,
    headers,
    normalization: { headerRowCount: 2, headers },
  };
}

/**
 * Table and PivotTable mutations need one flat, complete header row. Reject ambiguous
 * merged/multi-row headers instead of letting Excel infer or rewrite the workbook shape.
 */
export function assertValidExcelTabularRange(input: ExcelRangeInput): void {
  if (input.values.length < 2)
    throw new InvalidExcelRangeError(
      "EXCEL_DATA_ROWS_REQUIRED",
      "Select one header row and at least one data row.",
    );
  const columnCount = input.values[0]?.length ?? 0;
  if (columnCount < 1 || input.values.some((row) => row.length !== columnCount))
    throw new InvalidExcelRangeError(
      "EXCEL_RANGE_NOT_RECTANGULAR",
      "Select one rectangular Excel range.",
    );
  const layout =
    input.hasHeaders === false ? noHeaderLayout : getExcelHeaderLayout(input);
  const dataOffset = layout.headerRowCount;
  const hasData = input.values
    .slice(dataOffset)
    .some((row) => row.some((value) => normalizedCell(value) !== ""));
  if (!hasData)
    throw new InvalidExcelRangeError(
      "EXCEL_DATA_ROWS_REQUIRED",
      "The selection has no data rows. Include the rows below the header before inspecting.",
    );
}

/**
 * Maps an explicit user instruction to the mutation allowlist. Ambiguous text returns no
 * actions, so inspecting data can never silently turn into every supported workbook change.
 */
export function selectExcelActions(instruction: string): ExcelActionKind[] {
  const normalized = instruction.toLocaleLowerCase().replace(/[_-]+/g, " ");
  if (
    /\b(?:export|download)\b.*\bcsv\b|\bcsv\b.*\b(?:export|download|file)\b/.test(
      normalized,
    )
  )
    return ["export-csv"];
  if (
    /\b(?:export|download)\b.*\bpdf\b|\bpdf\b.*\b(?:export|download|file)\b/.test(
      normalized,
    )
  )
    return /\bdashboard\b/.test(normalized)
      ? ["dashboard", "export-pdf"]
      : ["export-pdf"];
  if (/\b(?:kpi\s+)?dashboard\b/.test(normalized)) return ["dashboard"];
  const withoutPivot = normalized.replace(/pivot\s*table/g, " ");
  const requested = new Set<ExcelActionKind>();
  if (/\btable\b|\bformat\s+(?:it\s+)?as\s+(?:a\s+)?table\b/.test(withoutPivot))
    requested.add("table");
  if (/\bnamed\s+range\b/.test(normalized)) requested.add("named-range");
  if (/\bslicer\b/.test(normalized)) requested.add("slicer");
  if (/\b(chart|graph|plot|visuali[sz](?:e|ation))\b/.test(normalized))
    requested.add("chart");
  if (
    /\b(new|result|summary)\s+(sheet|worksheet|tab)\b|\bworksheet\b/.test(
      normalized,
    )
  )
    requested.add("new-sheet");
  if (/\bpivot(?:\s*table)?\b/.test(normalized)) requested.add("pivot-table");
  return EXCEL_ACTION_ORDER.filter((action) => requested.has(action));
}

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
  0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotateRight(value: number, count: number): number {
  return (value >>> count) | (value << (32 - count));
}

/** Small synchronous SHA-256 implementation for the Office client, which has no Node crypto. */
function sha256Hex(value: string): string {
  const input = new TextEncoder().encode(value);
  const paddedLength = Math.ceil((input.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(input);
  padded[input.length] = 0x80;
  const view = new DataView(padded.buffer);
  const bitLength = input.length * 8;
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x1_0000_0000));
  view.setUint32(paddedLength - 4, bitLength >>> 0);

  const state = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c,
    0x1f83d9ab, 0x5be0cd19,
  ]);
  const words = new Uint32Array(64);
  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let index = 0; index < 16; index += 1)
      words[index] = view.getUint32(offset + index * 4);
    for (let index = 16; index < 64; index += 1) {
      const s0 =
        rotateRight(words[index - 15], 7) ^
        rotateRight(words[index - 15], 18) ^
        (words[index - 15] >>> 3);
      const s1 =
        rotateRight(words[index - 2], 17) ^
        rotateRight(words[index - 2], 19) ^
        (words[index - 2] >>> 10);
      words[index] = (words[index - 16] + s0 + words[index - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = state;
    for (let index = 0; index < 64; index += 1) {
      const sum1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choice = (e & f) ^ (~e & g);
      const temp1 = (h + sum1 + choice + SHA256_K[index] + words[index]) >>> 0;
      const sum0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (sum0 + majority) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }
    state[0] = (state[0] + a) >>> 0;
    state[1] = (state[1] + b) >>> 0;
    state[2] = (state[2] + c) >>> 0;
    state[3] = (state[3] + d) >>> 0;
    state[4] = (state[4] + e) >>> 0;
    state[5] = (state[5] + f) >>> 0;
    state[6] = (state[6] + g) >>> 0;
    state[7] = (state[7] + h) >>> 0;
  }
  return [...state].map((word) => word.toString(16).padStart(8, "0")).join("");
}

/** SHA-256 fingerprint of the exact source cells used by the local mutation gate. */
export function fingerprintExcelRange(input: ExcelRangeInput): string {
  // A sampled range cannot be re-read in full cheaply: it is pinned by its size and header rows.
  const serialized = JSON.stringify(
    input.sample
      ? {
          workbookId: input.workbookId,
          worksheetName: input.worksheetName,
          address: input.address,
          sample: input.sample,
          values: input.values.slice(0, SAMPLED_FINGERPRINT_ROWS),
        }
      : {
          workbookId: input.workbookId,
          worksheetName: input.worksheetName,
          address: input.address,
          values: input.values,
        },
  );
  return sha256Hex(serialized);
}

export function profileExcelRange(
  input: ExcelRangeInput,
  chunkRows = DEFAULT_CHUNK_ROWS,
): ExcelRangeProfile {
  if (!Number.isInteger(chunkRows) || chunkRows < 1 || chunkRows > 5000) {
    throw new Error("chunkRows must be an integer between 1 and 5000");
  }
  assertValidExcelTabularRange(input);
  const layout =
    input.hasHeaders === false ? noHeaderLayout : getExcelHeaderLayout(input);
  const headers = layout.headers;
  const seen = new Set<string>();
  const duplicateHeaderNames = new Set<string>();
  for (const value of headers) {
    const header = String(value ?? "").trim();
    if (!header) continue;
    if (seen.has(header)) duplicateHeaderNames.add(header);
    seen.add(header);
  }
  const columnCount = input.values.reduce(
    (max, row) => Math.max(max, row.length),
    0,
  );
  const blankCells = input.values.reduce(
    (count, row) =>
      count + row.filter((value) => value === null || value === "").length,
    0,
  );
  const dataRows = Math.max(0, input.values.length - layout.headerRowCount);
  return {
    rowCount: input.sample ? input.sample.totalRows : input.values.length,
    columnCount,
    headerRowCount: layout.headerRowCount,
    headerCount: headers.length,
    blankCells,
    duplicateHeaderNames: [...duplicateHeaderNames].sort(),
    chunkCount: input.sample ? 1 : Math.max(1, Math.ceil(dataRows / chunkRows)),
    sourceFingerprint: fingerprintExcelRange(input),
    ...(input.sample ? { sample: input.sample } : {}),
  };
}

export function createExcelPreviewPlan(
  input: ExcelRangeInput,
  requestedActions: ExcelActionKind[],
  chunkRows = DEFAULT_CHUNK_ROWS,
  specs?: ExcelColumnSpecs,
): Omit<ExcelActionPlan, "planId" | "approvalToken" | "expiresAt"> {
  const profile = profileExcelRange(input, chunkRows);
  const layout =
    input.hasHeaders === false ? noHeaderLayout : getExcelHeaderLayout(input);
  const requested = new Set(requestedActions);
  if (input.sample) {
    if (
      layout.normalization ||
      [...requested].some((kind) => !sampledKindAllowed(kind, requested, specs))
    )
      throw new InvalidExcelRangeError(
        "EXCEL_SPEC_INVALID",
        "This data is too large to read in full. A PivotTable works on every row; select at most 100,000 cells for other results.",
      );
  }
  if (layout.normalization) requested.add("new-sheet");
  const safeActions = orderExcelActions(
    requested,
    specs?.chart?.pivotResult === true,
  );
  const baseName = excelSafeBaseName(input.worksheetName);
  const resultSheet = `${baseName}_Vynor_Result`;
  const targetFor = (kind: ExcelActionKind) =>
    kind === "clean"
      ? `${baseName}_Vynor_Clean`
      : kind === "add-column"
        ? `${baseName}_Vynor_Calc`
        : kind === "lookup-columns"
          ? `${baseName}_Vynor_Lookup`
          : kind === "split-column"
            ? `${baseName}_Vynor_Split`
            : kind === "unpivot"
              ? `${baseName}_Vynor_Unpivot`
              : kind === "format"
                ? `${baseName}_Vynor_Format`
                : kind === "quality"
                  ? `${baseName}_Vynor_Report`
                  : kind === "summary"
                    ? `${baseName}_Vynor_Totals`
                    : kind === "view"
                      ? `${baseName}_Vynor_View`
                      : kind === "statistics"
                        ? `${baseName}_Vynor_Stats`
                        : kind === "named-range"
                          ? `${baseName}_Vynor_Names`
                          : kind === "slicer"
                            ? `${baseName}_Vynor_Slicer`
                            : kind === "dashboard"
                              ? `${baseName}_Vynor_Dashboard`
                              : kind === "export-csv"
                                ? `${baseName}_Vynor_CSV`
                                : kind === "export-pdf"
                                  ? requested.has("dashboard")
                                    ? `${baseName}_Vynor_Dashboard`
                                    : `${baseName}_Vynor_PDF`
                                  : resultSheet;
  if (
    (requested.has("summary") ||
      requested.has("format") ||
      requested.has("quality") ||
      requested.has("statistics") ||
      requested.has("dashboard")) &&
    layout.normalization
  )
    throw new InvalidExcelRangeError(
      "EXCEL_SPEC_INVALID",
      "This result needs a range with one header row.",
    );
  const resolved = resolveColumnSpecs(
    layout.headers,
    input.values.slice(layout.headerRowCount),
    specs,
    requested,
  );
  const actions = safeActions.map((kind) => ({
    kind,
    name:
      kind === "named-range" && resolved.namedRange
        ? (resolved.namedRange.namedRangeName ??
          `${baseName}_Vynor_named_range`)
        : kind === "slicer" && resolved.slicer
          ? (resolved.slicer.slicerName ?? `${baseName}_Vynor_slicer`)
          : `${baseName}_Vynor_${kind.replace("-", "_")}`,
    targetSheet: targetFor(kind),
    preservesSource: true as const,
    description: layout.normalization
      ? `Preview ${kind} using a normalized copy of ${input.address} on ${resultSheet}; source data remains unchanged.`
      : `Preview ${kind} using ${input.address}; source data remains unchanged.`,
    ...(kind === "chart" && resolved.chart
      ? {
          spec: {
            ...resolved.chart,
            ...(requested.has("pivot-table") && specs?.chart?.pivotResult
              ? { pivotSourceName: `${baseName}_Vynor_pivot_table` }
              : {}),
          },
        }
      : {}),
    ...(kind === "pivot-table" && resolved.pivot
      ? { spec: resolved.pivot }
      : {}),
    ...(kind === "clean" && resolved.clean ? { spec: resolved.clean } : {}),
    ...(kind === "add-column" && resolved.addColumn
      ? { spec: resolved.addColumn }
      : {}),
    ...(kind === "lookup-columns" && resolved.lookupColumns
      ? { spec: resolved.lookupColumns }
      : {}),
    ...(kind === "unpivot" && resolved.unpivot
      ? { spec: resolved.unpivot }
      : {}),
    ...(kind === "split-column" && resolved.split
      ? { spec: resolved.split }
      : {}),
    ...(kind === "format" && resolved.format ? { spec: resolved.format } : {}),
    ...(kind === "summary" && resolved.summary
      ? { spec: resolved.summary }
      : {}),
    ...(kind === "view" && resolved.view ? { spec: resolved.view } : {}),
    ...(kind === "statistics" && resolved.statistics
      ? { spec: resolved.statistics }
      : {}),
    ...(kind === "quality" && resolved.quality
      ? { spec: resolved.quality }
      : {}),
    ...(kind === "dashboard" && resolved.dashboard
      ? { spec: resolved.dashboard }
      : {}),
    ...(kind === "named-range" && resolved.namedRange
      ? { spec: resolved.namedRange }
      : {}),
    ...(kind === "slicer" && resolved.slicer ? { spec: resolved.slicer } : {}),
  }));
  const chunks = Array.from({ length: profile.chunkCount }, (_, index) => ({
    index,
    startRow: layout.headerRowCount + index * chunkRows,
    rowCount: Math.min(
      chunkRows,
      Math.max(
        0,
        input.values.length - layout.headerRowCount - index * chunkRows,
      ),
    ),
  }));
  const warnings = [
    ...profile.duplicateHeaderNames.map((name) => `Duplicate header: ${name}`),
  ];
  if (input.sample)
    warnings.push(
      `Very large data: the preview uses a sample of ${input.sample.sampledRows.toLocaleString("en-US")} of ${input.sample.totalRows.toLocaleString("en-US")} rows; Excel calculates the result over every row.`,
    );
  else if (profile.blankCells > 0)
    warnings.push(`${profile.blankCells} blank cells require review.`);
  if (input.sample && requested.has("clean"))
    warnings.push(
      `The cleaned sheet covers the first ${Math.max(1000, Math.min(50_000, Math.floor(500_000 / Math.max(1, profile.columnCount)))).toLocaleString("en-US")} rows; Excel on the web cannot hold more.`,
    );
  if (input.sample && requested.has("unpivot"))
    warnings.push(
      "The unpivoted sheet covers the first rows only; Excel on the web cannot hold more.",
    );
  if (input.sample && requested.has("format"))
    warnings.push("The formatted sheet shows the first 5,000 rows.");
  if (!input.sample && profile.chunkCount > 1)
    warnings.push(
      `Large range will be processed in ${profile.chunkCount} chunks.`,
    );
  return {
    contractVersion: "2026-10-14.excel.v1",
    workbookId: input.workbookId,
    worksheetName: input.worksheetName,
    sourceAddress: input.address,
    sourceFingerprint: profile.sourceFingerprint,
    profile,
    normalization: layout.normalization,
    chunks,
    actions,
    warnings,
    requiresConfirmation: true,
  };
}

/** Confirms that the server authorized the exact local preview, excluding its hash implementation. */
export function excelPlansMatch(
  local: ComparableExcelPlan,
  server: Partial<ExcelActionPlan>,
): boolean {
  const comparableProfile = (profile: any) => ({
    rowCount: profile?.rowCount,
    columnCount: profile?.columnCount,
    headerRowCount: profile?.headerRowCount,
    headerCount: profile?.headerCount,
    blankCells: profile?.blankCells,
    duplicateHeaderNames: profile?.duplicateHeaderNames,
    chunkCount: profile?.chunkCount,
    sample: profile?.sample,
  });
  return (
    server.contractVersion === local.contractVersion &&
    server.workbookId === local.workbookId &&
    server.worksheetName === local.worksheetName &&
    server.sourceAddress === local.sourceAddress &&
    server.requiresConfirmation === true &&
    JSON.stringify(comparableProfile(server.profile)) ===
      JSON.stringify(comparableProfile(local.profile)) &&
    JSON.stringify(server.chunks) === JSON.stringify(local.chunks) &&
    JSON.stringify(server.normalization) ===
      JSON.stringify(local.normalization) &&
    JSON.stringify(server.actions) === JSON.stringify(local.actions) &&
    JSON.stringify(server.warnings) === JSON.stringify(local.warnings)
  );
}

export function assertConfirmedApproval(
  confirmed: boolean,
  approvalToken?: string,
): void {
  if (!confirmed)
    throw new Error(
      "Explicit confirmation is required before workbook mutation",
    );
  if (!approvalToken)
    throw new Error(
      "A valid approval token is required before workbook mutation",
    );
}

/**
 * Excel caps sheet names at 31 characters and object names must start with a letter or "_".
 * 18 characters + "_Vynor_Result" (13) stays within the sheet-name limit.
 */
export function excelSafeBaseName(worksheetName: string): string {
  // A sheet this add-in made ("Sales_Vynor_Result (2)") must not be stacked into another
  // "..._Vynor_Forma_Vynor_Result" name when it is used as a source.
  const origin = String(worksheetName).replace(
    /_Vynor_[A-Za-z]+(?:\s*\(\d+\))?$/,
    "",
  );
  const base = origin.replace(/[^A-Za-z0-9_]/g, "_").slice(0, 18) || "Sheet";
  return /^[A-Za-z_]/.test(base) ? base : `S_${base}`.slice(0, 18);
}

/**
 * A very large range is never read in full, so a chart or a group summary is computed by a
 * PivotTable instead (Excel aggregates every row). Other requests are left for the planner to refuse.
 */
export function adaptForSampledRange(
  actions: ExcelActionKind[],
  specs: ExcelColumnSpecs,
): { actions: ExcelActionKind[]; specs: ExcelColumnSpecs } {
  const next = new Set<ExcelActionKind>(actions);
  const out: ExcelColumnSpecs = { ...specs };
  if (
    next.has("chart") &&
    !next.has("pivot-table") &&
    specs.chart &&
    specs.chart.chartType !== "histogram" &&
    specs.chart.chartType !== "waterfall"
  ) {
    next.add("pivot-table");
    out.chart = { ...specs.chart, pivotResult: true };
    out.pivot = {
      rows: specs.chart.category,
      values: specs.chart.value,
      aggregation: "sum",
      ...(specs.chart.extraValues?.length
        ? { extraValues: specs.chart.extraValues.slice(0, 3) }
        : {}),
    };
  } else if (
    next.has("chart") &&
    next.has("pivot-table") &&
    specs.chart &&
    specs.chart.chartType !== "histogram" &&
    specs.chart.chartType !== "waterfall" &&
    !specs.chart.pivotResult
  ) {
    // A chart and a PivotTable asked together: the chart draws the PivotTable Excel computes.
    out.chart = { ...specs.chart, pivotResult: true };
    if (
      specs.pivot?.rows !== specs.chart.category ||
      specs.pivot?.values !== specs.chart.value
    )
      out.pivot = {
        rows: specs.chart.category,
        values: specs.chart.value,
        aggregation: "sum",
        ...(specs.chart.extraValues?.length
          ? { extraValues: specs.chart.extraValues.slice(0, 3) }
          : {}),
      };
  }
  if (
    next.has("summary") &&
    !next.has("pivot-table") &&
    specs.summary?.values?.length
  ) {
    const [first, ...others] = specs.summary.values;
    next.delete("summary");
    next.add("pivot-table");
    delete out.summary;
    const extra = others
      .filter((value) => value.aggregation === first.aggregation)
      .slice(0, 3)
      .map((value) => value.column);
    out.pivot = {
      rows: specs.summary.group,
      values: first.column,
      aggregation: first.aggregation,
      ...(extra.length ? { extraValues: extra } : {}),
    };
  }
  return { actions: [...next], specs: out };
}
