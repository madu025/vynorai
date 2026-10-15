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

test("a dashboard preview shows real grouped chart values and KPI tiles", () => {
  const [item] = buildOutcomes(
    [
      {
        kind: "dashboard",
        targetSheet: "Sheet1_Vynor_Dashboard",
        spec: {
          dashboard: {
            category: { column: "Region", index: 1 },
            values: [
              { column: "Sales", index: 2 },
              { column: "Cost", index: 3 },
            ],
            aggregation: "sum",
          },
        },
      },
    ],
    headers,
    rows,
  );
  assert.match(item.title, /Dashboard: Sales, Cost by Region/);
  assert.deepEqual(item.chart?.categories, ["North", "South"]);
  assert.deepEqual(item.chart?.series[0].values, [1200, 1500]);
  assert.deepEqual(item.table?.rows[0], ["Data rows", "2"]);
});

import { resolveSheetName } from "./outcome.js";

test("a format outcome lists the exact rules, including drop-downs and data bars", () => {
  const [item] = buildOutcomes(
    [
      {
        kind: "format",
        targetSheet: "Sheet1_Vynor_Format",
        spec: {
          freezeHeader: true,
          totalRow: true,
          columnFormats: [{ index: 2, column: "Sales", format: "#,##0" }],
          conditional: [{ column: "Sales", index: 2, rule: "data-bars" }],
          validation: [
            {
              column: "Region",
              index: 1,
              rule: "list",
              values: ["North", "South"],
            },
          ],
        },
      },
    ],
    headers,
    rows,
  );
  const text = item.details.join("\n");
  assert.match(text, /header row stays visible/);
  assert.match(text, /Sales: data bars/);
  assert.match(text, /Region: drop-down list \(North, South\)/);
  assert.match(text, /total row/);
  assert.deepEqual(item.table?.dropdownColumns, [1]);
  assert.equal(item.table?.barColumns[0].index, 2);
});

test("a repeat run gets a numbered sheet name that still fits Excel's limit", () => {
  const taken = new Set(["Sheet1_Vynor_Result", "Sheet1_Vynor_Result (2)"]);
  assert.equal(
    resolveSheetName("Sheet1_Vynor_Result", "chart", "Sheet1", taken),
    "Sheet1_Vynor_Result (3)",
  );
  const long = "ABCDEFGHIJKLMNOPQR_Vynor_Result";
  const name = resolveSheetName(long, "chart", "Sheet1", new Set([long]));
  assert.ok(name.length <= 31);
  assert.match(name, /_Vynor_Result \(2\)$/);
  assert.equal(
    resolveSheetName("Sheet1", "table", "Sheet1", new Set(["Sheet1"])),
    "Sheet1",
  );
});

test("a PivotTable outcome shows the grouped totals it will contain", () => {
  const [item] = buildOutcomes(
    [
      {
        kind: "pivot-table",
        targetSheet: "Sheet1_Vynor_Result",
        spec: {
          rowsColumn: "Region",
          rowsIndex: 1,
          valuesColumn: "Sales",
          valuesIndex: 2,
          aggregation: "sum",
        },
      },
    ],
    headers,
    [
      ["Jan", "North", 1200, 800],
      ["Feb", "South", 1500, 950],
      ["Mar", "North", 1800, 1100],
    ],
  );
  assert.deepEqual(item.table?.headers, ["Region", "Total — Sales"]);
  assert.deepEqual(item.table?.rows, [
    ["North", "3000"],
    ["South", "1500"],
    ["Grand total", "4500"],
  ]);
});
