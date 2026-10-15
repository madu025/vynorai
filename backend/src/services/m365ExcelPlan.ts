import crypto from "node:crypto";

export class InvalidExcelRangeError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "InvalidExcelRangeError";
  }
}

function normalizedCell(value: unknown): string {
  return String(value ?? "").trim();
}

type ExcelHeaderLayout = {
  headerRowCount: 0 | 1 | 2;
  headers: string[];
  normalization?: { headerRowCount: 2; headers: string[] };
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
      "Every selected column needs a unique header.",
    );
}

function getServerExcelHeaderLayout(input: any): ExcelHeaderLayout {
  const firstRow = ((input.values as any[][])[0] || []).map(normalizedCell);
  if (!firstRow.length)
    throw new InvalidExcelRangeError(
      "EXCEL_HEADERS_REQUIRED",
      "Select a flat range with one complete header row.",
    );
  if (!firstRow.some((header) => !header)) {
    assertUniqueHeaders(firstRow);
    return { headerRowCount: 1, headers: firstRow };
  }
  if ((input.values as any[][]).length < 3)
    throw new InvalidExcelRangeError(
      "EXCEL_DATA_ROWS_REQUIRED",
      "Select the two header rows and at least one data row below them.",
    );
  const secondRow = ((input.values as any[][])[1] || []).map(normalizedCell);
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

export function assertValidServerExcelRange(input: any): void {
  const values = input.values as any[][];
  if (values.length < 2)
    throw new InvalidExcelRangeError(
      "EXCEL_DATA_ROWS_REQUIRED",
      "Select one header row and at least one data row.",
    );
  const columnCount = values[0]?.length ?? 0;
  if (columnCount < 1 || values.some((row) => row.length !== columnCount))
    throw new InvalidExcelRangeError(
      "EXCEL_RANGE_NOT_RECTANGULAR",
      "Select one rectangular Excel range.",
    );
  const layout =
    input.hasHeaders === false
      ? noHeaderLayout
      : getServerExcelHeaderLayout(input);
  const dataOffset = layout.headerRowCount;
  const hasData = values
    .slice(dataOffset)
    .some((row) => row.some((value) => normalizedCell(value) !== ""));
  if (!hasData)
    throw new InvalidExcelRangeError(
      "EXCEL_DATA_ROWS_REQUIRED",
      "The selection has no data rows.",
    );
}

export function createServerExcelPreviewPlan(
  input: any,
  requestedActions: string[],
  chunkRows = 500,
): any {
  if (!Number.isInteger(chunkRows) || chunkRows < 1 || chunkRows > 5000)
    throw new Error("chunkRows must be an integer between 1 and 5000");
  assertValidServerExcelRange(input);
  const values = input.values as any[][];
  const layout =
    input.hasHeaders === false
      ? noHeaderLayout
      : getServerExcelHeaderLayout(input);
  const headers = layout.headers;
  const seen = new Set<string>();
  const duplicateHeaderNames = new Set<string>();
  for (const value of headers) {
    const header = String(value ?? "").trim();
    if (!header) continue;
    if (seen.has(header)) duplicateHeaderNames.add(header);
    seen.add(header);
  }
  const dataOffset = layout.headerRowCount;
  const dataRows = Math.max(0, values.length - dataOffset);
  const chunkCount = Math.max(1, Math.ceil(dataRows / chunkRows));
  const profile = {
    rowCount: values.length,
    columnCount: values.reduce((max, row) => Math.max(max, row.length), 0),
    headerRowCount: layout.headerRowCount,
    headerCount: headers.length,
    blankCells: values.reduce(
      (count, row) =>
        count + row.filter((value) => value === null || value === "").length,
      0,
    ),
    duplicateHeaderNames: [...duplicateHeaderNames].sort(),
    chunkCount,
    sourceFingerprint: crypto
      .createHash("sha256")
      .update(JSON.stringify(input))
      .digest("hex"),
  };
  const baseName = excelSafeBaseName(input.worksheetName);
  const requested = new Set(requestedActions);
  if (layout.normalization) requested.add("new-sheet");
  const actions = ["new-sheet", "table", "chart", "pivot-table"]
    .filter((kind) => requested.has(kind))
    .map((kind) => ({
      kind,
      name: `${baseName}_Vynor_${kind.replace("-", "_")}`,
      targetSheet:
        kind === "table" && !layout.normalization
          ? input.worksheetName
          : `${baseName}_Vynor_Result`,
      preservesSource: true,
      description: layout.normalization
        ? `Preview ${kind} using a normalized copy of ${input.address} on ${baseName}_Vynor_Result; source data remains unchanged.`
        : `Preview ${kind} using ${input.address}; source data remains unchanged.`,
    }));
  const warnings = [
    ...profile.duplicateHeaderNames.map((name) => `Duplicate header: ${name}`),
  ];
  if (profile.blankCells > 0)
    warnings.push(`${profile.blankCells} blank cells require review.`);
  if (chunkCount > 1)
    warnings.push(`Large range will be processed in ${chunkCount} chunks.`);
  return {
    contractVersion: "2026-10-14.excel.v1",
    workbookId: input.workbookId,
    worksheetName: input.worksheetName,
    sourceAddress: input.address,
    sourceFingerprint: profile.sourceFingerprint,
    profile,
    normalization: layout.normalization,
    chunks: Array.from({ length: chunkCount }, (_, index) => ({
      index,
      startRow: dataOffset + index * chunkRows,
      rowCount: Math.min(chunkRows, dataRows - index * chunkRows),
    })),
    actions,
    warnings,
    requiresConfirmation: true,
  };
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
