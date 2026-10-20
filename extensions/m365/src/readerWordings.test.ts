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
