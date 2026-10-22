import assert from "node:assert/strict";
import { test } from "node:test";
import { buildOutcomes, KIND_TITLES, kindTitle } from "./outcome.js";

// Preview cards in Sinhala and Tamil keep the person's column names.

const headers = ["Month", "Region", "Sales", "Cost"];
const rows = [
  ["Jan", "North", 1200, 800],
  ["Feb", "South", 1500, 950],
];

const TAMIL = /[஀-௿]/;
const SINHALA = /[඀-෿]/;

test("a Tamil chart outcome is written in Tamil and keeps the column names", () => {
  const [item] = buildOutcomes(
    [
      {
        kind: "chart",
        targetSheet: "Sheet1_Vynor_Result",
        spec: {
          categoryIndex: 0,
          valueIndex: 2,
          extraValueIndexes: [3],
          chartType: "combo",
          showDataLabels: true,
        },
      },
    ],
    headers,
    rows,
    "ta",
  );
  assert.match(item.title, TAMIL);
  assert.match(item.title, /Sales, Cost/);
  assert.match(item.title, /Month/);
  assert.ok(item.details.length >= 3);
  for (const detail of item.details) assert.match(detail, TAMIL);
  assert.match(item.details[0], /Sales, Cost/);
  assert.match(item.details[0], /Month/);
});

test("a Tamil PivotTable outcome uses Tamil totals and keeps the column names", () => {
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
          columnsColumn: "Month",
        },
      },
    ],
    headers,
    rows,
    "ta",
  );
  assert.equal(item.title, "PivotTable");
  assert.match(item.table!.headers[1], TAMIL);
  assert.match(item.table!.headers[1], /Sales/);
  const grand = item.table!.rows.at(-1)!;
  assert.match(grand[0], TAMIL);
  assert.equal(grand[1], "2700");
  const text = item.details.join("\n");
  assert.match(text, TAMIL);
  for (const column of ["Region", "Sales", "Month"])
    assert.match(text, new RegExp(column));
});

test("a Tamil summary outcome is written in Tamil and keeps the group values", () => {
  const [item] = buildOutcomes(
    [
      {
        kind: "summary",
        targetSheet: "Sheet1_Vynor_Summary",
        spec: {
          groupColumn: "Region",
          groups: ["North", "South"],
          summaryValues: [
            { column: "Sales", aggregation: "sum" },
            { column: "Cost", aggregation: "average" },
          ],
        },
      },
    ],
    headers,
    rows,
    "ta",
  );
  assert.match(item.title, TAMIL);
  for (const detail of item.details) assert.match(detail, TAMIL);
  assert.match(item.details[0], /Region/);
  assert.match(item.details[0], /North, South/);
  assert.match(item.details[0], /Sales/);
  assert.match(item.details[0], /Cost/);
});

test("a Tamil format outcome explains each conditional rule in Tamil", () => {
  const [item] = buildOutcomes(
    [
      {
        kind: "format",
        targetSheet: "Sheet1_Vynor_Format",
        spec: {
          freezeHeader: true,
          conditional: [
            { column: "Sales", index: 2, rule: "data-bars" },
            { column: "Cost", index: 3, rule: "top-n", n: 3 },
            {
              column: "Region",
              index: 1,
              rule: "text-contains",
              text: "North",
            },
            {
              column: "Sales",
              index: 2,
              rule: "custom-formula",
              operator: ">",
              value: 1000,
            },
          ],
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
    "ta",
  );
  assert.match(item.title, TAMIL);
  for (const detail of item.details) assert.match(detail, TAMIL);
  const text = item.details.join("\n");
  assert.match(text, /Sales: [^\n]*data bars/);
  assert.match(text, /Cost: [^\n]*\(3\)/);
  assert.match(text, /Region: [^\n]*\(North\)/);
  assert.match(text, /Sales: [^\n]*\(>1000\)/);
  assert.match(text, /Region: [^\n]*\(North, South\)/);
  assert.equal(item.table?.barColumns[0].index, 2);
  assert.deepEqual(item.table?.dropdownColumns, [1]);
});

test("kindTitle gives Tamil for every kind whose Sinhala title is translated", () => {
  for (const [kind, [english, sinhala]] of Object.entries(KIND_TITLES)) {
    assert.equal(kindTitle(kind, "en"), english);
    assert.equal(kindTitle(kind, "si"), sinhala);
    if (sinhala === english) assert.equal(kindTitle(kind, "ta"), english);
    else assert.match(kindTitle(kind, "ta"), TAMIL, kind);
  }
  assert.equal(kindTitle("pivot-table", "ta"), "PivotTable");
  assert.equal(kindTitle("lookup-columns", "ta"), "Lookup columns");
  assert.equal(kindTitle("unknown-kind", "ta"), "unknown-kind");
});

test("a Sinhala clean outcome shows real Sinhala labels, not garbled bytes", () => {
  const [item] = buildOutcomes(
    [
      {
        kind: "clean",
        targetSheet: "Sheet1_Vynor_Clean",
        spec: {
          operations: ["text-to-number", "text-to-date", "dedupe"],
        },
      },
    ],
    headers,
    rows,
    "si",
  );
  const text = item.details.join("\n");
  assert.match(text, SINHALA);
  assert.doesNotMatch(text, /[À-ÿ]/);
});
