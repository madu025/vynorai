import {
  canonicalExpression,
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
  };
  format?: {
    freezeHeader?: boolean;
    autofit?: boolean;
    numberFormats?: boolean;
    totalRow?: boolean;
    conditional?: Array<{
      column: number;
      rule: "data-bars" | "color-scale" | "negative" | "duplicates";
    }>;
    validation?: Array<{ column: number; rule: "list" | "non-negative" }>;
  };
  clean?: { operations: string[] };
  addColumn?: {
    name: string;
    left?: number;
    operator?: "+" | "-" | "*" | "/";
    right?: number;
    /** A safe column expression; used instead of left/operator/right. */
    expression?: string;
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
  };
}

export interface ExcelActionSpec {
  categoryColumn?: string;
  categoryIndex?: number;
  valueColumn?: string;
  valueIndex?: number;
  chartType?: ExcelChartType;
  extraValueColumns?: string[];
  extraValueIndexes?: number[];
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
} {
  if (!specs) return {};
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
  } = {};
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
    resolved.pivot = {
      rowsColumn: headers[rows],
      rowsIndex: rows,
      valuesColumn: headers[values],
      valuesIndex: values,
      aggregation,
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
    const allowed = ["trim", "text-to-number", "dedupe"];
    if (
      !Array.isArray(operations) ||
      operations.length === 0 ||
      new Set(operations).size !== operations.length ||
      operations.some((operation) => !allowed.includes(operation))
    )
      fail("EXCEL_SPEC_INVALID", "Choose valid, unique clean-up steps.");
    resolved.clean = {
      operations: allowed.filter((operation) => operations.includes(operation)),
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
    if (expression !== undefined) {
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
      if (!parsed.refs.every((column) => numeric(column)))
        fail(
          "EXCEL_SPEC_VALUE_NOT_NUMERIC",
          "Every column used in an expression must contain numbers.",
        );
      resolved.addColumn = {
        columnName: name.trim(),
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
        columnName: name.trim(),
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
    }> = [];
    for (const entry of options.validation ?? []) {
      if (
        !inRange(entry.column) ||
        !["list", "non-negative"].includes(entry.rule)
      )
        fail(
          "EXCEL_SPEC_INVALID",
          "Choose a valid column and validation rule.",
        );
      if (validation.length >= 4)
        fail("EXCEL_SPEC_INVALID", "At most four validation rules.");
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
  if (specs.view) {
    if (!requested.has("view"))
      fail("EXCEL_SPEC_UNUSED", "View options need the view action.");
    const { sort, filter, highlight } = specs.view;
    if (!sort && !filter && !highlight)
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

function assertUniqueHeaders(headers: string[]): void {
  const normalizedHeaders = headers.map((header) => header.toLocaleLowerCase());
  if (new Set(normalizedHeaders).size !== normalizedHeaders.length)
    throw new InvalidExcelRangeError(
      "EXCEL_HEADERS_MUST_BE_UNIQUE",
      "Every selected column needs a unique header before creating a Table or PivotTable.",
    );
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

/** Local FNV-1a fingerprint of the exact source cells; used to prove the source is unchanged. */
export function fingerprintExcelRange(input: ExcelRangeInput): string {
  let hash = 2166136261;
  const serialized = JSON.stringify({
    workbookId: input.workbookId,
    worksheetName: input.worksheetName,
    address: input.address,
    values: input.values,
  });
  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= serialized.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${(hash >>> 0).toString(16).padStart(8, "0")}${"0".repeat(56)}`;
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
                : kind === "table" && !layout.normalization
                  ? input.worksheetName
                  : resultSheet;
  if (
    (requested.has("summary") ||
      requested.has("format") ||
      requested.has("quality")) &&
    layout.normalization
  )
    throw new InvalidExcelRangeError(
      "EXCEL_SPEC_INVALID",
      "A summary needs a range with one header row.",
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
  const base =
    String(worksheetName)
      .replace(/[^A-Za-z0-9_]/g, "_")
      .slice(0, 18) || "Sheet";
  return /^[A-Za-z_]/.test(base) ? base : `S_${base}`.slice(0, 18);
}
