import assert from "node:assert/strict";
import { test } from "node:test";
import { guardText } from "./textGuard.js";
import { cleanRows } from "./transform.js";

test("identifier text is prefixed so Excel keeps it as text", () => {
  assert.equal(guardText("0112559962"), "'0112559962");
  assert.equal(guardText("007"), "'007");
  assert.equal(guardText("+94771234567"), "'+94771234567");
});

test("dates, fractions, percentages, times and booleans written as text are prefixed", () => {
  for (const text of ["2025-01-05", "1/2", "12%", "00:30", "TRUE", "false"])
    assert.equal(guardText(text), `'${text}`);
});

test("real numbers, plain words and blanks are untouched", () => {
  assert.equal(guardText(12), 12);
  assert.equal(guardText("North"), "North");
  assert.equal(guardText(null), null);
  assert.equal(guardText(""), "");
  assert.equal(guardText(true), true);
});

test("after clean a column can hold text IDs next to real numbers: each cell is guarded alone", () => {
  const { rows } = cleanRows(
    [["0112559962"], [" 007 "], ["12"]],
    ["trim", "text-to-number"],
  );
  assert.deepEqual(rows, [["0112559962"], ["007"], [12]]);
  assert.deepEqual(
    rows.map(([cell]) => guardText(cell)),
    ["'0112559962", "'007", 12],
  );
});
