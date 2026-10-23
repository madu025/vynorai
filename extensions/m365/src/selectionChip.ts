/**
 * The line above the request box that says which cells a request will use: sheet, range and size.
 * Pure: `taskpane.ts` reads the selection with Office.js and shows this text.
 */
export interface SelectionInfo {
  /** Range address as Excel reports it, with or without the sheet name. */
  address: string;
  rows: number;
  columns: number;
}

const count = (value: number) =>
  Math.max(0, Math.floor(value)).toLocaleString("en-US");

/** The words around the numbers; English unless the pane passes its own (i18n keys row_label ...). */
export interface SelectionWords {
  cell: string;
  row: string;
  rows: string;
  column: string;
  columns: string;
}
const ENGLISH_WORDS: SelectionWords = {
  cell: "cell",
  row: "row",
  rows: "rows",
  column: "column",
  columns: "columns",
};

/** "'Sales'!A1:J500 · 500 rows × 10 columns"; a single cell is "'Sales'!B2 · 1 cell". */
export function describeSelection(
  info: SelectionInfo | undefined,
  words: Partial<SelectionWords> = {},
): string {
  if (!info || !info.address) return "";
  const w = { ...ENGLISH_WORDS, ...words };
  const cleaned = info.address.replace(/\$/g, "");
  const bang = cleaned.lastIndexOf("!");
  const sheet = bang > 0 ? cleaned.slice(0, bang).replace(/^'|'$/g, "") : "";
  const range = bang > 0 ? cleaned.slice(bang + 1) : cleaned;
  const where = sheet ? `'${sheet}'!${range}` : range;
  if (info.rows === 1 && info.columns === 1) return `${where} · 1 ${w.cell}`;
  const rows = `${count(info.rows)} ${info.rows === 1 ? w.row : w.rows}`;
  const columns = `${count(info.columns)} ${info.columns === 1 ? w.column : w.columns}`;
  return `${where} · ${rows} × ${columns}`;
}

const colNumber = (letters: string) =>
  [...letters.toUpperCase()].reduce(
    (n, ch) => n * 26 + ch.charCodeAt(0) - 64,
    0,
  );

/** Sheet name and size of an address like 'Orders'!A1:L3001, or undefined when it is not a block. */
function blockOf(address: string | undefined) {
  if (!address) return undefined;
  const cleaned = address.replace(/\$/g, "");
  const bang = cleaned.lastIndexOf("!");
  const sheet = bang > 0 ? cleaned.slice(0, bang).replace(/^'|'$/g, "") : "";
  const match = /^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/i.exec(
    bang > 0 ? cleaned.slice(bang + 1) : cleaned,
  );
  if (!match || !match[3]) return { sheet, rows: 1, columns: 1 };
  return {
    sheet,
    rows: Number(match[4]) - Number(match[2]) + 1,
    columns: colNumber(match[3]) - colNumber(match[1]) + 1,
  };
}

/**
 * The same line without cell addresses: "Orders · 3,000 rows × 12 columns". The table found around
 * the selection wins over a single cell; the first row is the header and is not counted.
 */
export function friendlySelection(
  info: SelectionInfo | undefined,
  tableAddress?: string,
  words: Partial<SelectionWords> = {},
): string {
  if (!info || !info.address) return "";
  const w = { ...ENGLISH_WORDS, ...words };
  const own = blockOf(info.address);
  const table = blockOf(tableAddress);
  const sheet = own?.sheet || table?.sheet || "";
  const size =
    table && table.rows >= 2
      ? { rows: table.rows - 1, columns: table.columns }
      : info.rows > 1 || info.columns > 1
        ? { rows: info.rows, columns: info.columns }
        : undefined;
  if (!size) return sheet || describeSelection(info, words);
  const rows = `${count(size.rows)} ${size.rows === 1 ? w.row : w.rows}`;
  const columns = `${count(size.columns)} ${size.columns === 1 ? w.column : w.columns}`;
  return `${sheet ? `${sheet} · ` : ""}${rows} × ${columns}`;
}

/** Removes sheet!range tokens from display text ("'Orders'!A1:L3001" becomes "Orders"). */
export function stripRanges(text: string): string {
  return text
    .replace(/'([^']+)'!\$?[A-Z]{1,3}\$?\d+(?::\$?[A-Z]{1,3}\$?\d+)?/g, "$1")
    .replace(
      /\b([A-Za-z_][\w ]*?)!\$?[A-Z]{1,3}\$?\d+(?::\$?[A-Z]{1,3}\$?\d+)?/g,
      "$1",
    )
    .replace(/\s{2,}/g, " ");
}
