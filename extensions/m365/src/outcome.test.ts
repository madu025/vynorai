import assert from "node:assert/strict";
import { test } from "node:test";
import { buildOutcomes } from "./outcome.js";

const headers = ["Month", "Region", "Sales", "Cost"];
const rows = [
  ["Jan", "North", 1200, 800],
  ["Feb", "South", 1500, 950],
];

test("a chart outcome is drawn from the person's own columns", () => {
  const [item] = buildOutcomes(
    [
      {
        kind: "chart",
        targetSheet: "Sheet1_Vynor_Result",
        spec: {
          categoryIndex: 0,
          valueIndex: 2,
          extraValueIndexes: [3],
          chartType: "line",
        },
      },
    ],
    headers,
    rows,
  );
  assert.equal(item.chart?.series.length, 2);
  assert.deepEqual(item.chart?.categories, ["Jan", "Feb"]);
  assert.deepEqual(item.chart?.series[1].values, [800, 950]);
  assert.match(item.title, /Line chart: Sales, Cost by Month/);
});

test("other outcomes show a small table of the data they use", () => {
  const [item] = buildOutcomes(
    [{ kind: "pivot-table", targetSheet: "Sheet1_Vynor_Pivot", spec: {} }],
    headers,
    rows,
  );
  assert.equal(item.title, "PivotTable");
  assert.deepEqual(item.table?.headers, headers);
  assert.equal(item.table?.rows.length, 2);
});
