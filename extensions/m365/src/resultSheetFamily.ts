/**
 * An earlier version of the same result: "Dashboard Sales (2)" and "Dashboard Sales" are one family.
 * A new dashboard of the same data used to stack up as "(2)", "(3)" sheets (live run 2026-11-03);
 * only the older sheets of the new result's own family are replaced, never a different result.
 */
export function resultSheetFamily(name: string): string {
  return String(name ?? "")
    .replace(/\s*\(\d+\)\s*$/, "")
    .trim()
    .toLowerCase();
}

export function isOlderVersionOf(candidate: string, keep: string): boolean {
  return (
    candidate !== keep &&
    resultSheetFamily(candidate) !== "" &&
    resultSheetFamily(candidate) === resultSheetFamily(keep)
  );
}
