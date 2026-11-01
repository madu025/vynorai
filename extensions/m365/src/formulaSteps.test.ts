import assert from "node:assert/strict";
import { test } from "node:test";
import { explainFormulaSteps } from "./formulaSteps.js";

function steps(formula: string, values?: Record<string, unknown>) {
  const result = explainFormulaSteps(formula, values);
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.ok ? result.steps : [];
}

test("nested IF with VLOOKUP lists the innermost call first and the whole formula last", () => {
  const list = steps('=IF(VLOOKUP(A2,$F$2:$G$20,2,FALSE)>100,"High","Low")');
  assert.deepEqual(
    list.map((step) => step.expression),
    [
      "VLOOKUP(A2,$F$2:$G$20,2,FALSE)",
      'IF(VLOOKUP(A2,$F$2:$G$20,2,FALSE)>100,"High","Low")',
    ],
  );
  assert.deepEqual(list[0].references, ["A2", "F2:G20"]);
  assert.match(list[0].meaning, /first column of \$F\$2:\$G\$20/);
  assert.match(list[1].meaning, /^Tests /);
  assert.equal(list[1].depth, 0);
  assert.equal(list[0].depth, 1);
});

test("deeply nested IF returns one step per call in post-order", () => {
  const list = steps('=IF(A1>1,IF(A1>2,IF(A1>3,"c","b"),"a"),"z")');
  assert.equal(list.length, 3);
  assert.equal(list[0].expression, 'IF(A1>3,"c","b")');
  assert.equal(
    list[2].expression,
    'IF(A1>1,IF(A1>2,IF(A1>3,"c","b"),"a"),"z")',
  );
});

test("XLOOKUP inside IFERROR and SUMIFS with several criteria", () => {
  const list = steps(
    '=IFERROR(XLOOKUP(A2,Data!$A:$A,Data!$C:$C),SUMIFS(D:D,B:B,"x",C:C,">5"))',
  );
  assert.deepEqual(
    list.map((step) => step.expression.split("(")[0]),
    ["XLOOKUP", "SUMIFS", "IFERROR"],
  );
  assert.ok(list[0].references.includes("Data!A:A"));
  assert.ok(list[1].references.includes("D:D"));
});

test("commas and parentheses inside strings do not split or nest", () => {
  const list = steps('=IF(A1="a, (b",CONCATENATE("x)",",",B1),"it""s (ok)")');
  assert.deepEqual(
    list.map((step) => step.expression.split("(")[0]),
    ["CONCATENATE", "IF"],
  );
  assert.equal(list[0].expression, 'CONCATENATE("x)",",",B1)');
  assert.deepEqual(list[0].references, ["B1"]);
  assert.deepEqual(list[1].references, ["A1", "B1"]);
});

test("array constants keep their commas and semicolons", () => {
  const list = steps("=SUM(INDEX({1,2;3,4},2,1),A1)");
  assert.equal(list[0].expression, "INDEX({1,2;3,4},2,1)");
  assert.equal(list[1].expression, "SUM(INDEX({1,2;3,4},2,1),A1)");
});

test("function names that look like cells are not references", () => {
  const list = steps("=LOG10(A1)+ATAN2(B1,C1)");
  assert.deepEqual(list[0].references, ["A1"]);
  assert.deepEqual(list[1].references, ["B1", "C1"]);
  assert.equal(list[2].expression, "LOG10(A1)+ATAN2(B1,C1)");
});

test("quoted sheet names and structured references", () => {
  const list = steps("=SUM('Q1 Sales'!B2:B9,Table1[Amount])");
  assert.deepEqual(list[0].references, ["Q1 Sales!B2:B9"]);
});

test("provided cell values are attached to the step inputs", () => {
  const list = steps("=ROUND(A1/B1,2)", { A1: 10, B1: 4, Z9: 1 });
  assert.deepEqual(list[0].inputs, [
    { reference: "A1", value: 10 },
    { reference: "B1", value: 4 },
  ]);
  const without = steps("=ROUND(A1/B1,2)");
  assert.deepEqual(without[0].inputs, []);
});

test("a formula without a function call still returns one step", () => {
  const list = steps("=A1*B1+3");
  assert.equal(list.length, 1);
  assert.equal(list[0].expression, "A1*B1+3");
});

test("bad input returns an error and never throws", () => {
  const bad = [
    "",
    "   ",
    "=",
    "=SUM(A1",
    "=SUM(A1))",
    '=IF(A1,"x)',
    "=SUM({1,2)",
    "=SUM(A1,[x)",
  ];
  for (const formula of bad) {
    const result = explainFormulaSteps(formula);
    assert.equal(result.ok, false, formula);
    if (!result.ok) assert.ok(result.error.length > 0);
  }
  assert.equal(explainFormulaSteps(undefined as unknown as string).ok, false);
  assert.equal(
    explainFormulaSteps("=" + "(".repeat(500) + "1" + ")".repeat(500)).ok,
    false,
  );
});

test("a very long formula is refused, not processed", () => {
  const result = explainFormulaSteps("=SUM(" + "A1,".repeat(5000) + "A1)");
  assert.equal(result.ok, false);
});
