import assert from "node:assert/strict";
import { test } from "node:test";
import { describeSelection } from "./selectionChip.js";

test("a range shows its sheet, address and size", () => {
  assert.equal(
    describeSelection({ address: "Sales!$A$1:$J$500", rows: 500, columns: 10 }),
    "'Sales'!A1:J500 · 500 rows × 10 columns",
  );
  assert.equal(
    describeSelection({ address: "'Sales Data'!A1:B1048576", rows: 1048576, columns: 2 }),
    "'Sales Data'!A1:B1048576 · 1,048,576 rows × 2 columns",
  );
});

test("one cell, one row and one column read naturally", () => {
  assert.equal(describeSelection({ address: "Data!B2", rows: 1, columns: 1 }), "'Data'!B2 · 1 cell");
  assert.equal(
    describeSelection({ address: "Data!A1:J1", rows: 1, columns: 10 }),
    "'Data'!A1:J1 · 1 row × 10 columns",
  );
  assert.equal(
    describeSelection({ address: "Data!C1:C9", rows: 9, columns: 1 }),
    "'Data'!C1:C9 · 9 rows × 1 column",
  );
});

test("a missing selection shows nothing, and an address without a sheet still works", () => {
  assert.equal(describeSelection(undefined), "");
  assert.equal(describeSelection({ address: "", rows: 0, columns: 0 }), "");
  assert.equal(describeSelection({ address: "A1:C3", rows: 3, columns: 3 }), "A1:C3 · 3 rows × 3 columns");
});
