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
  if (input.hasHeaders !== false) {
    const headers = values[0].map(normalizedCell);
    if (headers.some((header) => !header))
      throw new InvalidExcelRangeError(
        "EXCEL_HEADERS_REQUIRED",
        "The first selected row has blank or merged header cells.",
      );
    const normalizedHeaders = headers.map((header) =>
      header.toLocaleLowerCase(),
    );
    if (new Set(normalizedHeaders).size !== normalizedHeaders.length)
      throw new InvalidExcelRangeError(
        "EXCEL_HEADERS_MUST_BE_UNIQUE",
        "Every selected column needs a unique header.",
      );
  }
  const dataOffset = input.hasHeaders === false ? 0 : 1;
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
  const headers = input.hasHeaders === false ? [] : values[0] || [];
  const seen = new Set<string>();
  const duplicateHeaderNames = new Set<string>();
  for (const value of headers) {
    const header = String(value ?? "").trim();
    if (!header) continue;
    if (seen.has(header)) duplicateHeaderNames.add(header);
    seen.add(header);
  }
  const dataOffset = input.hasHeaders === false ? 0 : 1;
  const dataRows = Math.max(0, values.length - dataOffset);
  const chunkCount = Math.max(1, Math.ceil(dataRows / chunkRows));
  const profile = {
    rowCount: values.length,
    columnCount: values.reduce((max, row) => Math.max(max, row.length), 0),
    headerCount: headers.filter((value) => normalizedCell(value) !== "").length,
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
  const actions = [...new Set(requestedActions)].map((kind) => ({
    kind,
    name: `${baseName}_Vynor_${kind.replace("-", "_")}`,
    targetSheet:
      kind === "table" ? input.worksheetName : `${baseName}_Vynor_Result`,
    preservesSource: true,
    description: `Preview ${kind} using ${input.address}; source data remains unchanged.`,
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
