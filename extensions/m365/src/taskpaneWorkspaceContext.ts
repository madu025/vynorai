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
    const range = context.workbook.getSelectedRange();
    range.load(["address", "rowCount", "columnCount"]);
    range.worksheet.load("name");
    await context.sync();
    const info: WorkspaceSelection = {
      address: String(range.address),
      rows: Number(range.rowCount),
      columns: Number(range.columnCount),
    };
    if (info.rows === 1 && info.columns === 1) {
      range.load("values");
      await context.sync();
      info.isBlank = String(range.values?.[0]?.[0] ?? "").trim() === "";
    }
    let schema: WorkspaceSchema | undefined;
    const sampleRows = Math.min(Math.max(info.rows, 0), 26);
    const sampleColumns = Math.min(Math.max(info.columns, 0), 20);
    if (sampleRows >= 2 && sampleColumns >= 1) {
      try {
        const sample = range
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
          worksheetName: String(range.worksheet.name),
          address: info.address,
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
        };
      } catch (error) {
        onSchemaError?.(error);
      }
    }
    return { info, schema };
  });
}
