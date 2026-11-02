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
  /** A one-cell title in the first row above a table: drawn as a dark band. */
  titleRow?: number;
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
  const first = values[0]?.filter(filled) ?? [];
  if (
    first.length === 1 &&
    typeof first[0] === "string" &&
    headerRows.length &&
    !headerRows.includes(0)
  )
    return { headerRows, totalRows, titleRow: 0 };
  return { headerRows, totalRows };
}

export interface ChartBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

const overlaps = (a: ChartBox, b: ChartBox) =>
  a.left < b.left + b.width &&
  b.left < a.left + a.width &&
  a.top < b.top + b.height &&
  b.top < a.top + a.height;

/** Chart card size and gap in points on an agent-built dashboard. */
export const CHART_CARD = { width: 420, height: 260, gap: 12 };

/**
 * Charts the agent placed on top of each other (live run 2026-11-02) go into a grid, two per row,
 * under the sheet's cells. Charts that do not overlap keep their places (undefined).
 */
export function arrangeCharts(
  boxes: readonly ChartBox[],
  belowTop: number,
): ChartBox[] | undefined {
  const clash = boxes.some((box, index) =>
    boxes.some((other, at) => at > index && overlaps(box, other)),
  );
  if (!clash) return undefined;
  const { width, height, gap } = CHART_CARD;
  return boxes.map((_, index) => ({
    left: (index % 2) * (width + gap),
    top: belowTop + gap + Math.floor(index / 2) * (height + gap),
    width,
    height,
  }));
}

const HEADER_FILL = "#1F4E78";
const HEADER_FONT = "#FFFFFF";
const TOTAL_LINE = "#1F4E78";
const TITLE_FILL = "#1F3864";
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
        if (plan.titleRow !== undefined) {
          const band = used
            .getCell(plan.titleRow, 0)
            .getResizedRange(0, width - 1);
          band.format.fill.color = TITLE_FILL;
          band.format.font.color = HEADER_FONT;
          band.format.font.bold = true;
          band.format.font.size = 14;
        }
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
        await polishCharts(context, sheet, used, name);
      } catch {
        // Polish is optional: the result is already written and verified.
      }
    }
  });
}

/**
 * Charts on a sheet the agent built: card look (white face, faint border, rounded corners, one
 * font, bold title, no gridlines) and, when they overlap, a two-per-row grid under the cells. A
 * sheet named like a dashboard also hides the cell grid. Every touch is optional.
 */
async function polishCharts(
  context: any,
  sheet: any,
  used: any,
  name: string,
): Promise<void> {
  const quietly = async (touch: () => void) => {
    try {
      touch();
      await context.sync();
    } catch {
      // Decoration only.
    }
  };
  if (/dashboard/i.test(name))
    await quietly(() => {
      sheet.showGridlines = false;
    });
  let charts: any[] = [];
  try {
    const list = sheet.charts;
    list.load("items/name,items/left,items/top,items/width,items/height");
    await context.sync();
    charts = list.items ?? [];
  } catch {
    return;
  }
  if (!charts.length) return;
  for (const chart of charts) {
    await quietly(() => {
      chart.format.fill.setSolidColor("#FFFFFF");
      chart.format.border.color = "#E5E7EB";
      chart.format.font.name = "Segoe UI";
      chart.title.format.font.bold = true;
      chart.title.format.font.size = 13;
    });
    await quietly(() => {
      chart.format.roundedCorners = true;
    });
    await quietly(() => {
      chart.axes.valueAxis.majorGridlines.visible = false;
    });
  }
  let bottom = 0;
  try {
    const last = used.getLastRow();
    last.load("top,height");
    await context.sync();
    bottom = Number(last.top) + Number(last.height);
  } catch {
    bottom = 0;
  }
  const placed = arrangeCharts(
    charts.map((chart) => ({
      left: Number(chart.left),
      top: Number(chart.top),
      width: Number(chart.width),
      height: Number(chart.height),
    })),
    bottom,
  );
  if (placed)
    await quietly(() => {
      charts.forEach((chart, index) => Object.assign(chart, placed[index]));
    });
}
