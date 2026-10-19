import assert from "node:assert/strict";
import { test } from "node:test";
import { selectExcelActions } from "./excel.js";
import { interpretInstruction } from "./intent.js";
import { describeUnhandledJobs, findUnhandledJobs } from "./workflowCheck.js";

const HEADERS = ["Service ID", "RTOM", "Status", "Requested Quantity"];
const ROWS = Array.from({ length: 20 }, (_, index) => [
  `HK${index}`,
  index % 2 ? "A" : "B",
  "Done",
  index,
]);

const plannedKinds = (text: string) => [
  ...new Set([
    ...selectExcelActions(text),
    ...(interpretInstruction(text, HEADERS, ROWS).actions as string[]),
  ]),
];

test("every job in the sentence is in the plan: nothing to report", () => {
  const text =
    "clean the data, then pivot total Requested Quantity by RTOM, then chart it";
  assert.deepEqual(findUnhandledJobs(text, plannedKinds(text)), []);
});

test("a job the planner dropped is named, with a sentence that gets it", () => {
  const unhandled = findUnhandledJobs("pivot it and split Service ID", [
    "pivot-table",
  ]);
  assert.deepEqual(
    unhandled.map((job) => job.label),
    ["split"],
  );
  assert.match(describeUnhandledJobs(unhandled) ?? "", /split <column>/);
});

test('"summary sheet" is a place, not a summary job', () => {
  assert.deepEqual(
    findUnhandledJobs("put the result in a summary sheet", []),
    [],
  );
});

test("a dashboard covers summary, pivot, chart and statistics wording", () => {
  assert.deepEqual(
    findUnhandledJobs("dashboard with a summary, chart and pivot", [
      "dashboard",
    ]),
    [],
  );
});

test("highlight handled by a view is not reported", () => {
  assert.deepEqual(
    findUnhandledJobs("highlight the top 10 Requested Quantity", ["view"]),
    [],
  );
});

test("no jobs, no message", () => {
  assert.equal(describeUnhandledJobs([]), undefined);
});
