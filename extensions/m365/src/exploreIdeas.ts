/**
 * Explore tab, data side. Part A: counts read from a small sample of the selection on the device
 * (distinct values, blanks, sums) choose the measure and the grouping columns, so "Net Amount"
 * wins over "Unit Price" and an identifier never becomes a category. Part B: the optional "More
 * ideas" request, which sends only column names, roles and these counts (never a cell value) to the
 * agent after the person agreed, and the reader of its reply. Pure.
 */
import { isMoneyHeader } from "./businessContext.js";

export interface ColumnStat {
  rows: number;
  blanks: number;
  distinct: number;
  /** Numbers in the column, and how many of them have decimals. */
  numeric: number;
  fractional: number;
  /** Sum of absolute values of the numbers. */
  sum: number;
}

export type ExploreStats = Record<string, ColumnStat>;

/** Counts per column from a sample of rows; keyed by the trimmed header (first one wins). */
export function columnStats(headers: string[], rows: unknown[][]): ExploreStats {
  // No prototype: a header named "constructor" or "__proto__" is a column, not an inherited member.
  const out: ExploreStats = Object.create(null);
  headers.forEach((header, index) => {
    const name = String(header ?? "").trim();
    if (!name || out[name]) return;
    const seen = new Set<string>();
    const stat: ColumnStat = { rows: 0, blanks: 0, distinct: 0, numeric: 0, fractional: 0, sum: 0 };
    for (const row of rows) {
      const value = row[index];
      stat.rows += 1;
      if (value === null || value === undefined || String(value).trim() === "") {
        stat.blanks += 1;
        continue;
      }
      seen.add(String(value).trim().toLowerCase());
      if (typeof value === "number" && Number.isFinite(value)) {
        stat.numeric += 1;
        stat.sum += Math.abs(value);
        if (!Number.isInteger(value)) stat.fractional += 1;
      }
    }
    stat.distinct = seen.size;
    out[name] = stat;
  });
  return out;
}

/** A per-unit figure cannot be added up, so it is a poor "total" column. */
const PER_UNIT = /unit|price|rate|percent|%|margin|ratio|avg|average/i;
const TOTAL_LIKE = /net|total|amount|revenue|sales|value|cost|spend/i;

/** Best first: money-like totals over per-unit prices; with counts, bigger sums win. */
export function rankMeasures(names: string[], stats?: ExploreStats): string[] {
  const score = (name: string) => {
    let value = 0;
    if (isMoneyHeader(name)) value += 3;
    if (TOTAL_LIKE.test(name)) value += 2;
    if (PER_UNIT.test(name)) value -= 3;
    const stat = stats?.[name];
    if (stat && stat.numeric > 0) {
      value += Math.min(2, Math.log10(stat.sum + 1) / 4);
      if (stat.numeric / Math.max(1, stat.rows - stat.blanks) < 0.8) value -= 2;
    }
    return value;
  };
  return names
    .map((name, index) => ({ name, index, value: score(name) }))
    .sort((a, b) => b.value - a.value || a.index - b.index)
    .map((entry) => entry.name);
}

/** Best first: a column with a handful of repeating values groups well; an identifier does not. */
export function rankCategories(names: string[], stats?: ExploreStats): string[] {
  const score = (name: string) => {
    const stat = stats?.[name];
    if (!stat || stat.rows - stat.blanks < 4) return 0;
    const filled = stat.rows - stat.blanks;
    if (stat.distinct < 2) return -5;
    if (stat.distinct > Math.max(30, filled * 0.6)) return -3;
    return stat.distinct <= 15 ? 2 : 1;
  };
  return names
    .map((name, index) => ({ name, index, value: score(name) }))
    .sort((a, b) => b.value - a.value || a.index - b.index)
    .filter((entry) => entry.value > -3 || names.length === 1)
    .map((entry) => entry.name);
}

export const IDEAS_MAX = 4;

/** What goes to the agent: names, roles and counts only. Asks for plain request sentences. */
export function ideasRequest(
  columns: { name: string; role: string }[],
  stats?: ExploreStats,
): string {
  const lines = columns.slice(0, 30).map((column) => {
    const stat = stats?.[column.name.trim()];
    const facts = stat
      ? ` (${stat.distinct} different values, ${stat.blanks} blank of ${stat.rows}${stat.numeric ? `, total ${Math.round(stat.sum)}` : ""})`
      : "";
    return `- ${column.name} [${column.role}]${facts}`;
  });
  return [
    "Suggest up to 4 useful things to do with this selected data. Use only the column summary below; do not read the sheet and do not use any tool.",
    "Each idea is one short request sentence the person could send to you next (for example a summary, a chart, a clean-up or a question), using the exact column names.",
    `Reply with one idea per line, each starting with "- ", and nothing else.`,
    "Columns:",
    ...lines,
  ].join("\n");
}

/** The ideas in the agent's reply: short plain sentences, at most four, never a formula or a link. */
export function parseIdeas(reply: string): string[] {
  const out: string[] = [];
  for (const line of String(reply ?? "").split("\n")) {
    const match = /^\s*(?:[-*•]|\d+[.)])\s+(.+)$/.exec(line);
    if (!match) continue;
    const text = match[1].replace(/[*_`]/g, "").trim();
    if (text.length < 8 || text.length > 160) continue;
    if (/^[=+@]|https?:|www\./i.test(text) || /[\u0000-\u001f]/.test(text)) continue;
    if (out.some((idea) => idea.toLowerCase() === text.toLowerCase())) continue;
    out.push(text);
    if (out.length === IDEAS_MAX) break;
  }
  return out;
}
