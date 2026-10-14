type ExcelRangeInput = {
  workbookId: string;
  worksheetName: string;
  address: string;
  values: any[][];
  hasHeaders?: boolean;
};
type ExcelActionPlan = any;

/** Minimal structural types keep the add-in build independent of a global Office.js install. */
export interface ExcelContextLike {
  workbook: any;
  sync(): Promise<void>;
}
export interface ExcelRuntimeLike {
  run<T>(callback: (context: ExcelContextLike) => Promise<T>): Promise<T>;
}

export async function inspectSelectedExcelRange(
  runtime: ExcelRuntimeLike,
  workbookId: string,
  chunkRows = 500,
): Promise<ExcelRangeInput> {
  if (!Number.isInteger(chunkRows) || chunkRows < 1 || chunkRows > 5000)
    throw new Error("chunkRows must be an integer between 1 and 5000");
  return runtime.run(async (context) => {
    const selected = context.workbook.getSelectedRange();
    selected.load(["address", "rowCount", "columnCount", "values"]);
    selected.worksheet.load("name");
    await context.sync();
    const values: any[][] = [];
    const rows = Number(selected.rowCount);
    const columns = Number(selected.columnCount);
    for (let start = 0; start < rows; start += chunkRows) {
      const count = Math.min(chunkRows, rows - start);
      const chunk = selected
        .getCell(start, 0)
        .getResizedRange(count - 1, columns - 1);
      chunk.load("values");
      await context.sync();
      values.push(...chunk.values);
    }
    return {
      workbookId,
      worksheetName: selected.worksheet.name,
      address: selected.address,
      values,
      hasHeaders: true,
    };
  });
}

export async function applyApprovedExcelPlan(
  runtime: ExcelRuntimeLike,
  plan: ExcelActionPlan,
  confirmed: boolean,
  approvalToken: string,
): Promise<void> {
  if (!confirmed)
    throw new Error(
      "Explicit confirmation is required before workbook mutation",
    );
  if (!approvalToken)
    throw new Error(
      "A valid approval token is required before workbook mutation",
    );
  await runtime.run(async (context) => {
    const source = context.workbook.worksheets.getItem(plan.worksheetName);
    for (const action of plan.actions) {
      if (action.kind === "table") {
        source.tables.add(plan.sourceAddress, true).name = action.name;
      } else {
        const result = context.workbook.worksheets.getItemOrNullObject(
          action.targetSheet,
        );
        result.load("isNullObject");
        await context.sync();
        const sheet = result.isNullObject
          ? context.workbook.worksheets.add(action.targetSheet)
          : result;
        if (action.kind === "new-sheet")
          sheet.getRange("A1").values = [
            ["VynorAI result", "Source preserved", plan.sourceAddress],
          ];
        if (action.kind === "chart")
          sheet.charts.add(
            "ColumnClustered",
            source.getRange(plan.sourceAddress),
            "Auto",
          ).name = action.name;
        if (action.kind === "pivot-table")
          sheet.pivotTables.add(plan.sourceAddress, "A1", action.name);
      }
    }
    await context.sync();
  });
}
