import type { ExcelActionResult, ExcelActionStatus } from "./officeExcel.js";

export type StoredResultGallery = {
  planId: string;
  results: ExcelActionResult[];
};

/** Persist only the stable result-card evidence; workbook objects are revalidated on restore. */
export function serializeResultGallery(
  planId: string,
  results: readonly ExcelActionResult[],
  maxResults: number,
): string {
  return JSON.stringify({
    planId,
    results: results.slice(-maxResults).map((result) => ({
      kind: result.kind,
      name: result.name,
      targetSheet: result.targetSheet,
      status: result.status,
      ...(result.request ? { request: result.request } : {}),
      ...(result.sourceRange ? { sourceRange: result.sourceRange } : {}),
      ...(result.previewPlanId ? { previewPlanId: result.previewPlanId } : {}),
      ...(result.createdSheet ? { createdSheet: true } : {}),
      ...(result.createdNames?.length
        ? { createdNames: result.createdNames.slice(0, 20) }
        : {}),
    })),
  });
}

/**
 * Parse persisted result cards and keep only entries whose target sheet still exists.
 * This is deliberately pure: the caller owns localStorage and the Office host check.
 */
export function parseResultGallery(
  raw: string | null,
  availableSheets: ReadonlySet<string>,
  maxResults: number,
): StoredResultGallery | undefined {
  try {
    const parsed = JSON.parse(raw || "null") as {
      planId?: unknown;
      results?: unknown;
    } | null;
    if (
      !parsed ||
      typeof parsed.planId !== "string" ||
      !Array.isArray(parsed.results)
    ) {
      return undefined;
    }
    const results = parsed.results
      .filter((entry): entry is Record<string, unknown> => {
        if (!entry || typeof entry !== "object") return false;
        const item = entry as Record<string, unknown>;
        return (
          typeof item.kind === "string" &&
          typeof item.name === "string" &&
          typeof item.targetSheet === "string" &&
          (item.status === "created" || item.status === "exists") &&
          availableSheets.has(item.targetSheet)
        );
      })
      .slice(-maxResults)
      .map((item) => ({
        kind: item.kind as string,
        name: item.name as string,
        targetSheet: item.targetSheet as string,
        status: item.status as ExcelActionStatus,
        ...(typeof item.request === "string" ? { request: item.request } : {}),
        ...(typeof item.sourceRange === "string"
          ? { sourceRange: item.sourceRange }
          : {}),
        ...(typeof item.previewPlanId === "string"
          ? { previewPlanId: item.previewPlanId }
          : {}),
        ...(item.createdSheet === true ? { createdSheet: true } : {}),
        ...(Array.isArray(item.createdNames)
          ? {
              createdNames: item.createdNames
                .filter((name): name is string => typeof name === "string")
                .slice(0, 20),
            }
          : {}),
      }));
    return { planId: parsed.planId, results };
  } catch {
    return undefined;
  }
}
