/**
 * The share card (pure): what the person sends to WhatsApp, built on the device from the values
 * of a result sheet, from the cells selected in Excel, or from cells pasted from Excel. The card
 * changes with what the data holds: a dashboard gives its KPI cards and breakdown, a plain table
 * gives a total, a row count and the top groups. Nothing is read from or sent anywhere here.
 */
import { isMoneyHeader } from "./businessContext.js";
import type { Language } from "./i18n.js";
import { pick } from "./paneText.js";
import {
  clean,
  figure,
  findBreakdown,
  findCards,
  titleCase,
  whatsappSummary,
  type Cell,
  type WhatsAppSummaryOptions,
} from "./whatsappSummary.js";

export interface ShareTile {
  label: string;
  value: string;
}
export interface ShareBar {
  name: string;
  value: number;
  text: string;
}
export interface ShareCard {
  kind: "dashboard" | "table" | "pairs" | "empty";
  title: string;
  subtitle: string;
  /** One sentence that says what matters; empty when the data does not support one. */
  headline: string;
  tiles: ShareTile[];
  bars: ShareBar[];
  /** The text that goes with the picture (WhatsApp formatting, at most WHATSAPP_MAX characters). */
  message: string;
  footer: string;
}
export interface ShareCardOptions
  extends Pick<WhatsAppSummaryOptions, "symbol" | "style" | "date"> {
  sheet: string;
  source?: "sheet" | "pasted" | "selection";
  language?: Language;
}

const MAX_ROWS = 200;
const MAX_COLUMNS = 30;
const isText = (cell: Cell): cell is string =>
  typeof cell === "string" && cell.trim() !== "";
const isNumber = (cell: Cell): cell is number =>
  typeof cell === "number" && Number.isFinite(cell);

/** "Rs 1,200", "(5,000)", "12%", "4,500/=", "LKR 3.5": a number; "007" and "2026-01-05" stay text. */
function toCell(raw: string): Cell {
  const text = raw
    .trim()
    .replace(/^"(.*)"$/s, "$1")
    .replace(/""/g, '"')
    .trim();
  if (text === "") return null;
  if (/^0\d/.test(text)) return text;
  const match =
    /^(\()?\s*(-)?\s*(?:Rs\.?|LKR|USD|රු\.?|\$|€|£)?\s*(-)?\s*(\d[\d,]*(?:\.\d+)?|\.\d+)\s*(%|\/=)?\s*(?:LKR)?\s*(\))?$/i.exec(
      text,
    );
  if (!match) return text;
  const digits = match[4].replace(/,/g, "");
  let value = Number(digits);
  if (!Number.isFinite(value)) return text;
  if (match[5] === "%") value /= 100;
  return match[1] && match[6] ? -value : match[2] || match[3] ? -value : value;
}

/** One CSV line with quotes; commas inside quotes stay. */
function csvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else current += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      cells.push(current);
      current = "";
    } else current += ch;
  }
  cells.push(current);
  return cells;
}

/**
 * Cells copied from Excel arrive as tab-separated text (rows by line breaks); a CSV paste works
 * too. At most 200 rows and 30 columns are kept, and empty edges are dropped.
 */
export function parsePastedCells(text: string): Cell[][] {
  const lines = text.replace(/\r/g, "").split("\n");
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  const tabbed = lines.some((line) => line.includes("\t"));
  const csv =
    !tabbed && lines.length >= 2 && (lines[0].match(/,/g)?.length ?? 0) >= 1;
  const rows = lines
    .slice(0, MAX_ROWS)
    .map((line) =>
      (tabbed ? line.split("\t") : csv ? csvLine(line) : [line])
        .slice(0, MAX_COLUMNS)
        .map(toCell),
    );
  const width = rows.reduce(
    (wide, row) =>
      Math.max(
        wide,
        row.length - [...row].reverse().findIndex((c) => c !== null),
      ),
    0,
  );
  return rows.map((row) => {
    const trimmed = row.slice(0, width);
    while (trimmed.length < width) trimmed.push(null);
    return trimmed;
  });
}

const FOOTER = (language: Language) =>
  pick(
    language,
    "Checked on this device · VynorAI",
    "මෙම උපාංගයේ පරීක්ෂා කළා · VynorAI",
    "இந்தச் சாதனத்தில் சரிபார்க்கப்பட்டது · VynorAI",
  );

function headline(
  language: Language,
  name: string,
  share: number,
  measure: string,
): string {
  return pick(
    language,
    `${name} brings ${share}% of ${measure}.`,
    `${measure} හි ${share}% ක් ${name} වෙතින්.`,
    `${measure}-இல் ${share}% ${name} மூலம்.`,
  );
}

const GROUP_HEADER =
  /\b(region|area|district|province|department|dept|category|product|item|branch|status|type|group|customer|supplier|rep|manager|city|route)\b/i;
const ID_HEADER =
  /\b(id|no|number|code|nic|phone|mobile|year|month|date|day)\b|#/i;

interface TableShape {
  header: string[];
  body: Cell[][];
  measure: number;
  group: number;
}

/** A table: a header row of text, then rows with one number column worth adding up. */
function inferTable(rows: Cell[][]): TableShape | undefined {
  const header = rows[0]?.map((cell) => (isText(cell) ? cell : ""));
  const body = rows.slice(1).filter((row) => row.some((c) => c !== null));
  if (!header || header.filter(Boolean).length < 2 || body.length < 2)
    return undefined;
  const share = (column: number, test: (c: Cell) => boolean) => {
    const cells = body.map((row) => row[column]).filter((c) => c !== null);
    return cells.length ? cells.filter(test).length / cells.length : 0;
  };
  const numeric = header
    .map((_, column) => column)
    .filter(
      (column) =>
        header[column] &&
        share(column, isNumber) >= 0.8 &&
        !ID_HEADER.test(header[column]),
    );
  if (!numeric.length) return undefined;
  const total = (column: number) =>
    body.reduce(
      (sum, row) => sum + (isNumber(row[column]) ? row[column] : 0),
      0,
    );
  const measure =
    numeric.find((column) => isMoneyHeader(header[column])) ??
    numeric.reduce((best, column) =>
      Math.abs(total(column)) > Math.abs(total(best)) ? column : best,
    );
  const texts = header
    .map((_, column) => column)
    .filter((column) => header[column] && share(column, isText) >= 0.8);
  const distinct = (column: number) =>
    new Set(body.map((row) => String(row[column] ?? ""))).size;
  const grouped = texts.filter(
    (column) => distinct(column) >= 2 && distinct(column) <= body.length * 0.75,
  );
  const usable = (column: number) =>
    distinct(column) >= 2 && !ID_HEADER.test(header[column]);
  const group =
    grouped.find((column) => GROUP_HEADER.test(header[column])) ??
    texts.find(
      (column) => usable(column) && GROUP_HEADER.test(header[column]),
    ) ??
    grouped.find(usable) ??
    texts.find(usable) ??
    -1;
  return { header, body, measure, group };
}

function tableCard(
  shape: TableShape,
  options: WhatsAppSummaryOptions,
  language: Language,
  sourceName: string,
  dateText: string,
): ShareCard {
  const { header, body, measure, group } = shape;
  const measureName = clean(header[measure]);
  const sums = new Map<string, number>();
  let all = 0;
  for (const row of body) {
    const value = row[measure];
    if (!isNumber(value)) continue;
    all += value;
    if (group >= 0) {
      const name = clean(String(row[group] ?? ""));
      if (name) sums.set(name, (sums.get(name) ?? 0) + value);
    }
  }
  const top = [...sums.entries()].sort((a, b) => b[1] - a[1]);
  const sizes = Math.abs(all) || 1;
  const bars = top.slice(0, 5).map(([name, value]) => ({
    name,
    value,
    text: figure(measureName, value, options),
  }));
  const totalWord = pick(language, "Total", "එකතුව", "மொத்தம்");
  const rowsWord = pick(language, "Rows", "පේළි", "வரிசைகள்");
  const topWord = pick(language, "Top", "ඉහළම", "முதலிடம்");
  const groupName = group >= 0 ? clean(header[group]) : "";
  const tiles: ShareTile[] = [
    {
      label: `${totalWord} ${titleCase(measureName)}`,
      value: figure(measureName, all, options),
    },
    { label: rowsWord, value: body.length.toLocaleString("en-US") },
  ];
  if (top.length)
    tiles.push({
      label: `${topWord} ${groupName}`,
      value: `${top[0][0]} · ${Math.round((top[0][1] / sizes) * 100)}%`,
    });
  const lines = [`*${clean(sourceName)}*`, dateText, ""];
  lines.push(`${totalWord} ${titleCase(measureName)}: *${tiles[0].value}*`);
  lines.push(`${rowsWord}: *${tiles[1].value}*`);
  if (bars.length) {
    lines.push("", `${topWord} ${groupName} by ${measureName}:`);
    bars.forEach((bar, index) =>
      lines.push(`${index + 1}. ${bar.name}: ${bar.text}`),
    );
  }
  lines.push("", options.footer ?? "");
  return {
    kind: "table",
    title: clean(sourceName),
    subtitle: groupName ? `${measureName} · ${groupName}` : measureName,
    headline: top.length
      ? headline(
          language,
          top[0][0],
          Math.round((top[0][1] / sizes) * 100),
          measureName,
        )
      : "",
    tiles,
    bars,
    message: cap(lines.join("\n")),
    footer: FOOTER(language),
  };
}

const footerLine = (options: ShareCardOptions, sourceName: string) =>
  options.source === "pasted"
    ? "From pasted cells (VynorAI)"
    : options.source === "selection"
      ? `From the selected cells of "${clean(sourceName)}" (VynorAI)`
      : `From the "${clean(sourceName)}" sheet (VynorAI)`;

const cap = (text: string) =>
  text.length > 1000 ? `${text.slice(0, 998)}…` : text;

export function buildShareCard(
  values: Cell[][],
  options: ShareCardOptions,
): ShareCard {
  const language = options.language ?? "en";
  const rows = values
    .map((row) => (Array.isArray(row) ? row : []))
    .slice(0, MAX_ROWS)
    .map((row) => row.slice(0, MAX_COLUMNS));
  const date = options.date ?? new Date();
  const dateText = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  const sourceName =
    options.source === "pasted"
      ? pick(language, "Pasted cells", "අලවා ගත් කොටු", "ஒட்டிய கலங்கள்")
      : options.sheet;
  const summaryOptions: WhatsAppSummaryOptions = {
    sheet: sourceName,
    ...(options.symbol ? { symbol: options.symbol } : {}),
    ...(options.style ? { style: options.style } : {}),
    date,
    footer: footerLine(options, options.sheet),
  };
  const cards = findCards(rows);
  const breakdown = findBreakdown(rows, cards ? cards.row + 2 : 0);
  // A header row with its rows under it is a table, not a dashboard block: it is added up by group.
  const shape =
    cards || (breakdown && breakdown.row > 0) ? undefined : inferTable(rows);
  if (shape)
    return tableCard(shape, summaryOptions, language, sourceName, dateText);
  if (cards || breakdown) {
    const title = clean(
      String(
        breakdown?.row === 0
          ? sourceName
          : (rows[0]?.find(isText) ?? sourceName),
      ),
    );
    const lines = breakdown
      ? [...breakdown.lines].sort((a, b) => b[1] - a[1])
      : [];
    const sum = lines.reduce((total, [, value]) => total + value, 0) || 1;
    return {
      kind: "dashboard",
      title,
      subtitle: breakdown
        ? `${clean(breakdown.measure)} · ${clean(breakdown.name)}`
        : clean(sourceName),
      headline: lines.length
        ? headline(
            language,
            clean(lines[0][0]),
            Math.round((lines[0][1] / sum) * 100),
            clean(breakdown!.measure),
          )
        : "",
      tiles: (cards?.cards ?? []).slice(0, 4).map(([label, value]) => ({
        label: titleCase(label),
        value: figure(label, value, summaryOptions),
      })),
      bars: lines.slice(0, 5).map(([name, value]) => ({
        name: clean(name),
        value,
        text: figure(breakdown!.measure, value, summaryOptions),
      })),
      message: whatsappSummary(rows, summaryOptions),
      footer: FOOTER(language),
    };
  }
  const message = whatsappSummary(rows, summaryOptions);
  const pairs: ShareTile[] = [];
  for (const row of rows.slice(0, 40)) {
    const at = row.findIndex(isText);
    if (at >= 0 && isNumber(row[at + 1]))
      pairs.push({
        label: clean(String(row[at])),
        value: figure(String(row[at]), row[at + 1], summaryOptions),
      });
    if (pairs.length >= 4) break;
  }
  return {
    kind: pairs.length ? "pairs" : "empty",
    title: clean(sourceName),
    subtitle: dateText,
    headline: "",
    tiles: pairs,
    bars: [],
    message: pairs.length ? message : "",
    footer: FOOTER(language),
  };
}
