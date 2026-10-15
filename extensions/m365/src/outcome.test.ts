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

test("an unpivot outcome previews long-format rows from the selected data", () => {
  const [item] = buildOutcomes(
    [
      {
        kind: "unpivot",
        targetSheet: "Sheet1_Vynor_Unpivot",
        spec: {
          unpivotValueIndexes: [2, 3],
          unpivotNameColumn: "Measure",
          unpivotValueColumn: "Amount",
        },
      },
    ],
    headers,
    rows,
  );
  assert.deepEqual(item.table?.headers, [
    "Month",
    "Region",
    "Measure",
    "Amount",
  ]);
  assert.deepEqual(item.table?.rows, [
    ["Jan", "North", "Sales", "1200"],
    ["Jan", "North", "Cost", "800"],
    ["Feb", "South", "Sales", "1500"],
    ["Feb", "South", "Cost", "950"],
  ]);
  assert.match(item.details.join("\n"), /long-format rows/);
});

test("a rank outcome previews real descending ranks", () => {
  const [item] = buildOutcomes(
    [
      {
        kind: "add-column",
        targetSheet: "Sheet1_Vynor_Calc",
        spec: {
          columnName: "Rank of Sales",
          derived: "rank",
          sourceColumn: "Sales",
          sourceIndex: 2,
        },
      },
    ],
    headers,
    [
      ["Jan", "North", 1200, 800],
      ["Feb", "South", 1500, 950],
      ["Mar", "North", 900, 600],
    ],
  );
  assert.deepEqual(item.table?.headers, [
    "Month",
    "Region",
    "Sales",
    "Cost",
    "Rank of Sales",
  ]);
  assert.deepEqual(item.table?.rows, [
    ["Jan", "North", "1200", "800", "2"],
    ["Feb", "South", "1500", "950", "1"],
    ["Mar", "North", "900", "600", "3"],
  ]);
  assert.match(item.details.join("\n"), /Rank of Sales/);
});

test("a percent-change outcome previews row-over-row percentages", () => {
  const [item] = buildOutcomes(
    [
      {
        kind: "add-column",
        targetSheet: "Sheet1_Vynor_Calc",
        spec: {
          columnName: "% Change of Sales",
          derived: "percent-change",
          sourceColumn: "Sales",
          sourceIndex: 2,
        },
      },
    ],
    headers,
    [
      ["Jan", "North", 100, 80],
      ["Feb", "South", 125, 90],
      ["Mar", "North", 100, 70],
    ],
  );
  assert.deepEqual(item.table?.rows, [
    ["Jan", "North", "100", "80", "—"],
    ["Feb", "South", "125", "90", "25%"],
    ["Mar", "North", "100", "70", "-20%"],
  ]);
  assert.match(item.details.join("\n"), /Percent change of Sales/);
});

test("a moving-average outcome previews only complete windows", () => {
  const [item] = buildOutcomes(
    [
      {
        kind: "add-column",
        targetSheet: "Sheet1_Vynor_Calc",
        spec: {
          columnName: "3-Period Moving Average of Sales",
          derived: "moving-average",
          sourceColumn: "Sales",
          sourceIndex: 2,
          window: 3,
        },
      },
    ],
    headers,
    [
      ["Jan", "North", 100, 80],
      ["Feb", "South", 125, 90],
      ["Mar", "North", 100, 70],
      ["Apr", "East", 175, 100],
    ],
  );
  assert.deepEqual(item.table?.rows, [
    ["Jan", "North", "100", "80", "—"],
    ["Feb", "South", "125", "90", "—"],
    ["Mar", "North", "100", "70", "108.33"],
    ["Apr", "East", "175", "100", "133.33"],
  ]);
  assert.match(item.details.join("\n"), /moving average of Sales/);
});

test("a YoY outcome keeps incomplete 12-period history blank", () => {
  const [item] = buildOutcomes(
    [
      {
        kind: "add-column",
        targetSheet: "Sheet1_Vynor_Calc",
        spec: {
          columnName: "YoY Change of Sales",
          derived: "yoy",
          sourceColumn: "Sales",
          sourceIndex: 2,
          lag: 12,
        },
      },
    ],
    headers,
    [
      ["Jan", "North", 100, 80],
      ["Feb", "South", 125, 90],
      ["Mar", "North", 100, 70],
    ],
  );
  assert.deepEqual(
    item.table?.rows.map((row) => row.at(-1)),
    ["—", "—", "—"],
  );
  assert.match(item.details.join("\n"), /YoY change of Sales/);
});

test("a date-group outcome previews month labels from Excel dates", () => {
  const [item] = buildOutcomes(
    [
      {
        kind: "add-column",
        targetSheet: "Sheet1_Vynor_Calc",
        spec: {
          columnName: "Month of Date",
          derived: "date-group",
          sourceColumn: "Date",
          sourceIndex: 0,
          group: "month",
        },
      },
    ],
    ["Date", "Sales"],
    [
      [44927, 100],
      [44958, 110],
      [45017, 120],
    ],
  );
  assert.deepEqual(
    item.table?.rows.map((row) => row.at(-1)),
    ["2023-01", "2023-02", "2023-04"],
  );
  assert.match(item.details.join("\n"), /month grouping of Date/);
});

test("a combine outcome previews both source values", () => {
  const [item] = buildOutcomes(
    [
      {
        kind: "add-column",
        targetSheet: "Sheet1_Vynor_Calc",
        spec: {
          columnName: "Region - Status",
          derived: "combine",
          sourceColumn: "Region",
          sourceIndex: 1,
          sourceColumn2: "Status",
          sourceIndex2: 2,
          separator: " - ",
        },
      },
    ],
    ["Month", "Region", "Status", "Sales"],
    [
      ["Jan", "North", "Active", 100],
      ["Feb", "South", "Paused", 200],
    ],
  );
  assert.deepEqual(
    item.table?.rows.map((row) => row.at(-1)),
    ["North - Active", "South - Paused"],
  );
  assert.match(item.details.join("\n"), /Region combined with Status/);
});

test("a split outcome previews first and last name columns", () => {
  const [item] = buildOutcomes(
    [
      {
        kind: "split-column",
        targetSheet: "Sheet1_Vynor_Split",
        spec: {
          splitSourceColumn: "Customer",
          splitSourceIndex: 0,
          splitFirstColumn: "Customer First",
          splitLastColumn: "Customer Last",
        },
      },
    ],
    ["Customer", "Sales"],
    [
      ["Prasad Dissanayake", 100],
      ["Nimal", 200],
    ],
  );
  assert.deepEqual(item.table?.headers.slice(-2), [
    "Customer First",
    "Customer Last",
  ]);
  assert.deepEqual(
    item.table?.rows.map((row) => row.slice(-2)),
    [
      ["Prasad", "Dissanayake"],
      ["Nimal", ""],
    ],
  );
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

test("a format outcome explains dependent dropdown groups", () => {
  const [item] = buildOutcomes(
    [
      {
        kind: "format",
        targetSheet: "Sheet1_Vynor_Format",
        spec: {
          dependentDropdown: {
            childColumn: "Status",
            childIndex: 1,
            parentColumn: "Region",
            parentIndex: 0,
            groups: [
              { key: "North", name: "VynorAI_DD_North", values: ["Open"] },
            ],
          },
        },
      },
    ],
    ["Region", "Status"],
    [["North", "Open"]],
  );
  assert.match(item.details.join("\n"), /Status depends on Region/);
  assert.deepEqual(item.table?.dropdownColumns, [1]);
});

test("a format outcome explains a custom conditional formula", () => {
  const [item] = buildOutcomes(
    [
      {
        kind: "format",
        targetSheet: "Sheet1_Vynor_Format",
        spec: {
          conditional: [
            {
              column: "Sales",
              index: 1,
              rule: "custom-formula",
              operator: ">",
              value: 1000,
            },
          ],
        },
      },
    ],
    ["Region", "Sales"],
    [["North", 1200]],
  );
  assert.match(
    item.details.join("\n"),
    /Sales: custom numeric formula \(>1000\)/,
  );
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
