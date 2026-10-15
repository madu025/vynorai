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
      | "add-column";
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
];

type ComparableExcelPlan = Omit<
  ExcelActionPlan,
  "planId" | "approvalToken" | "expiresAt"
>;

const DEFAULT_CHUNK_ROWS = 500;

export interface ExcelColumnSpecs {
  chart?: {
    category: number;
    value: number;
    chartType: "column" | "line" | "bar" | "pie";
  };
  pivot?: { rows: number; values: number };
  clean?: { operations: string[] };
  addColumn?: {
    name: string;
    left: number;
    operator: "+" | "-" | "*" | "/";
    right: number;
  };
}

export interface ExcelActionSpec {
  categoryColumn?: string;
  categoryIndex?: number;
  valueColumn?: string;
  valueIndex?: number;
  chartType?: "column" | "line" | "bar" | "pie";
  rowsColumn?: string;
  rowsIndex?: number;
  valuesColumn?: string;
  valuesIndex?: number;
  aggregation?: "sum";
  operations?: string[];
  columnName?: string;
  leftColumn?: string;
  leftIndex?: number;
  operator?: "+" | "-" | "*" | "/";
  rightColumn?: string;
  rightIndex?: number;
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
  } = {};
  if (specs.chart) {
    if (!requested.has("chart"))
      fail("EXCEL_SPEC_UNUSED", "A chart column choice needs a chart action.");
    const { category, value, chartType } = specs.chart;
    if (!inRange(category) || !inRange(value) || category === value)
      fail("EXCEL_SPEC_INVALID", "Choose two different columns for the chart.");
    if (!["column", "line", "bar", "pie"].includes(chartType))
      fail("EXCEL_SPEC_INVALID", "Unsupported chart type.");
    if (!numeric(value))
      fail(
        "EXCEL_SPEC_VALUE_NOT_NUMERIC",
        "The chart value column must contain numbers.",
      );
    resolved.chart = {
      categoryColumn: headers[category],
      categoryIndex: category,
      valueColumn: headers[value],
      valueIndex: value,
      chartType,
    };
  }
  if (specs.pivot) {
    if (!requested.has("pivot-table"))
      fail(
        "EXCEL_SPEC_UNUSED",
        "A PivotTable column choice needs a PivotTable action.",
      );
    const { rows, values } = specs.pivot;
    if (!inRange(rows) || !inRange(values) || rows === values)
      fail(
        "EXCEL_SPEC_INVALID",
        "Choose two different columns for the PivotTable.",
      );
    if (!numeric(values))
      fail(
        "EXCEL_SPEC_VALUE_NOT_NUMERIC",
        "The PivotTable value column must contain numbers.",
      );
    resolved.pivot = {
      rowsColumn: headers[rows],
      rowsIndex: rows,
      valuesColumn: headers[values],
      valuesIndex: values,
      aggregation: "sum",
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
    const { name, left, operator, right } = specs.addColumn;
    if (
      typeof name !== "string" ||
      name.trim().length === 0 ||
      name.length > 40 ||
      /^[=+\-@\t\r]/.test(name.trim()) ||
      /[\r\n]/.test(name)
    )
      fail("EXCEL_SPEC_INVALID", "The new column name is not allowed.");
    if (!["+", "-", "*", "/"].includes(operator))
      fail("EXCEL_SPEC_INVALID", "Unsupported operator.");
    if (!inRange(left) || !inRange(right) || left === right)
      fail("EXCEL_SPEC_INVALID", "Choose two different columns to combine.");
    if (!numeric(left) || !numeric(right))
      fail(
        "EXCEL_SPEC_VALUE_NOT_NUMERIC",
        "Both columns of a computed column must contain numbers.",
      );
    resolved.addColumn = {
      columnName: name.trim(),
      leftColumn: headers[left],
      leftIndex: left,
      operator,
      rightColumn: headers[right],
      rightIndex: right,
    };
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
        : kind === "table" && !layout.normalization
          ? input.worksheetName
          : resultSheet;
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
