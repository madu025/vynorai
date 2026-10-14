import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertConfirmedApproval,
  createExcelPreviewPlan,
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
