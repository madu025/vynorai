import assert from "node:assert/strict";
import { test } from "node:test";
import { localizeMessage } from "./i18n.js";
import { mapRelationships } from "./relationships.js";
import { readBackLine, relationshipLine, reviewerLine } from "./roleEvidence.js";

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
