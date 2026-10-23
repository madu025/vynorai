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

const count = (value: number) => Math.max(0, Math.floor(value)).toLocaleString("en-US");

/** The words around the numbers; English unless the pane passes its own (i18n keys row_label ...). */
export interface SelectionWords {
  cell: string;
  row: string;
  rows: string;
  column: string;
  columns: string;
}
const ENGLISH_WORDS: SelectionWords = { cell: "cell", row: "row", rows: "rows", column: "column", columns: "columns" };

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
