import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isDashboardPivot,
  refreshDashboardPivots,
  shouldRefreshAfter,
} from "./dashboardRefresh.js";

test("only dashboard PivotTables are refreshed", () => {
  assert.equal(isDashboardPivot("Orders_Vynor_dashboard"), true);
  assert.equal(isDashboardPivot("PivotTable1"), false);
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
              pivot("Sales_dashboard", "dash"),
              pivot("PivotTable1", "other"),
            ],
            load() {},
          },
        },
        sync: async () => {},
      }),
  };
  const sheets = await refreshDashboardPivots(runtime);
  assert.deepEqual(refreshed, ["Sales_dashboard"]);
  assert.deepEqual([...sheets], ["dash"]);
});
