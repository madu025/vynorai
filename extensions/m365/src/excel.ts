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
  headerCount: number;
  blankCells: number;
  duplicateHeaderNames: string[];
  chunkCount: number;
  sourceFingerprint: string;
};
type ExcelActionPlan = {
  contractVersion: "2026-10-14.excel.v1";
  planId: string;
  workbookId: string;
  worksheetName: string;
  sourceAddress: string;
  sourceFingerprint: string;
  profile: ExcelRangeProfile;
  chunks: Array<{ index: number; startRow: number; rowCount: number }>;
  actions: Array<{
    kind: "table" | "chart" | "new-sheet" | "pivot-table";
    name: string;
    targetSheet: string;
    preservesSource: true;
    description: string;
  }>;
  warnings: string[];
  requiresConfirmation: true;
};

export type ExcelActionKind = ExcelActionPlan["actions"][number]["kind"];

const EXCEL_ACTION_ORDER: ExcelActionKind[] = [
  "table",
  "chart",
  "new-sheet",
  "pivot-table",
];

type ComparableExcelPlan = Omit<
  ExcelActionPlan,
  "planId" | "approvalToken" | "expiresAt"
>;

const DEFAULT_CHUNK_ROWS = 500;

const normalizedCell = (value: ExcelCell): string => String(value ?? "").trim();

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
  if (input.hasHeaders !== false) {
    const headers = input.values[0].map(normalizedCell);
    if (headers.some((header) => !header))
      throw new InvalidExcelRangeError(
        "EXCEL_HEADERS_REQUIRED",
        "The first selected row has blank or merged header cells. Select a flat range with one complete header row.",
      );
    const normalizedHeaders = headers.map((header) =>
      header.toLocaleLowerCase(),
    );
    if (new Set(normalizedHeaders).size !== normalizedHeaders.length)
      throw new InvalidExcelRangeError(
        "EXCEL_HEADERS_MUST_BE_UNIQUE",
        "Every selected column needs a unique header before creating a Table or PivotTable.",
      );
  }
  const dataOffset = input.hasHeaders === false ? 0 : 1;
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
  const headers = input.hasHeaders === false ? [] : (input.values[0] ?? []);
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
  const dataRows = Math.max(
    0,
    input.values.length - (input.hasHeaders === false ? 0 : 1),
  );
  return {
    rowCount: input.values.length,
    columnCount,
    headerCount: headers.filter((value) => normalizedCell(value) !== "").length,
    blankCells,
    duplicateHeaderNames: [...duplicateHeaderNames].sort(),
    chunkCount: Math.max(1, Math.ceil(dataRows / chunkRows)),
    sourceFingerprint: fingerprintExcelRange(input),
  };
}

export function createExcelPreviewPlan(
  input: ExcelRangeInput,
  requestedActions: Array<"table" | "chart" | "new-sheet" | "pivot-table">,
  chunkRows = DEFAULT_CHUNK_ROWS,
): Omit<ExcelActionPlan, "planId" | "approvalToken" | "expiresAt"> {
  const profile = profileExcelRange(input, chunkRows);
  const safeActions = [...new Set(requestedActions)];
  const baseName = excelSafeBaseName(input.worksheetName);
  const actions = safeActions.map((kind) => ({
    kind,
    name: `${baseName}_Vynor_${kind.replace("-", "_")}`,
    targetSheet:
      kind === "table" ? input.worksheetName : `${baseName}_Vynor_Result`,
    preservesSource: true as const,
    description: `Preview ${kind} using ${input.address}; source data remains unchanged.`,
  }));
  const chunks = Array.from({ length: profile.chunkCount }, (_, index) => ({
    index,
    startRow: (input.hasHeaders === false ? 0 : 1) + index * chunkRows,
    rowCount: Math.min(
      chunkRows,
      Math.max(
        0,
        input.values.length -
          (input.hasHeaders === false ? 0 : 1) -
          index * chunkRows,
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
