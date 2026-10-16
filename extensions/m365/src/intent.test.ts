import assert from "node:assert/strict";
import { test } from "node:test";
import { interpretInstruction } from "./intent.js";

test("a Sinhala pivot request names its rows and values", () => {
  const headers = ["Service ID", "RTOM", "Status", "Requested Quantity"];
  const rows = [["a", "R-HK", "S", 1]];
  const result: any = interpretInstruction(
    "RTOM අනුව Requested Quantity එකතුව pivot table එකක් හදන්න",
    headers,
    rows,
  );
  assert.deepEqual(result.actions, ["pivot-table"]);
  assert.equal(result.specs.pivot.rows, 1);
  assert.equal(result.specs.pivot.values, 3);
});

const BATCH_HEADERS = [
  "Service ID",
  "RTOM",
  "LEA",
  "PAT Complete Date",
  "Status",
  "Requested Quantity",
];
const BATCH_ROWS: any[][] = [
  ["a", "R-HK", "HK", 45720, "S", 1],
  ["b", "R-GP", "NT", 45721, "E", 2],
];

test("a pivot or chart can group by a date column", () => {
  const pivot: any = interpretInstruction(
    "pivot of total Requested Quantity by PAT Complete Date",
    BATCH_HEADERS,
    BATCH_ROWS,
  );
  assert.deepEqual(pivot.actions, ["pivot-table"]);
  assert.equal(pivot.specs.pivot.rows, 3);
  const chart: any = interpretInstruction(
    "line chart of Requested Quantity by PAT Complete Date",
    BATCH_HEADERS,
    BATCH_ROWS,
  );
  assert.deepEqual(chart.actions, ["chart"]);
  assert.equal(chart.specs.chart.chartType, "line");
});

test("a pivot can count a text column", () => {
  const result: any = interpretInstruction(
    "pivot table counting Service ID by Status",
    BATCH_HEADERS,
    BATCH_ROWS,
  );
  assert.deepEqual(result.actions, ["pivot-table"]);
  assert.equal(result.specs.pivot.rows, 4);
  assert.equal(result.specs.pivot.values, 0);
  assert.equal(result.specs.pivot.aggregation, "count");
});

test('"show rows where Status is S" filters the view', () => {
  const result: any = interpretInstruction(
    "show rows where Status is S",
    BATCH_HEADERS,
    BATCH_ROWS,
  );
  assert.deepEqual(result.actions, ["view"]);
  assert.equal(result.specs.view.filter.value, "S");
  assert.equal(result.specs.view.filter.operator, "=");
});

test("everyday wording becomes a computed column", () => {
  const headers = [
    "Service ID",
    "RTOM",
    "PAT Complete Date",
    "Requested Quantity",
    "Issued Quantity",
  ];
  const rows: any[][] = [["a", "R-HK", 45720, 3, 2]];
  const cases: Array<[string, string]> = [
    [
      "add a column Short that is yes if Issued Quantity < Requested Quantity otherwise no",
      'IF([Issued Quantity] < [Requested Quantity],"yes","no")',
    ],
    ["add a column Region that is the first 3 letters of RTOM", "LEFT(RTOM,3)"],
    [
      "add a column Year that is year of PAT Complete Date",
      "YEAR([PAT Complete Date])",
    ],
  ];
  for (const [text, expected] of cases) {
    const result: any = interpretInstruction(text, headers, rows);
    assert.deepEqual(result.actions, ["add-column"], text);
    assert.equal(result.specs.addColumn.expression, expected, text);
  }
});

test("an insight report groups by the column that was asked for", () => {
  const headers = ["RTOM", "Status", "Requested Quantity"];
  const rows: any[][] = [["R-HK", "S", 1]];
  const result: any = interpretInstruction(
    "insights about Requested Quantity by RTOM",
    headers,
    rows,
  );
  assert.equal(result.specs.statistics.category, 0);
});
