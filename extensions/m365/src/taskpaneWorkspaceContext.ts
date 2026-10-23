import { buildSchemaSummary } from "./analysis.js";
import type { WorkspaceSchema, WorkspaceSelection } from "./smartWorkspace.js";

/**
 * Reads the bounded local sample used by the workbook context and suggestion cards.
 * It returns schema facts only; callers decide how to render or log failures.
 */
export async function readWorkspaceContext(
  excel: any,
  onSchemaError?: (error: unknown) => void,
): Promise<{ info: WorkspaceSelection; schema?: WorkspaceSchema }> {
  return excel.run(async (context: any) => {
    let range = context.workbook.getSelectedRange();
    range.load(["address", "rowCount", "columnCount"]);
    range.worksheet.load("name");
    await context.sync();
    let info: WorkspaceSelection = {
      address: String(range.address),
      rows: Number(range.rowCount),
      columns: Number(range.columnCount),
    };
    if (info.rows === 1 && info.columns === 1) {
      range.load("values");
      await context.sync();
      info.isBlank = String(range.values?.[0]?.[0] ?? "").trim() === "";
      if (info.isBlank) {
        const detected = await findSheetDataRange(range, context);
        if (detected) {
          range = detected;
          range.load(["address", "rowCount", "columnCount"]);
          range.worksheet.load("name");
          await context.sync();
          info = {
            address: String(range.address),
            rows: Number(range.rowCount),
            columns: Number(range.columnCount),
          };
        }
      }
    }
    let schema: WorkspaceSchema | undefined;
    // One filled cell inside a table: read the schema of the surrounding table (selection unchanged),
    // so the idle suggestions can name real columns.
    let schemaRange = range;
    let schemaInfo = info;
    if (info.rows === 1 && info.columns === 1 && !info.isBlank) {
      const table = await findSheetDataRange(range, context);
      if (table) {
        table.load(["address", "rowCount", "columnCount"]);
        await context.sync();
        schemaRange = table;
        schemaInfo = {
          address: String(table.address),
          rows: Number(table.rowCount),
          columns: Number(table.columnCount),
        };
      }
    }
    const sampleRows = Math.min(Math.max(schemaInfo.rows, 0), 26);
    const sampleColumns = Math.min(Math.max(schemaInfo.columns, 0), 20);
    if (sampleRows >= 2 && sampleColumns >= 1) {
      try {
        const sample = schemaRange
          .getCell(0, 0)
          .getResizedRange(sampleRows - 1, sampleColumns - 1);
        sample.load("values");
        await context.sync();
        const values = (sample.values as unknown[][]).map((row) =>
          row.map((cell) =>
            typeof cell === "string" ||
            typeof cell === "number" ||
            typeof cell === "boolean" ||
            cell === null
              ? cell
              : String(cell ?? ""),
          ),
        );
        const summary = buildSchemaSummary({
          workbookId: "local-workspace-context",
          worksheetName: String(schemaRange.worksheet.name),
          address: schemaInfo.address,
          values,
        });
        schema = {
          hasMeasure: summary.columns.some(
            (column) => column.roleHint === "measure",
          ),
          hasDate: summary.columns.some((column) => column.roleHint === "date"),
          hasCategory: summary.columns.some(
            (column) => column.roleHint === "category",
          ),
          hasText: summary.columns.some((column) => column.roleHint === "text"),
          sampleRows: Math.max(0, values.length - summary.headerRowCount),
          columns: summary.columns.map((column) => ({
            name: column.name,
            role: column.roleHint,
          })),
          blankColumns: summary.columns
            .map((column, index) => ({ column, index }))
            .filter(({ index }) =>
              values
                .slice(summary.headerRowCount)
                .some((row) => String(row[index] ?? "").trim() === ""),
            )
            .map(({ column }) => column.name),
          tableAddress: schemaInfo.address,
          otherSheets: await readOtherSheetHeaders(
            context,
            String(schemaRange.worksheet.name),
          ),
        };
      } catch (error) {
        onSchemaError?.(error);
      }
    }
    return { info, schema };
  });
}

/**
 * A clicked blank cell is common in Excel. Resolve it to the first usable data block on the
 * same sheet without selecting or changing anything in the workbook. This mirrors the bounded
 * detection used by the real inspection path so the context card and Run use the same source.
 */
async function findSheetDataRange(
  selected: any,
  context: any,
): Promise<any | undefined> {
  const candidates: Array<() => any> = [];
  if (typeof selected.getSurroundingRegion === "function")
    candidates.push(() => selected.getSurroundingRegion());
  if (typeof selected.getUsedRangeOrNullObject === "function")
    candidates.push(() => selected.getUsedRangeOrNullObject(true));
  const worksheet = selected.worksheet;
  if (typeof worksheet?.getUsedRangeOrNullObject === "function")
    candidates.push(() => worksheet.getUsedRangeOrNullObject(true));

  for (const make of candidates) {
    try {
      let found = make();
      found.load(["address", "rowCount", "columnCount", "isNullObject"]);
      await context.sync();
      if (found.isNullObject) continue;
      if (Number(found.rowCount) > 2 && typeof found.getCell === "function") {
        try {
          const block = found.getCell(0, 0).getSurroundingRegion();
          block.load(["address", "rowCount", "columnCount"]);
          await context.sync();
          if (Number(block.rowCount) >= 2) found = block;
        } catch {
          // Keep the used range when the host cannot resolve a surrounding region.
        }
      }
      if (Number(found.rowCount) >= 2 && Number(found.columnCount) >= 1)
        return found;
    } catch {
      // Try the next host-compatible detection method.
    }
  }
  return undefined;
}

/** First-row header names of the other sheets: one small read, at most 10 sheets, never values below row 1. */
async function readOtherSheetHeaders(
  context: any,
  activeName: string,
): Promise<{ name: string; headers: string[] }[]> {
  try {
    const sheets = context.workbook.worksheets;
    sheets.load("items/name");
    await context.sync();
    const names: string[] = (sheets.items ?? [])
      .map((sheet: any) => String(sheet.name))
      .filter((name: string) => name !== activeName && !/^vynorai/i.test(name))
      .slice(0, 10);
    const ranges = names.map((name) => {
      const range = sheets.getItem(name).getRange("A1:T1");
      range.load("values");
      return range;
    });
    await context.sync();
    return names.map((name, index) => ({
      name,
      headers: ((ranges[index].values?.[0] ?? []) as unknown[])
        .map((cell) => String(cell ?? "").trim())
        .filter(Boolean),
    }));
  } catch {
    return [];
  }
}
