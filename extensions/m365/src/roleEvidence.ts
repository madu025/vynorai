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
