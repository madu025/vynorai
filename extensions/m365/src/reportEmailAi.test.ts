import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildReportEmailRequest,
  reportEmailConsentMessage,
  reportSummaryText,
} from "./reportEmailAi.js";
import { MAX_TEXT_CHARS } from "./textAssist.js";

const RESULTS = [
  { kind: "pivot-table", name: "Sales", targetSheet: "Report", status: "ok" },
];

test("the summary holds the result lines and at most 40 report rows", () => {
  const values = Array.from({ length: 100 }, (_, i) => [`R${i}`, i]);
  const text = reportSummaryText(RESULTS, "Report", values, true);
  assert.match(text, /pivot-table: Sales on Report/);
  assert.ok(text.includes("R39 | 39"));
  assert.ok(!text.includes("R40 | 40"));
  assert.match(text, /truncated/);
});

test("an over-long summary is cut on a line boundary and says so", () => {
  const values = Array.from({ length: 40 }, (_, i) => [
    `Row ${i}`,
    "x".repeat(400),
  ]);
  const text = reportSummaryText(RESULTS, "Report", values, false);
  assert.ok(text.length < MAX_TEXT_CHARS);
  assert.match(text, /shortened to fit/);
  assert.doesNotThrow(() => buildReportEmailRequest(text, true));
});

test("no request can be built without consent", () => {
  assert.throws(() => buildReportEmailRequest("hello", false), /CONSENT/);
});

test("the request is the excel report-email task and the consent text shows the summary", () => {
  const request = buildReportEmailRequest("Sales | 10", true);
  assert.equal(request.host, "excel");
  assert.equal(request.task, "report-email");
  assert.equal(request.consent, true);
  assert.match(reportEmailConsentMessage("Sales | 10"), /Sales \| 10/);
});
