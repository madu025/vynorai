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

test("whole-column figures: share of the total, above the average, spread", () => {
  const share = parseExpression("Sales / COLSUM(Sales)", headers);
  assert.equal(
    expressionToFormula(share.ast, cell, (index) => `$C$2:$C$201`),
    '=IFERROR((C2/SUM($C$2:$C$201)),"")',
  );
  const above = parseExpression(
    'IF(Sales > COLAVG(Sales), "Above", "Below")',
    headers,
  );
  assert.equal(
    expressionToFormula(above.ast, cell, () => "$C$2:$C$9"),
    '=IF((C2>AVERAGE($C$2:$C$9)),"Above","Below")',
  );
  const z = parseExpression(
    "(Sales - COLAVG(Sales)) / COLSTDEV(Sales)",
    headers,
  );
  assert.match(
    expressionToFormula(z.ast, cell, () => "$C$2:$C$9"),
    /STDEV\.S\(\$C\$2:\$C\$9\)/,
  );
  assert.throws(
    () => parseExpression("COLSUM(Sales + Cost)", headers),
    ExpressionError,
  );
  assert.throws(
    () =>
      parseExpression("COLSUM(Region)", headers).ast &&
      expressionToFormula(parseExpression("COLSUM(Sales)", headers).ast, cell),
  );
});

test("conditional, distinct and per-group figures (SUMIFS, COUNTIFS, UNIQUE) stay in the closed grammar", async () => {
  const { numericColumnRefs } = await import("./expression.js");
  const whole = (index: number) =>
    `$${String.fromCharCode(65 + index)}$2:$${String.fromCharCode(65 + index)}$9`;
  const formula = (source: string) =>
    expressionToFormula(parseExpression(source, headers).ast, cell, whole);
  assert.equal(
    formula('COLSUMIF(Sales, Region, "North")'),
    '=SUMIFS($C$2:$C$9,$B$2:$B$9,"North")',
  );
  assert.equal(
    formula('COLCOUNTIF(Region, "North")'),
    '=COUNTIFS($B$2:$B$9,"North")',
  );
  assert.equal(
    formula('COLCOUNTIF(Sales, ">100")'),
    '=COUNTIFS($C$2:$C$9,">100")',
  );
  assert.equal(
    formula("COLDISTINCT(Region)"),
    '=IFERROR(ROWS(UNIQUE(FILTER($B$2:$B$9,$B$2:$B$9<>""))),0)',
  );
  assert.equal(
    formula("GROUPSUM(Sales, Region)"),
    "=SUMIFS($C$2:$C$9,$B$2:$B$9,B2)",
  );
  assert.equal(formula("GROUPCOUNT(Region)"), "=COUNTIFS($B$2:$B$9,B2)");
  assert.equal(
    formula("Sales / GROUPSUM(Sales, Region)"),
    '=IFERROR((C2/SUMIFS($C$2:$C$9,$B$2:$B$9,B2)),"")',
  );
  // Only the measure must be numeric; the group and condition columns may hold text.
  assert.deepEqual(
    numericColumnRefs(parseExpression("GROUPSUM(Sales, Region)", headers).ast),
    [2],
  );
  assert.deepEqual(
    numericColumnRefs(
      parseExpression('COLSUMIF(Sales, Region, "N")', headers).ast,
    ),
    [2],
  );
  assert.throws(
    () => parseExpression("GROUPSUM(Sales * 2, Region)", headers),
    ExpressionError,
  );
  assert.throws(
    () => parseExpression("COLCOUNTIF(Region, Month)", headers),
    ExpressionError,
  );
  assert.throws(
    () => parseExpression("COLDISTINCT(Region, Sales)", headers),
    ExpressionError,
  );
});
