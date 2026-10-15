import assert from "node:assert/strict";
import { test } from "node:test";
import {
  formatFormulaInspection,
  inspectFormulas,
  isFormulaInspectionRequest,
} from "./formulaInspector.js";

test("formula inspector reports references, calculation errors and a direct self reference", () => {
  const report = inspectFormulas({
    worksheetName: "Sales",
    address: "Sales!B2:C3",
    formulas: [
      ["=SUM(A2:A5)", "=B2/0"],
      ["=B3+1", "plain text"],
    ],
    values: [
      [12, "#DIV/0!"],
      ["#VALUE!", "plain text"],
    ],
  });
  assert.equal(report.formulaCellCount, 3);
  assert.equal(report.errorCellCount, 2);
  assert.equal(report.possibleCircularReferenceCount, 1);
  assert.deepEqual(report.items[0].references, ["A2:A5"]);
  assert.deepEqual(report.items[1].errors, ["#DIV/0!"]);
  assert.equal(report.items[2].possibleCircularReference, true);
  assert.match(formatFormulaInspection(report), /B3: =B3\+1/);
});

test("formula inspector request words do not capture ordinary data questions", () => {
  assert.equal(
    isFormulaInspectionRequest("Explain the selected formulas"),
    true,
  );
  assert.equal(isFormulaInspectionRequest("Check formula errors"), true);
  assert.equal(isFormulaInspectionRequest("What is total Sales?"), false);
});
