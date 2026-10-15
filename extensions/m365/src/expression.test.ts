import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ExpressionError,
  canonicalExpression,
  expressionToFormula,
  parseExpression,
  wantsPercentFormat,
} from "./expression.js";
import { interpretInstruction } from "./intent.js";

const headers = ["Month", "Region", "Sales", "Cost", "Unit Price"];
const cell = (index: number) => `${String.fromCharCode(65 + index)}2`;

test("an expression is parsed with precedence, parentheses and percentages", () => {
  const margin = parseExpression("(Sales - Cost) / Sales", headers);
  assert.deepEqual(margin.refs, [2, 3]);
  assert.equal(
    canonicalExpression(margin.ast),
    "(((#2-#3))/#2)".replace("((", "(").replace("))", ")"),
  );
  const formula = expressionToFormula(margin.ast, cell);
  assert.equal(formula, '=IFERROR(((C2-D2)/C2),"")');
  const plain = parseExpression("Sales - Cost * 2", headers);
  assert.equal(expressionToFormula(plain.ast, cell), "=(C2-(D2*2))");
  const percent = parseExpression("Sales * 10%", headers);
  assert.equal(expressionToFormula(percent.ast, cell), "=(C2*0.1)");
  const spaced = parseExpression("[Unit Price] * 3", headers);
  assert.equal(expressionToFormula(spaced.ast, cell), "=(E2*3)");
  const rounded = parseExpression("ROUND(Cost * 1.15, 2)", headers);
  assert.equal(expressionToFormula(rounded.ast, cell), "=ROUND((D2*1.15),2)");
  assert.equal(
    expressionToFormula(
      parseExpression("-Sales + MAX(Cost, 100)", headers).ast,
      cell,
    ),
    "=((-C2)+MAX(D2,100))",
  );
});

test("anything outside the grammar is rejected", () => {
  const bad = (text: string, pattern: RegExp) =>
    assert.throws(
      () => parseExpression(text, headers),
      (error) => {
        assert.ok(error instanceof ExpressionError);
        assert.match((error as Error).message, pattern);
        return true;
      },
    );
  bad("", /Write an expression/);
  bad("Sales + Revenue", /not a column/);
  bad("HYPERLINK(Sales)", /not supported/);
  bad("Sales; Cost", /Unsupported character/);
  bad("A1 + Sales", /not a column/);
  bad("Sales ^ 2", /Unsupported character/);
  bad("(Sales + Cost", /not closed/);
  bad("Sales Cost", /Unexpected text/);
  bad("5 + 2", /at least one column/);
  bad("ROUND(Sales, Cost)", /fixed number/);
  bad("x".repeat(241), /limited/);
  bad("[Sales", /not closed/);
  bad("=Sales", /Unexpected symbol/);
  bad(`${"(".repeat(12)}Sales${")".repeat(12)}`, /nested too deeply/);
  assert.throws(
    () => parseExpression("Sales", ["Sales", "sales"]),
    /more than one column/,
  );
});

test("the name decides whether the result is shown as a percentage", () => {
  assert.equal(wantsPercentFormat("Margin %"), true);
  assert.equal(wantsPercentFormat("Profit percent"), true);
  assert.equal(wantsPercentFormat("Profit"), false);
});

test("instructions with more than two columns or functions become an expression column", () => {
  const rows = [
    ["Jan", "North", 1200, 800, 3],
    ["Feb", "South", 1500, 950, 4],
  ];
  const margin = interpretInstruction(
    "Add column Margin % = (Sales - Cost) / Sales",
    headers,
    rows,
  );
  assert.deepEqual(margin.actions, ["add-column"]);
  assert.deepEqual(margin.specs.addColumn, {
    name: "Margin %",
    expression: "(Sales - Cost) / Sales",
  });
  const simple = interpretInstruction(
    "Add column Profit = Sales - Cost",
    headers,
    rows,
  );
  assert.deepEqual(simple.specs.addColumn, {
    name: "Profit",
    left: 2,
    operator: "-",
    right: 3,
  });
  const unknown = interpretInstruction(
    "Add column X = (Revenue - Cost) / Sales",
    headers,
    rows,
  );
  assert.deepEqual(unknown.actions, []);
});
