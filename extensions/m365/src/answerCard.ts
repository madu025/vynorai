/**
 * Turns an agent answer into a card: a title, number tiles, a bar list or a small table, warning
 * pills and follow-up questions as chips. The numbers come ONLY from the calculations Excel ran for
 * the answer, never from the model's words: with no such result there is no data card and the
 * caller shows the reply as clamped text (fallbackText). Display only and pure.
 */
import type { AgentMessage } from "./agent.js";

export type CardCell = string | number;

export interface CardResult {
  formula?: string;
  values: CardCell[][];
}

export interface AnswerCardData {
  title: string;
  tiles: { label: string; value: string }[];
  /** `ratio` is value / largest value, 0..1, for the bar width. */
  bars: { label: string; value: string; ratio: number }[];
  table?: { headers: string[]; rows: string[][] };
  pills: { tone: "ok" | "warn"; text: string }[];
  chips: string[];
  /** The answer itself as one visible line when no number can be drawn; the rest stays in `more`. */
  answer?: string;
  /** The rest of the answer text, shown behind "Show more" inside the card. */
  more: string[];
  /** Set when there is nothing to draw: the first bullet only, the rest stays as text. */
  fallbackText?: string;
}

const WARNING =
  /not found|unmatched|error|warning|failed|check needed|#spill|⚠|no match/i;
/** A finding that says nothing is wrong: "No duplicate Order IDs", "0 blank cells". */
const OK_FINDING =
  /^(no|none|zero|0|nothing)\b(?!.*(not found|unmatched|no match))|\bno\s+(duplicate|blank|empty|missing|error|mismatch|issue|problem)/i;
const BULLET = /^\s*[-•*]\s+/;
const MAX_BARS = 12;
const MAX_TABLE_ROWS = 5;
const MAX_TILES = 4;

export function formatNumber(value: number): string {
  return Number.isInteger(value)
    ? value.toLocaleString("en-US")
    : value.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

const isNum = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
const isText = (value: unknown): value is string =>
  typeof value === "string" && value.trim() !== "";
const show = (value: CardCell | null | undefined): string =>
  isNum(value) ? formatNumber(value) : String(value ?? "");

/** The calculation results of one agent run, in order, with personal data put back. */
export function answerResults(
  messages: readonly AgentMessage[],
  restore: (text: string) => string = (text) => text,
): CardResult[] {
  const formulas = new Map<string, string>();
  const results: CardResult[] = [];
  for (const message of messages) {
    if (message.role === "assistant" && message.tool_calls)
      for (const call of message.tool_calls)
        if (call.function.name === "calculate")
          try {
            const args = JSON.parse(call.function.arguments || "{}");
            formulas.set(call.id, restore(String(args.formula ?? "")));
          } catch {
            // A call that cannot be read has no result to show.
          }
    if (message.role === "tool" && formulas.has(message.tool_call_id)) {
      let result: unknown;
      try {
        result = JSON.parse(message.content)?.result;
      } catch {
        continue;
      }
      const grid = toGrid(result);
      if (grid)
        results.push({
          formula: formulas.get(message.tool_call_id),
          values: grid.map((row) =>
            row.map((cell) =>
              isNum(cell) ? cell : restore(String(cell ?? "")),
            ),
          ),
        });
    }
  }
  return results;
}

function toGrid(result: unknown): CardCell[][] | undefined {
  if (isNum(result)) return [[result]];
  if (Array.isArray(result))
    return result.map((row) => (Array.isArray(row) ? row : [row]));
  if (
    result &&
    typeof result === "object" &&
    Array.isArray((result as any).first)
  )
    return toGrid((result as any).first);
  return undefined;
}

const clause = (text: string): string =>
  text
    .replace(BULLET, "")
    .split(/\s[—–-]\s|[;.]\s|\.$/)[0]
    .trim();

const words = (text: string, max: number): string => {
  const list = text.split(/\s+/).filter(Boolean);
  return list.length > max
    ? `${list.slice(0, max).join(" ")}…`
    : list.join(" ");
};

/** Pill text: cut at the first comma, period or dash, parentheses dropped, at most 7 words, no ellipsis. */
export const pillText = (text: string): string => {
  const first = text
    .replace(BULLET, "")
    .replace(/\([^)]*\)?/g, " ")
    .split(/,|;|[.:]\s|\.$|\s[—–-]\s/)[0]
    .trim();
  return first.split(/\s+/).filter(Boolean).slice(0, 7).join(" ");
};

/** "what is the average net amount per order? just tell me" -> "Average net amount per order". */
export function questionPhrase(question: string | undefined): string {
  let q = (question ?? "")
    .split(/[?.!\n]/)[0]
    .replace(/,?\s*(just|please)\b.*$/i, "")
    .replace(
      /^\s*(?:please\s+)?(?:(?:what|which)\s+(?:is|are|was|were)|how\s+(?:much|many)\s+(?:is|are)?|tell me|show me|give me|calculate|find|get)\s+(?:the\s+)?/i,
      "",
    )
    .replace(/\s+/g, " ")
    .trim();
  if (!q || q.split(" ").length > 7) return "";
  return q.charAt(0).toUpperCase() + q.slice(1);
}

const cleanChip = (text: string): string =>
  text.replace(/^\s*(?:[-–—•*]+\s*)+/, "").trim();

const lines = (reply: string): string[] =>
  reply
    .split(/\n/)
    .map((line) => line.trim())
    .filter(Boolean);

/** Real names for the numbers of a one-row result, or undefined when none can be found. */
function tileLabels(
  numbers: number[],
  header: string[] | undefined,
  formula: string | undefined,
  sentences: string[],
): string[] | undefined {
  if (header && header.length === numbers.length) return header;
  if (formula) {
    const literals = [...formula.matchAll(/"([^"]{2,30})"/g)]
      .map((m) => m[1].trim())
      .filter((t) => /[A-Za-z]/.test(t) && !/^not found$/i.test(t));
    if (literals.length === numbers.length) return literals;
  }
  for (const sentence of sentences) {
    const found: string[] = [];
    let at = 0;
    const pattern =
      /(\d[\d,]*(?:\.\d+)?)\s+([A-Za-z][A-Za-z ]{2,30}?)(?=[,;.)(]|\s+and\s|\s*$)/g;
    for (const m of sentence.matchAll(pattern)) {
      if (Number(m[1].replace(/,/g, "")) === numbers[at]) {
        found.push(m[2].trim().replace(/^./, (c) => c.toUpperCase()));
        at += 1;
        if (at === numbers.length) return found;
      }
    }
  }
  return undefined;
}

function fromResult(
  result: CardResult,
  card: AnswerCardData,
  sentences: string[],
  question?: string,
): boolean {
  let rows = result.values.filter((row) => row.length > 0);
  if (!rows.length) return false;
  const header =
    rows.length > 1 &&
    rows[0].every(isText) &&
    rows.slice(1).some((r) => r.some(isNum))
      ? (rows[0] as string[])
      : undefined;
  const data = header ? rows.slice(1) : rows;
  if (!data.length) return false;
  const columns = Math.max(...data.map((row) => row.length));
  if (columns === 1 && data.length === 1 && isNum(data[0][0])) {
    const literal = [...(result.formula ?? "").matchAll(/"([^"]{2,30})"/g)]
      .map((m) => m[1].trim())
      .find((t) => /[A-Za-z]/.test(t) && !/^not found$/i.test(t));
    const label = header?.[0] ?? literal ?? questionPhrase(question);
    // A number with no name (a read-back check) means nothing on a card.
    if (!label) return false;
    card.tiles.push({ label, value: formatNumber(data[0][0] as number) });
    return true;
  }
  if (
    columns === 2 &&
    data.length >= 2 &&
    data.length <= MAX_BARS &&
    data.every((row) => isText(row[0]) && isNum(row[1]))
  ) {
    const values = data.map((row) => row[1] as number);
    const max = Math.max(...values.map(Math.abs)) || 1;
    data.forEach((row, i) =>
      card.bars.push({
        label: String(row[0]),
        value: formatNumber(values[i]),
        ratio: Math.max(0, Math.abs(values[i]) / max),
      }),
    );
    card.tiles.push(
      {
        label: "Total",
        value: formatNumber(values.reduce((a, b) => a + b, 0)),
      },
      { label: "Rows", value: formatNumber(data.length) },
    );
    return true;
  }
  if (
    data.length === 1 &&
    columns >= 2 &&
    columns <= MAX_TILES &&
    data[0].every(isNum)
  ) {
    const names = tileLabels(
      data[0] as number[],
      header,
      result.formula,
      sentences,
    );
    // Without real names the numbers would mean nothing: no tiles, the pills and text carry it.
    if (!names) return false;
    data[0].forEach((cell, i) =>
      card.tiles.push({ label: names[i], value: formatNumber(cell as number) }),
    );
    return true;
  }
  if (columns >= 2) {
    const head =
      header ??
      (data[0].every(isText) && data.length > 1
        ? (data[0] as string[])
        : undefined);
    const body = head && !header ? data.slice(1) : data;
    // Columns without real names ("Column 1, Column 2") are a raw dump, not an answer.
    if (!head) return false;
    card.table = {
      headers: head.map(String),
      rows: body.slice(0, MAX_TABLE_ROWS).map((row) => row.map(show)),
    };
    return true;
  }
  return false;
}

export function buildAnswerCard(input: {
  reply: string;
  results?: readonly CardResult[];
  /** What the person asked: names a lone number when the result has no label. */
  question?: string;
}): AnswerCardData {
  const all = lines(input.reply);
  const card: AnswerCardData = {
    title: "Result",
    tiles: [],
    bars: [],
    pills: [],
    chips: [],
    more: [],
  };
  const plain: string[] = [];
  for (const line of all) {
    const text = line.replace(BULLET, "");
    if (/\?\s*$/.test(text)) card.chips.push(cleanChip(text));
    else if (OK_FINDING.test(text))
      card.pills.push({ tone: "ok", text: pillText(text) });
    else if (WARNING.test(text))
      card.pills.push({ tone: "warn", text: pillText(text) });
    else plain.push(text);
  }
  const first = plain[0];
  let titleFromBullet = false;
  if (first) {
    const head = clause(first);
    // A leaked internal sentence ("The reviewer is right: ...") or a long one is not a title.
    if (
      head &&
      head.split(/\s+/).length <= 7 &&
      !/^(the\s+)?(reviewers?|agents?|team)\b/i.test(head)
    ) {
      card.title = head;
      titleFromBullet = true;
    }
  }
  for (const result of input.results ?? []) {
    if (card.bars.length || card.table) break;
    fromResult(
      result,
      card,
      all.map((l) => l.replace(BULLET, "")),
      input.question,
    );
  }
  card.tiles = card.tiles.slice(0, MAX_TILES);
  card.pills = card.pills.slice(0, 3);
  card.chips = card.chips.slice(0, 2);
  const data = card.bars.length || card.table || card.tiles.length;
  {
    const asked = questionPhrase(input.question);
    if (asked) {
      card.title = asked;
      titleFromBullet = false;
    }
  }
  if (data) card.more = plain.slice(titleFromBullet ? 1 : 0);
  else if (plain.length) {
    // No number to draw: the first bullet is the answer and stays visible, only the rest is folded.
    card.answer = plain[0];
    card.more = plain.slice(1);
  }
  // Without numbers it is still a compact card when there is a title, a finding or a question.
  if (
    !data &&
    card.title === "Result" &&
    !card.pills.length &&
    !card.chips.length
  )
    card.fallbackText = plain[0] ?? all[0] ?? input.reply;
  return card;
}

/** Calculation results kept in memory for the answers of this session, keyed by the reply text. */
const remembered = new Map<string, CardResult[]>();
export function rememberAnswerResults(
  reply: string,
  results: CardResult[],
): void {
  if (!results.length) return;
  remembered.set(reply, results);
  if (remembered.size > 30)
    remembered.delete(remembered.keys().next().value as string);
}
export function recallAnswerResults(reply: string): CardResult[] {
  return remembered.get(reply) ?? [];
}
