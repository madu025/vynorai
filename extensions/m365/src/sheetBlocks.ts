/**
 * Finds the separate data blocks on one sheet: a summary at the top, a table further down, a side
 * table to the right. Blocks are rectangles split apart by fully blank rows or columns (an XY cut,
 * repeated until no blank row or column runs through a part). Pure: it works on a bounded grid of
 * cell values (the top-left part of the used range) and never touches Office.js.
 */

/** Rows of the used range scanned per sheet. */
export const BLOCK_SCAN_ROWS = 200;
/** Columns of the used range scanned per sheet. */
export const BLOCK_SCAN_COLUMNS = 40;
/** At most this many blocks are reported per sheet. */
export const MAX_SHEET_BLOCKS = 8;
/** A block needs at least this many rows and columns; smaller ones are notes or stray cells. */
export const MIN_BLOCK_ROWS = 2;
export const MIN_BLOCK_COLUMNS = 2;

export interface SheetBlock {
  /** A1 address on the sheet, e.g. "A20:E45". */
  address: string;
  /** Sheet row number of the header row (or of the first row when there are no text headers). */
  headerRow: number;
  /** Header texts, when the first row of the block looks like text headers. */
  headers?: string[];
  /** A one-cell title row found right above the headers, e.g. "Sales 2025". */
  title?: string;
  /** Rows including the header row. */
  rows: number;
  columns: number;
  /** The block reaches the edge of the scanned part, so it may go on past it. */
  clipped?: true;
}

export interface SheetBlockInput {
  /** Values of the scanned part, starting at the used range's top-left cell. */
  values: unknown[][];
  /** Address of the used range (sheet prefix allowed), e.g. "Sheet1!B3:K900". */
  usedAddress: string;
  /** Size of the whole used range; blocks touching the scan edge are stretched to it. */
  usedRows?: number;
  usedColumns?: number;
}

const blank = (value: unknown) =>
  value === null ||
  value === undefined ||
  (typeof value === "string" && value.trim() === "");

/** A cell counts as a header when it is text that is not a number. */
const textual = (value: unknown) =>
  typeof value === "string" &&
  value.trim() !== "" &&
  !/^[-+]?[\d.,\s%$€£]+$/.test(value.trim());

function letters(index: number): string {
  let value = index;
  let out = "";
  do {
    out = String.fromCharCode(65 + (value % 26)) + out;
    value = Math.floor(value / 26) - 1;
  } while (value >= 0);
  return out;
}

function topLeft(address: string): { row: number; column: number } {
  const first = address.split("!").pop()!.replace(/\$/g, "").split(":")[0];
  const match = /^([A-Z]{1,3})(\d+)$/i.exec(first);
  if (!match) return { row: 1, column: 0 };
  let column = 0;
  for (const char of match[1].toUpperCase())
    column = column * 26 + (char.charCodeAt(0) - 64);
  return { row: Number(match[2]), column: column - 1 };
}

interface Box {
  r0: number;
  r1: number;
  c0: number;
  c1: number;
}

/**
 * Splits the grid into blocks. Returns the blocks in reading order (top to bottom, then left to
 * right), at most MAX_SHEET_BLOCKS of them. A sheet that holds one block returns one entry.
 */
export function findSheetBlocks(input: SheetBlockInput): SheetBlock[] {
  const grid = input.values.slice(0, BLOCK_SCAN_ROWS);
  const height = grid.length;
  const width = Math.min(
    BLOCK_SCAN_COLUMNS,
    grid.reduce((most, row) => Math.max(most, row?.length ?? 0), 0),
  );
  if (!height || !width) return [];
  const filled = (r: number, c: number) => !blank(grid[r]?.[c]);
  const rowFilled = (r: number, b: Box) => {
    for (let c = b.c0; c <= b.c1; c += 1) if (filled(r, c)) return true;
    return false;
  };
  const columnFilled = (c: number, b: Box) => {
    for (let r = b.r0; r <= b.r1; r += 1) if (filled(r, c)) return true;
    return false;
  };
  const trim = (b: Box): Box | undefined => {
    const box = { ...b };
    while (box.r0 <= box.r1 && !rowFilled(box.r0, box)) box.r0 += 1;
    while (box.r1 >= box.r0 && !rowFilled(box.r1, box)) box.r1 -= 1;
    if (box.r0 > box.r1) return undefined;
    while (box.c0 <= box.c1 && !columnFilled(box.c0, box)) box.c0 += 1;
    while (box.c1 >= box.c0 && !columnFilled(box.c1, box)) box.c1 -= 1;
    return box;
  };
  // Runs of filled rows (or columns) inside a trimmed box; more than one run means a split.
  const runs = (from: number, to: number, isFilled: (i: number) => boolean) => {
    const out: [number, number][] = [];
    let start = -1;
    for (let i = from; i <= to; i += 1) {
      if (isFilled(i)) {
        if (start < 0) start = i;
      } else if (start >= 0) {
        out.push([start, i - 1]);
        start = -1;
      }
    }
    if (start >= 0) out.push([start, to]);
    return out;
  };
  const leaves: Box[] = [];
  const cut = (b: Box, depth: number) => {
    const box = trim(b);
    if (!box) return;
    if (depth > 64) {
      leaves.push(box);
      return;
    }
    const rowRuns = runs(box.r0, box.r1, (r) => rowFilled(r, box));
    if (rowRuns.length > 1) {
      for (const [r0, r1] of rowRuns) cut({ ...box, r0, r1 }, depth + 1);
      return;
    }
    const columnRuns = runs(box.c0, box.c1, (c) => columnFilled(c, box));
    if (columnRuns.length > 1) {
      for (const [c0, c1] of columnRuns) cut({ ...box, c0, c1 }, depth + 1);
      return;
    }
    leaves.push(box);
  };
  cut({ r0: 0, r1: height - 1, c0: 0, c1: width - 1 }, 0);

  const origin = topLeft(input.usedAddress);
  const usedRows = Math.max(height, input.usedRows ?? height);
  const usedColumns = Math.max(width, input.usedColumns ?? width);
  const blocks: SheetBlock[] = [];
  for (const leaf of leaves) {
    const box = { ...leaf };
    const cellsIn = (r: number) => {
      let count = 0;
      for (let c = box.c0; c <= box.c1; c += 1) if (filled(r, c)) count += 1;
      return count;
    };
    // A one-cell title right above the headers (often a merged cell) is not part of the table.
    let title: string | undefined;
    if (
      box.r1 - box.r0 >= 2 &&
      box.c1 - box.c0 >= 1 &&
      cellsIn(box.r0) === 1 &&
      cellsIn(box.r0 + 1) >= 2
    ) {
      for (let c = box.c0; c <= box.c1; c += 1)
        if (filled(box.r0, c)) title = String(grid[box.r0][c]).trim();
      box.r0 += 1;
    }
    let rows = box.r1 - box.r0 + 1;
    let columns = box.c1 - box.c0 + 1;
    if (rows < MIN_BLOCK_ROWS || columns < MIN_BLOCK_COLUMNS) continue;
    const top: unknown[] = [];
    for (let c = box.c0; c <= box.c1; c += 1) top.push(grid[box.r0]?.[c]);
    const filledTop = top.filter((value) => !blank(value));
    const headers =
      filledTop.length * 2 >= top.length && filledTop.every(textual)
        ? top.map((value) => (blank(value) ? "" : String(value).trim()))
        : undefined;
    // A block that reaches the bottom or right edge of a clipped scan may go on past it.
    const clippedDown = box.r1 === height - 1 && usedRows > height;
    const clippedRight = box.c1 === width - 1 && usedColumns > width;
    if (clippedDown) rows = usedRows - box.r0;
    if (clippedRight) columns = usedColumns - box.c0;
    const firstRow = origin.row + box.r0;
    const firstColumn = origin.column + box.c0;
    blocks.push({
      address: `${letters(firstColumn)}${firstRow}:${letters(firstColumn + columns - 1)}${firstRow + rows - 1}`,
      headerRow: firstRow,
      ...(headers ? { headers } : {}),
      ...(title ? { title } : {}),
      rows,
      columns,
      ...(clippedDown || clippedRight ? { clipped: true as const } : {}),
    });
  }
  return blocks
    .sort(
      (a, b) =>
        a.headerRow - b.headerRow ||
        topLeft(a.address).column - topLeft(b.address).column,
    )
    .slice(0, MAX_SHEET_BLOCKS);
}
