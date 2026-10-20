/**
 * A request that names a column which is not in the selection ("pivot total Profit by Region" when
 * there is no Profit column) must not quietly turn into a plan on some other column. This finds the
 * capitalised names that follow by / per / of / in / for / where / highlight / sort and checks them
 * against the real headers. Advisory only: the person still sees the preview before anything changes.
 */
const SKIP = new Set([
  "the",
  "this",
  "that",
  "these",
  "those",
  "all",
  "each",
  "every",
  "any",
  "my",
  "our",
  "your",
  "total",
  "sum",
  "average",
  "avg",
  "count",
  "max",
  "min",
  "top",
  "bottom",
  "excel",
  "sheet",
  "workbook",
  "data",
  "table",
  "column",
  "columns",
  "row",
  "rows",
  "a",
  "an",
  "and",
  "or",
  "then",
  "please",
  "it",
  "them",
  "here",
  "there",
  "now",
  "new",
  "old",
  "first",
  "last",
  "next",
  "highest",
  "lowest",
  "largest",
  "smallest",
  "biggest",
  "ascending",
  "descending",
  "blank",
  "empty",
  "name",
]);

const PREPOSITION =
  /\b(?:by|per|of|in|for|where|on|total|sum|average|avg|count|highlight|sort(?:ed)?(?:\s+by)?|group(?:ed)?(?:\s+by)?)\s+((?:[A-Z][\w%()./-]*(?:\s+|$)){1,3})/g;

const norm = (value: string) =>
  value
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
const singular = (word: string) =>
  word.replace(/(?:ies)$/, "y").replace(/s$/, "");

function matchesAHeader(phrase: string, headers: string[]): boolean {
  const wanted = norm(phrase);
  if (!wanted) return true;
  return headers.some((header) => {
    const have = norm(header);
    if (!have) return false;
    return (
      have === wanted ||
      have.includes(wanted) ||
      wanted.includes(have) ||
      singular(have) === singular(wanted)
    );
  });
}

/** Names the request uses that match no header, in the order they appear. */
export function findUnknownColumns(text: string, headers: string[]): string[] {
  const real = headers.map(String).filter(Boolean);
  if (!real.length) return [];
  const unknown: string[] = [];
  for (const match of text.matchAll(PREPOSITION)) {
    const after = text.slice((match.index ?? 0) + match[0].length);
    if (/^\s*(?:sheet|tab|worksheet|workbook)\b/i.test(after)) continue;
    const words = match[1].trim().split(/\s+/);
    // Keep the longest leading run of words that is not a filler word, as a candidate column name.
    while (words.length && SKIP.has(words[0].toLocaleLowerCase()))
      words.shift();
    while (
      words.length &&
      SKIP.has(words[words.length - 1].toLocaleLowerCase())
    )
      words.pop();
    if (!words.length) continue;
    // A phrase is fine if any prefix of it is a header ("Net Amount Region" is "Net Amount" plus a word).
    let ok = false;
    for (let size = words.length; size >= 1 && !ok; size -= 1)
      ok = matchesAHeader(words.slice(0, size).join(" "), real);
    if (!ok) unknown.push(words.join(" "));
  }
  return [...new Set(unknown)];
}

export function describeUnknownColumns(
  unknown: string[],
  headers: string[],
): string | undefined {
  if (!unknown.length) return undefined;
  const real = headers.map(String).filter(Boolean);
  const names = unknown.map((name) => `"${name}"`).join(", ");
  return `I could not find ${unknown.length === 1 ? "a column called" : "columns called"} ${names}. The columns are: ${real.slice(0, 20).join(", ")}${real.length > 20 ? ", ..." : ""}. Check the preview carefully; it may use a different column from the one you meant.`;
}
