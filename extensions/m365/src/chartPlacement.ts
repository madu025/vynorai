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
