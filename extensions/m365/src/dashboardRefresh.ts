/**
 * Keeps dashboard PivotTables in step with their data while the task pane is open. Formulas follow
 * an edit at once, but a PivotTable shows the old figures until it is refreshed (live run
 * 2026-11-02: the cards said 21,250 and the PivotTable 17,250). The dashboard also sets
 * refreshOnOpen, so a workbook opened without the pane is current too.
 */
import type { ExcelRuntimeLike } from "./officeExcel.js";

/** Dashboard PivotTables are named after the dashboard action ("Orders_Vynor_Dashboard"). */
export function isDashboardPivot(name: string): boolean {
  return /_Vynor_Dashboard$/i.test(name);
}

/** Dashboard charts are named "<action>_chart_<n>". */
export function isDashboardChart(name: string): boolean {
  return /_Vynor_Dashboard_chart_\d+$/i.test(name);
}

/**
 * The cell a chart's spilled data starts in, from its values address ("'Dash'!$AP$3:$AP$7"): the
 * category cell to the left of the first value. Undefined for an address that is not one column.
 */
export function spillAnchor(
  valuesAddress: string,
): { sheet: string; column: string; row: number } | undefined {
  const match =
    /^(?:(.*)!)?\$?([A-Z]{1,3})\$?(\d+)(?::\$?([A-Z]{1,3})\$?\d+)?$/i.exec(
      String(valuesAddress ?? "").trim(),
    );
  if (!match || (match[4] && match[4].toUpperCase() !== match[2].toUpperCase()))
    return undefined;
  const toNumber = (letters: string) =>
    [...letters.toUpperCase()].reduce(
      (n, ch) => n * 26 + ch.charCodeAt(0) - 64,
      0,
    );
  const toLetters = (n: number) => {
    let out = "";
    for (; n > 0; n = Math.floor((n - 1) / 26))
      out = String.fromCharCode(65 + ((n - 1) % 26)) + out;
    return out;
  };
  const at = toNumber(match[2]);
  if (at < 2) return undefined;
  return {
    sheet: match[1] ?? "",
    column: toLetters(at - 1),
    row: Number(match[3]),
  };
}

/**
 * Charts over spilled data (the dashboard's own, and an agent chart over a GROUPBY summary) keep
 * the row count they were made with; when a category or month is added or removed, each series is
 * pointed at the spill's new size. Returns the sheets of the dashboard's own charts only: a sheet
 * that also holds the person's data must still trigger a refresh when they edit it.
 */
export async function resizeDashboardCharts(
  context: any,
): Promise<Set<string>> {
  const sheets = new Set<string>();
  const list = context.workbook.worksheets;
  list.load("items/id,items/name");
  await context.sync();
  const found: Array<{ sheet: any; charts: any }> = [];
  for (const sheet of list.items) {
    const charts = sheet.charts;
    charts.load("items/name");
    found.push({ sheet, charts });
  }
  await context.sync();
  const targets = found.flatMap(({ sheet, charts }) =>
    (charts.items ?? []).map((chart: any) => {
      if (isDashboardChart(String(chart.name))) sheets.add(String(sheet.id));
      const series = chart.series;
      series.load("count");
      return { sheet, chart, series };
    }),
  );
  if (!targets.length) return sheets;
  await context.sync();
  const sources = targets.flatMap(({ sheet, series }) =>
    Array.from({ length: Math.min(Number(series.count) || 0, 6) }, (_, at) => {
      const item = series.getItemAt(at);
      return {
        sheet,
        series: item,
        address: item.getDimensionDataSourceString("Values"),
      };
    }),
  );
  await context.sync();
  const byName = new Map<string, any>(
    list.items.map((sheet: any) => [String(sheet.name).toLowerCase(), sheet]),
  );
  const spills = sources.flatMap((source) => {
    const anchor = spillAnchor(String(source.address?.value ?? ""));
    if (!anchor) return [];
    const named = anchor.sheet.replace(/^'|'$/g, "").replace(/''/g, "'");
    const sheet = named ? byName.get(named.toLowerCase()) : source.sheet;
    if (!sheet) return [];
    // The category cell may start the spill (=GROUPBY(...) in A2) or sit inside it, under a
    // header the same formula wrote (=GROUPBY(...) in A1).
    const parent = sheet
      .getRange(anchor.column + anchor.row)
      .getSpillParentOrNullObject();
    parent.load("isNullObject");
    return [{ ...source, sheet, anchor, parent }];
  });
  await context.sync();
  const live = spills.flatMap((item) => {
    if (item.parent.isNullObject) return [];
    const spill = item.parent.getSpillingToRange();
    spill.load("rowIndex,rowCount");
    return [{ ...item, spill }];
  });
  await context.sync();
  for (const { sheet, series, anchor, spill, address } of live) {
    const last = Number(spill.rowIndex) + Number(spill.rowCount);
    const shown = /:\$?[A-Z]+\$?(\d+)$/i.exec(String(address.value));
    const lastShown = shown ? Number(shown[1]) : anchor.row;
    if (last < anchor.row || lastShown === last) continue;
    const valueColumn = String(address.value)
      .replace(/^.*!/, "")
      .match(/\$?([A-Z]{1,3})\$?\d+/i)![1];
    series.setXAxisValues(
      sheet.getRange(anchor.column + anchor.row + ":" + anchor.column + last),
    );
    series.setValues(
      sheet.getRange(valueColumn + anchor.row + ":" + valueColumn + last),
    );
  }
  await context.sync();
  return sheets;
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
    try {
      (await resizeDashboardCharts(context)).forEach((id) => sheets.add(id));
    } catch {
      // Older hosts cannot read a series' source; the charts keep their size.
    }
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
