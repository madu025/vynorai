import type { ExcelColumnSpecs } from "./excel.js";

const FOLLOW_WORDS = /(?:\b(?:that|it|same|those|these)\b|ඒකටම|eka|ekata)/i;
const CHART_WORDS = /\b(line|pie|bar|area|column|scatter)\b/i;

/**
 * "Now add a chart for that" names no columns, so it reuses the columns of the PivotTable
 * that was just applied. Returns the specs unchanged when the request is not such a follow-up.
 */
export function applyFollowUpChart(
  specs: ExcelColumnSpecs,
  earlier: ExcelColumnSpecs | undefined,
  instruction: string,
  headers: readonly string[],
  actions: readonly string[],
): { specs: ExcelColumnSpecs; applied: boolean } {
  const pivot = earlier?.pivot;
  if (!pivot || !actions.includes("chart")) return { specs, applied: false };
  const lower = instruction.toLowerCase();
  const namesAColumn = headers.some(
    (header) =>
      String(header).length > 1 && lower.includes(String(header).toLowerCase()),
  );
  if (namesAColumn || !FOLLOW_WORDS.test(instruction))
    return { specs, applied: false };
  const named = CHART_WORDS.exec(instruction)?.[1]?.toLowerCase();
  return {
    applied: true,
    specs: {
      ...specs,
      chart: {
        category: pivot.rows,
        value: pivot.values,
        chartType: (named ?? "column") as NonNullable<
          ExcelColumnSpecs["chart"]
        >["chartType"],
        ...(pivot.extraValues?.length
          ? { extraValues: pivot.extraValues }
          : {}),
      },
    },
  };
}
