import assert from "node:assert/strict";
import { test } from "node:test";
import { boxAddress, clearPosition, parseBox } from "./chartPlacement.js";

test("a position round-trips as A1 text", () => {
  assert.deepEqual(parseBox("A9:G24"), {
    row: 8,
    column: 0,
    rows: 16,
    columns: 7,
  });
  assert.equal(boxAddress(parseBox("A9:G24")!), "A9:G24");
  assert.equal(boxAddress(parseBox("AB3")!), "AB3");
  assert.equal(parseBox("Sheet1!A1"), undefined);
});

test("an empty position is kept", () => {
  const box = parseBox("H2:M16")!;
  assert.deepEqual(
    clearPosition(box, [
      ["", ""],
      [null, ""],
    ]),
    box,
  );
});

test("a position over data moves under the last filled cell of its columns", () => {
  const box = parseBox("A9:G24")!;
  // data in rows 9..30 (indexes 0..21 from row 9): the chart goes to row 32
  const values = Array.from({ length: 30 }, (_, i) =>
    i < 22 ? ["", "", "", "", "x"] : ["", ""],
  );
  const moved = clearPosition(box, values);
  assert.equal(boxAddress(moved), "A32:G47");
});
