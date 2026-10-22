import assert from "node:assert/strict";
import { test } from "node:test";
import { describeUnknownColumns, findUnknownColumns } from "./unknownColumn.js";

const HEADERS = [
  "Order No",
  "Region",
  "Product",
  "Qty",
  "Net Amount",
  "Order Date",
];

test("names a column that is not in the selection", () => {
  assert.deepEqual(
    findUnknownColumns("pivot total Profit by Region", HEADERS),
    ["Profit"],
  );
  assert.deepEqual(findUnknownColumns("pivot total Qty by Country", HEADERS), [
    "Country",
  ]);
  assert.deepEqual(
    findUnknownColumns("remove duplicates in Customer", HEADERS),
    ["Customer"],
  );
  assert.deepEqual(
    findUnknownColumns("highlight Score greater than 5", HEADERS),
    ["Score"],
  );
});

test("real columns, filler words and sheet names are not reported", () => {
  for (const text of [
    "pivot total Qty by Region",
    "bar chart of Net Amount by Region",
    "sort by Qty then Region",
    "sort by Net Amount descending",
    "total by Product",
    "show the rows sorted by Region then Qty",
    "add a column Share that is [Qty] / COLSUM([Qty])",
    "summary of the Orders sheet",
    "pivot of the data by Region",
    "clean the data",
  ])
    assert.deepEqual(findUnknownColumns(text, HEADERS), [], text);
});

test("the notice lists the real columns and is empty when nothing is unknown", () => {
  const text = describeUnknownColumns(["Profit"], HEADERS) ?? "";
  assert.match(text, /"Profit"/);
  assert.match(text, /Order No, Region/);
  assert.equal(describeUnknownColumns([], HEADERS), undefined);
});
