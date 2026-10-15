import {
  canonicalExpression,
  numericColumnRefs,
  parseExpression,
  wantsPercentFormat,
} from "./expression.js";
type ExcelCell = string | number | boolean | null;
type ExcelRow = ExcelCell[];
type ExcelRangeInput = {
  workbookId: string;
  worksheetName: string;
  address: string;
  values: ExcelRow[];
  hasHeaders?: boolean;
};

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
      | "pivot-table"
      | "clean"
      | "add-column"
      | "summary"
      | "format"
      | "quality"
      | "statistics"
      | "dashboard"
      | "view";
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
  "table",
  "chart",
  "pivot-table",
  "clean",
  "add-column",
  "summary",
  "format",
  "quality",
  "statistics",
  "dashboard",
  "view",
];

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
  | "area";
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
  chart?: {
    category: number;
    value: number;
    chartType: ExcelChartType;
    extraValues?: number[];
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
        | "icon-set";
    }>;
    validation?: Array<{
      column: number;
      rule: "list" | "non-negative" | "between" | "max-length";
      min?: number;
      max?: number;
    }>;
  };
  clean?: { operations: string[]; fillBlanks?: string | number };
  addColumn?: {
    name: string;
    left?: number;
    operator?: "+" | "-" | "*" | "/";
    right?: number;
    /** A safe column expression; used instead of left/operator/right. */
    expression?: string;
    /** Bring a column in from another sheet by matching a key column. */
    lookup?: {
      sheet: string;
      sourceKey: number;
      keyIndex: number;
      keyHeader: string;
      returnIndex: number;
      returnHeader: string;
      rows: number;
    };
  };
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
  categoryColumn?: string;
  categoryIndex?: number;
  valueColumn?: string;
  valueIndex?: number;
  chartType?: ExcelChartType;
  extraValueColumns?: string[];
  extraValueIndexes?: number[];
  secondaryIndexes?: number[];
  extraValuesColumns?: string[];
  extraValuesIndexes?: number[];
  showAs?: "percent-of-total" | "percent-of-column";
  rowsColumn?: string;
  rowsIndex?: number;
  valuesColumn?: string;
  valuesIndex?: number;
  aggregation?: ExcelAggregation;
  columnsColumn?: string;
  columnsIndex?: number;
  operations?: string[];
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
  conditional?: Array<{ column: string; index: number; rule: string }>;
  validation?: Array<{
    column: string;
    index: number;
    rule: string;
    values?: string[];
    min?: number;
    max?: number;
  }>;
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
  lookupKeyHeader?: string;
  lookupKeyIndex?: number;
  lookupReturnHeader?: string;
  lookupReturnIndex?: number;
  lookupRows?: number;
  expression?: string;
  canonical?: string;
  refs?: number[];
  percentFormat?: boolean;
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
  summary?: ExcelActionSpec;
  format?: ExcelActionSpec;
  view?: ExcelActionSpec;
  statistics?: ExcelActionSpec;
  dashboard?: ExcelActionSpec;
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
    summary?: ExcelActionSpec;
    format?: ExcelActionSpec;
    view?: ExcelActionSpec;
    statistics?: ExcelActionSpec;
    dashboard?: ExcelActionSpec;
  } = {};
  if (requested.has("dashboard") && !specs.dashboard)
    fail("EXCEL_SPEC_INVALID", "A dashboard needs explicit column choices.");
  const chartTypes = [
    "column",
    "line",
    "bar",
    "pie",
    "stacked-column",
    "stacked-bar",
    "area",
  ];
  if (specs.chart) {
    if (!requested.has("chart"))
      fail("EXCEL_SPEC_UNUSED", "A chart column choice needs a chart action.");
    const { category, value, chartType } = specs.chart;
    const extra = specs.chart.extraValues ?? [];
    if (!inRange(category) || !inRange(value) || category === value)
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
    ];
    if (
      !Array.isArray(operations) ||
      operations.length === 0 ||
      new Set(operations).size !== operations.length ||
      operations.some((operation) => !allowed.includes(operation))
    )
      fail("EXCEL_SPEC_INVALID", "Choose valid, unique clean-up steps.");
    const fillBlanks = specs.clean.fillBlanks;
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
    resolved.clean = {
      operations: allowed.filter((operation) => operations.includes(operation)),
      ...(fillBlanks !== undefined ? { fillBlanks } : {}),
    };
  }
  if (specs.addColumn) {
    if (!requested.has("add-column"))
      fail(
        "EXCEL_SPEC_UNUSED",
        "A computed column needs the add-column action.",
      );
    const { name, left, operator, right, expression } = specs.addColumn;
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
        }
      | undefined;
    if (lookup !== undefined) {
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
      if (
        !text(lookup.sheet, 31) ||
        /[\[\]:*?/\\]/.test(lookup.sheet) ||
        !text(lookup.keyHeader, 60) ||
        !text(lookup.returnHeader, 60) ||
        !inRange(lookup.sourceKey) ||
        !Number.isInteger(lookup.keyIndex) ||
        lookup.keyIndex < 0 ||
        lookup.keyIndex > 99 ||
        !Number.isInteger(lookup.returnIndex) ||
        lookup.returnIndex < 0 ||
        lookup.returnIndex > 99 ||
        lookup.keyIndex === lookup.returnIndex ||
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
        lookupKeyHeader: lookup.keyHeader,
        lookupKeyIndex: lookup.keyIndex,
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
      if (!numeric(entry.column))
        fail(
          "EXCEL_SPEC_VALUE_NOT_NUMERIC",
          "A summary value column must contain numbers.",
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
    ];
    const conditional: Array<{ column: string; index: number; rule: string }> =
      [];
    for (const entry of options.conditional ?? []) {
      if (!inRange(entry.column) || !conditionalRules.includes(entry.rule))
        fail("EXCEL_SPEC_INVALID", "Choose a valid column and highlight rule.");
      if (entry.rule !== "duplicates" && !numeric(entry.column))
        fail(
          "EXCEL_SPEC_VALUE_NOT_NUMERIC",
          "That highlight rule needs a column of numbers.",
        );
      if (conditional.length >= 6)
        fail("EXCEL_SPEC_INVALID", "At most six highlight rules.");
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
  if (/\b(?:kpi\s+)?dashboard\b/.test(normalized)) return ["dashboard"];
  const withoutPivot = normalized.replace(/pivot\s*table/g, " ");
  const requested = new Set<ExcelActionKind>();
  if (/\btable\b|\bformat\s+(?:it\s+)?as\s+(?:a\s+)?table\b/.test(withoutPivot))
    requested.add("table");
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
  const serialized = JSON.stringify({
    workbookId: input.workbookId,
    worksheetName: input.worksheetName,
    address: input.address,
    values: input.values,
  });
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
    rowCount: input.values.length,
    columnCount,
    headerRowCount: layout.headerRowCount,
    headerCount: headers.length,
    blankCells,
    duplicateHeaderNames: [...duplicateHeaderNames].sort(),
    chunkCount: Math.max(1, Math.ceil(dataRows / chunkRows)),
    sourceFingerprint: fingerprintExcelRange(input),
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
  if (layout.normalization) requested.add("new-sheet");
  const safeActions = EXCEL_ACTION_ORDER.filter((action) =>
    requested.has(action),
  );
  const baseName = excelSafeBaseName(input.worksheetName);
  const resultSheet = `${baseName}_Vynor_Result`;
  const targetFor = (kind: ExcelActionKind) =>
    kind === "clean"
      ? `${baseName}_Vynor_Clean`
      : kind === "add-column"
        ? `${baseName}_Vynor_Calc`
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
                  : kind === "dashboard"
                    ? `${baseName}_Vynor_Dashboard`
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
    name: `${baseName}_Vynor_${kind.replace("-", "_")}`,
    targetSheet: targetFor(kind),
    preservesSource: true as const,
    description: layout.normalization
      ? `Preview ${kind} using a normalized copy of ${input.address} on ${resultSheet}; source data remains unchanged.`
      : `Preview ${kind} using ${input.address}; source data remains unchanged.`,
    ...(kind === "chart" && resolved.chart ? { spec: resolved.chart } : {}),
    ...(kind === "pivot-table" && resolved.pivot
      ? { spec: resolved.pivot }
      : {}),
    ...(kind === "clean" && resolved.clean ? { spec: resolved.clean } : {}),
    ...(kind === "add-column" && resolved.addColumn
      ? { spec: resolved.addColumn }
      : {}),
    ...(kind === "format" && resolved.format ? { spec: resolved.format } : {}),
    ...(kind === "summary" && resolved.summary
      ? { spec: resolved.summary }
      : {}),
    ...(kind === "view" && resolved.view ? { spec: resolved.view } : {}),
    ...(kind === "statistics" && resolved.statistics
      ? { spec: resolved.statistics }
      : {}),
    ...(kind === "dashboard" && resolved.dashboard
      ? { spec: resolved.dashboard }
      : {}),
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
  if (profile.blankCells > 0)
    warnings.push(`${profile.blankCells} blank cells require review.`);
  if (profile.chunkCount > 1)
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
