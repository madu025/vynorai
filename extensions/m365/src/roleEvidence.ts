/**
 * The one line each agent role shows when it finishes, built from what that role really did:
 * the join the relationship mapper found, the issues a reviewer reported and how many
 * calculations it ran, how many changes the read-back checked. Pure; the pane localizes the lines.
 */
import type { RelationLink } from "./relationships.js";

const tableName = (label: string): string => label.split("!")[0].replace(/^'|'$/g, "");

export function relationshipLine(link: RelationLink): string {
  const duplicates = link.from.duplicateKeys + link.to.duplicateKeys;
  return `${tableName(link.from.table)}.${link.from.column} → ${tableName(link.to.table)}.${link.to.column} · ${link.cardinality} · ${link.fromRowsWithoutPartner.toLocaleString("en-US")} unmatched rows · ${duplicates.toLocaleString("en-US")} duplicate keys`;
}

export function reviewerLine(
  verdict: { ok: boolean; issues: string[] },
  calculations: number,
): string {
  if (verdict.ok)
    return calculations
      ? `checks passed · ${calculations} calculation(s)`
      : "checks passed";
  const first = (verdict.issues[0] ?? "").replace(/\s+/g, " ").slice(0, 90);
  return `${verdict.issues.length} issue(s): ${first}`;
}

export function readBackLine(results: { status: string }[]): string {
  const failed = results.filter((result) => result.status !== "applied").length;
  return `${results.length} change(s) read back${failed ? `, ${failed} failed` : ""}`;
}

export type FinalRole = "planner" | "relationships" | "builder" | "accuracy" | "safety";
export interface FinalRoleState {
  role: FinalRole;
  state: "done" | "skipped";
  evidence: string;
}

/**
 * The last state of every team role once a request has ended, so none stays "pending" (a question,
 * a skipped planner, a model that used `calculate` instead of `map_relationships`, a reviewer that
 * failed). A role that did its work is "done" with its evidence line; one that had nothing to do is
 * "skipped" with the reason. Pure; the pane localizes the lines.
 */
export function finalRoleStates(input: {
  planSteps: number;
  link?: RelationLink;
  /** True when the relationship mapper tool ran (builder or a helper) even if it found no link. */
  mapperRan?: boolean;
  changes: number;
  reviewers: readonly { focus: string; ok: boolean; issues: string[] }[];
  calculations: { accuracy: number; safety: number };
  /** The change was simple: the reviewer models were skipped on purpose (the rules still ran). */
  reviewSkipped?: boolean;
}): FinalRoleState[] {
  const states: FinalRoleState[] = [
    input.planSteps > 0
      ? { role: "planner", state: "done", evidence: `${input.planSteps} plan step(s)` }
      : { role: "planner", state: "skipped", evidence: "no plan needed" },
  ];
  if (input.link)
    states.push({ role: "relationships", state: "done", evidence: relationshipLine(input.link) });
  else
    states.push({
      role: "relationships",
      state: "skipped",
      evidence: input.mapperRan ? "no join found between the ranges" : "not needed for this request",
    });
  states.push(
    input.changes > 0
      ? { role: "builder", state: "done", evidence: `${input.changes} staged change(s)` }
      : { role: "builder", state: "done", evidence: "answer ready, nothing to change" },
  );
  for (const role of ["accuracy", "safety"] as const) {
    const verdict = input.reviewers.find((reviewer) => reviewer.focus === role);
    if (verdict)
      states.push({ role, state: "done", evidence: reviewerLine(verdict, input.calculations[role]) });
    else
      states.push({
        role,
        state: "skipped",
        evidence: !input.changes
          ? "not needed, nothing was changed"
          : input.reviewSkipped
            ? "simple change, checked by rules only"
            : input.reviewers.length
            ? "not run, the builder corrected first"
            : "did not finish",
      });
  }
  return states;
}
