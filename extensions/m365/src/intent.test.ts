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

test("everyday wording: above N, only dates, name a column, date part, copy to a new sheet, repair", () => {
  const headers = [
    "Service ID",
    "PAT Complete Date",
    "Status",
    "Requested Quantity",
  ];
  const rows = [["a", "04-Mar-25", "S", 1]];
  const run = (text: string): any => interpretInstruction(text, headers, rows);

  const above = run("highlight Requested Quantity above 10");
  assert.deepEqual(above.actions, ["format"]);
  assert.equal(above.problems.length, 0);

  const dates = run("allow only dates in PAT Complete Date");
  assert.deepEqual(dates.specs.format.validation, [
    { column: 1, rule: "date" },
  ]);

  const named = run("name the Requested Quantity column Requested");
  assert.deepEqual(named.actions, ["named-range"]);
  assert.deepEqual(named.specs.namedRange, { source: 3, name: "Requested" });

  const year = run("add a column Year from PAT Complete Date");
  assert.deepEqual(year.actions, ["add-column"]);

  const copy = run("copy this data to a new sheet");
  assert.deepEqual(copy.actions, ["view"]);
  assert.equal(copy.specs.view.limit, 50000);

  assert.deepEqual(run("repair the data problems").actions, ["quality"]);
});

test("an if-then-otherwise column is one step, not two", () => {
  const headers = ["Service ID", "Issued Quantity"];
  const rows = [["a", 2]];
  const result: any = interpretInstruction(
    'add a column Flag that is if Issued Quantity is more than 1 then "many" otherwise "one"',
    headers,
    rows,
  );
  assert.equal(result.problems.length, 0);
  assert.deepEqual(result.actions, ["add-column"]);
  const both: any = interpretInstruction(
    'add a column Flag that is if Issued Quantity > 1 then "many" otherwise "one" then format the data nicely',
    headers,
    rows,
  );
  assert.equal(both.problems.length, 0);
  assert.ok(
    both.actions.includes("add-column") && both.actions.includes("format"),
  );
});

test("a pivot can list a second field under each row: by Circuit ID and Item Code as rows", () => {
  const headers = ["Service ID", "Item Code", "Issued Quantity", "Circuit ID"];
  const rows = [["a", "OSP1", 2, "0112559962"]];
  const nested: any = interpretInstruction(
    "pivot table of total Issued Quantity by Circuit ID and Item Code as rows",
    headers,
    rows,
  );
  assert.deepEqual(nested.actions, ["pivot-table"]);
  assert.equal(nested.specs.pivot.rows, 3);
  assert.equal(nested.specs.pivot.subRows, 1);
  assert.equal(nested.specs.pivot.columns, undefined);
  const wide: any = interpretInstruction(
    "pivot table of total Issued Quantity by Circuit ID and Item Code",
    headers,
    rows,
  );
  assert.equal(wide.specs.pivot.columns, 1);
  assert.equal(wide.specs.pivot.subRows, undefined);
});
