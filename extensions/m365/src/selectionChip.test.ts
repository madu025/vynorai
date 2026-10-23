import assert from "node:assert/strict";
import { test } from "node:test";
import { describeSelection } from "./selectionChip.js";

test("a range shows its sheet, address and size", () => {
  assert.equal(
    describeSelection({ address: "Sales!$A$1:$J$500", rows: 500, columns: 10 }),
    "'Sales'!A1:J500 · 500 rows × 10 columns",
  );
  assert.equal(
    describeSelection({
      address: "'Sales Data'!A1:B1048576",
      rows: 1048576,
      columns: 2,
    }),
    "'Sales Data'!A1:B1048576 · 1,048,576 rows × 2 columns",
  );
});

test("one cell, one row and one column read naturally", () => {
  assert.equal(
    describeSelection({ address: "Data!B2", rows: 1, columns: 1 }),
    "'Data'!B2 · 1 cell",
  );
  assert.equal(
    describeSelection({ address: "Data!A1:J1", rows: 1, columns: 10 }),
    "'Data'!A1:J1 · 1 row × 10 columns",
  );
  assert.equal(
    describeSelection({ address: "Data!C1:C9", rows: 9, columns: 1 }),
    "'Data'!C1:C9 · 9 rows × 1 column",
  );
});

test("the words around the numbers can be given in another language", () => {
  const words = {
    cell: "කොටුව",
    row: "පේළිය",
    rows: "පේළි",
    column: "තීරුව",
    columns: "තීරු",
  };
  assert.equal(
    describeSelection(
      { address: "Sales!A1:J500", rows: 500, columns: 10 },
      words,
    ),
    "'Sales'!A1:J500 · 500 පේළි × 10 තීරු",
  );
  assert.equal(
    describeSelection({ address: "Data!B2", rows: 1, columns: 1 }, words),
    "'Data'!B2 · 1 කොටුව",
  );
  assert.equal(
    describeSelection({ address: "Data!C1:C9", rows: 9, columns: 1 }, words),
    "'Data'!C1:C9 · 9 පේළි × 1 තීරුව",
  );
});

test("a missing selection shows nothing, and an address without a sheet still works", () => {
  assert.equal(describeSelection(undefined), "");
  assert.equal(describeSelection({ address: "", rows: 0, columns: 0 }), "");
  assert.equal(
    describeSelection({ address: "A1:C3", rows: 3, columns: 3 }),
    "A1:C3 · 3 rows × 3 columns",
  );
});

test("friendlySelection and stripRanges hide cell addresses", async () => {
  const { friendlySelection, stripRanges } = await import("./selectionChip.js");
  assert.equal(
    friendlySelection(
      { address: "Orders!A1", rows: 1, columns: 1 },
      "'Orders'!A1:L3001",
    ),
    "Orders · 3,000 rows × 12 columns",
  );
  assert.equal(
    friendlySelection({ address: "Orders!A1", rows: 1, columns: 1 }),
    "Orders",
  );
  assert.equal(
    stripRanges("Rows in 'Orders'!A1:L3001 and Customers!A2:A3001 differ"),
    "Rows in Orders and Customers differ",
  );
});
