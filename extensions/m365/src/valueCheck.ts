/**
 * A PivotTable, summary or dashboard groups by the exact text of a column. "Central" and " Central "
 * (or "central") are different groups to Excel, so one region silently appears twice. This finds those
 * pairs in the grouping columns of a plan so the person is told before applying, and can clean first.
 */
type Cell = string | number | boolean | null;

const normal = (value: string) =>
  value.replace(/\s+/g, " ").trim().toLocaleLowerCase();

export type NearDuplicates = {
  column: number;
  /** Groups of different spellings that mean the same value, for example [" Central ", "Central"]. */
  groups: string[][];
};

/** Distinct spellings of one value that differ only by spaces or capital letters. */
export function findNearDuplicates(
  rows: readonly Cell[][],
  column: number,
): NearDuplicates | undefined {
  const spellings = new Map<string, Set<string>>();
  for (const row of rows) {
    const cell = row[column];
    if (typeof cell !== "string" || !cell.trim()) continue;
    const key = normal(cell);
    const seen = spellings.get(key) ?? new Set<string>();
    seen.add(cell);
    spellings.set(key, seen);
  }
  const groups = [...spellings.values()]
    .filter((set) => set.size > 1)
    .map((set) => [...set].sort());
  return groups.length ? { column, groups } : undefined;
}

/** Column indexes a plan groups by, from its specs (PivotTable rows/columns, summary group, dashboard category). */
export function groupingColumns(specs: {
  pivot?: { rows?: number; subRows?: number; columns?: number };
  summary?: { group?: number };
  dashboard?: { category?: number };
}): number[] {
  const columns = [
    specs.pivot?.rows,
    specs.pivot?.subRows,
    specs.pivot?.columns,
    specs.summary?.group,
    specs.dashboard?.category,
  ].filter((value): value is number => typeof value === "number");
  return [...new Set(columns)];
}

/** One sentence for the pane, or undefined when every grouping column is consistent. */
export function describeNearDuplicates(
  headers: readonly string[],
  rows: readonly Cell[][],
  specs: Parameters<typeof groupingColumns>[0],
): string | undefined {
  const found = groupingColumns(specs)
    .map((column) => findNearDuplicates(rows, column))
    .filter((item): item is NearDuplicates => item !== undefined);
  if (!found.length) return undefined;
  const parts = found.map((item) => {
    const example = item.groups[0].map((value) => `"${value}"`).join(" and ");
    return `"${headers[item.column]}" has ${item.groups.length} value${item.groups.length === 1 ? "" : "s"} written in more than one way (for example ${example}), so they will appear as separate groups`;
  });
  return `${parts.join("; ")}. Clean the data first (trim extra spaces) to combine them.`;
}

/** The same request with a clean step in front, so grouping steps read the cleaned copy. */
export function cleanFirstInstruction(text: string): string {
  const request = text.trim().replace(/[.!?]+$/, "");
  if (!request) return "";
  if (/^clean\b/i.test(request)) return request;
  return `clean the data, then ${request.charAt(0).toLowerCase()}${request.slice(1)}`;
}
