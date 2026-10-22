/**
 * Is the built-in reader sure it understood a request? It is not when the request names columns
 * that the reading then ignores ("dashboard ... Circuit ID ... Item Code" read as a dashboard on the
 * first column), when it names none of the columns but still produces a plan that must pick columns
 * itself, or when it recognised nothing at all. In those cases the AI should read the request.
 * Pure and offline: it looks only at the sentence, the column names and the reading.
 */
export interface Reading {
  actions: string[];
  specs: unknown;
  problems?: string[];
}

const WHOLE_TABLE_REQUEST =
  /\b(?:one[- ]page|executive|management|overview|kpi|scorecard|target|board|boss|summary|report|dashboard)\b/i;

const escapeRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Indexes of the columns the sentence names, longest names first so "Item Code" wins over "Item". */
export function mentionedColumns(text: string, headers: string[]): number[] {
  const lower = text.toLocaleLowerCase();
  const found: number[] = [];
  const order = headers
    .map((header, index) => ({ header: String(header ?? "").trim(), index }))
    .filter((entry) => entry.header.length >= 3)
    .sort((a, b) => b.header.length - a.header.length);
  let rest = lower;
  for (const { header, index } of order) {
    const pattern = new RegExp(
      `(^|[^\\p{L}\\p{N}])${escapeRegExp(header.toLocaleLowerCase())}s?(?=$|[^\\p{L}\\p{N}])`,
      "u",
    );
    if (pattern.test(rest)) {
      found.push(index);
      rest = rest.replace(pattern, " ");
    }
  }
  // "itemcode" typed as one word still names "Item Code" (long names only, to avoid chance matches).
  const tokens = new Set(lower.split(/[^\p{L}\p{N}]+/u).filter(Boolean));
  for (const { header, index } of order) {
    const joined = header.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
    if (joined.length >= 6 && !found.includes(index) && tokens.has(joined))
      found.push(index);
  }
  return found.sort((a, b) => a - b);
}

/** Every column index the reading points at, wherever it sits in the specs. */
function usedIndexes(specs: unknown): Set<number> {
  const used = new Set<number>();
  const walk = (value: unknown) => {
    if (typeof value === "number" && Number.isInteger(value) && value >= 0)
      used.add(value);
    else if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === "object")
      Object.values(value).forEach(walk);
  };
  walk(specs);
  return used;
}

/** Why the reading cannot be trusted, or undefined when it can. */
export function weakReading(
  text: string,
  headers: string[],
  reading: Reading,
): string | undefined {
  if (!text.trim()) return undefined;
  if (reading.problems?.length) return undefined; // it already says plainly what is wrong
  if (!reading.actions.length) return "nothing in the request was recognised";
  const named = mentionedColumns(text, headers);
  const specs = reading.specs as Record<string, unknown> | undefined;
  const hasSpecs = specs && Object.keys(specs).length > 0;
  // Only plans that choose columns are judged; clean, quality and similar need no columns.
  const choosesColumns = reading.actions.some((action) =>
    ["dashboard", "chart", "pivot-table", "summary", "view"].includes(action),
  );
  if (!choosesColumns) return undefined;
  const words = text.split(/\s+/).filter(Boolean).length;
  // A long request that names no column at all, read as a plan that must pick columns itself.
  // A dashboard "for management, target 5M" deliberately names no column: the built-in one-page dashboard picks them.
  if (!named.length && words >= 5 && !WHOLE_TABLE_REQUEST.test(text))
    return "none of the words in the request match a column, so the plan would pick its own";
  // Without specs the plan reads the column names from the sentence itself (charts and pivots do), so there is nothing to compare.
  if (!hasSpecs) return undefined;
  const used = usedIndexes(specs);
  const ignored = named.filter((index) => !used.has(index));
  if (ignored.length)
    return `the reading ignores ${ignored.map((index) => `"${headers[index]}"`).join(", ")}`;
  return undefined;
}
