import assert from "node:assert/strict";
import { test } from "node:test";
import {
  formatFormulaInspection,
  inspectFormulas,
  isFormulaExplanationRequest,
  isFormulaInspectionRequest,
  isFormulaRepairRequest,
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
  assert.equal(
    isFormulaExplanationRequest("Explain this formula in plain language"),
    true,
  );
  assert.equal(
    isFormulaExplanationRequest(
      "What does the formula in the selected cell do?",
    ),
    true,
  );
  assert.equal(isFormulaInspectionRequest("What is total Sales?"), false);
});

test("formula inspector gives a read-only #DIV/0! repair candidate for a safe formula", () => {
  const report = inspectFormulas({
    worksheetName: "Sales",
    address: "Sales!C2",
    formulas: [["=A2/B2"]],
    values: [["#DIV/0!"]],
  });

  assert.deepEqual(report.items[0].repair, {
    candidate: '=IFERROR(A2/B2,"")',
    guidance:
      "Suggested repair suppresses the division error with a blank result. It is advisory and is not applied to your source cell.",
  });
  assert.match(
    formatFormulaInspection(report),
    /Suggested repair: =IFERROR\(A2\/B2,""\)/,
  );
  assert.match(report.items[0].explanation, /zero or blank divisor/);
  assert.equal(isFormulaRepairRequest("Repair this #DIV/0! formula"), true);
  assert.equal(
    isFormulaInspectionRequest("Repair this #DIV/0! formula"),
    false,
  );
});

test("formula inspector refuses to guess a deleted #REF! reference", () => {
  const report = inspectFormulas({
    worksheetName: "Sales",
    address: "Sales!C2",
    formulas: [["=#REF!/B2"]],
    values: [["#REF!"]],
  });

  assert.equal(report.items[0].repair?.candidate, undefined);
  assert.match(
    report.items[0].repair?.guidance ?? "",
    /cannot be reconstructed safely/,
  );
});

test("formula inspector refuses unsupported formula functions in repair advice", () => {
  const report = inspectFormulas({
    worksheetName: "Sales",
    address: "Sales!C2",
    formulas: [["=WEBSERVICE(A2)/B2"]],
    values: [["#DIV/0!"]],
  });

  assert.equal(report.items[0].repair?.candidate, undefined);
  assert.match(
    report.items[0].repair?.guidance ?? "",
    /outside the safe automatic repair subset/,
  );
});
