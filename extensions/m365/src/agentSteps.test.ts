import assert from "node:assert/strict";
import { test } from "node:test";
import { createServerExcelPreviewPlan } from "../../../backend/src/services/m365ExcelPlan.js";
import { runStepWith } from "./agentSteps.js";
import { readBackMismatches } from "./officeAgentHost.js";
import { gridWorkbook } from "../test/batch/gridWorkbook.js";

const headers = ["Order No", "Region", "Net Amount"];
const rows = [
  ["A-1", "North", 100],
  ["A-2", "South", 250],
  ["A-3", "North", 75],
  ["A-4", "East", 40],
];

function step(host: "desktop" | "web") {
  const book = gridWorkbook("Sales", [headers, ...rows], { host });
  const input = {
    workbookId: "wb",
    worksheetName: "Sales",
    address: "A1:C5",
    values: [headers, ...rows],
    hasHeaders: true,
  };
  const api: any = {
    planExcel: async ({ actions, specs, ...range }: any) => ({
      ...createServerExcelPreviewPlan(range, actions, undefined, specs ?? {}),
      planId: "plan-1",
      approvalToken: "token-1",
    }),
    approveExcel: async () => ({}),
    reportExcelResult: async () => ({}),
  };
  return runStepWith({
    runtime: book.runtime as any,
    api,
    readInput: async () => input as any,
    supportsExcelApi: book.supportsExcelApi,
    requirements: {},
  });
}

test("a step tells the agent when Excel refused a PivotTable and a formula summary was used", async () => {
  const result: any = await step("web")("PivotTable of Net Amount by Region");
  assert.equal(result.ok, true, JSON.stringify(result));
  const notes = result.detail.flatMap((item: any) => item.notes ?? []);
  assert.match(
    notes.join(" "),
    /could not create a PivotTable.+formula summary/,
  );
});

test("a step on desktop has no fallback note", async () => {
  const result: any = await step("desktop")(
    "PivotTable of Net Amount by Region",
  );
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(
    result.detail.flatMap((item: any) => item.notes ?? []),
    [],
  );
});

test("written values are read back and Excel's changes are named", async () => {
  // Excel turns "007" into 7 and "2026-01-05" into a date serial when written as values.
  const landed = [
    ["ID", "When", "Total"],
    [7, 46027, "=SUM(C3:C4)"],
  ];
  const target = {
    getCell: () => ({
      getResizedRange: (r: number, c: number) => ({
        load: () => undefined,
        values: landed.slice(0, r + 1).map((row) => row.slice(0, c + 1)),
      }),
    }),
  };
  const context = { sync: async () => undefined };
  const found = await readBackMismatches(context, target, [
    ["ID", "When", "Total"],
    ["007", "2026-01-05", "=SUM(C3:C4)"],
  ]);
  assert.equal(found.length, 2, found.join(" | "));
  assert.match(found.join(" "), /column 1.+leading zeros/);
  assert.match(found.join(" "), /column 2.+turned into numbers/);
  // An apostrophe keeps text as text; Excel drops it, which is not a change.
  assert.deepEqual(
    await readBackMismatches(
      context,
      {
        getCell: () => ({
          getResizedRange: () => ({ load() {}, values: [["007"]] }),
        }),
      },
      [["'007"]],
    ),
    [],
  );
});
