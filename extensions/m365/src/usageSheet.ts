/**
 * Writes the usage dashboard onto a new result sheet. The numbers come from usageDashboard.ts and the
 * cell plan from usageLayout.ts; this file only reads the source columns in chunks and places the cells.
 */
import { UsageAccumulator } from "./usageDashboard.js";
import {
  buildUsageLayout,
  type BlockStyle,
  type LayoutRefs,
} from "./usageLayout.js";

/** Rows read per request for one column: 20,000 single-column cells is far below Excel's limits. */
export const USAGE_CHUNK_ROWS = 20000;

export interface UsageSheetOptions {
  context: { sync: () => Promise<unknown> };
  sheet: any;
  /** The source range including its header row. */
  sourceRange: any;
  rowCount: number;
  columns: { entity: number; item: number; quantity: number; unit?: number };
  refs: LayoutRefs;
  chartPrefix: string;
  snapshotText: string;
  topN?: number;
  isCancelled?: () => boolean;
  onProgress?: (done: number, total: number) => void;
}

const WIDTHS = [44, 120, 92, 22]; // rank, entity, value, gap; repeated for each table

const STYLE: Record<BlockStyle, (range: any) => void> = {
  title: (range) => {
    range.format.font.bold = true;
    range.format.font.size = 18;
    range.format.font.color = "#FFFFFF";
  },
  subtitle: (range) => {
    range.format.font.italic = true;
    range.format.font.color = "#595959";
  },
  "kpi-label": (range) => {
    range.format.font.bold = true;
    range.format.font.size = 9;
    range.format.font.color = "#595959";
  },
  "kpi-value": (range) => {
    range.format.font.bold = true;
    range.format.font.size = 18;
    range.format.font.color = "#1F3864";
  },
  section: (range) => {
    range.format.font.bold = true;
    range.format.font.color = "#1F3864";
  },
  input: (range) => {
    range.format.font.bold = true;
    range.format.font.color = "#0B5394";
    range.format.fill.color = "#FFF2CC";
  },
  "lookup-label": (range) => {
    range.format.font.bold = true;
  },
  "lookup-value": (range) => {
    range.format.font.bold = true;
    range.format.font.color = "#1F3864";
  },
  "table-header": (range) => {
    range.format.font.bold = true;
    range.format.font.color = "#FFFFFF";
    range.format.fill.color = "#2F5597";
  },
  "table-body": () => undefined,
  note: (range) => {
    range.format.font.italic = true;
    range.format.font.color = "#595959";
  },
};

export async function writeUsageDashboard(options: UsageSheetOptions) {
  const { context, sheet, sourceRange, rowCount, columns } = options;
  const dataRows = Math.max(0, rowCount - 1);
  const accumulator = new UsageAccumulator();
  const wanted = [columns.entity, columns.item, columns.quantity, columns.unit];
  for (let start = 0; start < dataRows; start += USAGE_CHUNK_ROWS) {
    if (options.isCancelled?.()) throw new Error("EXCEL_READ_CANCELLED");
    const count = Math.min(USAGE_CHUNK_ROWS, dataRows - start);
    const ranges = wanted.map((index) => {
      if (index === undefined) return undefined;
      const range = sourceRange
        .getCell(1 + start, index)
        .getResizedRange(count - 1, 0);
      range.load("values");
      return range;
    });
    await context.sync();
    const [entity, item, quantity, unit] = ranges as any[];
    for (let row = 0; row < count; row += 1)
      accumulator.add(
        entity.values[row][0],
        item.values[row][0],
        quantity.values[row][0],
        unit ? unit.values[row][0] : undefined,
      );
    options.onProgress?.(start + count, dataRows);
  }

  const result = accumulator.finish(options.topN ?? 10);
  const layout = buildUsageLayout(result, options.refs, options.snapshotText);

  try {
    sheet.showGridlines = false;
  } catch {
    // Older Excel: the grid simply stays visible.
  }
  // Column widths first, so wide text never stretches a table.
  for (let table = 0; table < 4; table += 1)
    WIDTHS.forEach((width, offset) => {
      sheet.getRangeByIndexes(0, table * 4 + offset, 1, 1).format.columnWidth =
        width;
    });

  const titleBar = sheet.getRangeByIndexes(0, 0, 1, 16);
  titleBar.format.fill.color = "#1F3864";

  for (const block of layout.blocks) {
    const width = block.cells[0].length;
    const range = sheet.getRangeByIndexes(
      block.row,
      block.col,
      block.cells.length,
      width,
    );
    if (block.style === "table-body") {
      // Identifiers keep their leading zeros: the entity column is text before it is written.
      sheet.getRangeByIndexes(
        block.row,
        block.col + 1,
        block.cells.length,
        1,
      ).numberFormat = block.cells.map(() => ["@"]);
      range.values = block.cells;
    } else if (
      block.cells
        .flat()
        .some((cell) => typeof cell === "string" && cell.startsWith("="))
    ) {
      range.formulas = block.cells;
    } else {
      if (block.text)
        range.numberFormat = block.cells.map((row) => row.map(() => "@"));
      range.values = block.cells;
    }
    STYLE[block.style](range);
    if (block.numberFormat)
      range.numberFormat = block.cells.map((row) =>
        row.map(() => block.numberFormat),
      );
  }

  for (const bar of layout.dataBars) {
    try {
      sheet
        .getRangeByIndexes(bar.row, bar.col, bar.rows, 1)
        .conditionalFormats.add("DataBar");
    } catch {
      // Data bars are decoration; the numbers are already there.
    }
  }
  await context.sync();

  layout.charts.forEach((chart, index) => {
    const source = sheet.getRangeByIndexes(
      chart.headerRow,
      chart.col,
      chart.dataRows + 1,
      2,
    );
    const drawn = sheet.charts.add("BarClustered", source, "Columns");
    drawn.name = `${options.chartPrefix}_chart_${index + 1}`;
    drawn.title.text = chart.title;
    drawn.legend.visible = false;
    drawn.setPosition(chart.from, chart.to);
    try {
      drawn.axes.categoryAxis.reversePlotOrder = true;
    } catch {
      // Without it the largest bar is drawn at the bottom; still correct.
    }
  });
  await context.sync();
  return result;
}
