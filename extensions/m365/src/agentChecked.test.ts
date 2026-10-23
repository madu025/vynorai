import assert from "node:assert/strict";
import { test } from "node:test";
import { CHECKED_OK, checkedLine } from "./agentChecked.js";

test("idle shows nothing", () => {
  assert.equal(checkedLine({ badge: "" }).state, "idle");
});

test("while working it says what is happening", () => {
  for (const badge of [
    "Working",
    "Planning",
    "Reviewing",
    "Applying",
    "Verifying",
  ]) {
    const line = checkedLine({ badge, progress: "Reading Orders" });
    assert.equal(line.state, "working");
    assert.equal(line.text, "Working… Reading Orders");
  }
  assert.equal(checkedLine({ badge: "Working" }).text, "Working…");
});

test("a clean finish says the original data is not changed", () => {
  for (const badge of ["Done", "Waiting for approval", "Undone", "Discarded"]) {
    const line = checkedLine({ badge, issues: [] });
    assert.equal(line.state, "ok");
    assert.equal(line.text, CHECKED_OK);
  }
});

test("a problem turns it into a check needed line with the first problem, short", () => {
  const line = checkedLine({
    badge: "Done",
    issues: ["", "21 rows did not match   the key", "other"],
  });
  assert.equal(line.state, "warn");
  assert.equal(line.text, "Check needed: 21 rows did not match the key");
  const long = checkedLine({ badge: "Done", issues: ["x".repeat(300)] });
  assert.ok(long.detail.length <= 100 && long.detail.endsWith("…"));
});

test("a stopped run needs a check, working never hides a problem as ok", () => {
  assert.equal(checkedLine({ badge: "Stopped" }).state, "warn");
  assert.equal(
    checkedLine({ badge: "Applying", issues: ["x"] }).state,
    "working",
  );
});
