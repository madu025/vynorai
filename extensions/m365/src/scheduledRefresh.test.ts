import assert from "node:assert/strict";
import { test } from "node:test";
import { interpretInstruction } from "./intent.js";
import {
  parseScheduledRefresh,
  parseStoredScheduledRefresh,
} from "./scheduledRefresh.js";

test("parses a weekly refresh while preserving the report request", () => {
  const value = parseScheduledRefresh(
    "Create a sales dashboard and refresh this report every Monday",
    new Date("2026-10-27T10:00:00"),
  );
  assert.equal(value?.request, "Create a sales dashboard");
  assert.equal(value?.frequency, "weekly");
  assert.equal(value?.weekday, 1);
  assert.equal(new Date(value!.nextRunAt).getDay(), 1);
});

test("removes a schedule phrase even when the request does not say refresh", () => {
  const schedule = parseScheduledRefresh(
    "Create a sales report every Monday",
    new Date("2026-10-27T08:00:00"),
  );
  assert.equal(schedule?.request, "Create a sales report");
  assert.equal(schedule?.weekday, 1);
});

test("invalid stored schedule data is discarded", () => {
  assert.equal(parseStoredScheduledRefresh('{"frequency":"daily"}'), undefined);
  assert.equal(parseStoredScheduledRefresh("not json"), undefined);
});

test("scheduled requests still use the normal report planner", () => {
  const value = interpretInstruction(
    "Create a chart of Sales by Region and refresh every week",
    ["Region", "Sales"],
    [
      ["North", 10],
      ["South", 20],
    ],
  );
  assert.deepEqual(value.actions, ["chart"]);
  assert.equal(value.specs.scheduleRefresh?.frequency, "weekly");
  assert.equal(
    value.specs.scheduleRefresh?.request,
    "Create a chart of Sales by Region",
  );
});
