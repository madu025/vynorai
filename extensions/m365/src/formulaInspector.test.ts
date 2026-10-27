import assert from "node:assert/strict";
import { test } from "node:test";
import {
  auditWorkbook,
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

test("formula inspector reports displayed Excel errors when formula text is unavailable", () => {
  const report = inspectFormulas({
    worksheetName: "CustomerFeedback",
    address: "CustomerFeedback!G2",
    formulas: [["#VALUE!"]],
    values: [["#VALUE!"]],
  });

  assert.equal(report.formulaCellCount, 0);
  assert.equal(report.errorCellCount, 1);
  assert.deepEqual(report.displayedErrorItems, [
    {
      address: "G2",
      value: "#VALUE!",
      errors: ["#VALUE!"],
      explanation:
        "Excel returned an error value, but no formula text was available for this cell. It may be a hard-coded error value or a formula whose text Excel did not expose.",
    },
  ]);
  assert.match(
    formatFormulaInspection(report),
    /G2: no formula text was returned; displayed value #VALUE!/,
  );
});

test("formula audit reports hard-coded numbers and copied-formula inconsistencies", () => {
  const report = inspectFormulas({
    worksheetName: "Sales",
    address: "Sales!A2:C5",
    formulas: [
      ["=B2*C2", "", ""],
      ["=B3*C3", "", ""],
      ["=B4+C4", "", ""],
      ["", "", ""],
    ],
    values: [
      [20, 10, 20],
      [30, 11, 21],
      [40, 12, 22],
      [1, 2, 3],
    ],
  });

  assert.equal(report.hardCodedCellCount, 1);
  assert.equal(report.inconsistentFormulaCount, 1);
  assert.equal(
    report.items.find((item) => item.address === "A4")?.inconsistentFormula,
    true,
  );
  assert.match(
    formatFormulaInspection(report),
    /1 hard-coded numeric cell\(s\)/,
  );
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

test("the workbook audit adds up every sheet, lists the worst cells first and names skipped sheets", () => {
  const summary = auditWorkbook(
    [
      inspectFormulas({
        worksheetName: "Ops",
        address: "Ops!A1:B4",
        formulas: [
          ["Qty", "Double"],
          [1, "=A2*2"],
          [2, "=A3*2"],
          [3, "=A4*3"],
        ],
        values: [
          ["Qty", "Double"],
          [1, 2],
          [2, 4],
          [3, 9],
        ],
      }),
      inspectFormulas({
        worksheetName: "Sales",
        address: "Sales!A1:B3",
        formulas: [
          ["Qty", "Total"],
          [2, "=A2*10"],
          [3, "=A3*10+1"],
        ],
        values: [
          ["Qty", "Total"],
          [2, 20],
          [3, "#DIV/0!"],
        ],
      }),
      inspectFormulas({
        worksheetName: "Notes",
        address: "Notes!A1:A2",
        formulas: [["x"], ["y"]],
        values: [["x"], ["y"]],
      }),
    ],
    ["Raw Data (600,000 cells)"],
  );
  assert.equal(summary.sheetsChecked, 3);
  assert.deepEqual(summary.skipped, ["Raw Data (600,000 cells)"]);
  assert.equal(summary.totals.errors, 1);
  assert.deepEqual(
    summary.sheets.map((sheet) => sheet.sheet),
    ["Sales", "Ops"],
  );
  assert.deepEqual(
    summary.issues.map((issue) => issue.sheet),
    ["Sales", "Ops"],
  );
  assert.equal(summary.issues[1].inconsistent, true);
  const first = summary.issues[0];
  assert.equal(first.sheet, "Sales");
  assert.equal(first.cell, "B3");
  assert.deepEqual(first.errors, ["#DIV/0!"]);
  assert.ok(first.explanation.length > 0);
});
