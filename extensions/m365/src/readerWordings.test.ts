import assert from "node:assert/strict";
import { test } from "node:test";
import { selectExcelActions } from "./excel.js";
import { interpretInstruction } from "./intent.js";

const HEADERS = [
  "Order No",
  "Customer",
  "Region",
  "Qty",
  "Net Amount",
  "Order Date",
];
const ROWS = Array.from({ length: 20 }, (_, index) => [
  `00${index}`,
  "Asha Perera",
  "North",
  index || null,
  index * 3,
  45700 + index,
]);

const read = (text: string) => {
  const result: any = interpretInstruction(text, HEADERS, ROWS as any);
  return {
    actions: [
      ...new Set([
        ...selectExcelActions(text),
        ...(result.actions as string[]),
      ]),
    ],
    specs: result.specs,
    problems: result.problems as string[],
  };
};

test("blank cells of one column can be filled in several wordings", () => {
  for (const text of [
    "fill blank cells in Qty with 0",
    "fill the empty cells of the Qty column with 0",
    "fill blank Qty values with 0",
    "fill empty cells with 0",
  ]) {
    const result = read(text);
    assert.deepEqual(result.actions, ["clean"], text);
    assert.equal(result.specs.clean.fillBlanks, 0, text);
  }
  assert.equal(
    read("fill blank cells in Qty with 0").specs.clean.fillBlanksColumn,
    3,
  );
});

test("a per-row share of the total becomes a computed column", () => {
  const result = read("show each row Qty as a percentage of the total Qty");
  assert.deepEqual(result.actions, ["add-column"]);
  assert.match(JSON.stringify(result.specs), /COLSUM/);
});

test("a pivot that shows a share stays a pivot", () => {
  assert.ok(
    read(
      "pivot table of total Qty by Region as a percentage of the total",
    ).actions.includes("pivot-table"),
  );
});

test("Above or Below the average becomes a computed column", () => {
  const result = read(
    "add a column that says Above or Below depending on whether Qty is over the average",
  );
  assert.deepEqual(result.actions, ["add-column"]);
  assert.match(JSON.stringify(result.specs), /COLAVG/);
});

test("a date part column is read from the date column", () => {
  const result = read("I need a new column with only the month of Order Date");
  assert.deepEqual(result.actions, ["add-column"]);
});

test("everyday wording for duplicates, problems and name splits", () => {
  assert.deepEqual(read("delete the duplicates please").actions, ["clean"]);
  assert.deepEqual(read("are there any problems with this data?").actions, [
    "quality",
  ]);
  assert.deepEqual(read("data wala awul thiyenawada balanna").actions, [
    "quality",
  ]);
  assert.deepEqual(
    read("split Customer into first name and last name").actions,
    ["split-column"],
  );
});

test("highlighting duplicates is not turned into removing them", () => {
  assert.ok(!read("highlight duplicates in Region").actions.includes("clean"));
});

test("sorting by two columns is one view with two keys, not two steps", () => {
  const result = read("show the rows sorted by Region then Qty");
  assert.deepEqual(result.actions, ["view"]);
  assert.equal(result.specs.view.thenSort.column, 3);
});

test("a share-of-total column is named with % so it shows as a percentage", () => {
  const result = read("show each row Qty as a percentage of the total Qty");
  assert.equal(result.specs.addColumn.name, "Qty Share %");
});

test("how much a value differs from the average becomes a computed column (English and Singlish)", () => {
  for (const text of [
    "add a column showing how much Qty differs from the average",
    "Qty eka average ekata wada kiyak wenas da kiyala column ekak danna",
  ]) {
    const result = read(text);
    assert.deepEqual(result.actions, ["add-column"], text);
    assert.match(JSON.stringify(result.specs), /COLAVG/, text);
  }
});

test("a dashboard of how much of each item each id used becomes a usage dashboard with units", () => {
  const headers = [
    "Service ID",
    "Item Code",
    "Requested Quantity",
    "Issued Quantity",
    "UoM",
    "Circuit ID",
  ];
  const rows = Array.from({ length: 20 }, (_, i) => [
    `S${i}`,
    `IC${i % 4}`,
    i,
    i * 2,
    ["Ea", "km", "m"][i % 3],
    `C${i % 5}`,
  ]);
  for (const text of [
    "usage dashboard of total Issued Quantity by Circuit ID and Item Code with units in UoM",
    "dashboard of how much Item Code each Circuit ID used",
    "Circuit ID walata Item Code kopamana use unada kiyala dashboard ekak hadanna",
  ]) {
    const result: any = interpretInstruction(text, headers, rows as any);
    assert.deepEqual(result.actions, ["dashboard"], text);
    assert.deepEqual(
      result.specs.dashboard,
      {
        category: 5,
        values: [3],
        aggregation: "sum",
        usage: { item: 1, unit: 4 },
      },
      text,
    );
  }
  // One category and a measure stays the ordinary dashboard.
  const plain: any = interpretInstruction(
    "dashboard of Issued Quantity by Circuit ID",
    headers,
    rows as any,
  );
  assert.equal(plain.specs.dashboard.usage, undefined);
});

test("a usage dashboard can name its unit column in the sentence", () => {
  const headers = ["Customer", "Product", "Category", "Qty"];
  const rows = Array.from({ length: 12 }, (_, i) => [
    `C${i % 3}`,
    `P${i % 4}`,
    ["Network", "Mobile"][i % 2],
    i,
  ]);
  const result: any = interpretInstruction(
    "usage dashboard of total Qty by Customer and Product with units in Category",
    headers,
    rows as any,
  );
  assert.deepEqual(result.specs.dashboard, {
    category: 0,
    values: [3],
    aggregation: "sum",
    usage: { item: 1, unit: 2 },
  });
});
