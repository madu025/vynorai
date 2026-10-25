import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CHART_LIMITS,
  CHART_MAX_COLS,
  CHART_MAX_ROWS,
  MAX_ROWS_BELOW,
} from "./chartPlacement.js";
import {
  autoChartTitle,
  axisNumberFormat,
  pickChartColumns,
  planAddress,
  resolveChartSource,
} from "./chartSource.js";

/** A fake worksheet holding `grid` from A1; reads are counted so a test can prove they stay small. */
function fakeSheet(
  grid: unknown[][],
  columns = grid[0]?.length ?? 0,
  rows = grid.length,
) {
  const state = { cellsRead: 0 };
  const geometry = (row: number, column: number, r: number, c: number) => ({
    rowIndex: row,
    columnIndex: column,
    rowCount: r,
    columnCount: c,
    load() {},
    get values() {
      state.cellsRead += r * c;
      return Array.from({ length: r }, (_, i) =>
        Array.from({ length: c }, (_, j) => grid[row + i]?.[column + j] ?? ""),
      );
    },
  });
  const sheet = {
    getUsedRange: () => geometry(0, 0, rows, columns),
    getRange(address: string) {
      const m = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(address)!;
      const col = (s: string) =>
        [...s].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
      return geometry(
        Number(m[2]) - 1,
        col(m[1]),
        Number(m[4]) - Number(m[2]) + 1,
        col(m[3]) - col(m[1]) + 1,
      );
    },
    getRangeByIndexes: geometry,
  };
  return { sheet, state, sync: async () => {} };
}

const sales = [
  ["Order No", "Region", "Qty", "Net Amount", "Share"],
  ...Array.from({ length: 30 }, (_, i) => [
    1000 + i,
    ["N", "S", "E"][i % 3],
    5 + (i % 7),
    15000 + i * 37,
    0.2 + (i % 5) / 100,
  ]),
];

test("limits are one config object with named constants", () => {
  assert.equal(MAX_ROWS_BELOW, CHART_LIMITS.maxRowsBelow);
  assert.equal(CHART_MAX_ROWS, CHART_LIMITS.maxRows);
  assert.equal(CHART_MAX_COLS, CHART_LIMITS.maxCols);
});

test("picks numeric columns and the first text column, skipping id and blank columns", () => {
  const picked = pickChartColumns([
    ...sales.slice(0, 20).map((r) => [...r, ""]),
  ]);
  assert.equal(picked?.label, 1);
  assert.deepEqual(picked?.values, [2, 3, 4]);
  assert.equal(pickChartColumns([["a"], ["x"], ["y"]]), undefined);
});

test("a counting column is a row number, not an amount", () => {
  const picked = pickChartColumns([
    ["Name", "Row", "Amount"],
    ["a", 1, 50],
    ["b", 2, 70],
    ["c", 3, 20],
  ]);
  assert.deepEqual(picked?.values, [2]);
});

test("no address charts the numeric columns of the used range, not the whole sheet", async () => {
  const { sheet, sync } = fakeSheet(sales);
  const plan = await resolveChartSource(sheet, sync);
  // Region (labels) + Qty, Net Amount, Share are neighbours; Order No is left out.
  assert.equal(planAddress(plan), "B1:E31");
  assert.equal(plan.title, "Qty, Net Amount and 1 more by Region");
});

test("an explicit narrower address is charted as asked", async () => {
  const { sheet, sync } = fakeSheet(sales);
  const plan = await resolveChartSource(sheet, sync, "B1:D31");
  assert.equal(planAddress(plan), "B1:D31");
  assert.equal(plan.title, "Qty and Net Amount by Region");
});

test("a 20,000-row sheet is refused in plain words after reading only a sample", async () => {
  const rows = [
    sales[0],
    ...Array.from({ length: 19_999 }, (_, i) => [i, "N", 1, 2, 0.5]),
  ];
  const { sheet, state, sync } = fakeSheet(rows);
  await assert.rejects(
    resolveChartSource(sheet, sync),
    /20000 rows is too many for a chart/,
  );
  assert.equal(state.cellsRead, 0);
});

test("a 50-column sheet is refused with the column limit", async () => {
  const wide = [
    Array.from({ length: 50 }, (_, i) => `C${i}`),
    ...Array.from({ length: 10 }, (_, r) =>
      Array.from({ length: 50 }, (_, c) => r * c + 0.5),
    ),
  ];
  const { sheet, state, sync } = fakeSheet(wide);
  await assert.rejects(
    resolveChartSource(sheet, sync),
    /49 columns|50 columns is too many for a chart \(at most 30\)/,
  );
  assert.ok(state.cellsRead <= 11 * 50);
  await assert.rejects(
    resolveChartSource(sheet, sync, "A1:AX11"),
    /columns is too many/,
  );
});

test("columns that cannot join one rectangle are left out with a note", async () => {
  const grid = [
    ["Region", "Qty", "Note", "Net", "Gross"],
    ...Array.from({ length: 6 }, (_, i) => [
      "N",
      5.5 + i,
      "",
      10 + i * 3,
      20 + i * 4,
    ]),
  ];
  const { sheet, sync } = fakeSheet(grid);
  const plan = await resolveChartSource(sheet, sync);
  assert.equal(planAddress(plan), "D1:E7");
  assert.match(plan.note ?? "", /1 number column/);
});

test("titles", () => {
  assert.equal(
    autoChartTitle(["Net Amount"], "Region"),
    "Net Amount by Region",
  );
  assert.equal(autoChartTitle(["Qty"]), "Qty");
  assert.equal(autoChartTitle([]), "");
});

test("axis number format follows the sampled numbers", () => {
  assert.equal(axisNumberFormat([157400, 20]), "#,##0");
  assert.equal(axisNumberFormat([0.2, 0.25]), "0%");
  assert.equal(axisNumberFormat([0.2, 0.2345]), "0.0%");
  assert.equal(axisNumberFormat([3, 5, 9]), undefined);
  assert.equal(axisNumberFormat([]), undefined);
});

test("headers such as 'Number of Orders' and 'No. of Units' are measures; 'Order No' is an identifier", () => {
  const picked = pickChartColumns([
    ["Region", "Order No", "Number of Orders", "No. of Units", "Net Amount"],
    ["North", 101, 12, 40, 5000.5],
    ["South", 205, 7, 22, 3100.25],
    ["East", 377, 15, 51, 6400.75],
  ]);
  assert.equal(picked?.label, 0);
  assert.deepEqual(picked?.values, [2, 3, 4]);
});
