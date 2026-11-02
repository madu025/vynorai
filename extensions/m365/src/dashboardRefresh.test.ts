import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isDashboardChart,
  isDashboardPivot,
  spillAnchor,
  refreshDashboardPivots,
  shouldRefreshAfter,
} from "./dashboardRefresh.js";

test("only dashboard PivotTables are refreshed", () => {
  assert.equal(isDashboardPivot("Orders_Vynor_dashboard"), true);
  assert.equal(isDashboardPivot("PivotTable1"), false);
  // A person's own PivotTable with "dashboard" in its name is left alone.
  assert.equal(isDashboardPivot("Sales dashboard pivot"), false);
});

test("a chart's spilled data starts one column left of its values", () => {
  assert.deepEqual(spillAnchor("'Dash'!$AP$3:$AP$7"), {
    sheet: "'Dash'",
    column: "AO",
    row: 3,
  });
  assert.equal(spillAnchor("$AP$3:$AQ$7"), undefined);
  assert.equal(isDashboardChart("Orders_Vynor_Dashboard_chart_2"), true);
  assert.equal(isDashboardChart("Chart 1"), false);
});

test("a change on the dashboard sheet itself does not trigger another refresh", () => {
  const dashboards = new Set(["sheet-dash"]);
  assert.equal(shouldRefreshAfter("sheet-data", dashboards), true);
  assert.equal(shouldRefreshAfter("sheet-dash", dashboards), false);
});

test("refresh touches dashboard PivotTables and reports their sheets", async () => {
  const refreshed: string[] = [];
  const pivot = (name: string, sheetId: string) => ({
    name,
    worksheet: { id: sheetId, load() {} },
    refresh: () => refreshed.push(name),
  });
  const runtime: any = {
    run: (callback: (context: any) => Promise<unknown>) =>
      callback({
        workbook: {
          pivotTables: {
            items: [
              pivot("Sales_Vynor_Dashboard", "dash"),
              pivot("PivotTable1", "other"),
            ],
            load() {},
          },
        },
        sync: async () => {},
      }),
  };
  const sheets = await refreshDashboardPivots(runtime);
  assert.deepEqual(refreshed, ["Sales_Vynor_Dashboard"]);
  assert.deepEqual([...sheets], ["dash"]);
});
