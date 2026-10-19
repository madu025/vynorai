/**
 * The Excel side of the agent (`agent.ts`): bounded reads, a side-effect-free `calculate`, and the
 * approved apply with undo. Reads never return more than the agent limits; `calculate` writes the
 * formula on a hidden temporary sheet and deletes it again. Every apply first records how to undo:
 * new sheets are deleted, overwritten cells get their old formulas back, and an in-place edit of a
 * large range (sort, a big format) works on a hidden backup copy of the sheet made first.
 */
import {
  CALC_MAX_COLUMNS,
  CALC_MAX_ROWS,
  describeChange,
  parseA1,
  type AgentHost,
  type StagedChange,
} from "./agent.js";
import type { ExcelRuntimeLike } from "./officeExcel.js";

const CALC_SHEET = "VynorAI_calc";
const BACKUP_MARK = "vynorai-backup";
/** In-place formats up to this size are undone from a snapshot; larger ones from a backup copy. */
const SNAPSHOT_CELLS = 50_000;
const isInternal = (name: string) =>
  name === CALC_SHEET || /^VynorAI_backup/.test(name);

const isoDate = (serial: number) =>
  new Date(Math.round((serial - 25569) * 86_400_000))
    .toISOString()
    .slice(0, 10);
/** Date cells come back as text (2025-03-01) so the model reads them as dates. */
function readable(values: any[][], formats: any[][] | undefined): any[][] {
  return values.map((row, r) =>
    row.map((value, c) => {
      const format = String(formats?.[r]?.[c] ?? "");
      return typeof value === "number" &&
        /[dy]/i.test(format) &&
        !/[#0]/.test(format) &&
        value > 0
        ? isoDate(value)
        : value;
    }),
  );
}

function guessType(values: unknown[], formats: unknown[]): string {
  const present = values
    .map((value, index) => ({ value, format: String(formats[index] ?? "") }))
    .filter((item) => item.value !== "" && item.value !== null);
  if (!present.length) return "empty";
  if (
    present.every(
      (item) =>
        typeof item.value === "number" &&
        /[dy]/i.test(item.format) &&
        !/[#0]/.test(item.format),
    )
  )
    return "date";
  if (present.every((item) => typeof item.value === "number")) return "number";
  return "text";
}

export function createOfficeAgentHost(
  runtime: ExcelRuntimeLike,
  checkStep: AgentHost["checkStep"],
): AgentHost {
  return {
    checkStep,
    getWorkbook: () =>
      runtime.run(async (context) => {
        const sheets = context.workbook.worksheets;
        sheets.load("items/name,items/visibility");
        const tables = context.workbook.tables;
        tables.load("items/name");
        const active = sheets.getActiveWorksheet();
        active.load("name");
        const selection = context.workbook.getSelectedRange();
        selection.load("address");
        await context.sync();
        const visible = sheets.items.filter(
          (sheet: any) =>
            !isInternal(String(sheet.name)) &&
            sheet.visibility !== "VeryHidden",
        );
        const used = visible.map((sheet: any) => {
          const range = sheet.getUsedRangeOrNullObject(true);
          range.load(["isNullObject", "address", "rowCount", "columnCount"]);
          return { sheet, range };
        });
        await context.sync();
        const activeUsed = used.find(
          (item: any) => item.sheet.name === active.name,
        )?.range;
        let data: unknown;
        if (activeUsed && !activeUsed.isNullObject) {
          const top = activeUsed.getRow(0).getResizedRange(3, 0);
          top.load(["values", "numberFormat"]);
          await context.sync();
          const [headers, ...firstRows] = top.values as any[][];
          const formats = (top.numberFormat as any[][]).slice(1);
          const start = parseA1(String(activeUsed.address).split("!").pop()!);
          data = {
            sheet: String(active.name),
            address: String(activeUsed.address).split("!").pop(),
            headerRow: start.row,
            dataRows: Math.max(0, Number(activeUsed.rowCount) - 1),
            columns: headers.map((header: unknown, index: number) => ({
              letter: columnLetter(start.column + index),
              name: String(header ?? ""),
              type: guessType(
                firstRows.map((row) => row[index]),
                formats.map((row) => row[index]),
              ),
            })),
            firstRows: readable(firstRows, formats),
          };
        }
        return {
          activeSheet: String(active.name),
          selection: String(selection.address).split("!").pop(),
          sheets: used.map(({ sheet, range }: any) => ({
            name: String(sheet.name),
            usedRange: range.isNullObject
              ? null
              : String(range.address).split("!").pop(),
            rows: range.isNullObject ? 0 : Number(range.rowCount),
            columns: range.isNullObject ? 0 : Number(range.columnCount),
          })),
          tables: tables.items.map((table: any) => String(table.name)),
          ...(data ? { data } : {}),
        };
      }),
    readRange: (sheet, address, formulas) =>
      runtime.run(async (context) => {
        const range = context.workbook.worksheets
          .getItem(sheet)
          .getRange(address);
        range.load([
          "address",
          "values",
          "numberFormat",
          ...(formulas ? ["formulas"] : []),
        ]);
        await context.sync();
        return {
          address: String(range.address).split("!").pop()!,
          values: readable(range.values, range.numberFormat),
          ...(formulas ? { formulas: range.formulas } : {}),
        };
      }),
    calculate: (formula) =>
      runtime.run(async (context) => {
        const sheets = context.workbook.worksheets;
        let sheet = sheets.getItemOrNullObject(CALC_SHEET);
        sheet.load("isNullObject");
        await context.sync();
        if (sheet.isNullObject) {
          sheet = sheets.add(CALC_SHEET);
          sheet.visibility = "Hidden";
        }
        try {
          const cell = sheet.getRange("A1");
          cell.formulas = [[formula]];
          await context.sync();
          const spill = cell.getSpillingToRangeOrNullObject();
          spill.load(["isNullObject", "rowCount", "columnCount"]);
          await context.sync();
          if (spill.isNullObject) {
            cell.load("values");
            await context.sync();
            return cell.values;
          }
          const rows = Number(spill.rowCount);
          const columns = Number(spill.columnCount);
          const first = sheet.getRangeByIndexes(
            0,
            0,
            Math.min(rows, CALC_MAX_ROWS),
            Math.min(columns, CALC_MAX_COLUMNS),
          );
          first.load("values");
          await context.sync();
          return rows > CALC_MAX_ROWS || columns > CALC_MAX_COLUMNS
            ? { rows, columns, first: first.values }
            : first.values;
        } finally {
          sheet.delete();
          await context.sync();
        }
      }),
  };
}

function columnLetter(index: number): string {
  let value = index;
  let letters = "";
  do {
    letters = String.fromCharCode(65 + (value % 26)) + letters;
    value = Math.floor(value / 26) - 1;
  } while (value >= 0);
  return letters;
}

// --- apply and undo -------------------------------------------------------------------------

export interface AgentUndo {
  createdSheets: string[];
  /** Old formulas of overwritten cells, restored in reverse order. */
  restores: { sheet: string; address: string; formulas: any[][] }[];
  formats: {
    sheet: string;
    address: string;
    numberFormat: any[][];
    cells: any[][];
  }[];
  /** Hidden copies made before an in-place edit of a large range. */
  backups: { sheet: string; backup: string; address: string }[];
  /** Undo data of built-in steps, handed back to the caller's rollback. */
  steps: unknown[];
}

export type AgentApplyResult = {
  change: string;
  status: "applied" | "failed" | "skipped";
  detail?: unknown;
};

export type StepRunner = (instruction: string) => Promise<{
  ok: boolean;
  detail: unknown;
  rollback?: unknown;
  error?: string;
}>;

/** Applies approved changes in order; stops at the first failure. Undo data is kept for what ran. */
export async function applyAgentChanges(
  runtime: ExcelRuntimeLike,
  changes: StagedChange[],
  runStep: StepRunner,
): Promise<{ results: AgentApplyResult[]; undo: AgentUndo }> {
  const undo: AgentUndo = {
    createdSheets: [],
    restores: [],
    formats: [],
    backups: [],
    steps: [],
  };
  const results: AgentApplyResult[] = [];
  const renamed = new Map<string, string>();
  const sheetOf = (name: string) => renamed.get(name) ?? name;
  let failed = false;
  for (const change of changes) {
    const label = describeChange(change);
    if (failed) {
      results.push({ change: label, status: "skipped" });
      continue;
    }
    try {
      if (change.kind === "vynor_step") {
        const ran = await runStep(change.instruction);
        if (ran.rollback) undo.steps.push(ran.rollback);
        if (!ran.ok) throw new Error(ran.error ?? "the step failed");
        results.push({ change: label, status: "applied", detail: ran.detail });
        continue;
      }
      const detail = await runtime.run(async (context) => {
        const sheets = context.workbook.worksheets;
        if (change.kind === "create_sheet") {
          sheets.load("items/name");
          await context.sync();
          const taken = new Set(
            sheets.items.map((sheet: any) => String(sheet.name).toLowerCase()),
          );
          let name = change.name;
          for (let n = 2; taken.has(name.toLowerCase()); n += 1)
            name = `${change.name.slice(0, 28)} ${n}`;
          const sheet = sheets.add(name);
          sheet.customProperties.add("vynorai", "agent");
          await context.sync();
          renamed.set(change.name, name);
          undo.createdSheets.push(name);
          return { sheet: name };
        }
        const sheetName = sheetOf(change.sheet);
        const sheet = sheets.getItem(sheetName);
        const ours = undo.createdSheets.includes(sheetName);
        if (change.kind === "write_formula" || change.kind === "write_values") {
          const anchor = parseA1(change.cell);
          const target =
            change.kind === "write_values"
              ? sheet.getRangeByIndexes(
                  anchor.row - 1,
                  anchor.column,
                  change.values.length,
                  change.values[0].length,
                )
              : sheet.getRange(change.fillRange ?? change.cell);
          const header =
            change.kind === "write_formula" && change.header && anchor.row > 1
              ? sheet.getRangeByIndexes(anchor.row - 2, anchor.column, 1, 1)
              : undefined;
          if (!ours) {
            for (const range of [target, header].filter(Boolean))
              range.load(["address", "formulas"]);
            await context.sync();
            for (const range of [target, header].filter(Boolean))
              undo.restores.push({
                sheet: sheetName,
                address: String(range.address).split("!").pop()!,
                formulas: range.formulas,
              });
          }
          if (header) header.values = [[(change as any).header]];
          if (change.kind === "write_values") target.values = change.values;
          else {
            const first = target.getCell(0, 0);
            first.formulas = [[change.formula]];
            if (change.fillRange) target.copyFrom(first, "Formulas");
          }
          await context.sync();
          // What was written, for the agent to check: the first rows and any error value.
          const spill = target.getCell(0, 0).getSpillingToRangeOrNullObject();
          spill.load(["isNullObject", "address", "rowCount"]);
          target.load(["rowCount"]);
          await context.sync();
          const shown = spill.isNullObject ? target : spill;
          const rows = Math.max(1, Number(shown.rowCount) || 1);
          const top = shown
            .getCell(0, 0)
            .getResizedRange(Math.min(4, rows - 1), 0);
          top.load("values");
          await context.sync();
          const firstValues = (top.values as any[][]).map((row) => row[0]);
          return {
            address: spill.isNullObject
              ? ((change.kind === "write_formula"
                  ? change.fillRange
                  : undefined) ?? change.cell)
              : String(spill.address).split("!").pop(),
            rows,
            first: firstValues,
            errors: firstValues.filter(
              (value) =>
                typeof value === "string" && /^#[A-Z/0!?]+/.test(value),
            ),
          };
        }
        if (change.kind === "sort_range" || change.kind === "format_range") {
          const range = sheet.getRange(change.address);
          range.load(["rowCount", "columnCount", "values"]);
          if (change.kind === "sort_range") range.getRow(0).load("values");
          await context.sync();
          const cells = Number(range.rowCount) * Number(range.columnCount);
          if (!ours) {
            if (change.kind === "format_range" && cells <= SNAPSHOT_CELLS) {
              range.load("numberFormat");
              const props = range.getCellProperties({
                format: {
                  fill: { color: true },
                  font: { bold: true, color: true },
                },
              });
              await context.sync();
              undo.formats.push({
                sheet: sheetName,
                address: change.address,
                numberFormat: range.numberFormat,
                cells: props.value,
              });
            } else {
              const copy = sheet.copy("End");
              copy.load("name");
              await context.sync();
              copy.visibility = "Hidden";
              copy.customProperties.add(BACKUP_MARK, sheetName);
              await context.sync();
              undo.backups.push({
                sheet: sheetName,
                backup: String(copy.name),
                address: change.address,
              });
            }
          }
          if (change.kind === "sort_range") {
            const header = (range.values as any[][])[0].map((value) =>
              String(value).trim().toLowerCase(),
            );
            const key = header.indexOf(change.column.trim().toLowerCase());
            if (key < 0)
              throw new Error(
                `"${change.column}" is not a header of ${change.address}`,
              );
            range.sort.apply(
              [{ key, ascending: !change.descending }],
              false,
              true,
            );
            await context.sync();
            return { sorted: Number(range.rowCount) - 1 };
          }
          if (change.numberFormat !== undefined)
            range.numberFormat = Array.from(
              { length: Number(range.rowCount) },
              () =>
                Array.from(
                  { length: Number(range.columnCount) },
                  () => change.numberFormat,
                ),
            );
          if (change.bold !== undefined) range.format.font.bold = change.bold;
          if (change.fontColor) range.format.font.color = change.fontColor;
          if (change.fill) range.format.fill.color = change.fill;
          if (change.autofit) range.format.autofitColumns();
          await context.sync();
          return { formatted: cells };
        }
        throw new Error("unknown change");
      });
      results.push({ change: label, status: "applied", detail });
    } catch (error) {
      failed = true;
      results.push({
        change: label,
        status: "failed",
        detail: String((error as Error)?.message ?? error).slice(0, 300),
      });
    }
  }
  return { results, undo };
}

/** Puts back what the agent changed, newest first. Built-in steps are rolled back by `undoStep`. */
export async function undoAgentChanges(
  runtime: ExcelRuntimeLike,
  undo: AgentUndo,
  undoStep: (rollback: unknown) => Promise<void>,
): Promise<void> {
  for (const rollback of [...undo.steps].reverse()) await undoStep(rollback);
  await runtime.run(async (context) => {
    const sheets = context.workbook.worksheets;
    for (const item of [...undo.restores].reverse())
      sheets.getItem(item.sheet).getRange(item.address).formulas =
        item.formulas;
    for (const item of [...undo.formats].reverse()) {
      const range = sheets.getItem(item.sheet).getRange(item.address);
      range.numberFormat = item.numberFormat;
      range.setCellProperties(item.cells);
    }
    await context.sync();
    for (const item of [...undo.backups].reverse()) {
      const backup = sheets.getItem(item.backup);
      sheets
        .getItem(item.sheet)
        .getRange(item.address)
        .copyFrom(backup.getRange(item.address), "All");
      await context.sync();
      backup.delete();
      await context.sync();
    }
    for (const name of [...undo.createdSheets].reverse()) {
      const sheet = sheets.getItemOrNullObject(name);
      sheet.load("isNullObject");
      await context.sync();
      if (!sheet.isNullObject) sheet.delete();
    }
    await context.sync();
  });
}

/** After the person keeps the result: the hidden backup copies are no longer needed. */
export async function dropAgentBackups(
  runtime: ExcelRuntimeLike,
  undo: AgentUndo,
): Promise<void> {
  if (!undo.backups.length) return;
  await runtime.run(async (context) => {
    for (const item of undo.backups) {
      const sheet = context.workbook.worksheets.getItemOrNullObject(
        item.backup,
      );
      sheet.load("isNullObject");
      await context.sync();
      if (!sheet.isNullObject) sheet.delete();
    }
    await context.sync();
  });
  undo.backups = [];
}
