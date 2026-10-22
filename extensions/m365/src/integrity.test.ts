import assert from "node:assert/strict";
import { test } from "node:test";
import { compareWrittenRows, describeIntegrityIssues } from "./integrity.js";

const HEADERS = ["Order No", "Qty", "Region"];

test("a result that matches reports nothing", () => {
  assert.deepEqual(
    compareWrittenRows(
      [
        ["000001", 5, "North"],
        ["000002", null, "South"],
      ],
      [
        ["000001", 5, "North"],
        ["000002", "", "South"],
      ],
      HEADERS,
    ),
    [],
  );
});

test("lost leading zeros are named by column", () => {
  const issues = compareWrittenRows(
    [
      ["000001", 5, "N"],
      ["000002", 6, "N"],
    ],
    [
      [1, 5, "N"],
      [2, 6, "N"],
    ],
    HEADERS,
  );
  assert.equal(issues.length, 1);
  assert.equal(issues[0].kind, "leading-zero");
  assert.match(issues[0].message, /"Order No": 2 value/);
});

test("a text value that became a number and a changed number are told apart", () => {
  const issues = compareWrittenRows(
    [["abc12", 5, "N"]],
    [[12, 6, "N"]],
    HEADERS,
  );
  assert.deepEqual(issues.map((issue) => issue.kind).sort(), [
    "text-became-number",
    "value-changed",
  ]);
});

test("a wrong row count is reported", () => {
  const issues = compareWrittenRows(
    [
      ["a", 1, "x"],
      ["b", 2, "y"],
    ],
    [["a", 1, "x"]],
    HEADERS,
    1,
  );
  assert.equal(issues[0].kind, "row-count");
});

test("the notice says what to do, and says nothing when clean", () => {
  const issues = compareWrittenRows([["007", 1, "x"]], [[7, 1, "x"]], HEADERS);
  assert.match(
    describeIntegrityIssues(issues) ?? "",
    /Check the result.*original data is untouched/,
  );
  assert.equal(describeIntegrityIssues([]), undefined);
});
