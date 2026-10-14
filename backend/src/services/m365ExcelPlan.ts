import crypto from "node:crypto";

export function createServerExcelPreviewPlan(
  input: any,
  requestedActions: string[],
  chunkRows = 500,
): any {
  if (!Number.isInteger(chunkRows) || chunkRows < 1 || chunkRows > 5000)
    throw new Error("chunkRows must be an integer between 1 and 5000");
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
  const baseName =
    input.worksheetName.replace(/[^A-Za-z0-9_]/g, "_").slice(0, 24) || "Sheet";
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
