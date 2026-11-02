/**
 * Copilot-style finish for result sheets the agent created: header rows get a dark fill with bold
 * white text, total rows are bold with a line above, and columns fit their text. It runs only on
 * sheets this run created (undo deletes them whole), after every change is written, so a spilled
 * formula is read with its real values. The plan is pure; `polishCreatedSheets` writes it.
 */
import type { ExcelRuntimeLike } from "./officeExcel.js";

export interface SheetPolishPlan {
  /** 0-based rows inside the used range. */
  headerRows: number[];
  totalRows: number[];
}

const TOTAL_LABEL = /^\s*(grand\s+)?totals?\b/i;
const filled = (cell: unknown) =>
  cell !== null && cell !== undefined && cell !== "";
const isNumber = (cell: unknown) =>
  typeof cell === "number" && Number.isFinite(cell);

/** A header row holds only text (two cells or more) and the row below it holds a number. */
export function planSheetPolish(
  values: readonly (readonly unknown[])[],
): SheetPolishPlan {
  const headerRows: number[] = [];
  const totalRows: number[] = [];
  values.forEach((row, index) => {
    const cells = row.filter(filled);
    const first = row.find(filled);
    if (
      typeof first === "string" &&
      TOTAL_LABEL.test(first) &&
      cells.some(isNumber)
    ) {
      totalRows.push(index);
      return;
    }
    const next = values[index + 1];
    if (
      cells.length >= 2 &&
      cells.every((cell) => typeof cell === "string") &&
      next?.some(isNumber)
    )
      headerRows.push(index);
  });
  return { headerRows, totalRows };
}

const HEADER_FILL = "#1F4E78";
const HEADER_FONT = "#FFFFFF";
const TOTAL_LINE = "#1F4E78";
/** About 30 characters: wide enough for a label, narrow enough to keep the table on screen. */
export const MAX_COLUMN_POINTS = 160;

/** Styles each named sheet; a sheet that cannot be read or styled is left as it is. */
export async function polishCreatedSheets(
  runtime: ExcelRuntimeLike,
  sheetNames: readonly string[],
): Promise<void> {
  if (!sheetNames.length) return;
  await runtime.run(async (context: any) => {
    for (const name of sheetNames) {
      try {
        const sheet = context.workbook.worksheets.getItem(name);
        const used = sheet.getUsedRangeOrNullObject(true);
        used.load(["isNullObject", "values", "rowCount", "columnCount"]);
        await context.sync();
        if (used.isNullObject || Number(used.rowCount) > 2000) continue;
        const plan = planSheetPolish(used.values as unknown[][]);
        const width = Number(used.columnCount);
        // Style only as far as the row's own cells reach, so a side table keeps its own width.
        const span = (row: number) => {
          const cells = (used.values as unknown[][])[row];
          let last = width - 1;
          while (last > 0 && !filled(cells[last])) last -= 1;
          let first = 0;
          while (first < last && !filled(cells[first])) first += 1;
          return used.getCell(row, first).getResizedRange(0, last - first);
        };
        for (const row of plan.headerRows) {
          const format = span(row).format;
          format.fill.color = HEADER_FILL;
          format.font.color = HEADER_FONT;
          format.font.bold = true;
        }
        for (const row of plan.totalRows) {
          const range = span(row);
          range.format.font.bold = true;
          const top = range.format.borders.getItem("EdgeTop");
          top.style = "Continuous";
          top.color = TOTAL_LINE;
        }
        used.format.autofitColumns();
        await context.sync();
        // A long note fits its column to the whole sentence and pushes the table off screen (live
        // run 2026-11-02): cap each column, and the note spills over the empty cells beside it.
        const columns = Array.from({ length: width }, (_, at) => {
          const format = used.getColumn(at).format;
          format.load("columnWidth");
          return format;
        });
        await context.sync();
        for (const format of columns)
          if (Number(format.columnWidth) > MAX_COLUMN_POINTS)
            format.columnWidth = MAX_COLUMN_POINTS;
        await context.sync();
      } catch {
        // Polish is optional: the result is already written and verified.
      }
    }
  });
}
