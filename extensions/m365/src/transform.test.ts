import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanRows } from "./transform.js";

test("text that is an identifier (leading zero, very long) is not turned into a number", () => {
  const { rows } = cleanRows(
    [["0112559962", "007", "12", "0.5", "1234567890123456789", " 1,200 "]],
    ["trim", "text-to-number"],
  );
  assert.deepEqual(rows[0], [
    "0112559962",
    "007",
    12,
    0.5,
    "1234567890123456789",
    1200,
  ]);
});
