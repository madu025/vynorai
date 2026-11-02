/**
 * One approval per task. The person approves the first batch (for example a new summary sheet with
 * a formula). The agent then often stages a second batch on that same sheet (the chart, the number
 * format) and used to ask again (live run 2026-11-02: two approvals for one summary sheet).
 *
 * A follow-up batch is applied without a second question only when every change is a write, a
 * format or a chart on a sheet this run created. Such a sheet is not the person's data: Undo
 * deletes it whole. Anything else (a sort, a change to existing data, a built-in step, an Excel
 * action) still waits for the person.
 */
import type { StagedChange } from "./agent.js";

const SAFE_KINDS = new Set([
  "write_formula",
  "write_values",
  "format_range",
  "create_chart",
]);

const clean = (name: string) =>
  String(name ?? "")
    .replace(/^'|'$/g, "")
    .trim()
    .toLowerCase();

/** True when the whole batch touches only sheets in `createdSheets` and only in safe ways. */
export function canAutoApprove(
  changes: readonly StagedChange[],
  createdSheets: readonly string[],
): boolean {
  if (!changes.length || !createdSheets.length) return false;
  const ours = new Set(createdSheets.map(clean));
  return changes.every(
    (change) =>
      SAFE_KINDS.has(change.kind) &&
      "sheet" in change &&
      ours.has(clean((change as { sheet: string }).sheet)),
  );
}
