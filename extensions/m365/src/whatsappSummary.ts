/**
 * WhatsApp-ready summary (pure): the headline numbers of a report sheet as a short message the
 * person copies into WhatsApp or Viber. It is built from the values the pane already read for the
 * e-mail report, on the device, and nothing is sent: the person pastes it themselves.
 */
import { isMoneyHeader } from "./businessContext.js";
import { shortAmount, type NumberStyle } from "./sriLanka.js";

type Cell = string | number | boolean | null | undefined;

export interface WhatsAppSummaryOptions {
  sheet: string;
  /** Currency symbol for money figures, for example "Rs". */
  symbol?: string;
  style?: NumberStyle;
  /** Date shown under the title. */
  date?: Date;
}

export const WHATSAPP_MAX = 1000;

const isText = (cell: Cell): cell is string =>
  typeof cell === "string" && cell.trim() !== "";
const isNumber = (cell: Cell): cell is number =>
  typeof cell === "number" && Number.isFinite(cell);
/** KPI labels are written in capitals by the dashboard: "TOTAL SALES", "% OF TARGET". */
const isLabel = (cell: Cell) =>
  isText(cell) && /[A-Z]/.test(cell) && !/[a-z]/.test(cell) && cell.length <= 60;

/** WhatsApp formatting characters in cell text would change the message; they are removed. */
const clean = (text: string) => text.replace(/[*_~`]/g, "").replace(/\s+/g, " ").trim();

function figure(label: string, value: Cell, options: WhatsAppSummaryOptions): string {
  if (!isNumber(value)) return clean(String(value ?? ""));
  if (/%/.test(label))
    return `${(value * 100).toLocaleString("en-US", { maximumFractionDigits: 1 })}%`;
  if (/^(RECORDS|COUNT\b)/i.test(label)) return value.toLocaleString("en-US");
  const amount = shortAmount(value, options.style);
  return options.symbol && isMoneyHeader(label) ? `${options.symbol} ${amount}` : amount;
}

const titleCase = (label: string) =>
  clean(label)
    .toLowerCase()
    .replace(/(^|\s)([a-z])/g, (_, space: string, letter: string) => space + letter.toUpperCase())
    .replace(/\bOf\b/g, "of")
    .replace(/\bTo\b/g, "to");

/** KPI cards: a row of capital labels with a value under each. */
function findCards(values: Cell[][]): { row: number; cards: Array<[string, Cell]> } | undefined {
  for (let r = 0; r < Math.min(values.length - 1, 12); r += 1) {
    const cards: Array<[string, Cell]> = [];
    values[r].forEach((cell, c) => {
      const below = values[r + 1]?.[c];
      if (isLabel(cell) && (isNumber(below) || isText(below)))
        cards.push([cell as string, below]);
    });
    if (cards.length >= 2) return { row: r, cards };
  }
  return undefined;
}

/** A breakdown: a header row, then rows of (name, number) up to a blank or a total row. */
function findBreakdown(values: Cell[][], from: number) {
  for (let r = from; r < values.length - 2; r += 1) {
    for (let c = 0; c < Math.min(values[r].length - 1, 20); c += 1) {
      const header = values[r];
      if (!isText(header[c]) || !isText(header[c + 1])) continue;
      const lines: Array<[string, number]> = [];
      for (let k = r + 1; k < values.length; k += 1) {
        const name = values[k][c];
        const value = values[k][c + 1];
        if (!isText(name) || !isNumber(value)) break;
        if (/^(grand\s+)?total$/i.test(name.trim())) break;
        lines.push([name, value]);
      }
      if (lines.length >= 2)
        return { row: r, name: String(header[c]), measure: String(header[c + 1]), lines };
    }
  }
  return undefined;
}

export function whatsappSummary(values: Cell[][], options: WhatsAppSummaryOptions): string {
  const rows = values.map((row) => (Array.isArray(row) ? row : []));
  const cards = findCards(rows);
  const breakdown = findBreakdown(rows, cards ? cards.row + 2 : 0);
  // A sheet that starts with its table header has no title row: the sheet name is the title.
  const title = clean(
    String(breakdown?.row === 0 ? options.sheet : (rows[0]?.find(isText) ?? options.sheet)),
  );
  const date = options.date ?? new Date();
  const lines = [
    `*${title}*`,
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`,
    "",
  ];
  if (cards)
    for (const [label, value] of cards.cards)
      lines.push(`${titleCase(label)}: *${figure(label, value, options)}*`);
  if (breakdown) {
    if (lines[lines.length - 1] !== "") lines.push("");
    lines.push(`Top ${clean(breakdown.name)} by ${clean(breakdown.measure)}:`);
    [...breakdown.lines]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .forEach(([name, value], index) =>
      lines.push(`${index + 1}. ${clean(name)}: ${figure(breakdown.measure, value, options)}`),
    );
  }
  if (!cards && !breakdown) {
    // Not a dashboard: the first label-value pairs on the sheet.
    for (const row of rows.slice(0, 40)) {
      const at = row.findIndex(isText);
      if (at >= 0 && isNumber(row[at + 1]))
        lines.push(`${clean(row[at] as string)}: ${figure(String(row[at]), row[at + 1], options)}`);
      if (lines.length >= 12) break;
    }
  }
  lines.push("", `From the "${clean(options.sheet)}" sheet (VynorAI)`);
  let text = lines.join("\n");
  if (text.length > WHATSAPP_MAX) text = `${text.slice(0, WHATSAPP_MAX - 2)}…`;
  return text;
}
