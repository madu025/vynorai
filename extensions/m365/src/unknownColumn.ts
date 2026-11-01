/**
 * A request that names a column which is not in the selection ("pivot total Profit by Region" when
 * there is no Profit column) must not quietly turn into a plan on some other column. This finds the
 * capitalised names that follow by / per / of / in / for / where / highlight / sort and checks them
 * against the real headers. Advisory only: the person still sees the preview before anything changes.
 * `checkMissingColumns` (below) is the agent's version, for stored fields such as a phone number.
 */
import type { AgentHost } from "./agent.js";

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

/**
 * The agent path. "Add the customer phone number" when no sheet holds a phone number must end in
 * "that column does not exist", never in a lookup or a placeholder written to some other column.
 * Only fields that are stored, never computed, are named here (a Profit, Total or Margin column can
 * be built from other columns, a phone number cannot), and only in English: a request in another
 * script is left to the model. Conservative by design: a request that names a new column, gives
 * the values, asks for a blank column or says "without" never counts.
 */
interface StoredField {
  label: string;
  /** Finds the field in the request. */
  mention: RegExp;
  /** COUNTIF patterns: any cell on any sheet that matches means the data may exist. */
  patterns: string[];
  /** A header like this may hold the field even without the word ("Contact"). */
  header?: RegExp;
}

const PERSON =
  "(?:customer|client|supplier|vendor|employee|staff|member|user|student|patient|contact|buyer|seller|owner|person|their|his|her|its)(?:'?s)?";

const STORED_FIELDS: StoredField[] = [
  {
    label: "phone number",
    mention: new RegExp(
      `\\b(?:(?:tele)?phones?(?:\\s+(?:numbers?|nos?\\.?))?|whatsapp(?:\\s+numbers?)?|(?:mobile|cell)\\s+(?:numbers?|nos?\\.?|phones?)|${PERSON}\\s+(?:mobile|cell)|contact\\s+(?:numbers?|nos?\\.?))\\b`,
      "gi",
    ),
    patterns: ["*phone*", "*mobile*", "*whatsapp*"],
    header: /^(?:contact(?:\s+(?:no|number|details|info))?|cell|tel|mob)\.?$/i,
  },
  {
    label: "email address",
    mention: /\be-?mails?(?:\s+address(?:es)?)?\b/gi,
    patterns: ["*mail*", "*@*"],
    header: /^contact(?:\s+(?:details|info))?$/i,
  },
  {
    label: "postal address",
    mention: new RegExp(
      `\\b(?:(?:postal|street|home|billing|shipping|delivery|mailing)\\s+address(?:es)?|${PERSON}\\s+address(?:es)?)\\b`,
      "gi",
    ),
    patterns: ["*address*", "*street*"],
  },
  {
    label: "date of birth",
    mention: /\b(?:dates?\s+of\s+birth|birth\s*dates?|birthdays?|dob)\b/gi,
    patterns: ["*birth*", "*dob*"],
  },
];

/** Words that mean the person names, fills or supplies the column themselves. */
const CREATES =
  /\b(?:called|named|titled|label(?:l)?ed|headed|blank|empty|placeholder|template|form|manually|type\s+in|fill\s+in|to\s+fill|enter(?:ed)?|input)\b|=|@|\d{5,}/i;
const NOT_WANTED =
  /\b(?:without|no|not|except|excluding|exclude|hide|remove|drop|delete|minus|ignore|skip|instead\s+of)\b(?:\s+\S+){0,3}\s*$/i;
const AS_A_NEW_COLUMN = /^\s*(?:columns?|cols?|fields?|headers?|headings?)\b/i;
const NON_LATIN_LETTER = /(?=\p{L})\P{Script=Latin}/u;

/** Stored fields the request asks to bring in, as { label, phrase }. Pure: no workbook needed. */
export function findStoredFieldRequests(
  request: string,
): { label: string; phrase: string }[] {
  const text = String(request ?? "");
  if (!text.trim() || text.trimStart().startsWith("[Report from the add-in"))
    return [];
  if (NON_LATIN_LETTER.test(text) || CREATES.test(text)) return [];
  const found: { label: string; phrase: string }[] = [];
  for (const field of STORED_FIELDS) {
    for (const match of text.matchAll(field.mention)) {
      const start = match.index ?? 0;
      const before = text.slice(0, start);
      const after = text.slice(start + match[0].length);
      if (NOT_WANTED.test(before) || AS_A_NEW_COLUMN.test(after)) continue;
      // Quoted text is a name the person chose ("add a column 'Phone'").
      if (/["'‘“]\s*$/.test(before) && /^\s*["'’”]/.test(after)) continue;
      found.push({ label: field.label, phrase: match[0] });
      break;
    }
  }
  return found;
}

const MISSING_MAX_SHEETS = 20;
const HEADER_MAX_COLUMNS = 200;

const scalarNumber = (value: unknown): number | undefined => {
  const cell = Array.isArray(value) ? (value as unknown[][])[0]?.[0] : value;
  return typeof cell === "number" && Number.isFinite(cell) ? cell : undefined;
};

const quoteSheet = (name: string) => `'${name.replace(/'/g, "''")}'`;

/** The first row of a used range ("B3:K40" gives "B3:K3"), or undefined when it is too wide. */
function firstRow(usedRange: string): string | undefined {
  const m = /^\$?([A-Z]{1,3})\$?(\d+)(?::\$?([A-Z]{1,3})\$?\d+)?$/.exec(
    usedRange.trim(),
  );
  if (!m) return undefined;
  const index = (letters: string) =>
    [...letters].reduce((sum, ch) => sum * 26 + ch.charCodeAt(0) - 64, 0);
  const end = m[3] ?? m[1];
  if (index(end) - index(m[1]) + 1 > HEADER_MAX_COLUMNS) return undefined;
  return `${m[1]}${m[2]}:${end}${m[2]}`;
}

/** Real headers that share a word with the request, best first; else the first headers seen. */
function closestHeaders(
  request: string,
  headers: { sheet: string; name: string }[],
): string[] {
  const words = new Set(
    norm(request)
      .split(" ")
      .filter((word) => word.length > 2 && !SKIP.has(word))
      .map(singular),
  );
  const scored = headers
    .map((header) => ({
      ...header,
      score: norm(header.name)
        .split(" ")
        .filter((word) => words.has(singular(word))).length,
    }))
    .filter((header) => header.score > 0)
    .sort((a, b) => b.score - a.score);
  const pick = (scored.length ? scored : headers).slice(0, 6);
  return pick.map((header) => `${header.name} ('${header.sheet}')`);
}

/**
 * Before the reviewers: when the request asks for a stored field that no sheet holds (no header and
 * no cell anywhere mentions it) and the builder staged changes anyway, the builder is sent back to
 * stage nothing for it and say so. A read that fails, a sheet it cannot see whole, or a workbook
 * with too many sheets means "maybe it exists", so the check stays quiet.
 */
export async function checkMissingColumns(
  request: string,
  changes: readonly unknown[],
  host: Pick<AgentHost, "getWorkbook" | "readRange" | "calculate">,
): Promise<{ issues: string[]; reply?: string }> {
  const quiet = { issues: [] };
  if (!changes.length) return quiet;
  const wanted = findStoredFieldRequests(request);
  if (!wanted.length) return quiet;
  try {
    const workbook = (await host.getWorkbook()) as
      | {
          sheets?: { name?: unknown; usedRange?: unknown }[];
          tables?: unknown[];
        }
      | undefined;
    const sheets = Array.isArray(workbook?.sheets) ? workbook.sheets : [];
    if (!sheets.length || sheets.length > MISSING_MAX_SHEETS) return quiet;
    const headers: { sheet: string; name: string }[] = [];
    const ranges: string[] = [];
    for (const sheet of sheets) {
      const name = String(sheet.name ?? "");
      if (!name) return quiet;
      // An empty sheet says null; a host that does not say where the data is cannot be checked.
      if (sheet.usedRange === null) continue;
      if (typeof sheet.usedRange !== "string") return quiet;
      const row = firstRow(sheet.usedRange);
      if (!row) return quiet;
      const read = await host.readRange(name, row, false);
      for (const cell of read.values[0] ?? []) {
        const header = String(cell ?? "").trim();
        if (header) headers.push({ sheet: name, name: header });
      }
      ranges.push(`${quoteSheet(name)}!${sheet.usedRange}`);
    }
    if (!headers.length) return quiet;
    const names = [
      ...sheets.map((sheet) => String(sheet.name ?? "")),
      ...(Array.isArray(workbook?.tables) ? workbook.tables : []).map(String),
      ...headers.map((header) => header.name),
    ];
    const missing: { label: string; phrase: string }[] = [];
    for (const field of wanted) {
      const spec = STORED_FIELDS.find((item) => item.label === field.label)!;
      const words = spec.patterns.map((pattern) =>
        pattern.replace(/\*/g, "").toLowerCase(),
      );
      if (
        names.some(
          (name) =>
            words.some((word) => name.toLowerCase().includes(word)) ||
            spec.header?.test(name.trim()),
        )
      )
        continue;
      // Any cell that mentions the field (a "Phone Cases" category, a note) means it may be there.
      let seen = 0;
      for (const range of ranges) {
        const count = scalarNumber(
          await host.calculate(
            `=SUM(COUNTIF(${range},{${spec.patterns.map((p) => `"${p}"`).join(",")}}))`,
          ),
        );
        if (count === undefined) return quiet;
        seen += count;
        if (seen) break;
      }
      if (!seen) missing.push(field);
    }
    if (!missing.length) return quiet;
    const closest = closestHeaders(request, headers);
    const labels = missing.map((field) => field.label).join(" and ");
    const issues = missing.map(
      (field) =>
        `MISSING COLUMN: the request asks for the ${field.label} ("${field.phrase}"), but no sheet in this workbook has a ${field.label} column or any ${field.label} values (every sheet was checked). The closest real headers are: ${closest.join(", ")}. Do not write a lookup, a guess, a placeholder or an empty column for it: remove every staged change for the ${field.label} and keep only changes for other parts of the request (if none remain, stage nothing). In the reply, say plainly that the workbook has no ${field.label} column, name the closest headers above, and ask where the ${field.label} data is.`,
    );
    const reply = `- No sheet in this workbook has a ${labels} column, so nothing was staged for it. The closest columns are: ${closest.join(", ")}. Which sheet holds the ${labels}?`;
    return { issues, reply };
  } catch {
    // A check that cannot run never blocks the plan.
    return quiet;
  }
}
