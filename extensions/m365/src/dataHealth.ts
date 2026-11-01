/**
 * "Check my data": a read-only health scan of the selected range or the used range of the sheet.
 * It runs on this device with no model call and writes nothing. Each finding has a count, up to
 * HEALTH_MAX_CELLS cell addresses, a severity and a ready request sentence that the pane puts in
 * the request box (it never runs by itself). Pure: the Office.js read is in
 * taskpaneWorkspaceContext.ts (`readDataHealthValues`).
 *
 * Related but different: noticed.ts shows three tiles from the first 2,000 rows and names no cells;
 * valueCheck.ts looks at one grouping column before a run; insights.ts and analysis.ts suggest
 * charts. This module reuses `columnLetters` (agent.ts) and the same bounded-read idea as
 * formulaResultHealth.ts (HEALTH_MAX_ROWS) and says plainly when only the top rows were checked.
 */
import { columnLetters } from "./agent.js";

export type HealthCell = string | number | boolean | null | undefined;
export type HealthKind =
  | "duplicate_rows"
  | "duplicate_key"
  | "blank_cells"
  | "number_text"
  | "mixed_types"
  | "extra_spaces"
  | "date_formats"
  | "outliers";
export type HealthSeverity = "high" | "medium" | "low";

export interface HealthFinding {
  kind: HealthKind;
  severity: HealthSeverity;
  /** Cells (or, for duplicates, rows) affected. */
  count: number;
  /** Header of the column concerned; absent for whole-row and whole-range findings. */
  column?: string;
  /** The first affected cells, A1 style, at most HEALTH_MAX_CELLS. */
  cells: string[];
  /** The sentence put in the request box. Nothing runs until the person sends it. */
  request: string;
}

export interface HealthReport {
  findings: HealthFinding[];
  /** Findings dropped because there were more than HEALTH_MAX_FINDINGS. */
  omitted: number;
  /** A1 address of the cells that were checked (no sheet name). */
  address: string;
  /** Data rows checked (header row not counted) and data rows in the whole range. */
  rowsChecked: number;
  rowsTotal: number;
  columnsChecked: number;
  columnsTotal: number;
  partialRows: boolean;
  partialColumns: boolean;
  hasHeader: boolean;
}

export const HEALTH_MAX_CELLS = 5;
export const HEALTH_MAX_FINDINGS = 12;
/** Data rows, columns and cells one scan checks; the rest is reported as not checked. */
export const HEALTH_SCAN_MAX_ROWS = 5000;
export const HEALTH_SCAN_MAX_COLUMNS = 50;
export const HEALTH_SCAN_MAX_CELLS = 200_000;
/** Cells per Office.js read, so one read stays small. */
export const HEALTH_CHUNK_CELLS = 40_000;

/** English templates; the pane looks `health_<kind>` up in the Sinhala and Tamil packs. */
export const HEALTH_LABELS: Record<HealthKind, string> = {
  duplicate_rows: "Duplicate rows (all columns): {n}",
  duplicate_key: "Repeated {col} values: {n}",
  blank_cells: "Blank cells in {col}: {n}",
  number_text: "Numbers stored as text in {col}: {n}",
  mixed_types: "Mixed types in {col}: {n}",
  extra_spaces: "Extra spaces at the start or end: {n}",
  date_formats: "Different date formats in {col}: {n}",
  outliers: "Unusual numbers in {col}: {n}",
};

export interface HealthReadPlan {
  /** Rows to read, header included. */
  rows: number;
  columns: number;
  /** Rows per Office.js read. */
  chunkRows: number;
}

/** How much of a range of the given size one scan reads. */
export function healthReadPlan(
  totalRows: number,
  totalColumns: number,
): HealthReadPlan {
  const columns = Math.max(
    0,
    Math.min(Math.floor(totalColumns), HEALTH_SCAN_MAX_COLUMNS),
  );
  if (columns === 0 || totalRows <= 0)
    return { rows: 0, columns: 0, chunkRows: 1 };
  const byCells = Math.floor(HEALTH_SCAN_MAX_CELLS / columns);
  const rows = Math.max(
    0,
    Math.min(Math.floor(totalRows), HEALTH_SCAN_MAX_ROWS + 1, byCells),
  );
  return {
    rows,
    columns,
    chunkRows: Math.max(1, Math.floor(HEALTH_CHUNK_CELLS / columns)),
  };
}

export interface HealthInput {
  /** The cells read, first row first. The first row is a header when it holds only text. */
  values: HealthCell[][];
  /** 1-based sheet row of values[0] (default 1). */
  row?: number;
  /** 0-based sheet column of values[0][0] (default 0). */
  column?: number;
  /** Size of the whole range when `values` is only its top-left part. */
  totalRows?: number;
  totalColumns?: number;
}

const SEVERITY_ORDER: Record<HealthSeverity, number> = {
  high: 0,
  medium: 1,
  low: 2,
};
// Zero-width space and BOM are not removed by trim(), but they are invisible padding.
const PAD = /^[\s​﻿]|[\s​﻿]$/;
const KEYISH =
  /\b(id|no|number|code|ref|phone|mobile|nic|tel|zip|postcode)\b|id$|^#/i;
const DATEISH = /date|dob|birth|day|දිනය|திகதி|தேதி/i;
const NUMBER_TEXT = /^[+-]?(\d{1,3}(,\d{3})+|\d+)(\.\d+)?$/;
const MONTHS = "jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec";
const DATE_NUMERIC = /^(\d{1,4})([-/.])(\d{1,2})\2(\d{1,4})$/;
const DATE_DMY_TEXT = new RegExp(
  `^\\d{1,2}[ -](${MONTHS})[a-z]*[ -,]+\\d{2,4}$`,
  "i",
);
const DATE_MDY_TEXT = new RegExp(
  `^(${MONTHS})[a-z]*\\.? \\d{1,2},? \\d{2,4}$`,
  "i",
);
/** Z-score on the median and MAD scale; 5 is well above the usual 3.5, so only clear outliers show. */
const OUTLIER_Z = 5;
const OUTLIER_MIN_NUMBERS = 10;

const isBlank = (v: HealthCell) =>
  v === null || v === undefined || (typeof v === "string" && v.trim() === "");
const isNumber = (v: HealthCell): v is number =>
  typeof v === "number" && Number.isFinite(v);

function isNumberText(v: HealthCell): boolean {
  if (typeof v !== "string") return false;
  const t = v.trim();
  if (!NUMBER_TEXT.test(t)) return false;
  if (/^[+-]?0\d/.test(t)) return false; // 007, 0771234567: an identifier, not an amount
  return t.replace(/\D/g, "").length < 12;
}

/** The shape of a date written as text, or undefined when the text is not a date. */
function dateShape(v: HealthCell): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  const numeric = DATE_NUMERIC.exec(t);
  if (numeric) {
    const [, a, sep, b, c] = numeric;
    if (b.length > 2) return undefined;
    if (a.length === 4 && c.length <= 2) return `${sep} year first`;
    if (c.length === 4 && a.length <= 2) return `${sep} year last`;
    if (c.length === 2 && a.length <= 2) return `${sep} 2-digit year`;
    return undefined;
  }
  if (DATE_DMY_TEXT.test(t)) return "day month-name year";
  if (DATE_MDY_TEXT.test(t)) return "month-name day year";
  return undefined;
}

const keyOf = (v: HealthCell) =>
  v === null || v === undefined ? "" : String(v).normalize("NFC").toLowerCase();

function median(sorted: number[]): number {
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

const SEVERITY_RANK = (f: HealthFinding) => SEVERITY_ORDER[f.severity];

export function scanDataHealth(input: HealthInput): HealthReport {
  const firstRow = input.row ?? 1;
  const firstColumn = input.column ?? 0;
  const values = input.values;
  const width = Math.min(
    HEALTH_SCAN_MAX_COLUMNS,
    values.reduce((max, row) => Math.max(max, row.length), 0),
  );
  const totalColumns = Math.max(
    input.totalColumns ?? 0,
    values.reduce((m, r) => Math.max(m, r.length), 0),
  );
  const hasHeader =
    values.length > 0 &&
    values[0].some((v) => !isBlank(v)) &&
    values[0].every((v) => isBlank(v) || typeof v === "string");
  const dataStart = hasHeader ? 1 : 0;
  const dataRows = values.length - dataStart;
  const totalRows = Math.max(
    (input.totalRows ?? 0) - dataStart,
    Math.max(dataRows, 0),
  );
  const lastColumnLetters = columnLetters(firstColumn + Math.max(width, 1) - 1);
  const address = `${columnLetters(firstColumn)}${firstRow}:${lastColumnLetters}${firstRow + Math.max(values.length, 1) - 1}`;
  const report: HealthReport = {
    findings: [],
    omitted: 0,
    address,
    rowsChecked: Math.max(dataRows, 0),
    rowsTotal: totalRows,
    columnsChecked: width,
    columnsTotal: totalColumns,
    partialRows: totalRows > Math.max(dataRows, 0),
    partialColumns: totalColumns > width,
    hasHeader,
  };
  if (width === 0 || dataRows <= 0) return report;

  const header = (c: number) => {
    const raw = hasHeader ? values[0][c] : undefined;
    return !isBlank(raw)
      ? String(raw).trim()
      : `column ${columnLetters(firstColumn + c)}`;
  };
  const cellAt = (r: number, c: number) =>
    `${columnLetters(firstColumn + c)}${firstRow + r}`;
  const colRange = (c: number) =>
    `${columnLetters(firstColumn + c)}${firstRow + dataStart}:${columnLetters(firstColumn + c)}${firstRow + values.length - 1}`;
  const cell = (r: number, c: number): HealthCell => values[r][c];

  // Rows that hold something; fully blank rows are separators, not data.
  const rowIndexes: number[] = [];
  for (let r = dataStart; r < values.length; r += 1) {
    let filled = false;
    for (let c = 0; c < width && !filled; c += 1) filled = !isBlank(cell(r, c));
    if (filled) rowIndexes.push(r);
  }
  if (rowIndexes.length === 0) return report;

  const findings: HealthFinding[] = [];
  const add = (f: Omit<HealthFinding, "cells"> & { cells: string[] }) =>
    findings.push({ ...f, cells: f.cells.slice(0, HEALTH_MAX_CELLS) });

  // Duplicate rows over every checked column (case ignored, Unicode-normalized, spaces kept).
  if (rowIndexes.length >= 2) {
    const seen = new Set<string>();
    const dupRows: number[] = [];
    for (const r of rowIndexes) {
      const key = JSON.stringify(
        Array.from({ length: width }, (_, c) => keyOf(cell(r, c))),
      );
      if (seen.has(key)) dupRows.push(r);
      else seen.add(key);
    }
    if (dupRows.length > 0)
      add({
        kind: "duplicate_rows",
        severity: "high",
        count: dupRows.length,
        cells: dupRows.map((r) => cellAt(r, 0)),
        request: `Remove duplicate rows from ${address}`,
      });
  }

  // Repeated values in the first column when it behaves like a key (mostly distinct).
  if (rowIndexes.length >= 3) {
    const keys = rowIndexes.map((r) => ({ r, key: keyOf(cell(r, 0)).trim() }));
    const present = keys.filter((k) => k.key !== "");
    const distinct = new Set(present.map((k) => k.key));
    if (present.length >= 3 && distinct.size / present.length >= 0.8) {
      const fullKeys = new Map<string, Set<string>>();
      const first = new Map<string, number>();
      const repeats: number[] = [];
      for (const { r, key } of present) {
        if (first.has(key)) repeats.push(r);
        else first.set(key, r);
        const whole = JSON.stringify(
          Array.from({ length: width }, (_, c) => keyOf(cell(r, c))),
        );
        const set = fullKeys.get(key) ?? new Set<string>();
        set.add(whole);
        fullKeys.set(key, set);
      }
      // Rows that repeat a whole earlier row are already counted as duplicate rows.
      const different = repeats.filter(
        (r) => (fullKeys.get(keyOf(cell(r, 0)).trim())?.size ?? 0) > 1,
      );
      if (different.length > 0)
        add({
          kind: "duplicate_key",
          severity: "high",
          count: different.length,
          column: header(0),
          cells: different.map((r) => cellAt(r, 0)),
          request: `Show the rows in ${address} where ${header(0)} appears more than once`,
        });
    }
  }

  for (let c = 0; c < width; c += 1) {
    const name = header(c);
    const filledRows = rowIndexes.filter((r) => !isBlank(cell(r, c)));
    const blankRows = rowIndexes.filter((r) => isBlank(cell(r, c)));

    // Blank cells in an otherwise full column.
    if (
      rowIndexes.length >= 3 &&
      blankRows.length > 0 &&
      filledRows.length / rowIndexes.length >= 0.9
    )
      add({
        kind: "blank_cells",
        severity:
          blankRows.length / rowIndexes.length >= 0.05 ? "medium" : "low",
        count: blankRows.length,
        column: name,
        cells: blankRows.map((r) => cellAt(r, c)),
        request: `Highlight the blank cells in ${name} (${colRange(c)})`,
      });

    if (filledRows.length === 0) continue;
    const numbers = filledRows.filter((r) => isNumber(cell(r, c)));
    const numTexts = filledRows.filter((r) => isNumberText(cell(r, c)));
    const texts = filledRows.filter(
      (r) => typeof cell(r, c) === "string" && !isNumberText(cell(r, c)),
    );

    // Numbers stored as text.
    const numericish = numbers.length + numTexts.length;
    if (
      numTexts.length > 0 &&
      numericish / filledRows.length >= 0.6 &&
      !KEYISH.test(name)
    )
      add({
        kind: "number_text",
        severity:
          numTexts.length / filledRows.length >= 0.5 ? "high" : "medium",
        count: numTexts.length,
        column: name,
        cells: numTexts.map((r) => cellAt(r, c)),
        request: `Convert the numbers stored as text in ${name} (${colRange(c)}) to real numbers`,
      });

    // Mixed types: a few cells of the other type in a column that is mostly one type.
    const total = numericish + texts.length;
    if (total >= 4 && numericish > 0 && texts.length > 0) {
      let odd: number[] | undefined;
      if (numericish / total >= 0.6) odd = texts;
      else if (
        numbers.length > 0 &&
        texts.length / total >= 0.6 &&
        numbers.length / total <= 0.2
      )
        odd = numbers;
      if (odd)
        add({
          kind: "mixed_types",
          severity: "medium",
          count: odd.length,
          column: name,
          cells: odd.map((r) => cellAt(r, c)),
          request: `Show the cells in ${name} (${colRange(c)}) that do not match the rest of the column`,
        });
    }

    // Inconsistent date formats among dates written as text.
    const shapes = new Map<string, number[]>();
    for (const r of filledRows) {
      const shape = dateShape(cell(r, c));
      if (shape) shapes.set(shape, [...(shapes.get(shape) ?? []), r]);
    }
    const dateTexts = [...shapes.values()].reduce(
      (sum, rows) => sum + rows.length,
      0,
    );
    let oddDates: number[] | undefined;
    if (dateTexts >= 3 && shapes.size >= 2) {
      const ranked = [...shapes.values()].sort((a, b) => b.length - a.length);
      oddDates = ranked
        .slice(1)
        .flat()
        .sort((a, b) => a - b);
    } else if (
      dateTexts >= 1 &&
      DATEISH.test(name) &&
      numbers.length / filledRows.length >= 0.5
    ) {
      // Real dates (serial numbers) mixed with dates typed as text.
      const serial = numbers.filter((r) => {
        const v = cell(r, c) as number;
        return v >= 1 && v < 80000;
      });
      if (serial.length === numbers.length)
        oddDates = [...shapes.values()].flat().sort((a, b) => a - b);
    }
    if (oddDates && oddDates.length > 0)
      add({
        kind: "date_formats",
        severity: "medium",
        count: oddDates.length,
        column: name,
        cells: oddDates.map((r) => cellAt(r, c)),
        request: `Make the dates in ${name} (${colRange(c)}) use one format`,
      });

    // Unusual numbers: modified z-score from the median and MAD, a high bar, id-like columns skipped.
    if (numbers.length >= OUTLIER_MIN_NUMBERS && !KEYISH.test(name)) {
      const nums = numbers.map((r) => cell(r, c) as number);
      const sorted = [...nums].sort((a, b) => a - b);
      const med = median(sorted);
      const mad = median(
        nums.map((v) => Math.abs(v - med)).sort((a, b) => a - b),
      );
      const idLike =
        nums.every(Number.isInteger) &&
        new Set(nums).size === nums.length &&
        nums.length >= 20;
      if (mad > 0 && !idLike) {
        const scored = numbers
          .map((r) => ({
            r,
            z: (0.6745 * Math.abs((cell(r, c) as number) - med)) / mad,
          }))
          .filter((s) => s.z > OUTLIER_Z)
          .sort((a, b) => b.z - a.z);
        if (scored.length > 0 && scored.length <= numbers.length * 0.1)
          add({
            kind: "outliers",
            severity: "low",
            count: scored.length,
            column: name,
            cells: scored.map((s) => cellAt(s.r, c)),
            request: `Show the unusual numbers in ${name} (${colRange(c)})`,
          });
      }
    }
  }

  // Leading or trailing spaces, over every checked column (one finding).
  const padded: string[] = [];
  let paddedCount = 0;
  for (const r of rowIndexes)
    for (let c = 0; c < width; c += 1) {
      const v = cell(r, c);
      if (typeof v === "string" && v.trim() !== "" && PAD.test(v)) {
        paddedCount += 1;
        if (padded.length < HEALTH_MAX_CELLS) padded.push(cellAt(r, c));
      }
    }
  if (paddedCount > 0)
    add({
      kind: "extra_spaces",
      severity: "low",
      count: paddedCount,
      cells: padded,
      request: `Remove leading and trailing spaces in ${address}`,
    });

  findings.sort(
    (a, b) => SEVERITY_RANK(a) - SEVERITY_RANK(b) || b.count - a.count,
  );
  report.findings = findings.slice(0, HEALTH_MAX_FINDINGS);
  report.omitted = Math.max(0, findings.length - HEALTH_MAX_FINDINGS);
  return report;
}
