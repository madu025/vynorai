/**
 * The agent's `map_relationships` tool: finds which columns of several sheets or tables join, by
 * comparing header names and the values themselves on the device, and says how they join (one to
 * many, rows with no partner, duplicate keys, keys spelled differently). Read-only and pure:
 * `agent.ts` reads the ranges and calls `mapRelationships`. The model gets counts, never rows.
 */
import { AgentToolError } from "./agent.js";

export type KeyCell = string | number | boolean | null | undefined;

export interface RelationTable {
  /** Label the model uses to point at the table, "Sheet!A1:F900". */
  label: string;
  headers: string[];
  rows: KeyCell[][];
}

export type Cardinality =
  | "one-to-one"
  | "one-to-many"
  | "many-to-one"
  | "many-to-many";

export interface RelationLink {
  from: {
    table: string;
    column: string;
    distinct: number;
    duplicateKeys: number;
  };
  to: {
    table: string;
    column: string;
    distinct: number;
    duplicateKeys: number;
  };
  cardinality: Cardinality;
  /** Share of the `from` rows whose key exists in `to` (0..1). */
  fromRowsMatched: number;
  /** `from` rows whose key has no partner in `to`. */
  fromRowsWithoutPartner: number;
  /** Share of `to` keys that appear in `from`. */
  toKeysUsed: number;
  nameMatch: boolean;
  /** Matches that exist only after trimming, lower-casing or dropping leading zeros. */
  needsCleaning: boolean;
  advice: string[];
}

/** Keep the relationship scan bounded while supporting the supported ten-sheet analyst fixture. */
export const RELATION_MAX_TABLES = 10;
export const RELATION_MAX_ROWS = 20_000;
const MAX_LINKS = 24;
const MIN_SHARED = 2;
const MIN_OVERLAP = 0.5;

const exactKey = (value: KeyCell): string =>
  value === null || value === undefined ? "" : String(value);
const looseKey = (value: KeyCell): string =>
  exactKey(value)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/^0+(?=\d)/, "");
const nameKey = (header: string): string =>
  header.toLowerCase().replace(/[^a-z0-9]+/g, "");

/** Columns that are plainly measures (amounts, dates) are not join keys. */
function looksLikeKey(values: KeyCell[], header: string): boolean {
  const present = values.filter((v) => exactKey(v).trim() !== "");
  if (present.length < MIN_SHARED) return false;
  const fractional = present.filter(
    (v) => typeof v === "number" && !Number.isInteger(v),
  ).length;
  if (fractional / present.length > 0.2) return false;
  if (
    /amount|total|price|cost|qty|quantity|revenue|salary|balance|rate|percent|%/i.test(
      header,
    )
  )
    return false;
  return true;
}

interface Profile {
  table: RelationTable;
  index: number;
  header: string;
  counts: Map<string, number>;
  loose: Map<string, number>;
  rows: number;
}

function profile(table: RelationTable): Profile[] {
  const out: Profile[] = [];
  table.headers.forEach((header, index) => {
    const values = table.rows.map((row) => row[index]);
    if (!header.trim() || !looksLikeKey(values, header)) return;
    const counts = new Map<string, number>();
    const loose = new Map<string, number>();
    let rows = 0;
    for (const value of values) {
      const key = exactKey(value);
      if (key.trim() === "") continue;
      rows += 1;
      counts.set(key, (counts.get(key) ?? 0) + 1);
      const l = looseKey(value);
      loose.set(l, (loose.get(l) ?? 0) + 1);
    }
    out.push({ table, index, header, counts, loose, rows });
  });
  return out;
}

const duplicates = (counts: Map<string, number>): number =>
  [...counts.values()].filter((n) => n > 1).length;

function cardinality(fromDup: number, toDup: number): Cardinality {
  if (fromDup === 0 && toDup === 0) return "one-to-one";
  if (fromDup > 0 && toDup === 0) return "many-to-one";
  if (fromDup === 0) return "one-to-many";
  return "many-to-many";
}

function shared(a: Map<string, number>, b: Map<string, number>): number {
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let n = 0;
  for (const key of small.keys()) if (large.has(key)) n += 1;
  return n;
}

function linkFor(a: Profile, b: Profile): RelationLink | undefined {
  const exactShared = shared(a.counts, b.counts);
  const looseShared = shared(a.loose, b.loose);
  const best = Math.max(exactShared, looseShared);
  const smaller = Math.min(
    looseShared > exactShared ? a.loose.size : a.counts.size,
    looseShared > exactShared ? b.loose.size : b.counts.size,
  );
  if (best < MIN_SHARED || smaller === 0 || best / smaller < MIN_OVERLAP)
    return undefined;
  const useLoose = looseShared > exactShared;
  const nameMatch = nameKey(a.header) === nameKey(b.header);
  const ca = useLoose ? a.loose : a.counts;
  const cb = useLoose ? b.loose : b.counts;
  // A key side is the one without repeats; start from the side that repeats (the "many" side).
  let from = a;
  let to = b;
  let fromCounts = ca;
  let toCounts = cb;
  if (duplicates(ca) < duplicates(cb)) {
    from = b;
    to = a;
    fromCounts = cb;
    toCounts = ca;
  }
  const fromDup = duplicates(fromCounts);
  const toDup = duplicates(toCounts);
  // Two repeated categories (Region against Region) are a grouping, not a join key.
  if (fromDup > 0 && toDup > 0 && !nameMatch) return undefined;
  let matchedRows = 0;
  for (const [key, n] of fromCounts) if (toCounts.has(key)) matchedRows += n;
  const withoutPartner = from.rows - matchedRows;
  const advice: string[] = [];
  const cardinalityValue = cardinality(fromDup, toDup);
  if (cardinalityValue === "many-to-many")
    advice.push(
      "Both sides repeat this value, so it is not a key: a lookup would return only the first match.",
    );
  if (toDup > 0 && cardinalityValue !== "many-to-many")
    advice.push(
      `${toDup} value(s) repeat in ${to.table.label} column ${to.header}: a lookup returns only the first match.`,
    );
  if (withoutPartner > 0)
    advice.push(
      `${withoutPartner} row(s) of ${from.table.label} have no partner in ${to.table.label}: say so, or list them.`,
    );
  if (useLoose && looseShared > exactShared)
    advice.push(
      "The keys match only after trimming, ignoring case or dropping leading zeros: clean them before joining.",
    );
  return {
    from: {
      table: from.table.label,
      column: from.header,
      distinct: fromCounts.size,
      duplicateKeys: fromDup,
    },
    to: {
      table: to.table.label,
      column: to.header,
      distinct: toCounts.size,
      duplicateKeys: toDup,
    },
    cardinality: cardinalityValue,
    fromRowsMatched: from.rows
      ? Math.round((matchedRows / from.rows) * 1000) / 1000
      : 0,
    fromRowsWithoutPartner: withoutPartner,
    toKeysUsed: toCounts.size
      ? Math.round((shared(fromCounts, toCounts) / toCounts.size) * 1000) / 1000
      : 0,
    nameMatch,
    needsCleaning: useLoose && looseShared > exactShared,
    advice,
  };
}

export function mapRelationships(tables: RelationTable[]): {
  links: RelationLink[];
  tables: { table: string; rows: number; columns: string[] }[];
  note?: string;
} {
  if (tables.length < 2)
    throw new AgentToolError(
      "Give at least two ranges, each with its header row.",
    );
  if (tables.length > RELATION_MAX_TABLES)
    throw new AgentToolError(`Give at most ${RELATION_MAX_TABLES} ranges.`);
  const profiles = tables.map(profile);
  const links: RelationLink[] = [];
  for (let i = 0; i < profiles.length; i += 1)
    for (let j = i + 1; j < profiles.length; j += 1)
      for (const a of profiles[i])
        for (const b of profiles[j]) {
          const link = linkFor(a, b);
          if (link) links.push(link);
        }
  // Best link per pair of columns first: matching names, then the most rows matched.
  links.sort(
    (x, y) =>
      Number(y.nameMatch) - Number(x.nameMatch) ||
      y.fromRowsMatched - x.fromRowsMatched ||
      x.from.duplicateKeys +
        x.to.duplicateKeys -
        (y.from.duplicateKeys + y.to.duplicateKeys),
  );
  const kept = links.slice(0, MAX_LINKS);
  const note =
    links.length > MAX_LINKS
      ? `Found ${links.length} candidate relationships; showing the ${MAX_LINKS} strongest matches. Ask for a specific pair to inspect the remaining candidates.`
      : undefined;
  return {
    links: kept,
    tables: tables.map((table) => ({
      table: table.label,
      rows: table.rows.length,
      columns: table.headers,
    })),
    ...(kept.length === 0
      ? {
          note: "No shared key was found. Ask the person which columns relate; do not guess a join.",
        }
      : note
        ? { note }
        : {}),
  };
}
