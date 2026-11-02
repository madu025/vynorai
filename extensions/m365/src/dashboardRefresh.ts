/**
 * Keeps dashboard PivotTables in step with their data while the task pane is open. Formulas follow
 * an edit at once, but a PivotTable shows the old figures until it is refreshed (live run
 * 2026-11-02: the cards said 21,250 and the PivotTable 17,250). The dashboard also sets
 * refreshOnOpen, so a workbook opened without the pane is current too.
 */
import type { ExcelRuntimeLike } from "./officeExcel.js";

/** Dashboard PivotTables are named after the dashboard action ("Orders_Vynor_dashboard"). */
export function isDashboardPivot(name: string): boolean {
  return /dashboard/i.test(name);
}

/**
 * Sheets to ignore: a change there comes from the dashboard itself (a refresh rewrites its cells),
 * and reacting to it would refresh again in a loop.
 */
export function shouldRefreshAfter(
  changedSheetId: string | undefined,
  dashboardSheetIds: ReadonlySet<string>,
): boolean {
  return !changedSheetId || !dashboardSheetIds.has(changedSheetId);
}

/** Refreshes every dashboard PivotTable; returns the ids of the sheets that hold them. */
export async function refreshDashboardPivots(
  runtime: ExcelRuntimeLike,
): Promise<Set<string>> {
  const sheets = new Set<string>();
  await runtime.run(async (context: any) => {
    const pivots = context.workbook.pivotTables;
    pivots.load("items/name");
    await context.sync();
    const dashboards = pivots.items.filter((pivot: any) =>
      isDashboardPivot(String(pivot.name)),
    );
    const owners = dashboards.map((pivot: any) => {
      const sheet = pivot.worksheet;
      sheet.load("id");
      return sheet;
    });
    await context.sync();
    owners.forEach((sheet: any) => sheets.add(String(sheet.id)));
    // A refresh fits the PivotTable's columns to its own text and squeezed the grid to "###" (live
    // run 2026-11-02): keep each column's width and put it back afterwards.
    const kept: Array<{ format: any; width: number }> = [];
    try {
      const columns = dashboards.flatMap((pivot: any) => {
        const range = pivot.layout.getRange();
        range.load("columnCount");
        return [{ range }];
      });
      await context.sync();
      const formats = columns.flatMap(({ range }: { range: any }) =>
        Array.from({ length: Number(range.columnCount) || 0 }, (_, at) => {
          const format = range.getColumn(at).format;
          format.load("columnWidth");
          return format;
        }),
      );
      await context.sync();
      formats.forEach((format: any) =>
        kept.push({ format, width: Number(format.columnWidth) }),
      );
    } catch {
      // Widths are a nicety; the refresh still runs.
    }
    dashboards.forEach((pivot: any) => pivot.refresh());
    await context.sync();
    if (kept.length)
      try {
        kept.forEach(({ format, width }) => {
          format.columnWidth = width;
        });
        await context.sync();
      } catch {
        // The PivotTable keeps Excel's widths.
      }
  });
  return sheets;
}

/** Refreshes dashboard PivotTables a moment after the person edits data on another sheet. */
export function watchDashboardPivots(
  runtime: ExcelRuntimeLike,
  onError: (error: unknown) => void = () => undefined,
  delayMs = 1500,
): void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let dashboardSheets = new Set<string>();
  void refreshDashboardPivots(runtime)
    .then((ids) => {
      dashboardSheets = ids;
    })
    .catch(onError);
  void Promise.resolve(
    runtime.run(async (context: any) => {
      context.workbook.worksheets.onChanged.add(async (event: any) => {
        if (!shouldRefreshAfter(event?.worksheetId, dashboardSheets)) return;
        clearTimeout(timer);
        timer = setTimeout(() => {
          refreshDashboardPivots(runtime)
            .then((ids) => {
              dashboardSheets = ids;
            })
            .catch(onError);
        }, delayMs);
      });
      await context.sync();
    }),
  ).catch(onError);
}
