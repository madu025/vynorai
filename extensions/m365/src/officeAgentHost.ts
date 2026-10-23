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
import { compareWrittenRows } from "./integrity.js";
import {
  describeBusinessMeaning,
  type BusinessMeaning,
} from "./businessContext.js";
import type { M365ApiClient } from "./api.js";
import {
  RUN_CODE_MAX_CELLS,
  runSandboxedCode,
  splitHeaders,
} from "./codeSandbox.js";
import {
  CHART_TYPES,
  readDetails,
  restoreFromBackup,
  runExcelAction,
  sheetAliases,
  undoJournalEntry,
  type ActionRun,
  type JournalEntry,
} from "./officeAgentActions.js";

const CALC_SHEET = "VynorAI_calc";
const BACKUP_MARK = "vynorai-backup";
/** In-place formats up to this size are undone from a snapshot; larger ones from a backup copy. */
const SNAPSHOT_CELLS = 50_000;
/** Rows per request when undo writes old formulas back. */
const RESTORE_ROWS = 20_000;
const CHART_MAX_ROWS = 5000;
/** Cells per read when run_code loads a large range. */
const RUN_CODE_CHUNK_CELLS = 50_000;
/** A hidden backup copy has its own recognisable name, so the agent never mistakes it for the person's sheet. */
const backupName = () =>
  `VynorAI_backup_${Date.now().toString(36)}${Math.floor(Math.random() * 36).toString(36)}`;
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

/** Rows read on the device to work out business meaning; only the derived facts are sent. */
const MEANING_ROWS = 50;

async function readMeaning(
  context: any,
  used: any,
  headers: unknown[],
  formats: unknown[] | undefined,
): Promise<BusinessMeaning | undefined> {
  try {
    const rows = Math.min(MEANING_ROWS, Number(used.rowCount) - 1);
    if (rows < 1) return undefined;
    const body = used
      .getCell(1, 0)
      .getResizedRange(rows - 1, headers.length - 1);
    body.load("values");
    await context.sync();
    return describeBusinessMeaning(
      headers.map((header) => String(header ?? "")),
      body.values as any[][],
      formats,
    );
  } catch {
    return undefined;
  }
}

/** Rows of a write_values change that are read back and compared with what was meant. */
const READ_BACK_ROWS = 200;

/**
 * Reads the top of a write_values target back and names what Excel changed on the way in, such as
 * an ID that lost its leading zeros or text Excel turned into a number or date. Advisory: a failed
 * read never fails the write. Formulas written as values are skipped, since they read back as results.
 */
export async function readBackMismatches(
  context: any,
  target: any,
  values: unknown[][],
): Promise<string[]> {
  try {
    const rows = Math.min(values.length, READ_BACK_ROWS);
    const columns = values[0]?.length ?? 0;
    if (!rows || !columns) return [];
    const back = target.getCell(0, 0).getResizedRange(rows - 1, columns - 1);
    back.load("values");
    await context.sync();
    const isFormula = (cell: unknown) =>
      typeof cell === "string" && cell.startsWith("=");
    const expected = values.slice(0, rows).map((row) =>
      row.map((cell) =>
        isFormula(cell)
          ? null
          : typeof cell === "string" && cell.startsWith("'")
            ? cell.slice(1) // Excel keeps the text and drops the apostrophe.
            : (cell as any),
      ),
    );
    const actual = (back.values as unknown[][]).map((row, r) =>
      row.map((cell, c) => (isFormula(values[r]?.[c]) ? null : cell)),
    );
    // Columns are named by their place in the written range ("column 1" is its first column).
    return compareWrittenRows(expected, actual, [], expected.length).map(
      (issue) => issue.message,
    );
  } catch {
    return [];
  }
}

export function createOfficeAgentHost(
  runtime: ExcelRuntimeLike,
  checkStep: AgentHost["checkStep"],
  api?: M365ApiClient,
): AgentHost {
  return {
    checkStep,
    runCode: async ({ sheet, areas, code, hasHeaders }) => {
      const values = await runtime.run(async (context) => {
        const worksheet = context.workbook.worksheets.getItem(sheet);
        const used = worksheet.getUsedRange();
        // Whole columns (A:D) are cut to the used rows.
        const ranges = areas.map((area) => {
          const range = worksheet
            .getRange(area)
            .getIntersectionOrNullObject(used);
          range.load(["isNullObject", "rowIndex", "rowCount", "columnCount"]);
          return range;
        });
        await context.sync();
        const present = ranges.filter((range) => !range.isNullObject);
        if (!present.length) return [] as unknown[][];
        const rows = Number(present[0].rowCount);
        if (
          present.some(
            (range) =>
              Number(range.rowCount) !== rows ||
              Number(range.rowIndex) !== Number(present[0].rowIndex),
          )
        )
          throw new Error("The ranges must cover the same rows.");
        const columns = present.reduce(
          (sum, range) => sum + Number(range.columnCount),
          0,
        );
        if (rows * columns > RUN_CODE_MAX_CELLS)
          throw new Error(
            `That is ${rows * columns} cells; run_code reads at most ${RUN_CODE_MAX_CELLS}. Read only the columns you need (for example B:B,H:H).`,
          );
        // Number formats of the first rows say which columns hold dates; reading them for
        // every cell would double what a large range costs.
        const heads = present.map((range) => {
          const head = range
            .getCell(0, 0)
            .getResizedRange(
              Math.min(rows, 3) - 1,
              Number(range.columnCount) - 1,
            );
          head.load("numberFormat");
          return head;
        });
        await context.sync();
        const formats = heads.flatMap((head, index) =>
          Array.from(
            { length: Number(present[index].columnCount) },
            (_, column) =>
              String(
                (head.numberFormat as any[][])
                  .map((row) => row[column])
                  .find((format) => /[dy]/i.test(String(format))) ?? "",
              ),
          ),
        );
        // Read in blocks so a large range stays within Excel on the web's request size.
        const step = Math.max(1, Math.floor(RUN_CODE_CHUNK_CELLS / columns));
        const all: unknown[][] = [];
        for (let top = 0; top < rows; top += step) {
          const count = Math.min(step, rows - top);
          const blocks = present.map((range) => {
            const block = range
              .getCell(top, 0)
              .getResizedRange(count - 1, Number(range.columnCount) - 1);
            block.load("values");
            return block;
          });
          await context.sync();
          for (let row = 0; row < count; row += 1) {
            const cells = blocks.flatMap(
              (block) => (block.values as unknown[][])[row],
            );
            all.push(readable([cells], [formats])[0]);
          }
        }
        return all;
      });
      const outcome = await runSandboxedCode({
        ...splitHeaders(values, hasHeaders),
        code,
      });
      if (!outcome.ok) return { error: outcome.error };
      return {
        result: outcome.result,
        rows_read: Math.max(0, values.length - (hasHeaders ? 1 : 0)),
      };
    },
    getDetails: (what, sheet, address) =>
      runtime.run((context) => readDetails(context, what, sheet, address)),
    getWorkbook: () =>
      runtime.run(async (context) => {
        const sheets = context.workbook.worksheets;
        sheets.load("items/name,items/visibility");
        const tables = context.workbook.tables;
        tables.load("items/name");
        const active = sheets.getActiveWorksheet();
        active.load("name");
        await context.sync();
        // A chart or shape can be selected: then there is no cell selection, and nothing else fails.
        let selectionAddress = "";
        try {
          const selection = context.workbook.getSelectedRange();
          selection.load("address");
          await context.sync();
          selectionAddress = String(selection.address);
        } catch {
          selectionAddress = "";
        }
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
          // An Excel Table changes how new columns behave: say so.
          const tables = active.tables;
          tables.load("items/name");
          await context.sync();
          const tableRanges = tables.items.map((table: any) => {
            const range = table.getRange();
            range.load("address");
            return { table, range };
          });
          await context.sync();
          data = {
            ...(tableRanges.length
              ? {
                  tables: tableRanges.map(({ table, range }: any) => ({
                    name: String(table.name),
                    address: String(range.address).split("!").pop(),
                  })),
                }
              : {}),
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
            meaning: await readMeaning(
              context,
              activeUsed,
              headers,
              formats[0],
            ),
          };
        }
        return {
          activeSheet: String(active.name),
          selection: selectionAddress.split("!").pop() || undefined,
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
    ...(api
      ? {
          analyzeTextBatch: (input: {
            feature: "sentiment" | "keywords" | "classification";
            texts: string[];
            categories?: string[];
          }) =>
            api.analyzeTextBatch({
              ...input,
              consent: true,
            }),
        }
      : {}),
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
  /** Old formulas of overwritten cells; null when they were all empty (undo clears them). */
  restores: { sheet: string; address: string; formulas: any[][] | null }[];
  /** Table sizes before a write next to them: Excel grows a Table into the new column. */
  tableSizes?: { name: string; columns: number }[];
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
  /** Charts added to sheets the agent did not create. */
  charts?: { sheet: string; name: string }[];
  /** Undo of workbook-object actions (officeAgentActions.ts), newest last. */
  journal?: JournalEntry[];
  /**
   * Cumulative length of every list above after each change ran, so undo can walk the changes
   * newest first instead of category by category.
   */
  marks?: UndoMark[];
  /** Which marked parts already came back, so a second Undo does not run them again. */
  settled?: boolean[];
}

export interface UndoMark {
  steps: number;
  journal: number;
  tableSizes: number;
  restores: number;
  formats: number;
  backups: number;
  charts: number;
  createdSheets: number;
}

const markOf = (undo: AgentUndo): UndoMark => ({
  steps: undo.steps.length,
  journal: undo.journal?.length ?? 0,
  tableSizes: undo.tableSizes?.length ?? 0,
  restores: undo.restores.length,
  formats: undo.formats.length,
  backups: undo.backups.length,
  charts: undo.charts?.length ?? 0,
  createdSheets: undo.createdSheets.length,
});

/** The undo entries one change added: marks are cumulative, so a part runs from one to the next. */
export function undoParts(undo: AgentUndo): { from: UndoMark; to: UndoMark }[] {
  const empty = markOf({ createdSheets: [], restores: [], formats: [], backups: [], steps: [] });
  const bounds = [...(undo.marks ?? []), markOf(undo)];
  const parts: { from: UndoMark; to: UndoMark }[] = [];
  let from = empty;
  for (const to of bounds) {
    if (JSON.stringify(from) !== JSON.stringify(to)) parts.push({ from, to });
    from = to;
  }
  return parts;
}

/** Joins the undo data of two applies; the second apply's marks count from the end of the first. */
export function mergeUndoData(earlier: AgentUndo | undefined, next: AgentUndo): AgentUndo {
  if (!earlier) return next;
  const base = markOf(earlier);
  const shift = (mark: UndoMark): UndoMark => ({
    steps: mark.steps + base.steps,
    journal: mark.journal + base.journal,
    tableSizes: mark.tableSizes + base.tableSizes,
    restores: mark.restores + base.restores,
    formats: mark.formats + base.formats,
    backups: mark.backups + base.backups,
    charts: mark.charts + base.charts,
    createdSheets: mark.createdSheets + base.createdSheets,
  });
  return {
    createdSheets: [...earlier.createdSheets, ...next.createdSheets],
    restores: [...earlier.restores, ...next.restores],
    formats: [...earlier.formats, ...next.formats],
    backups: [...earlier.backups, ...next.backups],
    steps: [...earlier.steps, ...next.steps],
    charts: [...(earlier.charts ?? []), ...(next.charts ?? [])],
    tableSizes: [...(earlier.tableSizes ?? []), ...(next.tableSizes ?? [])],
    journal: [...(earlier.journal ?? []), ...(next.journal ?? [])],
    marks: [...(earlier.marks ?? []), base, ...(next.marks ?? []).map(shift)],
    settled: undefined,
  };
}

export type AgentApplyResult = {
  change: string;
  status: "applied" | "failed" | "skipped";
  detail?: unknown;
  /** How long the change took in Excel. */
  ms?: number;
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
  options: {
    /** Called before each change: 1-based position, total, description. */
    onProgress?: (index: number, total: number, label: string) => void;
    /** True when the person pressed Stop: the rest is skipped (what ran stays undoable). */
    isCancelled?: () => boolean;
  } = {},
): Promise<{ results: AgentApplyResult[]; undo: AgentUndo }> {
  const undo: AgentUndo = {
    createdSheets: [],
    restores: [],
    formats: [],
    backups: [],
    steps: [],
    journal: [],
  };
  undo.marks = [];
  const results: AgentApplyResult[] = [];
  const renamed = new Map<string, string>();
  const createdNames = new Set<string>();
  const backedUp = new Set<string>();
  const sheetOf = (name: string) => renamed.get(name) ?? name;
  let failed = false;
  for (const [position, change] of changes.entries()) {
    undo.marks.push(markOf(undo));
    const label = describeChange(change);
    if (failed || options.isCancelled?.()) {
      results.push({ change: label, status: "skipped" });
      continue;
    }
    options.onProgress?.(position + 1, changes.length, label);
    const started = Date.now();
    try {
      if (change.kind === "vynor_step") {
        const ran = await runStep(change.instruction);
        if (ran.rollback) undo.steps.push(ran.rollback);
        if (!ran.ok) throw new Error(ran.error ?? "the step failed");
        results.push({
          change: label,
          status: "applied",
          detail: ran.detail,
          ms: Date.now() - started,
        });
        continue;
      }
      const detail = await runtime.run(async (context) => {
        const sheets = context.workbook.worksheets;
        if (change.kind === "excel_action") {
          const run: ActionRun = {
            context,
            sheet: (name) => sheets.getItem(sheetOf(name)),
            ours: (name) => createdNames.has(sheetOf(name)),
            journal: undo.journal!,
            rename: (from, to) => {
              renamed.set(from, to);
              if (createdNames.has(from)) createdNames.add(to);
            },
            backup: async (name) => {
              const sheet = sheets.getItem(sheetOf(name));
              sheet.load("id");
              await context.sync();
              const id = String(sheet.id);
              if (backedUp.has(id)) return;
              const copy = sheet.copy("End");
              copy.load("id");
              await context.sync();
              copy.name = backupName();
              copy.visibility = "Hidden";
              copy.customProperties.add(BACKUP_MARK, id);
              await context.sync();
              undo.journal!.push({
                type: "backup",
                sheetId: id,
                backupId: String(copy.id),
              });
              backedUp.add(id);
            },
          };
          return runExcelAction(run, change.tool, change.args);
        }
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
          sheet.load("id");
          await context.sync();
          renamed.set(change.name, name);
          createdNames.add(name);
          undo.createdSheets.push(String(sheet.id));
          return { sheet: name };
        }
        const sheetName = sheetOf(change.sheet);
        const sheet = sheets.getItem(sheetName);
        sheet.load("id");
        await context.sync();
        // Undo data refers to the sheet id, so a later rename cannot break it.
        const sheetKey = String(sheet.id);
        const ours = createdNames.has(sheetName);
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
            const tables = sheet.tables;
            tables.load("items/name");
            await context.sync();
            const counts = tables.items.map((table: any) => {
              const columns = table.columns;
              columns.load("count");
              return { table, columns };
            });
            await context.sync();
            for (const { table, columns } of counts)
              if (
                !(undo.tableSizes ??= []).some(
                  (item) => item.name === table.name,
                )
              )
                undo.tableSizes.push({
                  name: String(table.name),
                  columns: Number(columns.count),
                });
            for (const range of [target, header].filter(Boolean)) {
              const formulas = range.formulas as any[][];
              undo.restores.push({
                sheet: sheetKey,
                address: String(range.address).split("!").pop()!,
                // A large empty area is cleared on undo instead of written back cell by cell.
                formulas: formulas.every((row) =>
                  row.every((cell) => cell === "" || cell === null),
                )
                  ? null
                  : formulas,
              });
            }
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
          const mismatches =
            change.kind === "write_values"
              ? await readBackMismatches(context, target, change.values)
              : [];
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
            ...(mismatches.length ? { mismatches } : {}),
          };
        }
        if (change.kind === "create_chart") {
          const source = change.address
            ? sheet.getRange(change.address)
            : sheet.getUsedRange(true);
          source.load(["address", "rowCount"]);
          await context.sync();
          if (Number(source.rowCount) > CHART_MAX_ROWS)
            throw new Error(
              `${source.rowCount} rows is too many for a chart; chart a summary table (GROUPBY) instead`,
            );
          const chart = sheet.charts.add(
            CHART_TYPES[change.chartType],
            source,
            "Auto",
          );
          if (change.title) chart.title.text = change.title;
          if (change.position) {
            const [start, end = start] = change.position.split(":");
            chart.setPosition(start, end);
          }
          chart.load("name");
          await context.sync();
          if (!ours)
            (undo.charts ??= []).push({
              sheet: sheetKey,
              name: String(chart.name),
            });
          return {
            chart: String(chart.name),
            source: String(source.address).split("!").pop(),
          };
        }
        if (change.kind === "sort_range" || change.kind === "format_range") {
          const range = sheet.getRange(change.address);
          // Never load the cells of a large range: only its size, and the header row for a sort.
          range.load(["rowCount", "columnCount"]);
          const headerRow = range.getRow(0);
          if (change.kind === "sort_range") headerRow.load("values");
          await context.sync();
          const cells = Number(range.rowCount) * Number(range.columnCount);
          const structural =
            change.kind === "format_range" &&
            (change.mergeCenter ||
              change.style ||
              change.clear ||
              change.copyFrom);
          if (!ours) {
            if (
              change.kind === "format_range" &&
              cells <= SNAPSHOT_CELLS &&
              !structural
            ) {
              range.load("numberFormat");
              const props = range.getCellProperties({
                format: SNAPSHOT_FORMAT,
              });
              await context.sync();
              undo.formats.push({
                sheet: sheetKey,
                address: change.address,
                numberFormat: range.numberFormat,
                cells: props.value,
              });
            } else {
              const copy = sheet.copy("End");
              copy.load("id");
              await context.sync();
              copy.name = backupName();
              copy.visibility = "Hidden";
              copy.customProperties.add(BACKUP_MARK, sheetKey);
              await context.sync();
              undo.backups.push({
                sheet: sheetKey,
                backup: String(copy.id),
                address: change.address,
              });
            }
          }
          if (change.kind === "sort_range") {
            const header = (headerRow.values as any[][])[0].map((value) =>
              String(value).trim().toLowerCase(),
            );
            const keyOf = (column: string) => {
              const key = header.indexOf(column.trim().toLowerCase());
              if (key < 0)
                throw new Error(
                  `"${column}" is not a header of ${change.address}`,
                );
              return key;
            };
            if (change.byColumns) {
              range.sort.apply(
                [{ key: 0, ascending: !change.descending }],
                false,
                false,
                "Columns",
              );
              await context.sync();
              return { sortedColumns: Number(range.columnCount) };
            }
            range.sort.apply(
              [
                {
                  key: keyOf(change.column),
                  ascending: !change.descending,
                  ...(change.customOrder
                    ? { customOrder: change.customOrder }
                    : {}),
                },
                ...(change.then ?? []).map((next) => ({
                  key: keyOf(next.column),
                  ascending: !next.descending,
                })),
              ],
              false,
              true,
            );
            await context.sync();
            return { sorted: Number(range.rowCount) - 1 };
          }
          if (change.copyFrom)
            range.copyFrom(sheet.getRange(change.copyFrom), "Formats");
          if (change.clear) range.clear("Formats");
          if (change.style) range.style = change.style;
          if (change.numberFormat !== undefined)
            // One value applies to every cell, without building a huge array.
            (range as { numberFormat: unknown }).numberFormat =
              change.numberFormat;
          const format = range.format;
          if (change.bold !== undefined) format.font.bold = change.bold;
          if (change.italic !== undefined) format.font.italic = change.italic;
          if (change.underline !== undefined)
            format.font.underline = change.underline ? "Single" : "None";
          if (change.fontColor) format.font.color = change.fontColor;
          if (change.fontName) format.font.name = change.fontName;
          if (change.fontSize) format.font.size = change.fontSize;
          if (change.fill) format.fill.color = change.fill;
          if (change.horizontal)
            format.horizontalAlignment =
              change.horizontal === "center"
                ? "Center"
                : change.horizontal === "left"
                  ? "Left"
                  : "Right";
          if (change.vertical)
            format.verticalAlignment =
              change.vertical === "center"
                ? "Center"
                : change.vertical === "top"
                  ? "Top"
                  : "Bottom";
          if (change.wrap !== undefined) format.wrapText = change.wrap;
          if (change.indent !== undefined) format.indentLevel = change.indent;
          if (change.rotation !== undefined)
            format.textOrientation = change.rotation;
          if (change.borders) {
            const edges =
              change.borders === "bottom"
                ? ["EdgeBottom"]
                : change.borders === "outside"
                  ? ["EdgeTop", "EdgeBottom", "EdgeLeft", "EdgeRight"]
                  : [
                      "EdgeTop",
                      "EdgeBottom",
                      "EdgeLeft",
                      "EdgeRight",
                      "InsideHorizontal",
                      "InsideVertical",
                    ];
            for (const edge of [
              "EdgeTop",
              "EdgeBottom",
              "EdgeLeft",
              "EdgeRight",
              "InsideHorizontal",
              "InsideVertical",
            ]) {
              const border = format.borders.getItem(edge);
              border.style =
                change.borders !== "none" && edges.includes(edge)
                  ? "Continuous"
                  : "None";
            }
          }
          if (change.mergeCenter) {
            range.merge(false);
            format.horizontalAlignment = "Center";
          }
          if (change.autofit) format.autofitColumns();
          await context.sync();
          return { formatted: cells };
        }
        throw new Error("unknown change");
      });
      results.push({
        change: label,
        status: "applied",
        detail,
        ms: Date.now() - started,
      });
    } catch (error) {
      failed = true;
      results.push({
        change: label,
        status: "failed",
        detail: String((error as Error)?.message ?? error).slice(0, 300),
        ms: Date.now() - started,
      });
    }
  }
  return { results, undo };
}

/** The cell formats a small in-place format records, so undo can set them back exactly. */
const SNAPSHOT_FORMAT = {
  fill: { color: true },
  font: {
    bold: true,
    color: true,
    italic: true,
    underline: true,
    name: true,
    size: true,
  },
  horizontalAlignment: true,
  verticalAlignment: true,
  wrapText: true,
  indentLevel: true,
  textOrientation: true,
  borders: { style: true, color: true, weight: true },
};

type Attempt = (label: string, run: () => Promise<void>) => Promise<void>;

/** The undo entries of one marked part (one change). */
function sliceUndo(undo: AgentUndo, part: { from: UndoMark; to: UndoMark }): AgentUndo {
  const cut = <T>(list: T[] | undefined, key: keyof UndoMark): T[] =>
    (list ?? []).slice(part.from[key], part.to[key]);
  return {
    createdSheets: cut(undo.createdSheets, "createdSheets"),
    restores: cut(undo.restores, "restores"),
    formats: cut(undo.formats, "formats"),
    backups: cut(undo.backups, "backups"),
    steps: cut(undo.steps, "steps"),
    charts: cut(undo.charts, "charts"),
    tableSizes: cut(undo.tableSizes, "tableSizes"),
    journal: cut(undo.journal, "journal"),
  };
}

/**
 * Puts back what the agent changed, newest change first (each change's own entries in reverse).
 * Built-in steps are rolled back by `undoStep`. A part that came back completely is remembered in
 * `undo.settled`, so pressing Undo again after a failure only runs what is still open.
 */
export async function undoAgentChanges(
  runtime: ExcelRuntimeLike,
  undo: AgentUndo,
  undoStep: (rollback: unknown) => Promise<void>,
): Promise<void> {
  // One step that cannot be undone must not leave the others undone: every step runs, and the
  // ones that failed are named in the error (the person sees "Undo did not finish").
  const failures: string[] = [];
  const attempt: Attempt = async (label, run) => {
    try {
      await run();
    } catch (error) {
      failures.push(`${label}: ${(error as Error)?.message ?? String(error)}`);
    }
  };
  const parts = undoParts(undo);
  const settled = (undo.settled ??= []);
  try {
    for (let index = parts.length - 1; index >= 0; index -= 1) {
      if (settled[index]) continue;
      const before = failures.length;
      await undoPart(runtime, sliceUndo(undo, parts[index]), undoStep, attempt);
      settled[index] = failures.length === before;
    }
  } finally {
    sheetAliases.clear();
  }
  if (failures.length)
    throw new Error(`Undo could not finish ${failures.length} step(s): ${failures.join("; ").slice(0, 400)}`);
}

async function undoPart(
  runtime: ExcelRuntimeLike,
  undo: AgentUndo,
  undoStep: (rollback: unknown) => Promise<void>,
  attempt: Attempt,
): Promise<void> {
  for (const rollback of [...undo.steps].reverse())
    await attempt("step", () => undoStep(rollback));
  await attempt("workbook", () => runtime.run(async (context) => {
    for (const entry of [...(undo.journal ?? [])].reverse())
      await attempt(`journal ${entry.type}`, () =>
        undoJournalEntry(context, entry),
      );
    const sheets = context.workbook.worksheets;
    const byKey = async (key: string) => {
      const sheet = sheets.getItemOrNullObject(sheetAliases.get(key) ?? key);
      sheet.load("isNullObject");
      await context.sync();
      return sheet.isNullObject ? undefined : sheet;
    };
    // A Table that grew into a written column shrinks back first (an empty header is not allowed).
    for (const size of [...(undo.tableSizes ?? [])].reverse())
      await attempt(`table ${size.name}`, async () => {
      const table = context.workbook.tables.getItemOrNullObject(size.name);
      table.load("isNullObject");
      await context.sync();
      if (table.isNullObject) return;
      const columns = table.columns;
      columns.load("count");
      await context.sync();
      for (
        let index = Number(columns.count) - 1;
        index >= size.columns;
        index -= 1
      )
        columns.getItemAt(index).delete();
      await context.sync();
    });
    for (const item of [...undo.restores].reverse())
      await attempt(`restore ${item.sheet}!${item.address}`, async () => {
      const sheet = await byKey(item.sheet);
      if (!sheet) return;
      const range = sheet.getRange(item.address);
      if (!item.formulas) {
        range.clear("Contents");
        await context.sync();
        return;
      }
      // Written back in parts: one request for 366k cells is too large for Excel on the web.
      const rows = item.formulas.length;
      for (let start = 0; start < rows; start += RESTORE_ROWS) {
        const part = item.formulas.slice(start, start + RESTORE_ROWS);
        range
          .getCell(start, 0)
          .getResizedRange(part.length - 1, part[0].length - 1).formulas = part;
        await context.sync();
      }
    });
    for (const item of [...undo.formats].reverse())
      await attempt(`format ${item.sheet}!${item.address}`, async () => {
        const sheet = await byKey(item.sheet);
        if (!sheet) return;
        const range = sheet.getRange(item.address);
        range.numberFormat = item.numberFormat;
        range.setCellProperties(item.cells);
        await context.sync();
      });
    for (const item of [...undo.backups].reverse())
      await attempt(`backup ${item.sheet}!${item.address}`, async () => {
        const sheet = await byKey(item.sheet);
        const backup = await byKey(item.backup);
        if (!sheet || !backup) return;
        await restoreFromBackup(context, sheet, backup, item.address);
        backup.delete();
        await context.sync();
      });
    for (const item of [...(undo.charts ?? [])].reverse())
      await attempt(`chart ${item.name}`, async () => {
        const sheet = await byKey(item.sheet);
        if (!sheet) return;
        const chart = sheet.charts.getItemOrNullObject(item.name);
        chart.load("isNullObject");
        await context.sync();
        if (!chart.isNullObject) chart.delete();
        await context.sync();
      });
    for (const key of [...undo.createdSheets].reverse())
      await attempt(`sheet ${key}`, async () => {
        const sheet = await byKey(key);
        if (sheet) sheet.delete();
        await context.sync();
      });
  }));
}

/** After the person keeps the result: the hidden backup copies are no longer needed. */
export async function dropAgentBackups(
  runtime: ExcelRuntimeLike,
  undo: AgentUndo,
): Promise<string[]> {
  const hidden = [
    ...undo.backups.map((item) => item.backup),
    ...(undo.journal ?? []).flatMap((entry) =>
      entry.type === "backup"
        ? [entry.backupId]
        : entry.data?.restoreId
          ? [entry.data.restoreId as string]
          : [],
    ),
  ];
  undo.backups = [];
  undo.marks = undefined;
  undo.settled = undefined;
  undo.journal = (undo.journal ?? []).filter(
    (entry) => entry.type !== "backup" && !entry.data?.restoreId,
  );
  return deleteHiddenSheets(runtime, hidden);
}

/**
 * Deletes hidden backup sheets one by one, so one that cannot be deleted does not keep the others.
 * Returns the ids still in the workbook; the caller tries them again later.
 */
export async function deleteHiddenSheets(
  runtime: ExcelRuntimeLike,
  ids: string[],
): Promise<string[]> {
  const left: string[] = [];
  if (!ids.length) return left;
  await runtime.run(async (context) => {
    for (const key of ids) {
      try {
        const sheet = context.workbook.worksheets.getItemOrNullObject(key);
        sheet.load("isNullObject");
        await context.sync();
        if (!sheet.isNullObject) {
          sheet.delete();
          await context.sync();
        }
      } catch {
        left.push(key);
      }
    }
  });
  return left;
}
