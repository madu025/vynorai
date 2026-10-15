import {
  canonicalExpression,
  expressionColumnLetter,
  expressionToFormula,
  parseExpression,
  type ExprNode,
} from "./expression.js";
import {
  assertValidExcelTabularRange,
  fingerprintExcelRange,
} from "./excel.js";

import {
  applyView,
  buildQualityReport,
  buildSummaryTable,
  cleanRows,
  computedColumnFormula,
  type CleanOperation,
} from "./transform.js";

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

export type ExcelActionStatus =
  | "created"
  | "exists"
  | "failed"
  | "skipped_unsupported";

export interface ExcelActionResult {
  kind: string;
  name: string;
  targetSheet: string;
  status: ExcelActionStatus;
  error?: string;
}

export interface ExcelApplyReport {
  sourceVerifiedBeforeApply: true;
  sourceUnchangedAfterApply: boolean;
  results: ExcelActionResult[];
}

const MAX_SHEET_NAME = 31;

/** Sheet-local part of an Excel address ("'My Sheet'!A1:C4" -> "A1:C4"). */
export function localExcelAddress(address: string): string {
  const separator = address.lastIndexOf("!");
  return separator === -1 ? address : address.slice(separator + 1);
}

async function readValuesInChunks(
  context: ExcelContextLike,
  range: any,
  rows: number,
  columns: number,
  chunkRows: number,
): Promise<any[][]> {
  const values: any[][] = [];
  for (let start = 0; start < rows; start += chunkRows) {
    const count = Math.min(chunkRows, rows - start);
    const chunk = range
      .getCell(start, 0)
      .getResizedRange(count - 1, columns - 1);
    chunk.load("values");
    await context.sync();
    values.push(...chunk.values);
  }
  return values;
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
    // Values are read in bounded chunks below, not in one large payload here.
    selected.load(["address", "rowCount", "columnCount"]);
    selected.worksheet.load("name");
    await context.sync();
    const rows = Number(selected.rowCount);
    const columns = Number(selected.columnCount);
    if (rows < 2)
      throw new Error(
        "Select a table with a header row and at least one data row.",
      );
    const input = {
      workbookId,
      worksheetName: selected.worksheet.name,
      address: selected.address,
      values: await readValuesInChunks(
        context,
        selected,
        rows,
        columns,
        chunkRows,
      ),
      hasHeaders: true,
    };
    assertValidExcelTabularRange(input);
    return input;
  });
}

/** Re-reads the planned source cells and returns the same local fingerprint the preview used. */
async function sourceFingerprint(
  context: ExcelContextLike,
  plan: ExcelActionPlan,
): Promise<string> {
  const range = context.workbook.worksheets
    .getItem(plan.worksheetName)
    .getRange(localExcelAddress(plan.sourceAddress));
  range.load(["rowCount", "columnCount"]);
  await context.sync();
  const values = await readValuesInChunks(
    context,
    range,
    Number(range.rowCount),
    Number(range.columnCount),
    500,
  );
  return fingerprintExcelRange({
    workbookId: plan.workbookId,
    worksheetName: plan.worksheetName,
    address: plan.sourceAddress,
    values,
  });
}

function errorText(error: unknown): string {
  const value = error as {
    code?: string;
    message?: string;
    debugInfo?: { errorLocation?: string };
  };
  return (
    [value?.code, value?.message, value?.debugInfo?.errorLocation]
      .filter(Boolean)
      .join(": ") || String(error)
  );
}

/**
 * Applies an approved plan one action at a time. The source cells must still match the
 * previewed fingerprint before anything is written, and are checked again afterwards.
 * Each action reports its own outcome so a failure names the exact Excel function.
 */
export async function applyApprovedExcelPlan(
  runtime: ExcelRuntimeLike,
  plan: ExcelActionPlan,
  confirmed: boolean,
  approvalToken: string,
  options: {
    expectedSourceFingerprint: string;
    supportsExcelApi?: (version: string) => boolean;
    requirements?: Record<string, string>;
    onAction?: (result: ExcelActionResult) => void;
  },
): Promise<ExcelApplyReport> {
  if (!confirmed)
    throw new Error(
      "Explicit confirmation is required before workbook mutation",
    );
  if (!approvalToken)
    throw new Error(
      "A valid approval token is required before workbook mutation",
    );
  if (!options?.expectedSourceFingerprint)
    throw new Error("The previewed source fingerprint is required");
  return runtime.run(async (context) => {
    if (
      (await sourceFingerprint(context, plan)) !==
      options.expectedSourceFingerprint
    )
      throw new Error(
        "source_changed_since_preview: the selected data changed after the preview. Inspect it again.",
      );
    const source = context.workbook.worksheets.getItem(plan.worksheetName);
    const sourceRange = () =>
      source.getRange(localExcelAddress(plan.sourceAddress));
    const results: ExcelActionResult[] = [];
    let normalizedSource: any | undefined;

    const actionSourceRange = () => {
      if (!plan.normalization) return sourceRange();
      if (!normalizedSource)
        throw new Error(
          "normalized result sheet was not created; source data was not changed",
        );
      return normalizedSource;
    };

    const writeNormalizedCopy = async (sheet: any) => {
      const range = sourceRange();
      range.load(["rowCount", "columnCount"]);
      await context.sync();
      const values = await readValuesInChunks(
        context,
        range,
        Number(range.rowCount),
        Number(range.columnCount),
        500,
      );
      const normalizedValues = [
        plan.normalization.headers,
        ...values.slice(plan.normalization.headerRowCount),
      ];
      const target = sheet.getRangeByIndexes(
        0,
        0,
        normalizedValues.length,
        plan.normalization.headers.length,
      );
      target.values = normalizedValues;
      await context.sync();
      normalizedSource = target;
    };

    const readSourceValues = async () => {
      const range = sourceRange();
      range.load(["rowCount", "columnCount"]);
      await context.sync();
      return readValuesInChunks(
        context,
        range,
        Number(range.rowCount),
        Number(range.columnCount),
        500,
      );
    };
    const splitHeader = (values: any[][]) =>
      plan.normalization
        ? {
            headers: plan.normalization.headers as string[],
            rows: values.slice(plan.normalization.headerRowCount),
          }
        : {
            headers: (values[0] ?? []).map((cell) => String(cell ?? "")),
            rows: values.slice(1),
          };
    // A text cell that starts with "=" would be evaluated as a formula when written back.
    const literal = (cell: any) =>
      typeof cell === "string" && cell.startsWith("=") ? `'${cell}` : cell;

    for (const action of plan.actions) {
      const result: ExcelActionResult = {
        kind: action.kind,
        name: action.name,
        targetSheet: action.targetSheet,
        status: "created",
      };
      try {
        const required = options.requirements?.[action.kind];
        if (
          required &&
          options.supportsExcelApi &&
          !options.supportsExcelApi(required)
        ) {
          result.status = "skipped_unsupported";
          result.error = `requires ExcelApi ${required}`;
        } else if (action.kind === "table") {
          const existing = context.workbook.tables.getItemOrNullObject(
            action.name,
          );
          existing.load("isNullObject");
          await context.sync();
          if (!existing.isNullObject) result.status = "exists";
          else {
            const targetSheet = context.workbook.worksheets.getItem(
              action.targetSheet,
            );
            targetSheet.tables.add(actionSourceRange(), true).name =
              action.name;
            await context.sync();
          }
        } else {
          if (String(action.targetSheet).length > MAX_SHEET_NAME)
            throw new Error(
              `target sheet name exceeds ${MAX_SHEET_NAME} characters`,
            );
          const found = context.workbook.worksheets.getItemOrNullObject(
            action.targetSheet,
          );
          found.load("isNullObject");
          await context.sync();
          const sheetExists = !found.isNullObject;
          const sheet = sheetExists
            ? found
            : context.workbook.worksheets.add(action.targetSheet);
          if (action.kind === "new-sheet") {
            if (sheetExists) {
              result.status = "exists";
            } else if (plan.normalization) {
              await writeNormalizedCopy(sheet);
            } else {
              sheet.getRange("A1:C1").values = [
                ["VynorAI result", "Source preserved", plan.sourceAddress],
              ];
              await context.sync();
            }
          } else if (action.kind === "chart") {
            const existing = sheet.charts.getItemOrNullObject(action.name);
            existing.load("isNullObject");
            await context.sync();
            if (!existing.isNullObject) result.status = "exists";
            else {
              const spec = action.spec;
              if (spec?.categoryColumn) {
                if (
                  options.supportsExcelApi &&
                  !options.supportsExcelApi("1.7")
                )
                  throw new Error(
                    "skipped_unsupported: column-aware charts need ExcelApi 1.7",
                  );
                const source = actionSourceRange();
                const chartTypes: Record<string, string> = {
                  column: "ColumnClustered",
                  line: "Line",
                  bar: "BarClustered",
                  pie: "Pie",
                  "stacked-column": "ColumnStacked",
                  "stacked-bar": "BarStacked",
                  area: "Area",
                };
                const chart = sheet.charts.add(
                  chartTypes[spec.chartType] ?? "ColumnClustered",
                  source.getColumn(spec.valueIndex),
                  "Columns",
                );
                chart.name = action.name;
                chart.setPosition("H3");
                chart.title.text = `${spec.valueColumn} by ${spec.categoryColumn}`;
                const extras = spec.extraValueIndexes ?? [];
                chart.legend.visible =
                  extras.length > 0 || spec.chartType === "pie";
                if (spec.chartType !== "pie") {
                  chart.axes.categoryAxis.title.text = String(
                    spec.categoryColumn,
                  );
                  chart.axes.valueAxis.title.text =
                    extras.length > 0 ? "Value" : String(spec.valueColumn);
                  chart.axes.valueAxis.numberFormat = "#,##0";
                }
                await context.sync();
                const dataOf = (index: number) =>
                  source
                    .getColumn(index)
                    .getOffsetRange(1, 0)
                    .getResizedRange(-1, 0);
                chart.series
                  .getItemAt(0)
                  .setXAxisValues(dataOf(spec.categoryIndex));
                const extraIndexes: number[] = spec.extraValueIndexes ?? [];
                extraIndexes.forEach((index, position) => {
                  const extra = chart.series.add(
                    String(
                      spec.extraValueColumns?.[position] ??
                        `Series ${position + 2}`,
                    ),
                  );
                  extra.setValues(dataOf(index));
                  extra.setXAxisValues(dataOf(spec.categoryIndex));
                });
                await context.sync();
              } else {
                const chart = sheet.charts.add(
                  "ColumnClustered",
                  actionSourceRange(),
                  "Auto",
                );
                chart.name = action.name;
                chart.setPosition("H3");
                await context.sync();
              }
            }
          } else if (action.kind === "pivot-table") {
            const existing = context.workbook.pivotTables.getItemOrNullObject(
              action.name,
            );
            existing.load("isNullObject");
            await context.sync();
            if (!existing.isNullObject) result.status = "exists";
            else {
              // Office.js order is (name, source, destination); A3 keeps clear of the A1 note.
              const pivot = sheet.pivotTables.add(
                action.name,
                actionSourceRange(),
                sheet.getRange("A3"),
              );
              await context.sync();
              if (action.spec?.rowsColumn) {
                pivot.rowHierarchies.add(
                  pivot.hierarchies.getItem(action.spec.rowsColumn),
                );
                const total = pivot.dataHierarchies.add(
                  pivot.hierarchies.getItem(action.spec.valuesColumn),
                );
                const summarize: Record<string, string> = {
                  sum: "Sum",
                  count: "Count",
                  average: "Average",
                  min: "Min",
                  max: "Max",
                };
                total.summarizeBy =
                  summarize[action.spec.aggregation ?? "sum"] ?? "Sum";
                if (action.spec.columnsColumn)
                  pivot.columnHierarchies.add(
                    pivot.hierarchies.getItem(action.spec.columnsColumn),
                  );
                if (action.spec.filterColumn)
                  pivot.filterHierarchies.add(
                    pivot.hierarchies.getItem(action.spec.filterColumn),
                  );
                await context.sync();
              }
            }
          } else if (action.kind === "clean") {
            if (sheetExists) {
              result.status = "exists";
            } else {
              const { headers, rows } = splitHeader(await readSourceValues());
              const cleaned = cleanRows(
                rows,
                (action.spec?.operations ?? ["trim"]) as CleanOperation[],
              );
              const out = [headers, ...cleaned.rows].map((row) =>
                row.map(literal),
              );
              sheet.getRangeByIndexes(0, 0, out.length, headers.length).values =
                out;
              await context.sync();
            }
          } else if (action.kind === "view") {
            if (sheetExists) {
              result.status = "exists";
            } else {
              const { headers, rows } = splitHeader(await readSourceValues());
              const spec = action.spec ?? {};
              const view = applyView(rows, {
                sort: spec.sort,
                filter: spec.filter,
                highlight: spec.highlight,
              });
              const out = [headers, ...view.rows].map((row) =>
                row.map(literal),
              );
              sheet.getRangeByIndexes(0, 0, out.length, headers.length).values =
                out;
              await context.sync();
              for (const rowIndex of view.highlighted.slice(0, 500))
                sheet.getRangeByIndexes(
                  rowIndex + 1,
                  0,
                  1,
                  headers.length,
                ).format.fill.color = "#FFF2CC";
              if (view.highlighted.length > 0) await context.sync();
            }
          } else if (action.kind === "quality") {
            if (plan.normalization)
              throw new Error(
                "A quality report needs a range with one header row",
              );
            if (sheetExists) {
              result.status = "exists";
            } else {
              const { headers, rows } = splitHeader(await readSourceValues());
              const report = buildQualityReport(
                headers.map(String),
                rows as any,
              );
              const width = Math.max(
                ...report.values.map((row) => row.length),
                1,
              );
              const padded = report.values.map((row) => {
                const cells = row.map((cell) => literal(cell));
                while (cells.length < width) cells.push("");
                return cells;
              });
              sheet.getRangeByIndexes(0, 0, padded.length, width).values =
                padded;
              await context.sync();
              sheet.getRangeByIndexes(0, 0, 1, 1).format.font.bold = true;
              sheet.getRangeByIndexes(
                report.headerRow,
                0,
                1,
                width,
              ).format.font.bold = true;
              sheet
                .getRangeByIndexes(0, 0, padded.length, width)
                .format.autofitColumns();
              await context.sync();
            }
          } else if (action.kind === "format") {
            const spec = action.spec;
            if (!spec) throw new Error("format needs explicit options");
            if (plan.normalization)
              throw new Error("Formatting needs a range with one header row");
            if (sheetExists) {
              result.status = "exists";
            } else {
              const { headers, rows } = splitHeader(await readSourceValues());
              const out = [headers, ...rows].map((row) => row.map(literal));
              const columns = headers.length;
              sheet.getRangeByIndexes(0, 0, out.length, columns).values = out;
              await context.sync();
              const headerRange = sheet.getRangeByIndexes(0, 0, 1, columns);
              headerRange.format.font.bold = true;
              headerRange.format.font.color = "#FFFFFF";
              headerRange.format.fill.color = "#123A6B";
              if (spec.freezeHeader !== false) sheet.freezePanes.freezeRows(1);
              if (rows.length > 0) {
                for (const entry of spec.columnFormats ?? [])
                  sheet.getRangeByIndexes(
                    1,
                    entry.index,
                    rows.length,
                    1,
                  ).numberFormat = rows.map(() => [entry.format]);
                await context.sync();
                for (const rule of spec.conditional ?? []) {
                  const range = sheet.getRangeByIndexes(
                    1,
                    rule.index,
                    rows.length,
                    1,
                  );
                  if (rule.rule === "data-bars") {
                    range.conditionalFormats.add("DataBar");
                  } else if (rule.rule === "color-scale") {
                    const scale = range.conditionalFormats.add("ColorScale");
                    scale.colorScale.criteria = {
                      minimum: { type: "LowestValue", color: "#F8696B" },
                      midpoint: {
                        type: "Percentile",
                        formula: "50",
                        color: "#FFEB84",
                      },
                      maximum: { type: "HighestValue", color: "#63BE7B" },
                    };
                  } else if (rule.rule === "negative") {
                    const negative = range.conditionalFormats.add("CellValue");
                    negative.cellValue.rule = {
                      formula1: "0",
                      operator: "LessThan",
                    };
                    negative.cellValue.format.font.color = "#C00000";
                    negative.cellValue.format.fill.color = "#FFC7CE";
                  } else if (rule.rule === "duplicates") {
                    const dupes = range.conditionalFormats.add("Custom");
                    const letter = expressionColumnLetter(rule.index);
                    const last = rows.length + 1;
                    dupes.custom.rule.formula =
                      "=COUNTIF($" +
                      letter +
                      "$2:$" +
                      letter +
                      "$" +
                      last +
                      "," +
                      letter +
                      "2)>1";
                    dupes.custom.format.fill.color = "#FFC7CE";
                  }
                }
                await context.sync();
                for (const check of spec.validation ?? []) {
                  const range = sheet.getRangeByIndexes(
                    1,
                    check.index,
                    rows.length,
                    1,
                  );
                  if (check.rule === "list" && check.values) {
                    range.dataValidation.rule = {
                      list: {
                        inCellDropDown: true,
                        source: check.values.join(","),
                      },
                    };
                  } else {
                    range.dataValidation.rule = {
                      decimal: {
                        formula1: 0,
                        operator: "GreaterThanOrEqualTo",
                      },
                    };
                  }
                }
                await context.sync();
                if (spec.totalRow) {
                  const totalRowIndex = rows.length + 1;
                  const label = sheet.getRangeByIndexes(totalRowIndex, 0, 1, 1);
                  label.values = [["Total"]];
                  for (const entry of spec.columnFormats ?? []) {
                    const letter = expressionColumnLetter(entry.index);
                    const cell = sheet.getRangeByIndexes(
                      totalRowIndex,
                      entry.index,
                      1,
                      1,
                    );
                    cell.formulas = [
                      [
                        "=SUBTOTAL(109," +
                          letter +
                          "2:" +
                          letter +
                          String(rows.length + 1) +
                          ")",
                      ],
                    ];
                    cell.numberFormat = [[entry.format]];
                  }
                  sheet.getRangeByIndexes(
                    totalRowIndex,
                    0,
                    1,
                    columns,
                  ).format.font.bold = true;
                  await context.sync();
                }
              }
              if (spec.autofit !== false)
                sheet
                  .getRangeByIndexes(0, 0, out.length + 1, columns)
                  .format.autofitColumns();
              await context.sync();
            }
          } else if (action.kind === "summary") {
            const spec = action.spec;
            if (
              !spec?.groups ||
              !spec.summaryValues ||
              spec.groupIndex === undefined
            )
              throw new Error("summary needs explicit group and value columns");
            if (plan.normalization)
              throw new Error("A summary needs a range with one header row");
            if (sheetExists) {
              result.status = "exists";
            } else {
              const source = sourceRange();
              source.load("address");
              await context.sync();
              const table = buildSummaryTable({
                sheetName: plan.worksheetName,
                localAddress: localExcelAddress(plan.sourceAddress),
                groupIndex: spec.groupIndex,
                groups: spec.groups,
                values: spec.summaryValues.map((entry: any) => ({
                  column: entry.column,
                  index: entry.index,
                  aggregation: entry.aggregation,
                })),
                groupHeader: spec.groupColumn ?? "Group",
                includeTotal: spec.includeTotal !== false,
              });
              const grid = sheet.getRangeByIndexes(
                0,
                0,
                table.rowCount,
                table.columnCount,
              );
              // Labels are literal text; numbers are formulas over the source range.
              grid.formulas = table.values.map((row, rowIndex) =>
                row.map((cell, columnIndex) =>
                  rowIndex === 0 || columnIndex === 0 ? literal(cell) : cell,
                ),
              );
              await context.sync();
              sheet.getRangeByIndexes(
                0,
                0,
                1,
                table.columnCount,
              ).format.font.bold = true;
              if (spec.includeTotal !== false)
                sheet.getRangeByIndexes(
                  table.rowCount - 1,
                  0,
                  1,
                  table.columnCount,
                ).format.font.bold = true;
              grid.format.autofitColumns();
              await context.sync();
            }
          } else if (action.kind === "add-column") {
            const spec = action.spec;
            if (!spec?.columnName)
              throw new Error("add-column needs explicit column choices");
            if (sheetExists) {
              result.status = "exists";
            } else {
              const { headers, rows } = splitHeader(await readSourceValues());
              let expressionAst: ExprNode | undefined;
              if (spec.expression !== undefined) {
                const parsed = parseExpression(
                  spec.expression,
                  headers.map(String),
                );
                if (canonicalExpression(parsed.ast) !== spec.canonical)
                  throw new Error(
                    "The expression no longer matches the approved plan",
                  );
                expressionAst = parsed.ast;
              }
              const out = [
                [...headers, spec.columnName],
                ...rows.map((row) => [...row, ""]),
              ].map((row) => row.map(literal));
              sheet.getRangeByIndexes(
                0,
                0,
                out.length,
                headers.length + 1,
              ).values = out;
              await context.sync();
              if (rows.length > 0) {
                sheet.getRangeByIndexes(
                  1,
                  headers.length,
                  rows.length,
                  1,
                ).formulas = rows.map((_row, index) => [
                  expressionAst
                    ? expressionToFormula(
                        expressionAst,
                        (column) =>
                          `${expressionColumnLetter(column)}${index + 2}`,
                      )
                    : computedColumnFormula(
                        index + 2,
                        spec.leftIndex as number,
                        spec.operator as "+",
                        spec.rightIndex as number,
                      ),
                ]);
                if (spec.percentFormat)
                  sheet.getRangeByIndexes(
                    1,
                    headers.length,
                    rows.length,
                    1,
                  ).numberFormat = rows.map(() => ["0.0%"]);
                await context.sync();
              }
            }
          } else {
            throw new Error(`unsupported action ${action.kind}`);
          }
        }
      } catch (error) {
        result.status = "failed";
        result.error = errorText(error);
      }
      results.push(result);
      options.onAction?.(result);
    }

    return {
      sourceVerifiedBeforeApply: true,
      sourceUnchangedAfterApply:
        (await sourceFingerprint(context, plan)) ===
        options.expectedSourceFingerprint,
      results,
    };
  });
}

export interface WorkbookOverview {
  sheets: Array<{ name: string; rows: number; columns: number }>;
  tables: Array<{ name: string; sheet: string; rows: number; columns: number }>;
}

/** Sheet and table names plus sizes only; read-only, and cell values are never loaded. */
export async function inspectWorkbookOverview(
  runtime: ExcelRuntimeLike,
): Promise<WorkbookOverview> {
  return runtime.run(async (context) => {
    const sheets = context.workbook.worksheets;
    sheets.load("items/name");
    const tables = context.workbook.tables;
    tables.load("items/name");
    await context.sync();
    const used = sheets.items.map((sheet: any) => {
      const range = sheet.getUsedRangeOrNullObject(true);
      range.load(["isNullObject", "rowCount", "columnCount"]);
      return { sheet, range };
    });
    const tableRanges = tables.items.map((table: any) => {
      const range = table.getRange();
      range.load(["rowCount", "columnCount"]);
      table.worksheet.load("name");
      return { table, range };
    });
    await context.sync();
    return {
      sheets: used.map(({ sheet, range }: any) => ({
        name: String(sheet.name),
        rows: range.isNullObject ? 0 : Number(range.rowCount),
        columns: range.isNullObject ? 0 : Number(range.columnCount),
      })),
      tables: tableRanges.map(({ table, range }: any) => ({
        name: String(table.name),
        sheet: String(table.worksheet.name),
        rows: Number(range.rowCount),
        columns: Number(range.columnCount),
      })),
    };
  });
}

const CREATED_SHEET =
  /^[A-Za-z0-9_]{1,18}_Vynor_(Result|Clean|Calc|Totals|Format|Report|View)$/;
const CREATED_TABLE = /^[A-Za-z0-9_]{1,18}_Vynor_table$/;

export interface RollbackReport {
  removedSheets: string[];
  convertedTables: string[];
  skipped: string[];
}

/**
 * Removes only the result sheets and the Table this add-in created in the session. Names must
 * match the generated patterns, so source or unrelated sheets can never be deleted. A Table is
 * converted back to a plain range; the cell values are kept.
 */
export async function rollbackCreatedItems(
  runtime: ExcelRuntimeLike,
  items: { sheets: string[]; tables: string[] },
  confirmed: boolean,
): Promise<RollbackReport> {
  if (!confirmed)
    throw new Error("Explicit confirmation is required before rollback");
  return runtime.run(async (context) => {
    const report: RollbackReport = {
      removedSheets: [],
      convertedTables: [],
      skipped: [],
    };
    for (const name of [...new Set(items.tables)]) {
      if (!CREATED_TABLE.test(name)) {
        report.skipped.push(name);
        continue;
      }
      const table = context.workbook.tables.getItemOrNullObject(name);
      table.load("isNullObject");
      await context.sync();
      if (table.isNullObject) continue;
      // convertToRange keeps the table style as direct cell formatting, so remove the style
      // first; otherwise "undo" would leave the blue header and banding on the source cells.
      try {
        (table as { style: string | null }).style = null;
        await context.sync();
      } catch {
        // Hosts that refuse an empty style still get the range conversion below.
      }
      table.convertToRange();
      await context.sync();
      report.convertedTables.push(name);
    }
    for (const name of [...new Set(items.sheets)]) {
      if (!CREATED_SHEET.test(name)) {
        report.skipped.push(name);
        continue;
      }
      const sheet = context.workbook.worksheets.getItemOrNullObject(name);
      sheet.load("isNullObject");
      await context.sync();
      if (sheet.isNullObject) continue;
      sheet.delete();
      await context.sync();
      report.removedSheets.push(name);
    }
    return report;
  });
}
