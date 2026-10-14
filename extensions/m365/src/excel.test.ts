import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertConfirmedApproval,
  createExcelPreviewPlan,
  excelSafeBaseName,
  profileExcelRange,
} from "./excel.js";

const input = {
  workbookId: "book-1",
  worksheetName: "Sales",
  address: "A1:C1201",
  hasHeaders: true,
  values: [
    ["id", "amount", "region"],
    ...Array.from({ length: 1200 }, (_, i) => [i + 1, i * 2, "LK"]),
  ],
};

test("profiles selected Excel data and creates bounded chunks", () => {
  const profile = profileExcelRange(input, 500);
  assert.equal(profile.rowCount, 1201);
  assert.equal(profile.chunkCount, 3);
  const plan = createExcelPreviewPlan(
    input,
    ["table", "chart", "new-sheet"],
    500,
  );
  assert.equal(plan.requiresConfirmation, true);
  assert.equal(
    plan.actions.every((action) => action.preservesSource),
    true,
  );
  assert.match(plan.warnings.join(" "), /chunks/);
});

test("mutation gate requires confirmation and approval token", () => {
  assert.throws(() => assertConfirmedApproval(false), /confirmation/);
  assert.throws(() => assertConfirmedApproval(true), /approval token/);
  assert.doesNotThrow(() => assertConfirmedApproval(true, "approval"));
});

test("generated result sheet names fit Excel's 31-character limit", () => {
  const plan = createExcelPreviewPlan(
    { ...input, worksheetName: "Quarterly Revenue Summary 2026" },
    ["table", "chart", "new-sheet", "pivot-table"],
  );
  for (const action of plan.actions)
    assert.ok(action.targetSheet.length <= 31, action.targetSheet);
  assert.equal(excelSafeBaseName("2026"), "S_2026");
});
