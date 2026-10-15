import assert from "node:assert/strict";
import { test } from "node:test";
import { createExcelPreviewPlan } from "./excel.js";
import { interpretInstruction } from "./intent.js";
import { buildOutcomes } from "./outcome.js";

const headers = ["Month", "Region", "Sales", "Cost", "Margin"];
const rows = [
  ["Jan", "North", 120000, 80000, 0.33],
  ["Feb", "South", 150000, 95000, 0.37],
  ["Mar", "North", 180000, 110000, 0.39],
  ["Apr", "East", 135000, 90000, 0.33],
];
const input = {
  workbookId: "w",
  worksheetName: "Sheet1",
  address: "Sheet1!A1:E5",
  hasHeaders: true,
  values: [headers, ...rows],
} as any;

test("group E: a pivot can carry several value fields and show them as a share", () => {
  const asked = interpretInstruction(
    "Create a pivot of Sales and Cost by Region as percent of total",
    headers,
    rows,
  );
  assert.deepEqual(asked.actions, ["pivot-table"]);
  assert.deepEqual(asked.specs.pivot?.extraValues, [3]);
  assert.equal(asked.specs.pivot?.showAs, "percent-of-total");
  const plan = createExcelPreviewPlan(
    input,
    ["pivot-table"],
    500,
    asked.specs as any,
  );
  const spec = plan.actions[0].spec!;
  assert.deepEqual(spec.extraValuesColumns, ["Cost"]);
  assert.equal(spec.showAs, "percent-of-total");
  const [outcome] = buildOutcomes(plan.actions as any, headers, rows);
  assert.deepEqual(outcome.table?.headers, [
    "Region",
    "Total — Sales",
    "Total — Cost",
  ]);
  assert.equal(outcome.table?.rows.at(-1)?.[1], "100%");
  assert.throws(
    () =>
      createExcelPreviewPlan(input, ["pivot-table"], 500, {
        pivot: { rows: 1, values: 2, extraValues: [2] },
      }),
    /other columns/,
  );
  assert.throws(
    () =>
      createExcelPreviewPlan(input, ["pivot-table"], 500, {
        pivot: { rows: 1, values: 2, showAs: "nonsense" as any },
      }),
    /display option/,
  );
});

test("group F: a series on a very different scale goes to a second axis", () => {
  const plan = createExcelPreviewPlan(input, ["chart"], 500, {
    chart: { category: 0, value: 2, chartType: "line", extraValues: [3, 4] },
  });
  const spec = plan.actions[0].spec!;
  assert.deepEqual(spec.secondaryIndexes, [4]);
  const [outcome] = buildOutcomes(plan.actions as any, headers, rows);
  assert.match(outcome.details.join(" "), /Margin is on a second axis/);
  const same = createExcelPreviewPlan(input, ["chart"], 500, {
    chart: { category: 0, value: 2, chartType: "line", extraValues: [3] },
  });
  assert.equal(same.actions[0].spec!.secondaryIndexes, undefined);
});

test("group G: icon sets and allowed ranges are understood and validated", () => {
  const asked = interpretInstruction(
    "Format it with arrow icons on Sales and allow Cost between 1000 and 200000",
    headers,
    rows,
  );
  assert.deepEqual(asked.actions, ["format"]);
  assert.ok(
    asked.specs.format?.conditional?.some(
      (rule) => rule.rule === "icon-set" && rule.column === 2,
    ),
  );
  const range = asked.specs.format?.validation?.find(
    (rule) => rule.rule === "between",
  );
  assert.equal(range?.min, 1000);
  assert.equal(range?.max, 200000);
  const plan = createExcelPreviewPlan(
    input,
    ["format"],
    500,
    asked.specs as any,
  );
  const [outcome] = buildOutcomes(plan.actions as any, headers, rows);
  const text = outcome.details.join("\n");
  assert.match(text, /arrow icons/);
  assert.match(text, /only numbers from 1000 to 200000/);
  assert.throws(
    () =>
      createExcelPreviewPlan(input, ["format"], 500, {
        format: {
          validation: [{ column: 2, rule: "between", min: 5, max: 1 }],
        },
      }),
    /smaller and a larger/,
  );
  assert.throws(
    () =>
      createExcelPreviewPlan(input, ["format"], 500, {
        format: { validation: [{ column: 1, rule: "max-length", max: 999 }] },
      }),
    /1 to 255/,
  );
  const limited = interpretInstruction(
    "add validation: Region at most 12 characters",
    headers,
    rows,
  );
  assert.equal(limited.specs.format?.validation?.[0].rule, "max-length");
});
