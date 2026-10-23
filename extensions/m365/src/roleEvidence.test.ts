import assert from "node:assert/strict";
import { test } from "node:test";
import { localizeMessage } from "./i18n.js";
import { mapRelationships } from "./relationships.js";
import { finalRoleStates, readBackLine, relationshipLine, reviewerLine } from "./roleEvidence.js";

test("the relationship line names both columns, the join and the problems", () => {
  const { links } = mapRelationships([
    {
      label: "Orders!A1:B5",
      headers: ["CustomerID", "Amount"],
      rows: [["C1", 5.5], ["C2", 7.5], ["C1", 1.5], ["C9", 2.5]],
    },
    {
      label: "Customers!A1:B3",
      headers: ["CustomerID", "Region"],
      rows: [["C1", "N"], ["C2", "S"]],
    },
  ]);
  assert.equal(
    relationshipLine(links[0]),
    "Orders.CustomerID → Customers.CustomerID · many-to-one · 1 unmatched rows · 1 duplicate keys",
  );
});

test("a reviewer line shows its calculations, or its first issue", () => {
  assert.equal(reviewerLine({ ok: true, issues: [] }, 4), "checks passed · 4 calculation(s)");
  assert.equal(reviewerLine({ ok: true, issues: [] }, 0), "checks passed");
  assert.equal(
    reviewerLine({ ok: false, issues: ["C12  sums C2:C10 but the data ends at C11", "b"] }, 2),
    "2 issue(s): C12 sums C2:C10 but the data ends at C11",
  );
  assert.equal(readBackLine([{ status: "applied" }, { status: "failed" }]), "2 change(s) read back, 1 failed");
});

test("the evidence lines are Sinhala", () => {
  const si = (text: string) => localizeMessage("si", text);
  assert.match(si("checks passed · 4 calculation(s)"), /ගණනය 4ක්/);
  assert.match(si("2 issue(s): range is short"), /ගැටලු 2/);
  assert.match(si("3 change(s) read back"), /නැවත කියවූ/);
  assert.match(
    si("Orders.CustomerID → Customers.CustomerID · many-to-one · 1 unmatched rows · 0 duplicate keys"),
    /බොහෝ-එක.*පේළි 1ක්.*යතුරු 0ක්/,
  );
});

const joinLink = mapRelationships([
  { label: "Orders!A1:B3", headers: ["CustomerID", "Amount"], rows: [["C1", 5.5], ["C2", 7.5]] },
  { label: "Customers!A1:B3", headers: ["CustomerID", "Region"], rows: [["C1", "N"], ["C2", "S"]] },
]).links[0];

test("a change request with a join and two reviewers ends with every role done and evidence", () => {
  const states = finalRoleStates({
    planSteps: 3,
    link: joinLink,
    mapperRan: true,
    changes: 2,
    reviewers: [
      { focus: "accuracy", ok: true, issues: [] },
      { focus: "safety", ok: false, issues: ["Sheet1 is overwritten"] },
    ],
    calculations: { accuracy: 2, safety: 0 },
  });
  assert.deepEqual(states.map((s) => s.state), ["done", "done", "done", "done", "done"]);
  assert.match(states[1].evidence, /^Orders\.CustomerID → Customers\.CustomerID/);
  assert.equal(states[3].evidence, "checks passed · 2 calculation(s)");
  assert.equal(states[4].evidence, "1 issue(s): Sheet1 is overwritten");
});

test("when the model used calculate and no reviewer ran, no role stays pending", () => {
  const states = finalRoleStates({
    planSteps: 0,
    changes: 0,
    reviewers: [],
    calculations: { accuracy: 0, safety: 0 },
  });
  assert.ok(states.every((s) => s.state === "done" || s.state === "skipped"));
  assert.ok(states.every((s) => s.evidence.length > 0));
  assert.deepEqual(
    states.map((s) => [s.role, s.state, s.evidence]),
    [
      ["planner", "skipped", "no plan needed"],
      ["relationships", "skipped", "not needed for this request"],
      ["builder", "done", "answer ready, nothing to change"],
      ["accuracy", "skipped", "not needed, nothing was changed"],
      ["safety", "skipped", "not needed, nothing was changed"],
    ],
  );
});

test("the mapper that ran but found no link says so, a reviewer that failed is not left pending", () => {
  const states = finalRoleStates({
    planSteps: 1,
    mapperRan: true,
    changes: 1,
    reviewers: [{ focus: "accuracy", ok: false, issues: ["wrong range"] }],
    calculations: { accuracy: 0, safety: 0 },
  });
  assert.equal(states[1].evidence, "no join found between the ranges");
  assert.equal(states[4].state, "skipped");
  assert.equal(states[4].evidence, "not run, the builder corrected first");
  const failed = finalRoleStates({
    planSteps: 0,
    changes: 1,
    reviewers: [],
    calculations: { accuracy: 0, safety: 0 },
  });
  assert.equal(failed[3].evidence, "did not finish");
});

test("every final role line has Sinhala and Tamil wording", () => {
  const lines = new Set<string>();
  for (const input of [
    { planSteps: 0, changes: 0, reviewers: [] },
    { planSteps: 2, mapperRan: true, changes: 1, reviewers: [{ focus: "accuracy", ok: true, issues: [] }] },
    { planSteps: 0, changes: 1, reviewers: [] },
  ])
    for (const s of finalRoleStates({ ...input, calculations: { accuracy: 0, safety: 0 } }))
      lines.add(s.evidence);
  for (const line of lines)
    for (const lang of ["si", "ta"] as const)
      assert.notEqual(localizeMessage(lang, line), line, `${lang}: ${line}`);
});

test("the reviewer that really runs (focus coverage) fills the safety role", () => {
  const states = finalRoleStates({
    planSteps: 1,
    changes: 2,
    reviewers: [
      { focus: "accuracy", ok: true, issues: [] },
      { focus: "coverage", ok: false, issues: ["The Summary sheet name is unclear"] },
    ],
    calculations: { accuracy: 1, safety: 3 },
  });
  const safety = states.find((s) => s.role === "safety")!;
  assert.equal(safety.state, "done");
  assert.equal(safety.evidence, "1 issue(s): The Summary sheet name is unclear");
  const passed = finalRoleStates({
    planSteps: 0,
    changes: 1,
    reviewers: [{ focus: "coverage", ok: true, issues: [] }],
    calculations: { accuracy: 0, safety: 2 },
  });
  assert.equal(passed.find((s) => s.role === "safety")!.evidence, "checks passed · 2 calculation(s)");
});
