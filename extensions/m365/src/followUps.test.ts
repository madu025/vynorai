import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanChipText, nextSteps } from "./followUps.js";
import type { WorkspaceSchema } from "./smartWorkspace.js";

const schema: WorkspaceSchema = {
  hasMeasure: true,
  hasDate: true,
  hasCategory: true,
  hasText: true,
  sampleRows: 20,
  columns: [
    { name: "Net Amount", role: "measure" },
    { name: "Channel", role: "category" },
    { name: "Order ID", role: "identifier" },
    { name: "Order Date", role: "date" },
  ],
  blankColumns: ["Channel"],
};

test("the answer's own question comes first and the list is at most three", () => {
  const steps = nextSteps({ questions: ["- Want a bar chart?"], schema });
  assert.equal(steps.length, 3);
  assert.equal(steps[0].text, "Want a bar chart?");
});

test("what was just asked and Inspect formulas are never offered", () => {
  const steps = nextSteps({ schema, asked: "Total Net Amount by Channel" });
  assert.ok(steps.every((s) => !/total net amount by channel/i.test(s.text)));
  assert.ok(steps.every((s) => !/inspect formulas/i.test(s.text)));
  assert.ok(steps.length > 0);
});

test("without a schema only the answer's questions remain", () => {
  assert.deepEqual(
    nextSteps({ questions: ["Split by month?"] }).map((s) => s.text),
    ["Split by month?"],
  );
  assert.deepEqual(nextSteps({}), []);
});

test("a leading bullet or dash is stripped from chip text", () => {
  assert.equal(cleanChipText("- Want me to run it?"), "Want me to run it?");
  assert.equal(cleanChipText("• Next?"), "Next?");
  assert.equal(cleanChipText("Fine?"), "Fine?");
});
