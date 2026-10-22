/**
 * Office.js writers for the Sri Lanka pack and the change log. The rows come from the pure
 * modules (sriLanka.ts, changeLog.ts); this file only places them. Not type-checked against real
 * Excel here: see the vynor-live-verify skill.
 */
import { CHANGE_LOG_HEADER, CHANGE_LOG_SHEET } from "./changeLog.js";
import {
  excelDateSerial,
  HOLIDAY_NAME,
  HOLIDAY_SHEET,
  HOLIDAY_TABLE,
  holidaySheetRows,
} from "./sriLanka.js";
import type { PayrollPlan, PayrollStyle } from "./payroll.js";
import { guardText } from "./textGuard.js";

const columnLetter = (index: number) => String.fromCharCode(65 + index);

/**
 * Appends rows to the "VynorAI Log" sheet, creating it (with a header) the first time. The rows
 * are written as text, so a request can never run as a formula. Returns false when the host
 * refuses (a protected workbook): the log is a record, never a reason to fail an apply.
 */
export async function appendChangeLog(
  runtime: any,
  rows: string[][],
): Promise<boolean> {
  if (!rows.length || typeof runtime?.run !== "function") return false;
  try {
    await runtime.run(async (context: any) => {
      const sheets = context.workbook.worksheets;
      let sheet = sheets.getItemOrNullObject(CHANGE_LOG_SHEET);
      sheet.load("isNullObject");
      await context.sync();
      const width = CHANGE_LOG_HEADER.length;
      const last = columnLetter(width - 1);
      let next = 1;
      if (sheet.isNullObject) {
        sheet = sheets.add(CHANGE_LOG_SHEET);
        const header = sheet.getRange(`A1:${last}1`);
        header.values = [[...CHANGE_LOG_HEADER]];
        header.format.font.bold = true;
        sheet.freezePanes?.freezeRows?.(1);
        next = 2;
      } else {
        const used = sheet.getUsedRangeOrNullObject(true);
        used.load("isNullObject,rowCount,rowIndex");
        await context.sync();
        next = used.isNullObject
          ? 1
          : Number(used.rowIndex) + Number(used.rowCount) + 1;
      }
      const target = sheet.getRange(
        `A${next}:${last}${next + rows.length - 1}`,
      );
      target.numberFormat = rows.map((row) => row.map(() => "@"));
      target.values = rows;
      sheet.getRange(`A:${last}`).format.autofitColumns?.();
      await context.sync();
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Adds the "LK Holidays" sheet: a note, a table of the fixed-date holidays of the given years
 * (the person adds Poya days and festivals from the gazette), and the workbook name LK_Holidays
 * over the table's Date column for NETWORKDAYS(start, end, LK_Holidays). Refuses when the sheet
 * already exists, so nothing the person typed is overwritten.
 */
export async function writeHolidaySheet(
  runtime: any,
  years: number[],
): Promise<{ ok: true; rows: number } | { ok: false; error: string }> {
  if (typeof runtime?.run !== "function")
    return { ok: false, error: "EXCEL_API_UNAVAILABLE" };
  const plan = holidaySheetRows(years);
  try {
    return await runtime.run(async (context: any) => {
      const existing =
        context.workbook.worksheets.getItemOrNullObject(HOLIDAY_SHEET);
      existing.load("isNullObject");
      await context.sync();
      if (!existing.isNullObject)
        return { ok: false as const, error: "HOLIDAY_SHEET_EXISTS" };
      // A name left over from a deleted holiday sheet points at #REF!; it is replaced.
      const oldName = context.workbook.names.getItemOrNullObject(HOLIDAY_NAME);
      oldName.load("isNullObject");
      await context.sync();
      if (!oldName.isNullObject) oldName.delete();
      const sheet = context.workbook.worksheets.add(HOLIDAY_SHEET);
      sheet.getRange("A1").values = [[plan.note]];
      sheet.getRange("A1").format.wrapText = false;
      const first = 3;
      const lastRow = first + plan.rows.length;
      const body = sheet.getRange(`A${first}:C${lastRow}`);
      // Dates go in as Excel date serials, so NETWORKDAYS reads them as dates on every locale.
      body.values = [
        plan.header,
        ...plan.rows.map((row) => [excelDateSerial(row[0]), row[1], row[2]]),
      ];
      const dates = sheet.getRange(`A${first + 1}:A${lastRow}`);
      dates.numberFormat = plan.rows.map(() => ["yyyy-mm-dd"]);
      const table = sheet.tables.add(`A${first}:C${lastRow}`, true);
      table.name = HOLIDAY_TABLE;
      context.workbook.names.add(
        HOLIDAY_NAME,
        `=${HOLIDAY_TABLE}[Date]`,
        "Sri Lanka holidays for NETWORKDAYS and WORKDAY",
      );
      sheet.getRange("A:C").format.autofitColumns?.();
      try {
        await context.sync();
      } catch (error) {
        await removeHalfMade(context, HOLIDAY_SHEET, HOLIDAY_NAME);
        throw error;
      }
      return { ok: true as const, rows: plan.rows.length };
    });
  } catch (error) {
    return { ok: false, error: String((error as Error)?.message ?? error) };
  }
}

/** True when the host supports an ExcelApi requirement set; unknown hosts count as no. */
function excelApiSupported(version: string): boolean {
  const office = (globalThis as any).Office;
  return Boolean(
    office?.context?.requirements?.isSetSupported?.("ExcelApi", version),
  );
}

/**
 * After a failed batch, removes the sheet (and workbook name) this call added, so the person is
 * never left with a half-made sheet. The sheet did not exist before, so whatever is there is ours.
 */
async function removeHalfMade(
  context: any,
  sheetName: string,
  workbookName?: string,
): Promise<void> {
  try {
    const sheet = context.workbook.worksheets.getItemOrNullObject(sheetName);
    sheet.load("isNullObject");
    const name = workbookName
      ? context.workbook.names.getItemOrNullObject(workbookName)
      : undefined;
    name?.load("isNullObject");
    await context.sync();
    if (name && !name.isNullObject) name.delete();
    if (!sheet.isNullObject) sheet.delete();
    await context.sync();
  } catch {
    // The original error is the one the person needs to see.
  }
}

const PAYROLL_STYLE: Record<PayrollStyle, (range: any) => void> = {
  title: (range) => {
    range.format.font.bold = true;
    range.format.font.size = 14;
  },
  note: (range) => {
    range.format.font.italic = true;
    range.format.font.color = "#595959";
  },
  section: (range) => {
    range.format.font.bold = true;
  },
  header: (range) => {
    range.format.font.bold = true;
    range.format.fill.color = "#DEEAF6";
    range.format.wrapText = true;
  },
  body: () => {},
  total: (range) => {
    range.format.font.bold = true;
    try {
      range.format.borders.getItem("EdgeTop").style = "Continuous";
    } catch {
      // A host without borders keeps the bold line.
    }
  },
  label: () => {},
};

/**
 * Adds a payroll sheet from buildPayrollPlan (payroll.ts): formulas as formulas, every other cell
 * as a value, so a name or ID that starts with "=" or holds leading zeros stays text. Refuses when
 * a sheet of that name exists, so a month already worked on is never overwritten. The sheet is
 * marked as a VynorAI result; deleting it undoes the whole change.
 */
export async function writePayrollSheet(
  runtime: any,
  plan: PayrollPlan,
): Promise<{ ok: true; sheet: string } | { ok: false; error: string }> {
  if (typeof runtime?.run !== "function")
    return { ok: false, error: "EXCEL_API_UNAVAILABLE" };
  try {
    return await runtime.run(async (context: any) => {
      const existing = context.workbook.worksheets.getItemOrNullObject(
        plan.sheet,
      );
      existing.load("isNullObject");
      await context.sync();
      if (!existing.isNullObject)
        return { ok: false as const, error: "PAYROLL_SHEET_EXISTS" };
      const sheet = context.workbook.worksheets.add(plan.sheet);
      // Older Excel has no sheet properties; the sheet is still a normal sheet the person can delete.
      if (excelApiSupported("1.12"))
        sheet.customProperties.add("vynorai", "result");
      for (const block of plan.blocks) {
        const range = sheet.getRangeByIndexes(
          block.row - 1,
          block.col - 1,
          block.cells.length,
          block.cells[0].length,
        );
        if (block.formats?.some(Boolean))
          range.numberFormat = block.cells.map((row) =>
            row.map((_, column) => block.formats?.[column] || "General"),
          );
        range.formulas = block.cells.map((row) =>
          row.map((cell) => {
            if (typeof cell === "object") return cell.f;
            if (typeof cell !== "string") return cell;
            const safe = guardText(cell);
            return typeof safe === "string" && /^[=+\-@]/.test(safe)
              ? `'${safe}`
              : safe;
          }),
        );
        PAYROLL_STYLE[block.style](range);
      }
      sheet.freezePanes?.freezeRows?.(4);
      const height = Math.max(
        ...plan.blocks.map((block) => block.row + block.cells.length - 1),
      );
      // Autofit from the header row down, so the long title and note do not widen column A.
      sheet.getRangeByIndexes(3, 0, height - 3, 18).format.autofitColumns?.();
      // Columns Q and R hold long notes and sources: a fixed width with wrapping.
      const notes = sheet.getRangeByIndexes(0, 16, height, 2);
      notes.format.columnWidth = 220;
      notes.format.wrapText = true;
      sheet.getRange("A1:A2").format.wrapText = false;
      sheet.activate?.();
      try {
        await context.sync();
      } catch (error) {
        await removeHalfMade(context, plan.sheet);
        throw error;
      }
      return { ok: true as const, sheet: plan.sheet };
    });
  } catch (error) {
    return { ok: false, error: String((error as Error)?.message ?? error) };
  }
}
