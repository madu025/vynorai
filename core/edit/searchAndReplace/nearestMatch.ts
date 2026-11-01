/**
 * Read-only helper for the "string not found" edit error: finds the block of
 * the file that looks most like the model's old_string, so the error can show
 * it and the model can fix old_string in one step. It never edits anything.
 *
 * Cost is bounded: files over MAX_FILE_LINES / MAX_FILE_CHARS are skipped and
 * at most MAX_SEARCH_LINES lines of old_string are compared (one cheap
 * bigram similarity per old line per file line).
 */

const MAX_FILE_LINES = 5000;
const MAX_FILE_CHARS = 500_000;
const MAX_SEARCH_LINES = 40;
const MIN_SCORE = 0.6;
const CONTEXT_LINES = 2;
const MAX_SHOWN_MATCH_LINES = 10;
const MAX_SHOWN_LINE_CHARS = 200;

export const MAX_ECHOED_OLD_STRING_CHARS = 300;

export interface NearestMatch {
  /** 1-based first line of the best matching block */
  startLine: number;
  /** 1-based last line of the best matching block */
  endLine: number;
  /** Average line similarity, 0 to 1 */
  score: number;
  /** Numbered lines (match plus a little context), ready to print */
  snippet: string;
}

type Grams = { map: Map<string, number>; n: number };

function normalize(line: string): string {
  return line.replace(/\s+/g, " ").trim().toLowerCase();
}

function bigrams(s: string): Grams {
  const map = new Map<string, number>();
  let n = 0;
  if (s.length === 1) {
    map.set(s, 1);
    n = 1;
  }
  for (let i = 0; i < s.length - 1; i++) {
    const g = s.slice(i, i + 2);
    map.set(g, (map.get(g) ?? 0) + 1);
    n++;
  }
  return { map, n };
}

function dice(a: Grams, b: Grams): number {
  if (a.n === 0 || b.n === 0) return 0;
  let shared = 0;
  const [small, large] = a.map.size <= b.map.size ? [a, b] : [b, a];
  for (const [g, count] of small.map) {
    const other = large.map.get(g);
    if (other) shared += Math.min(count, other);
  }
  return (2 * shared) / (a.n + b.n);
}

export function truncateForEcho(
  text: string,
  max = MAX_ECHOED_OLD_STRING_CHARS,
): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}... [truncated, ${text.length - max} more characters]`;
}

export function findNearestMatch(
  fileContent: string,
  oldString: string,
): NearestMatch | null {
  if (fileContent.length > MAX_FILE_CHARS) return null;
  const fileLines = fileContent.split("\n");
  if (fileLines.length > MAX_FILE_LINES) return null;

  const searchLines = oldString.split("\n").slice(0, MAX_SEARCH_LINES);
  // Only non-blank lines carry signal; keep their offset inside the block.
  const probes: { offset: number; grams: Grams }[] = [];
  searchLines.forEach((line, offset) => {
    const norm = normalize(line);
    if (norm.length < 3) return;
    probes.push({ offset, grams: bigrams(norm) });
  });
  if (probes.length === 0) return null;

  const fileGrams = fileLines.map((line) => bigrams(normalize(line)));

  let bestStart = -1;
  let bestScore = 0;
  for (let start = 0; start < fileLines.length; start++) {
    let sum = 0;
    for (const p of probes) {
      const f = fileGrams[start + p.offset];
      if (f) sum += dice(p.grams, f);
    }
    const score = sum / probes.length;
    if (score > bestScore) {
      bestScore = score;
      bestStart = start;
    }
  }
  if (bestStart < 0 || bestScore < MIN_SCORE) return null;

  const matchEnd = Math.min(fileLines.length, bestStart + searchLines.length);
  const shownMatchEnd = Math.min(matchEnd, bestStart + MAX_SHOWN_MATCH_LINES);
  const from = Math.max(0, bestStart - CONTEXT_LINES);
  const to = Math.min(fileLines.length, shownMatchEnd + CONTEXT_LINES);
  const snippet = fileLines
    .slice(from, to)
    .map((line, i) => {
      const shown =
        line.length > MAX_SHOWN_LINE_CHARS
          ? `${line.slice(0, MAX_SHOWN_LINE_CHARS)}...`
          : line;
      return `${from + i + 1}: ${shown}`;
    })
    .join("\n");

  return {
    startLine: bestStart + 1,
    endLine: matchEnd,
    score: bestScore,
    snippet,
  };
}
