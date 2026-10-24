/**
 * Keeps a new chart off the cells that hold data. The agent names a position before the formulas
 * it wrote have spilled, so a chart can land on a table that is longer than expected.
 * Pure: boxes are 0-based {row, column} corners.
 */
export interface Box {
  row: number;
  column: number;
  rows: number;
  columns: number;
}

const letters = (index: number): string => {
  let n = index + 1;
  let out = "";
  while (n > 0) {
    out = String.fromCharCode(65 + ((n - 1) % 26)) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
};

function cellIndex(cell: string): { row: number; column: number } | undefined {
  const m = /^\$?([A-Z]{1,3})\$?(\d+)$/i.exec(cell.trim());
  if (!m) return undefined;
  let column = 0;
  for (const ch of m[1].toUpperCase())
    column = column * 26 + ch.charCodeAt(0) - 64;
  return { row: Number(m[2]) - 1, column: column - 1 };
}

/** "A9:G24" (or one cell) as a box; undefined when it is not plain A1 text. */
export function parseBox(position: string): Box | undefined {
  const [first, second = first] = position.split(":");
  const a = cellIndex(first);
  const b = cellIndex(second);
  if (!a || !b) return undefined;
  return {
    row: Math.min(a.row, b.row),
    column: Math.min(a.column, b.column),
    rows: Math.abs(a.row - b.row) + 1,
    columns: Math.abs(a.column - b.column) + 1,
  };
}

export function boxAddress(box: Box): string {
  const start = `${letters(box.column)}${box.row + 1}`;
  const end = `${letters(box.column + box.columns - 1)}${box.row + box.rows}`;
  return start === end ? start : `${start}:${end}`;
}

const filled = (cell: unknown) =>
  cell !== "" && cell !== null && cell !== undefined;

/**
 * `values` are the cells of the columns the chart covers, from the chart's first row downward.
 * Returns the position to use: the requested one when its cells are empty, otherwise the same size
 * one blank row under the last filled cell of those columns.
 */
export function clearPosition(
  box: Box,
  values: readonly (readonly unknown[])[],
): Box {
  const blocked = values.slice(0, box.rows).some((row) => row.some(filled));
  if (!blocked) return box;
  let last = -1;
  values.forEach((row, index) => {
    if (row.some(filled)) last = index;
  });
  return { ...box, row: box.row + last + 2 };
}

/** Every chart limit in one place, so they are easy to change. */
export const CHART_LIMITS = {
  /** How far below its columns' data a chart may sit before it goes beside the data instead (rows). */
  maxRowsBelow: 200,
  /** Most rows a chart source may have. */
  maxRows: 5000,
  /** Most columns a chart source may have. */
  maxCols: 30,
  /** A used range wider than this is refused before any cell is read. */
  maxSampleCols: 200,
  /** Rows (header included) read to decide which columns to chart. */
  sampleRows: 50,
};
export const MAX_ROWS_BELOW = CHART_LIMITS.maxRowsBelow;
export const CHART_MAX_ROWS = CHART_LIMITS.maxRows;
export const CHART_MAX_COLS = CHART_LIMITS.maxCols;
/** Largest requested box that is read cell by cell. */
const MAX_BOX_CELLS = 20_000;

export interface PlacementFacts {
  /** The requested box already holds values. */
  blocked: boolean;
  /** 0-based row of the last filled cell in the box's columns from the box's first row down, -1 if none. */
  lastFilledRow: number;
  /** 0-based column just after the sheet's last used column. */
  usedEndColumn: number;
}

/**
 * Where a chart goes when it is asked for `box`: the same place when that is empty, else one blank
 * row under the data of its columns, and for data longer than MAX_ROWS_BELOW rows (the chart would
 * land thousands of rows down) one blank column to the right of everything the sheet uses.
 */
export function placeChart(box: Box, facts: PlacementFacts): Box {
  if (!facts.blocked) return box;
  const below = facts.lastFilledRow + 2;
  if (below - box.row > MAX_ROWS_BELOW)
    return { ...box, column: Math.max(box.column, facts.usedEndColumn + 1) };
  return { ...box, row: Math.max(box.row, below) };
}

/** The slice of Excel's worksheet this needs; the real worksheet satisfies it. */
export interface PlacementSheet {
  getUsedRangeOrNullObject(valuesOnly?: boolean): any;
  getRangeByIndexes(
    row: number,
    column: number,
    rows: number,
    columns: number,
  ): any;
}

/**
 * Reads only what is needed (the requested box, then the used extent of its columns, never the
 * data itself) and returns the A1 position to use. `sync` is the context's sync.
 */
export async function resolveChartPosition(
  sheet: PlacementSheet,
  sync: () => Promise<void>,
  position: string,
): Promise<string> {
  const box = parseBox(position);
  if (!box || box.rows * box.columns > MAX_BOX_CELLS) return position;
  const used = sheet.getUsedRangeOrNullObject(true);
  used.load([
    "isNullObject",
    "rowIndex",
    "rowCount",
    "columnIndex",
    "columnCount",
  ]);
  await sync();
  if (used.isNullObject) return position;
  const end = Number(used.rowIndex) + Number(used.rowCount);
  if (end <= box.row) return position;
  const own = sheet.getRangeByIndexes(
    box.row,
    box.column,
    box.rows,
    box.columns,
  );
  own.load("values");
  await sync();
  if (!(own.values as unknown[][]).some((row) => row.some(filled)))
    return position;
  // The used extent of the box's columns, below the box's first row: no cell values are read.
  const columns = sheet.getRangeByIndexes(
    box.row,
    box.column,
    end - box.row,
    box.columns,
  );
  const extent = columns.getUsedRangeOrNullObject(true);
  extent.load(["isNullObject", "rowIndex", "rowCount"]);
  await sync();
  const lastFilledRow = extent.isNullObject
    ? box.row
    : Number(extent.rowIndex) + Number(extent.rowCount) - 1;
  return boxAddress(
    placeChart(box, {
      blocked: true,
      lastFilledRow,
      usedEndColumn: Number(used.columnIndex) + Number(used.columnCount),
    }),
  );
}
