type ExcelCell = string | number | boolean | null;
type ExcelRow = ExcelCell[];
type ExcelRangeInput = {
  workbookId: string;
  worksheetName: string;
  address: string;
  values: ExcelRow[];
  hasHeaders?: boolean;
};
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

const DEFAULT_CHUNK_ROWS = 500;

function fingerprint(input: ExcelRangeInput): string {
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
    headerCount: headers.length,
    blankCells,
    duplicateHeaderNames: [...duplicateHeaderNames].sort(),
    chunkCount: Math.max(1, Math.ceil(dataRows / chunkRows)),
    sourceFingerprint: fingerprint(input),
  };
}

export function createExcelPreviewPlan(
  input: ExcelRangeInput,
  requestedActions: Array<"table" | "chart" | "new-sheet" | "pivot-table">,
  chunkRows = DEFAULT_CHUNK_ROWS,
): Omit<ExcelActionPlan, "planId" | "approvalToken" | "expiresAt"> {
  const profile = profileExcelRange(input, chunkRows);
  const safeActions = [...new Set(requestedActions)];
  const baseName =
    input.worksheetName.replace(/[^A-Za-z0-9_]/g, "_").slice(0, 24) || "Sheet";
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
