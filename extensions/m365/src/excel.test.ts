import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertConfirmedApproval,
  assertValidExcelTabularRange,
  createExcelPreviewPlan,
  excelPlansMatch,
  excelSafeBaseName,
  profileExcelRange,
  selectExcelActions,
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

test("server preview must match the exact local selection and action plan", () => {
  const local = createExcelPreviewPlan(input, ["table", "chart"]);
  const server = {
    ...local,
    planId: "m365_plan",
    approvalToken: "approval",
    expiresAt: "2026-10-15T00:00:00.000Z",
    profile: { ...local.profile, sourceFingerprint: "b".repeat(64) },
  };
  assert.equal(excelPlansMatch(local, server), true);
  assert.equal(
    excelPlansMatch(local, { ...server, sourceAddress: "Sales!A1:C3" }),
    false,
  );
  assert.equal(
    excelPlansMatch(local, {
      ...server,
      actions: server.actions.map((action, index) =>
        index === 0 ? { ...action, targetSheet: "Other" } : action,
      ),
    }),
    false,
  );
});

test("instruction planner selects only explicit allowlisted Excel actions", () => {
  assert.deepEqual(
    selectExcelActions("Create a chart and PivotTable on a new result sheet"),
    ["chart", "new-sheet", "pivot-table"],
  );
  assert.deepEqual(selectExcelActions("Create only a PivotTable"), [
    "pivot-table",
  ]);
  assert.deepEqual(selectExcelActions("Format it as a table"), ["table"]);
  assert.deepEqual(selectExcelActions("Please improve this data"), []);
});

test("rejects merged, duplicate, and header-only table selections", () => {
  assert.throws(
    () =>
      assertValidExcelTabularRange({
        ...input,
        values: [
          ["Date", "Time", ""],
          ["", "Start", "End"],
          ["2026-09-02", "08:00", "09:00"],
        ],
      }),
    /blank or merged header cells/,
  );
  assert.throws(
    () =>
      assertValidExcelTabularRange({
        ...input,
        values: [
          ["Date", "End", "end"],
          ["2026-09-02", 1, 2],
        ],
      }),
    /unique header/,
  );
  assert.throws(
    () =>
      assertValidExcelTabularRange({
        ...input,
        values: [
          ["Date", "Amount"],
          ["", ""],
        ],
      }),
    /no data rows/,
  );
});
