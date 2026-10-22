/**
 * Before and after for the cells a staged change writes, so the person sees what an approval would
 * overwrite. Pure: `taskpane.ts` reads the current cells and shows the rows.
 */
import { columnLetters, parseA1, type StagedChange } from "./agent.js";

export const PREVIEW_MAX_CELLS = 12;
export const PREVIEW_MAX_ROWS = 6;
export const PREVIEW_MAX_COLUMNS = 6;

export interface CellPreview {
  cell: string;
  before: string;
  after: string;
}

export interface ChangePreview {
  sheet: string;
  /** The range to read to fill `before` (bounded to the cells shown). */
  address: string;
  /** Cells written in all, so "and N more" can be said when the list is cut short. */
  total: number;
  /** The change writes into a sheet this run creates: there is nothing to overwrite. */
  newSheet: boolean;
}

/** What to read for a change, or undefined when it writes no cells we can show. */
export function previewTarget(
  change: StagedChange,
  createdSheets: ReadonlySet<string> = new Set(),
): ChangePreview | undefined {
  if (change.kind !== "write_values" && change.kind !== "write_formula")
    return undefined;
  const start = parseA1(change.cell);
  const rows = change.kind === "write_values" ? change.values.length : 1;
  const columns =
    change.kind === "write_values"
      ? Math.max(1, ...change.values.map((row) => row.length))
      : 1;
  const shownRows = Math.min(rows, PREVIEW_MAX_ROWS);
  const shownColumns = Math.min(columns, PREVIEW_MAX_COLUMNS);
  const first = `${columnLetters(start.column)}${start.row}`;
  const last = `${columnLetters(start.column + shownColumns - 1)}${start.row + shownRows - 1}`;
  return {
    sheet: change.sheet,
    address: first === last ? first : `${first}:${last}`,
    total: rows * columns,
    newSheet: createdSheets.has(change.sheet),
  };
}

const text = (value: unknown): string => {
  if (value === null || value === undefined || value === "") return "(empty)";
  const out = String(value);
  return out.length > 60 ? `${out.slice(0, 57)}...` : out;
};

/**
 * The cells to show, up to PREVIEW_MAX_CELLS. `current` is the block read at `previewTarget`'s
 * address (undefined when nothing could be read); every `before` is then "(not read)".
 */
export function previewCells(
  change: StagedChange,
  current: unknown[][] | undefined,
  newSheet = false,
): CellPreview[] {
  if (change.kind !== "write_values" && change.kind !== "write_formula")
    return [];
  const start = parseA1(change.cell);
  const grid: unknown[][] =
    change.kind === "write_values" ? change.values : [[change.formula]];
  const cells: CellPreview[] = [];
  for (let r = 0; r < Math.min(grid.length, PREVIEW_MAX_ROWS); r += 1)
    for (let c = 0; c < Math.min(grid[r].length, PREVIEW_MAX_COLUMNS); c += 1) {
      if (cells.length >= PREVIEW_MAX_CELLS) return cells;
      cells.push({
        cell: `${columnLetters(start.column + c)}${start.row + r}`,
        before: newSheet
          ? "(empty)"
          : current
            ? text(current[r]?.[c])
            : "(not read)",
        after: text(grid[r][c]),
      });
    }
  return cells;
}
