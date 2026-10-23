/**
 * Turns an agent answer into a card: a title, number tiles, a bar list or a small table, warning
 * pills and follow-up questions as chips. The numbers come from the calculations Excel ran for the
 * answer (never from the model's words) and, when there are none, from "Label 1,234" pairs in the
 * reply. Display only and pure: nothing here writes to the workbook.
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
  /** Set when there is nothing to draw: the first bullet only, the rest stays as text. */
  fallbackText?: string;
}

const WARNING =
  /not found|unmatched|error|warning|failed|check needed|#spill|⚠|no match/i;
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

const lines = (reply: string): string[] =>
  reply
    .split(/\n/)
    .map((line) => line.trim())
    .filter(Boolean);

/** "Central 8,620,425.00, Western 8,612,825.00" -> label/number pairs, when there are at least 3. */
function pairsFrom(text: string): { label: string; value: number }[] {
  const pairs: { label: string; value: number }[] = [];
  const pattern =
    /([A-Za-z][A-Za-z .\/&-]{0,24}?)\s+(-?\d[\d,]*(?:\.\d+)?)(?=\s*[,;)]|\s*$)/g;
  for (let m = pattern.exec(text); m; m = pattern.exec(text)) {
    const value = Number(m[2].replace(/,/g, ""));
    if (Number.isFinite(value)) pairs.push({ label: m[1].trim(), value });
  }
  return pairs;
}

function fromResult(result: CardResult, card: AnswerCardData): boolean {
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
    card.tiles.push({
      label: header?.[0] ?? "Result",
      value: formatNumber(data[0][0] as number),
    });
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
    data[0].forEach((cell, i) =>
      card.tiles.push({
        label: header?.[i] ?? `Value ${i + 1}`,
        value: formatNumber(cell as number),
      }),
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
    card.table = {
      headers: (head ?? data[0].map((_, i) => `Column ${i + 1}`)).map(String),
      rows: body.slice(0, MAX_TABLE_ROWS).map((row) => row.map(show)),
    };
    return true;
  }
  return false;
}

export function buildAnswerCard(input: {
  reply: string;
  results?: readonly CardResult[];
}): AnswerCardData {
  const all = lines(input.reply);
  const card: AnswerCardData = {
    title: "Result",
    tiles: [],
    bars: [],
    pills: [],
    chips: [],
  };
  const plain: string[] = [];
  for (const line of all) {
    const text = line.replace(BULLET, "");
    if (/\?\s*$/.test(text)) card.chips.push(text);
    else if (WARNING.test(text))
      card.pills.push({ tone: "warn", text: words(clause(text), 8) });
    else plain.push(text);
  }
  const first = plain[0];
  if (first) {
    const title = words(clause(first), 7);
    if (title) card.title = title;
  }
  for (const result of input.results ?? []) {
    if (card.bars.length || card.table) break;
    fromResult(result, card);
  }
  if (!card.bars.length && !card.table && !card.tiles.length) {
    const bullet = plain.find((text) => pairsFrom(text).length >= 3);
    const pairs = bullet ? pairsFrom(bullet).slice(0, MAX_BARS) : [];
    if (pairs.length >= 3) {
      const max = Math.max(...pairs.map((p) => Math.abs(p.value))) || 1;
      for (const p of pairs)
        card.bars.push({
          label: p.label,
          value: formatNumber(p.value),
          ratio: Math.abs(p.value) / max,
        });
      card.tiles.push(
        {
          label: "Total",
          value: formatNumber(pairs.reduce((a, p) => a + p.value, 0)),
        },
        { label: "Rows", value: formatNumber(pairs.length) },
      );
    }
  }
  card.tiles = card.tiles.slice(0, MAX_TILES);
  card.pills = card.pills.slice(0, 3);
  card.chips = card.chips.slice(0, 2);
  if (!card.bars.length && !card.table && !card.tiles.length)
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
