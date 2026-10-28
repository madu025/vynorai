import assert from "node:assert/strict";
import { test } from "node:test";
import { buildResultEvidence } from "./resultEvidence.js";

test("result evidence records intent, source, output and read-back", () => {
  assert.deepEqual(
    buildResultEvidence({
      request: "Create a chart of Net Amount by Region.",
      sourceRange: "'VynorAI_QA'!A1:J41",
      result: {
        kind: "chart",
        targetSheet: "VynorAI_Result",
        targetRange: "A1:H20",
        previewPlanId: "plan-123",
        status: "created",
        notes: ["Local fallback used."],
        warnings: ["North and north were kept separate."],
      },
    }),
    [
      "Detected intent: Create a chart of Net Amount by Region.",
      "Source: 'VynorAI_QA'!A1:J41",
      "Preview/plan: approved plan plan-123 was applied after preview.",
      "Affected range: VynorAI_Result!A1:H20",
      "Formula/value verification: the written output was read back from Excel.",
      "Read-back verification: Excel returned the result after writing.",
      "Result status: created",
      "Fallback/unsupported: Local fallback used.",
      "Local fallback used.",
      "Warning: North and north were kept separate.",
    ],
  );
});

test("existing results explicitly prove duplicate protection", () => {
  const lines = buildResultEvidence({
    request: "Create the same chart again.",
    sourceRange: "Orders!A1:J10",
    result: { kind: "chart", targetSheet: "VynorAI_Result", status: "exists" },
  });
  assert.match(lines.join("\n"), /no duplicate was created/);
});

test("historical card evidence prefers metadata captured with that result", () => {
  const lines = buildResultEvidence({
    request: "Create the newer chart.",
    sourceRange: "Orders!A1:J10",
    result: {
      kind: "chart",
      targetSheet: "VynorAI_Result",
      status: "created",
      request: "Create the older chart.",
      sourceRange: "Archive!A1:J10",
      previewPlanId: "old-plan",
    },
  });
  assert.ok(lines.includes("Detected intent: Create the older chart."));
  assert.ok(lines.includes("Source: Archive!A1:J10"));
  assert.ok(
    lines.includes(
      "Preview/plan: approved plan old-plan was applied after preview.",
    ),
  );
});
