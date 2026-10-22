import assert from "node:assert/strict";
import { test } from "node:test";
import { parseExpression } from "./expression.js";
import { previewExpressionValue } from "./previewValue.js";

const headers = ["Name", "Dept", "Sales", "Cost", "Joined", "Note"];
const value = (text: string, row: unknown[]) =>
  previewExpressionValue(parseExpression(text, headers).ast, row);
const row = ["  amal perera ", "IT", 1500, 900, "2024-03-15", "a-b"];

test("the preview evaluates the common functions so the new column shows real values", () => {
  assert.equal(value('IF(Sales > 1400, "High", "Low")', row), "High");
  assert.equal(value("PROPER(TRIM(Name))", row), "Amal Perera");
  assert.equal(value("(Sales - Cost) / Sales", row), "0.4");
  assert.equal(
    value('IFS(Sales>=2000,"A",Sales>=1000,"B",TRUE,"C")', row),
    "B",
  );
  assert.equal(value('SUBSTITUTE(Note, "-", " ")', row), "a b");
  assert.equal(
    value('IF(AND(Sales>1000,Cost<1000),"Good","Check")', row),
    "Good",
  );
  assert.equal(value("ROUND(Sales / 7, 1)", row), "214.3");
});

test("what cannot be shown honestly returns null or an Excel error code", () => {
  assert.equal(value("YEAR(Joined)", row), null);
  assert.equal(value("Sales / 0", row), "#DIV/0!");
});
