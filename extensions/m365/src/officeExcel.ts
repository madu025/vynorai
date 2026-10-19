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
  SAMPLED_FINGERPRINT_ROWS,
} from "./excel.js";
import {
  addColumnFormula,
  cleanFormula,
  keyColumnFormula,
  LARGE_FORMAT_ROWS,
  histogramCells,
  qualityReportCells,
  splitColumnFormulas,
  unpivotFormula,
  viewFormula,
} from "./largeRange.js";

import {
  applyView,
  buildQualityReport,
  buildSummaryTable,
  pivotFallbackFormula,
  cleanRows,
  columnLetter,
  computedColumnFormula,
  parseLocalRange,
  type CleanOperation,
} from "./transform.js";
import {
  buildAdvancedForecastCells,
  buildAnomalyCells,
  buildCorrelationCells,
  buildDescribeCells,
  buildFinancialCells,
  buildForecastCells,
  buildForecastCellsLarge,
  buildInsightReportCells,
} from "./statistics.js";
import { inspectFormulas, type FormulaSelection } from "./formulaInspector.js";

type ExcelRangeInput = {
  workbookId: string;
  worksheetName: string;
  address: string;
  values: any[][];
  hasHeaders?: boolean;
  sample?: { totalRows: number; sampledRows: number };
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

import { plannedSheetName } from "./outcome.js";

export interface ExcelActionResult {
  kind: string;
  name: string;
  targetSheet: string;
  status: ExcelActionStatus;
  /** True only when this apply call created the target worksheet itself. */
  createdSheet?: boolean;
  /** Workbook names created as helper lists for one result. */
  createdNames?: string[];
  error?: string;
  /** Milliseconds this action took in Excel, shown when a result is slow. */
  ms?: number;
}

export interface ExcelApplyReport {
  sourceVerifiedBeforeApply: true;
  sourceUnchangedAfterApply: boolean;
  results: ExcelActionResult[];
}

export function rollbackItemsFromApplyReport(
  planId: string,
  results: ExcelActionResult[],
): { planId: string; sheets: string[]; tables: string[]; names: string[] } {
  return {
    planId,
    sheets: [
      ...new Set(
        results
          .filter((result) => result.createdSheet === true)
          .map((result) => result.targetSheet),
      ),
    ],
    tables: [
      ...new Set(
        results
          .filter(
            (result) => result.kind === "table" && result.status === "created",
          )
          .map((result) => result.name),
      ),
    ],
    names: [
      ...new Set(
        results.flatMap((result) => [
          ...(result.kind === "named-range" && result.status === "created"
            ? [result.name]
            : []),
          ...(result.status === "created" ? (result.createdNames ?? []) : []),
        ]),
      ),
    ],
  };
}

const MAX_SHEET_NAME = 31;
/** Brings a sheet the add-in created to the front so the person sees the result straight away. */
export async function revealExcelResult(
  runtime: ExcelRuntimeLike,
  sheetName: string,
): Promise<boolean> {
  try {
    return await runtime.run(async (context: any) => {
      const sheet = context.workbook.worksheets.getItemOrNullObject(sheetName);
      sheet.load("isNullObject");
      await context.sync();
      if (sheet.isNullObject) return false;
      sheet.activate();
      // Select what was just built, so the new range is highlighted like Copilot does.
      const used = sheet.getUsedRangeOrNullObject(true);
      used.load("isNullObject");
      const pivots = sheet.pivotTables;
      pivots.load("items/name");
      await context.sync();
      // Selecting a PivotTable makes Excel swap our task pane for its field list, so a pivot
      // sheet only gets A1 selected.
      if (used.isNullObject || (pivots.items ?? []).length > 0)
        sheet.getRange("A1").select();
      else used.select();
      await context.sync();
      return true;
    });
  } catch {
    // Showing the result is a convenience; the work itself is already done.
    return false;
  }
}

/** Sheets this add-in created: the ownership marker, or the legacy "_Vynor_" name. */
export async function listVynorSheets(
  runtime: ExcelRuntimeLike,
): Promise<string[]> {
  try {
    return await runtime.run(async (context: any) => {
      const sheets = context.workbook.worksheets;
      sheets.load("items/name");
      await context.sync();
      const items: any[] = sheets.items ?? [];
      const markers = items.map((sheet) => {
        try {
          const marker = sheet.customProperties.getItemOrNullObject("vynorai");
          marker.load("isNullObject");
          return marker;
        } catch {
          return undefined;
        }
      });
      try {
        await context.sync();
      } catch {
        // No custom-property support: only the legacy names count.
      }
      return items
        .filter((sheet, index) => {
          const marker = markers[index];
          let marked = false;
          try {
            marked = Boolean(marker) && marker.isNullObject === false;
          } catch {
            marked = false;
          }
          return (
            marked ||
            /_Vynor_[A-Za-z]+(?:\s*\(\d+\))?$/.test(String(sheet.name))
          );
        })
        .map((sheet) => String(sheet.name));
    });
  } catch {
    return [];
  }
}

/** Names of the sheets in the workbook; used so the preview can show the sheet name an apply will really use. */
export async function listWorksheetNames(
  runtime: ExcelRuntimeLike,
): Promise<string[]> {
  try {
    return await runtime.run(async (context: any) => {
      const sheets = context.workbook.worksheets;
      sheets.load("items/name");
      await context.sync();
      return (sheets.items ?? []).map((sheet: any) => String(sheet.name));
    });
  } catch {
    return [];
  }
}

export interface LookupSheetInfo {
  sheet: string;
  headers: string[];
  rows: number;
}

/** Reads only the header row and the row count of another sheet, for a lookup column. */
export async function readLookupSheetInfo(
  runtime: ExcelRuntimeLike,
  sheetName: string,
): Promise<LookupSheetInfo> {
  return runtime.run(async (context: any) => {
    const sheet = context.workbook.worksheets.getItemOrNullObject(sheetName);
    sheet.load(["isNullObject", "name"]);
    await context.sync();
    if (sheet.isNullObject)
      throw new Error(`There is no sheet called "${sheetName}".`);
    const used = sheet.getUsedRangeOrNullObject(true);
    used.load(["isNullObject", "address", "rowCount", "columnCount"]);
    await context.sync();
    if (used.isNullObject || Number(used.rowCount) < 2)
      throw new Error(`The sheet "${sheet.name}" has no data to look up in.`);
    if (!/^A1(?::|$)/i.test(localExcelAddress(String(used.address))))
      throw new Error(
        `The data on "${sheet.name}" must start at cell A1 with a header row.`,
      );
    const headerRow = used.getRow(0);
    headerRow.load("values");
    await context.sync();
    return {
      sheet: String(sheet.name),
      headers: (headerRow.values?.[0] ?? []).map((cell: any) =>
        String(cell ?? "").trim(),
      ),
      rows: Number(used.rowCount) - 1,
    };
  });
}

export const MAX_EXCEL_SELECTION_CELLS = 100_000;
export const MAX_EXCEL_SELECTION_COLUMNS = 100;
export const MAX_EXCEL_SELECTION_TEXT_CHARS = 2_000_000;

/** Sheet-local part of an Excel address ("'My Sheet'!A1:C4" -> "A1:C4"). */
export function localExcelAddress(address: string): string {
  const separator = address.lastIndexOf("!");
  return separator === -1 ? address : address.slice(separator + 1);
}

/** Builds a deterministic lookup formula for one or more lookup keys. */
export function buildLookupFormula(
  sheetName: string,
  sourceRow: number,
  sourceKeyIndexes: number[],
  lookupKeyIndexes: number[],
  returnIndex: number,
  lookupRows: number,
  matchMode: "exact" | "approximate" = "exact",
  method: "index-match" | "xlookup" = "index-match",
): string {
  if (
    sourceKeyIndexes.length < 1 ||
    sourceKeyIndexes.length !== lookupKeyIndexes.length ||
    !Number.isInteger(sourceRow) ||
    sourceRow < 1 ||
    !Number.isInteger(returnIndex) ||
    !Number.isInteger(lookupRows) ||
    lookupRows < 1 ||
    !["exact", "approximate"].includes(matchMode) ||
    (matchMode === "approximate" && sourceKeyIndexes.length !== 1) ||
    !["index-match", "xlookup"].includes(method) ||
    (method === "xlookup" && matchMode === "approximate")
  )
    throw new Error("Invalid lookup formula choices");
  const quoted = `'${String(sheetName).replace(/'/g, "''")}'`;
  const last = lookupRows + 1;
  const returnLetter = expressionColumnLetter(returnIndex);
  const sourceLetters = sourceKeyIndexes.map(expressionColumnLetter);
  const lookupRanges = lookupKeyIndexes.map((index) => {
    const letter = expressionColumnLetter(index);
    return `${quoted}!${letter}$2:${letter}${last}`;
  });
  if (method === "xlookup") {
    const lookupValue =
      sourceLetters.length === 1 ? `${sourceLetters[0]}${sourceRow}` : "1";
    const lookupArray =
      sourceLetters.length === 1
        ? lookupRanges[0]
        : lookupRanges
            .map(
              (range, index) =>
                `(${range}=${sourceLetters[index]}${sourceRow})`,
            )
            .join("*");
    const returnRange = `${quoted}!${returnLetter}$2:${returnLetter}${last}`;
    return `=IFERROR(XLOOKUP(${lookupValue},${lookupArray},${returnRange},""),"")`;
  }
  const matchType = matchMode === "approximate" ? 1 : 0;
  if (sourceLetters.length === 1)
    return `=IFERROR(INDEX(${quoted}!${returnLetter}$2:${returnLetter}${last},MATCH(${sourceLetters[0]}${sourceRow},${lookupRanges[0]},${matchType})),"")`;
  const matches = lookupRanges
    .map((range, index) => `(${range}=${sourceLetters[index]}${sourceRow})`)
    .join("*");
  return `=IFERROR(INDEX(${quoted}!${returnLetter}$2:${returnLetter}${last},MATCH(1,INDEX(${matches},0),0)),"")`;
}

/** CSV cells are quoted consistently and text that Excel could execute is neutralized. */
export function excelValuesToCsv(values: any[][]): string {
  const cell = (value: any): string => {
    let text = value === null || value === undefined ? "" : String(value);
    if (typeof value === "string" && /^[=+\-@]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  };
  return values.map((row) => row.map(cell).join(",")).join("\r\n") + "\r\n";
}

function downloadLocalBlob(blob: Blob, filename: string): void {
  if (typeof document === "undefined" || typeof URL === "undefined")
    throw new Error("FILE_DOWNLOAD_UNAVAILABLE");
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noopener";
  link.click();
  URL.revokeObjectURL(url);
}

/** Starts a local browser download; no workbook or server state is changed by this helper. */
export function downloadExcelCsv(values: any[][], filename: string): void {
  if (
    typeof document === "undefined" ||
    typeof Blob === "undefined" ||
    typeof URL === "undefined" ||
    typeof URL.createObjectURL !== "function"
  )
    throw new Error("CSV_DOWNLOAD_UNAVAILABLE");
  const blob = new Blob([excelValuesToCsv(values)], {
    type: "text/csv;charset=utf-8",
  });
  downloadLocalBlob(blob, filename);
}

function decodeOfficeFileSlice(data: unknown): Uint8Array {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (typeof data !== "string" || typeof atob !== "function")
    throw new Error("PDF_SLICE_INVALID");
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1)
    bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  if (typeof btoa !== "function") throw new Error("EMAIL_BASE64_UNAVAILABLE");
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(
      ...bytes.subarray(offset, Math.min(bytes.length, offset + chunkSize)),
    );
  }
  return btoa(binary);
}

/** Reads the current workbook as an XLSX attachment without sending it to VynorAI. */
export function readExcelWorkbookBase64(
  maxBytes = 3_000_000,
): Promise<{ base64: string; byteLength: number }> {
  const office = (globalThis as any).Office;
  const documentApi = office?.context?.document;
  if (typeof documentApi?.getFileAsync !== "function")
    return Promise.reject(new Error("XLSX_EXPORT_UNAVAILABLE"));
  return new Promise((resolve, reject) => {
    documentApi.getFileAsync(
      office.FileType?.Compressed ?? "compressed",
      (fileResult: any) => {
        if (fileResult?.status !== "succeeded" || !fileResult.value) {
          reject(new Error("XLSX_EXPORT_FAILED"));
          return;
        }
        const file = fileResult.value;
        const chunks: Uint8Array[] = [];
        let byteLength = 0;
        const close = () => {
          try {
            file.closeAsync?.();
          } catch {
            // Closing is best effort after a file API failure.
          }
        };
        const fail = (error: Error) => {
          close();
          reject(error);
        };
        const sliceCount = Number(file.sliceCount);
        if (!Number.isInteger(sliceCount) || sliceCount < 1) {
          fail(new Error("XLSX_SLICE_COUNT_INVALID"));
          return;
        }
        const readSlice = (index: number) => {
          file.getSliceAsync(index, (sliceResult: any) => {
            if (sliceResult?.status !== "succeeded" || !sliceResult.value) {
              fail(new Error("XLSX_SLICE_READ_FAILED"));
              return;
            }
            try {
              const bytes = decodeOfficeFileSlice(sliceResult.value.data);
              byteLength += bytes.length;
              if (byteLength > maxBytes) {
                fail(new Error("EMAIL_ATTACHMENT_TOO_LARGE"));
                return;
              }
              chunks.push(bytes);
            } catch (error) {
              fail(
                error instanceof Error
                  ? error
                  : new Error("XLSX_SLICE_INVALID"),
              );
              return;
            }
            if (index + 1 < sliceCount) {
              readSlice(index + 1);
              return;
            }
            try {
              const bytes = new Uint8Array(byteLength);
              let offset = 0;
              for (const chunk of chunks) {
                bytes.set(chunk, offset);
                offset += chunk.length;
              }
              const base64 = bytesToBase64(bytes);
              close();
              resolve({ base64, byteLength });
            } catch (error) {
              fail(
                error instanceof Error
                  ? error
                  : new Error("XLSX_EXPORT_FAILED"),
              );
            }
          });
        };
        readSlice(0);
      },
    );
  });
}

/** Reads a PDF snapshot through the Office common File API for an email attachment. */
export function readExcelPdfBase64(
  maxBytes = 150_000_000,
): Promise<{ base64: string; byteLength: number }> {
  const office = (globalThis as any).Office;
  const documentApi = office?.context?.document;
  if (typeof documentApi?.getFileAsync !== "function")
    return Promise.reject(new Error("PDF_EXPORT_UNAVAILABLE"));
  return new Promise((resolve, reject) => {
    documentApi.getFileAsync(
      office.FileType?.Pdf ?? "pdf",
      (fileResult: any) => {
        if (fileResult?.status !== "succeeded" || !fileResult.value) {
          reject(new Error("PDF_EXPORT_FAILED"));
          return;
        }
        const file = fileResult.value;
        const chunks: Uint8Array[] = [];
        let byteLength = 0;
        const close = () => {
          try {
            file.closeAsync?.();
          } catch {
            // Closing is best effort after a file API failure.
          }
        };
        const fail = (error: Error) => {
          close();
          reject(error);
        };
        const sliceCount = Number(file.sliceCount);
        if (!Number.isInteger(sliceCount) || sliceCount < 1) {
          fail(new Error("PDF_SLICE_COUNT_INVALID"));
          return;
        }
        const readSlice = (index: number) => {
          file.getSliceAsync(index, (sliceResult: any) => {
            if (sliceResult?.status !== "succeeded" || !sliceResult.value) {
              fail(new Error("PDF_SLICE_READ_FAILED"));
              return;
            }
            try {
              const bytes = decodeOfficeFileSlice(sliceResult.value.data);
              byteLength += bytes.length;
              if (byteLength > maxBytes) {
                fail(new Error("EMAIL_ATTACHMENT_TOO_LARGE"));
                return;
              }
              chunks.push(bytes);
            } catch (error) {
              fail(
                error instanceof Error ? error : new Error("PDF_SLICE_INVALID"),
              );
              return;
            }
            if (index + 1 < sliceCount) {
              readSlice(index + 1);
              return;
            }
            try {
              const bytes = new Uint8Array(byteLength);
              let offset = 0;
              for (const chunk of chunks) {
                bytes.set(chunk, offset);
                offset += chunk.length;
              }
              const base64 = bytesToBase64(bytes);
              close();
              resolve({ base64, byteLength });
            } catch (error) {
              fail(
                error instanceof Error ? error : new Error("PDF_EXPORT_FAILED"),
              );
            }
          });
        };
        readSlice(0);
      },
    );
  });
}

/** Reads a bounded result-sheet table locally for CSV or email-body reports. */
export function readExcelReportValues(
  sheetName: string,
  maxRows = 200,
  maxColumns = 30,
): Promise<{ values: any[][]; truncated: boolean }> {
  const runtime = (globalThis as any).Excel;
  if (typeof runtime?.run !== "function")
    return Promise.reject(new Error("EXCEL_API_UNAVAILABLE"));
  return runtime.run(async (context: any) => {
    const sheet = context.workbook.worksheets.getItem(sheetName);
    const used =
      sheet.getUsedRangeOrNullObject?.(true) ?? sheet.getUsedRange(true);
    used.load("rowCount,columnCount,isNullObject");
    await context.sync();
    if (used.isNullObject) throw new Error("REPORT_SHEET_EMPTY");
    const rows = Math.min(maxRows, Number(used.rowCount));
    const columns = Math.min(maxColumns, Number(used.columnCount));
    const range = sheet.getRangeByIndexes(0, 0, rows, columns);
    range.load("values");
    await context.sync();
    return {
      values: (range.values ?? []) as any[][],
      truncated:
        Number(used.rowCount) > rows || Number(used.columnCount) > columns,
    };
  });
}

/** Gets up to three report charts as base64 JPEG images for an HTML email body. */
export function readExcelChartImages(
  sheetName: string,
  maxCharts = 3,
): Promise<Array<{ name: string; contentId: string; base64: string }>> {
  const runtime = (globalThis as any).Excel;
  if (typeof runtime?.run !== "function")
    return Promise.reject(new Error("EXCEL_API_UNAVAILABLE"));
  return runtime.run(async (context: any) => {
    const sheet = context.workbook.worksheets.getItem(sheetName);
    const charts = sheet.charts;
    charts.load("items/name");
    await context.sync();
    const result: Array<{ name: string; contentId: string; base64: string }> =
      [];
    for (const chart of (charts.items ?? []).slice(0, maxCharts)) {
      const image = chart.getImage(1000, 560, "Fit");
      await context.sync();
      if (typeof image.value === "string" && image.value) {
        const name = String(chart.name || `Chart-${result.length + 1}`);
        result.push({
          name,
          contentId: `vynorai-${result.length + 1}@chart`,
          base64: image.value,
        });
      }
    }
    return result;
  });
}

/** Downloads the current Excel document as PDF through the Office common File API. */
export function downloadExcelPdf(filename: string): Promise<void> {
  const office = (globalThis as any).Office;
  const documentApi = office?.context?.document;
  if (typeof documentApi?.getFileAsync !== "function")
    return Promise.reject(new Error("PDF_EXPORT_UNAVAILABLE"));
  return new Promise((resolve, reject) => {
    documentApi.getFileAsync(
      office.FileType?.Pdf ?? "pdf",
      (fileResult: any) => {
        if (fileResult?.status !== "succeeded" || !fileResult.value) {
          reject(new Error("PDF_EXPORT_FAILED"));
          return;
        }
        const file = fileResult.value;
        const chunks: Uint8Array[] = [];
        const readSlice = (index: number) => {
          file.getSliceAsync(index, (sliceResult: any) => {
            if (sliceResult?.status !== "succeeded" || !sliceResult.value) {
              try {
                file.closeAsync?.();
              } catch {
                // Closing is best effort after a failed slice read.
              }
              reject(new Error("PDF_SLICE_READ_FAILED"));
              return;
            }
            try {
              chunks.push(decodeOfficeFileSlice(sliceResult.value.data));
            } catch (error) {
              try {
                file.closeAsync?.();
              } catch {
                // Closing is best effort after malformed data.
              }
              reject(error);
              return;
            }
            if (index + 1 < Number(file.sliceCount)) {
              readSlice(index + 1);
              return;
            }
            try {
              downloadLocalBlob(
                new Blob(chunks, { type: "application/pdf" }),
                filename,
              );
              file.closeAsync?.();
              resolve();
            } catch (error) {
              try {
                file.closeAsync?.();
              } catch {
                // Closing is best effort after a local download failure.
              }
              reject(error);
            }
          });
        };
        if (
          !Number.isInteger(Number(file.sliceCount)) ||
          Number(file.sliceCount) < 1
        ) {
          try {
            file.closeAsync?.();
          } catch {
            // Closing is best effort after an invalid file response.
          }
          reject(new Error("PDF_SLICE_COUNT_INVALID"));
          return;
        }
        readSlice(0);
      },
    );
  });
}

async function readValuesInChunks(
  context: ExcelContextLike,
  range: any,
  rows: number,
  columns: number,
  chunkRows: number,
  options?: {
    maxTextChars?: number;
    onProgress?: (completedRows: number, totalRows: number) => void;
    isCancelled?: () => boolean;
  },
): Promise<any[][]> {
  const values: any[][] = [];
  let textChars = 0;
  for (let start = 0; start < rows; start += chunkRows) {
    if (options?.isCancelled?.()) throw new Error("EXCEL_READ_CANCELLED");
    const count = Math.min(chunkRows, rows - start);
    const chunk = range
      .getCell(start, 0)
      .getResizedRange(count - 1, columns - 1);
    chunk.load("values");
    await context.sync();
    if (options?.isCancelled?.()) throw new Error("EXCEL_READ_CANCELLED");
    if (options?.maxTextChars !== undefined) {
      for (const row of chunk.values)
        for (const cell of row)
          if (typeof cell === "string") textChars += cell.length;
      if (textChars > options.maxTextChars)
        throw new Error(
          `The selection contains more than ${options.maxTextChars.toLocaleString()} text characters. Select a smaller range.`,
        );
    }
    values.push(...chunk.values);
    options?.onProgress?.(start + count, rows);
  }
  return values;
}

const SAMPLE_HEAD_ROWS = 1000;
const SAMPLE_BLOCK_ROWS = 100;
const SAMPLE_MAX_ROWS = 4000;

/** How many rows of a very large range are read for planning: at most 4,000 and 100,000 cells. */
export function sampleRowBudget(columns: number): number {
  return Math.max(
    2,
    Math.min(SAMPLE_MAX_ROWS, Math.floor(MAX_EXCEL_SELECTION_CELLS / columns)),
  );
}

/**
 * Row ranges [start, count] to read from a very large range: the first rows (header and
 * first data), then evenly spaced blocks across the rest, the last block touching the end.
 */
export function sampleBlocks(
  rows: number,
  budget: number,
): Array<[number, number]> {
  if (rows <= budget) return [[0, rows]];
  const head = Math.min(SAMPLE_HEAD_ROWS, budget);
  const blocks: Array<[number, number]> = [[0, head]];
  const rest = budget - head;
  const blockCount = Math.floor(rest / SAMPLE_BLOCK_ROWS);
  const span = rows - head - SAMPLE_BLOCK_ROWS;
  for (let index = 0; index < blockCount; index += 1) {
    const start =
      head +
      (blockCount === 1 ? span : Math.floor((index * span) / (blockCount - 1)));
    blocks.push([start, SAMPLE_BLOCK_ROWS]);
  }
  return blocks;
}

async function readSampleRows(
  context: ExcelContextLike,
  range: any,
  rows: number,
  columns: number,
  budget: number,
  options?: {
    maxTextChars?: number;
    onProgress?: (completedRows: number, totalRows: number) => void;
    isCancelled?: () => boolean;
  },
): Promise<any[][]> {
  const blocks = sampleBlocks(rows, budget);
  const values: any[][] = [];
  let textChars = 0;
  for (const [start, count] of blocks) {
    if (options?.isCancelled?.()) throw new Error("EXCEL_READ_CANCELLED");
    const chunk = range
      .getCell(start, 0)
      .getResizedRange(count - 1, columns - 1);
    chunk.load("values");
    await context.sync();
    if (options?.maxTextChars !== undefined) {
      for (const row of chunk.values)
        for (const cell of row)
          if (typeof cell === "string") textChars += cell.length;
      if (textChars > options.maxTextChars)
        throw new Error(
          `The selection contains more than ${options.maxTextChars.toLocaleString()} text characters. Select a smaller range.`,
        );
    }
    values.push(...chunk.values);
    options?.onProgress?.(values.length, budget);
  }
  return values;
}

async function writeValuesInChunks(
  context: ExcelContextLike,
  sheet: any,
  values: any[][],
  chunkRows: number,
  literal: (cell: any) => any,
  onProgress?: (completedRows: number, totalRows: number) => void,
): Promise<any> {
  const columns = values[0]?.length ?? 0;
  if (!values.length || !columns) return undefined;
  for (let start = 0; start < values.length; start += chunkRows) {
    const chunk = values
      .slice(start, start + chunkRows)
      .map((row) => row.map(literal));
    const target = sheet.getRangeByIndexes(start, 0, chunk.length, columns);
    target.values = chunk;
    await context.sync();
    onProgress?.(Math.min(values.length, start + chunk.length), values.length);
  }
  return sheet.getRangeByIndexes(0, 0, values.length, columns);
}

export async function inspectSelectedExcelRange(
  runtime: ExcelRuntimeLike,
  workbookId: string,
  chunkRows = 500,
  onProgress?: (completedRows: number, totalRows: number) => void,
  onAutoDetect?: (address: string) => void,
  isCancelled?: () => boolean,
): Promise<ExcelRangeInput> {
  if (!Number.isInteger(chunkRows) || chunkRows < 1 || chunkRows > 5000)
    throw new Error("chunkRows must be an integer between 1 and 5000");
  return runtime.run(async (context) => {
    let selected = context.workbook.getSelectedRange();
    // Values are read in bounded chunks below, not in one large payload here.
    selected.load(["address", "rowCount", "columnCount"]);
    selected.worksheet.load("name");
    await context.sync();
    // Nobody should have to drag-select first. A single clicked cell means "this table"; an empty
    // cell, a whole column or the whole sheet means "the data on this sheet".
    const cellCount = Number(selected.rowCount) * Number(selected.columnCount);
    const needsDetection =
      cellCount === 1 ||
      cellCount > MAX_EXCEL_SELECTION_CELLS ||
      Number(selected.columnCount) > MAX_EXCEL_SELECTION_COLUMNS;
    if (needsDetection) {
      const candidates: Array<() => any> = [];
      if (
        cellCount === 1 &&
        typeof selected.getSurroundingRegion === "function"
      )
        candidates.push(() => selected.getSurroundingRegion());
      if (typeof selected.getUsedRangeOrNullObject === "function")
        candidates.push(() => {
          const used = selected.getUsedRangeOrNullObject(true);
          return used;
        });
      const sheetUsed = (selected.worksheet as any)?.getUsedRangeOrNullObject;
      if (typeof sheetUsed === "function")
        candidates.push(() => {
          const used = (selected.worksheet as any).getUsedRangeOrNullObject(
            true,
          );
          return used;
        });
      for (const make of candidates) {
        try {
          let found = make();
          found.load(["address", "rowCount", "columnCount", "isNullObject"]);
          await context.sync();
          if (found.isNullObject) continue;
          // From the top-left of the data, take the block of connected cells: the first table.
          if (
            Number(found.rowCount) * Number(found.columnCount) > 1 &&
            typeof found.getCell === "function" &&
            Number(found.rowCount) > 2
          ) {
            try {
              const block = found.getCell(0, 0).getSurroundingRegion();
              block.load(["address", "rowCount", "columnCount"]);
              await context.sync();
              if (Number(block.rowCount) >= 2) found = block;
            } catch {
              // keep the whole used range
            }
          }
          // A table over the cell limit is still usable: it is sampled below, not refused.
          if (
            Number(found.rowCount) >= 2 &&
            Number(found.columnCount) >= 1 &&
            Number(found.columnCount) <= MAX_EXCEL_SELECTION_COLUMNS
          ) {
            found.worksheet?.load?.("name");
            await context.sync();
            selected = found;
            onAutoDetect?.(String(found.address));
            break;
          }
        } catch {
          // try the next way of finding the data
        }
      }
    }
    const rows = Number(selected.rowCount);
    const columns = Number(selected.columnCount);
    if (rows < 2)
      throw new Error(
        "Click a cell inside your table (or select it) so it has a header row and at least one data row.",
      );
    if (
      !Number.isSafeInteger(rows) ||
      !Number.isSafeInteger(columns) ||
      columns < 1 ||
      columns > MAX_EXCEL_SELECTION_COLUMNS
    )
      throw new Error(
        `The selection is too wide. Select at most ${MAX_EXCEL_SELECTION_COLUMNS} columns.`,
      );
    // Over the cell limit: read a sample for planning; Excel computes the result over every row.
    const sampled = rows * columns > MAX_EXCEL_SELECTION_CELLS;
    const sampleRows = sampled ? sampleRowBudget(columns) : rows;
    const values = sampled
      ? await readSampleRows(context, selected, rows, columns, sampleRows, {
          maxTextChars: MAX_EXCEL_SELECTION_TEXT_CHARS,
          onProgress,
          isCancelled,
        })
      : await readValuesInChunks(context, selected, rows, columns, chunkRows, {
          maxTextChars: MAX_EXCEL_SELECTION_TEXT_CHARS,
          onProgress,
          isCancelled,
        });
    const input: ExcelRangeInput = {
      workbookId,
      worksheetName: selected.worksheet.name,
      address: selected.address,
      values,
      hasHeaders: true,
      ...(sampled
        ? { sample: { totalRows: rows, sampledRows: values.length } }
        : {}),
    };
    assertValidExcelTabularRange(input);
    return input;
  });
}

/** Reads a bounded selected range of formulas and displayed values without mutating the workbook. */
export async function inspectSelectedExcelFormulas(
  runtime: ExcelRuntimeLike,
  maxCells = 2000,
): Promise<FormulaSelection> {
  if (!Number.isInteger(maxCells) || maxCells < 1 || maxCells > 10000)
    throw new Error("maxCells must be an integer between 1 and 10000");
  return runtime.run(async (context) => {
    const selected = context.workbook.getSelectedRange();
    selected.load(["address", "rowCount", "columnCount", "formulas", "values"]);
    selected.worksheet.load("name");
    await context.sync();
    const cells = Number(selected.rowCount) * Number(selected.columnCount);
    if (!Number.isSafeInteger(cells) || cells < 1)
      throw new Error("Select at least one cell to inspect formulas.");
    if (cells > maxCells)
      throw new Error(
        `Formula inspection is limited to ${maxCells} cells. Select a smaller range.`,
      );
    return {
      worksheetName: selected.worksheet.name,
      address: selected.address,
      formulas: selected.formulas,
      values: selected.values,
    };
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
  const sample = plan.profile?.sample;
  const values = await readValuesInChunks(
    context,
    range,
    // A sampled range is pinned by its size and header rows, not by every row.
    sample
      ? Math.min(Number(range.rowCount), SAMPLED_FINGERPRINT_ROWS)
      : Number(range.rowCount),
    Number(range.columnCount),
    500,
  );
  return fingerprintExcelRange({
    workbookId: plan.workbookId,
    worksheetName: plan.worksheetName,
    address: plan.sourceAddress,
    values,
    ...(sample
      ? {
          sample:
            Number(range.rowCount) === sample.totalRows
              ? sample
              : { ...sample, totalRows: Number(range.rowCount) },
        }
      : {}),
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
    /** Chart one bar per category (summed) instead of one per source row, e.g. after a pivot. */
    aggregateCharts?: boolean;
    requirements?: Record<string, string>;
    onAction?: (result: ExcelActionResult) => void;
    onProgress?: (completedRows: number, totalRows: number) => void;
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

    // A second run must produce a visible new result, not silently reuse last time's sheet.
    const existingSheets = context.workbook.worksheets;
    existingSheets.load?.("items/name");
    await context.sync();
    const takenNames = new Set<string>(
      (existingSheets.items ?? []).map((sheet: any) => String(sheet.name)),
    );
    const resolvedTargets = new Map<string, string>();
    const resolveTarget = (planned: any): string => {
      const name = String(planned.targetSheet);
      if (name === plan.worksheetName) return name;
      const known = resolvedTargets.get(name);
      if (known) return known;
      const chosen = plannedSheetName(
        planned,
        plan.worksheetName,
        takenNames,
        MAX_SHEET_NAME,
      );
      takenNames.add(chosen);
      resolvedTargets.set(name, chosen);
      return chosen;
    };
    // Pivot and table names are workbook-wide, so they get a number when one already exists.
    const takenObjects = new Set<string>();
    const pivotList = context.workbook.pivotTables;
    pivotList.load?.("items/name");
    const tableList = context.workbook.tables;
    tableList.load?.("items/name");
    const nameList = context.workbook.names;
    nameList?.load?.("items/name");
    let slicerList: any;
    try {
      slicerList = context.workbook.slicers;
    } catch {
      slicerList = undefined;
    }
    slicerList?.load?.("items/name");
    await context.sync();
    for (const item of pivotList.items ?? [])
      takenObjects.add(String(item.name));
    for (const item of tableList.items ?? [])
      takenObjects.add(String(item.name));
    for (const item of nameList?.items ?? [])
      takenObjects.add(String(item.name));
    for (const item of slicerList?.items ?? [])
      takenObjects.add(String(item.name));
    const uniqueObject = (base: string): string => {
      if (!takenObjects.has(base)) return base;
      for (let n = 2; n < 100; n += 1)
        if (!takenObjects.has(`${base}_${n}`)) return `${base}_${n}`;
      return base;
    };

    const actionSourceRange = () => {
      if (!plan.normalization) return sourceRange();
      if (!normalizedSource)
        throw new Error(
          "normalized result sheet was not created; source data was not changed",
        );
      return normalizedSource;
    };

    let lastCopiedValues: any[][] | undefined;

    const writeSourceCopy = async (sheet: any) => {
      if (plan.profile?.sample)
        throw new Error(
          "This result would copy every row of a very large range. Ask for a PivotTable, a view of the top rows or a computed column instead.",
        );
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
      const copiedValues = plan.normalization
        ? [
            plan.normalization.headers,
            ...values.slice(plan.normalization.headerRowCount),
          ]
        : values;
      lastCopiedValues = copiedValues;
      normalizedSource = await writeValuesInChunks(
        context,
        sheet,
        copiedValues,
        500,
        literal,
        options.onProgress,
      );
      return copiedValues.length;
    };

    const readSourceHead = async (maxRows: number) => {
      const range = sourceRange();
      range.load(["rowCount", "columnCount"]);
      await context.sync();
      const count = Math.min(maxRows, Number(range.rowCount));
      return readValuesInChunks(
        context,
        range,
        count,
        Number(range.columnCount),
        500,
      );
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
    // A PivotTable field is found by the name Excel gives it, which can differ from the header text
    // in spacing or case; the exact name is tried first.
    const pivotFieldResolver = async (pivot: any) => {
      let names: string[] = [];
      try {
        pivot.hierarchies.load("items/name");
        await context.sync();
        names = (pivot.hierarchies.items ?? []).map((item: any) =>
          String(item.name),
        );
      } catch {
        names = [];
      }
      const normal = (text: string) =>
        text.replace(/s+/g, " ").trim().toLowerCase();
      const nameOf = (name: string) =>
        names.find((entry) => entry === name) ??
        names.find((entry) => normal(entry) === normal(name)) ??
        name;
      return Object.assign(
        (name: string) => pivot.hierarchies.getItem(nameOf(name)),
        { nameOf },
      );
    };
    // Very large data: the header row is all that is read; the formulas cover every row.
    const readHeaderCells = async (): Promise<string[]> => {
      const headerRow = sourceRange().getRow(0);
      headerRow.load("values");
      await context.sync();
      return (headerRow.values[0] ?? []).map((cell: any) => String(cell ?? ""));
    };
    // Spilled results keep no formats: copy each column's number format from the first data row.
    const copyColumnFormats = async (sheet: any, columns: number[]) => {
      try {
        const sample = sourceRange().getRow(1);
        sample.load("numberFormat");
        await context.sync();
        const formats: string[] = (sample.numberFormat?.[0] ?? []).map(
          (format: any) => String(format ?? "General"),
        );
        let any = false;
        columns.forEach((source, target) => {
          const format = formats[source];
          if (format && format !== "General") {
            sheet.getRangeByIndexes(1, target, 1048575, 1).numberFormat =
              format as any;
            any = true;
          }
        });
        if (any) await context.sync();
      } catch {
        // Formats are presentation only.
      }
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

    for (const planned of plan.actions) {
      const resolvedSheet = resolveTarget(planned);
      const objectName =
        planned.kind === "pivot-table" ||
        planned.kind === "table" ||
        planned.kind === "dashboard" ||
        planned.kind === "named-range" ||
        planned.kind === "slicer"
          ? uniqueObject(planned.name)
          : planned.name;
      takenObjects.add(objectName);
      const action = {
        ...planned,
        targetSheet: resolvedSheet,
        name: objectName,
      };
      const result: ExcelActionResult = {
        kind: action.kind,
        name: action.name,
        targetSheet: action.targetSheet,
        status: "created",
      };
      const actionStarted = Date.now();
      try {
        const required = options.requirements?.[action.kind];
        if (
          required &&
          options.supportsExcelApi &&
          !options.supportsExcelApi(required)
        ) {
          result.status = "skipped_unsupported";
          result.error = `UNSUPPORTED_CAPABILITY: requires ExcelApi ${required}`;
        } else if (action.kind === "table") {
          const existing = context.workbook.tables.getItemOrNullObject(
            action.name,
          );
          existing.load("isNullObject");
          await context.sync();
          if (!existing.isNullObject) result.status = "exists";
          else {
            if (String(action.targetSheet).length > MAX_SHEET_NAME)
              throw new Error(
                `target sheet name exceeds ${MAX_SHEET_NAME} characters`,
              );
            const found = context.workbook.worksheets.getItemOrNullObject(
              action.targetSheet,
            );
            found.load("isNullObject");
            await context.sync();
            const targetSheet = found.isNullObject
              ? context.workbook.worksheets.add(action.targetSheet)
              : found;
            result.createdSheet = found.isNullObject;
            if (result.createdSheet) {
              try {
                targetSheet.customProperties.add("vynorai", "result");
              } catch {
                // Older hosts fall back to the guarded legacy-name ownership check.
              }
            }
            await writeSourceCopy(targetSheet);
            targetSheet.tables.add(normalizedSource, true).name = action.name;
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
          result.createdSheet = !sheetExists;
          if (!sheetExists) {
            try {
              // Ownership marker, so cleanup and undo never depend on the sheet's name.
              sheet.customProperties.add("vynorai", "result");
            } catch {
              // Older hosts: the legacy name check still applies.
            }
          }
          if (action.kind === "named-range") {
            const spec = action.spec;
            if (!Number.isInteger(spec?.namedRangeIndex))
              throw new Error("named range needs a validated source column");
            const existingName = context.workbook.names.getItemOrNullObject(
              action.name,
            );
            existingName.load("isNullObject");
            await context.sync();
            if (!existingName.isNullObject) {
              if (result.createdSheet) {
                sheet.delete();
                await context.sync();
                result.createdSheet = false;
              }
              result.status = "exists";
            } else if (plan.profile?.sample) {
              // Very large data: the name points at the source column itself, nothing is copied.
              const parsed = parseLocalRange(
                localExcelAddress(plan.sourceAddress),
              );
              const column = columnLetter(
                parsed.startColumn + (spec.namedRangeIndex as number),
              );
              const escapedSource = String(plan.worksheetName).replace(
                /'/g,
                "''",
              );
              context.workbook.names.add(
                action.name,
                `='${escapedSource}'!$${column}$${parsed.startRow + 1}:$${column}$${parsed.endRow}`,
              );
              await context.sync();
              if (result.createdSheet) {
                sheet.delete();
                await context.sync();
                result.createdSheet = false;
              }
            } else {
              const copiedRowCount = await writeSourceCopy(sheet);
              const startRow = plan.normalization ? 3 : 2;
              const endRow = Math.max(startRow, copiedRowCount);
              const escapedSheet = String(action.targetSheet).replace(
                /'/g,
                "''",
              );
              const column = columnLetter(spec.namedRangeIndex as number);
              context.workbook.names.add(
                action.name,
                `='${escapedSheet}'!$${column}$${startRow}:$${column}$${endRow}`,
              );
              await context.sync();
            }
          } else if (action.kind === "slicer") {
            const spec = action.spec;
            if (!Number.isInteger(spec?.slicerIndex) || !spec.slicerColumn)
              throw new Error("slicer needs a validated source column");
            await writeSourceCopy(sheet);
            if (!normalizedSource)
              throw new Error("slicer source copy was not created");
            const tableName = uniqueObject(`${action.name}_data`);
            const table = sheet.tables.add(normalizedSource, true);
            table.name = tableName;
            const slicer = context.workbook.slicers.add(
              table,
              spec.slicerColumn,
              sheet,
            );
            slicer.name = action.name;
            slicer.caption = String(spec.slicerColumn);
            await context.sync();
          } else if (action.kind === "new-sheet") {
            if (sheetExists) {
              result.status = "exists";
            } else if (plan.normalization) {
              await writeSourceCopy(sheet);
            } else {
              sheet.getRange("A1:C1").values = [
                ["VynorAI result", "Source preserved", plan.sourceAddress],
              ];
              await context.sync();
            }
          } else if (action.kind === "export-csv") {
            if (sheetExists) {
              result.status = "exists";
            } else {
              await writeSourceCopy(sheet);
              if (!lastCopiedValues)
                throw new Error("CSV source copy was not created");
              downloadExcelCsv(lastCopiedValues, `${action.targetSheet}.csv`);
            }
          } else if (action.kind === "export-pdf") {
            if (sheetExists) {
              const priorResultCreated = results.some(
                (prior) =>
                  prior.targetSheet === action.targetSheet &&
                  prior.createdSheet === true,
              );
              if (priorResultCreated)
                await downloadExcelPdf(`${action.targetSheet}.pdf`);
              else result.status = "exists";
            } else {
              await writeSourceCopy(sheet);
              await downloadExcelPdf(`${action.targetSheet}.pdf`);
            }
          } else if (action.kind === "dashboard") {
            const dashboard = action.spec?.dashboard;
            if (!dashboard)
              throw new Error("dashboard needs explicit column choices");
            if (plan.normalization)
              throw new Error("A dashboard needs a range with one header row");
            if (sheetExists) {
              result.status = "exists";
            } else {
              const dashboardSampled = Boolean(plan.profile?.sample);
              // Very large data: the totals and the category table are formulas over every row.
              const { rows } = dashboardSampled
                ? splitHeader(await readSourceHead(LARGE_FORMAT_ROWS + 1))
                : splitHeader(await readSourceValues());
              const parsed = parseLocalRange(
                localExcelAddress(plan.sourceAddress),
              );
              const quotedSheet = `'${String(plan.worksheetName).replace(/'/g, "''")}'!`;
              const sourceColumn = (index: number) => {
                const letter = columnLetter(parsed.startColumn + index);
                return `${quotedSheet}$${letter}$${parsed.startRow + 1}:$${letter}$${parsed.endRow}`;
              };
              const category = dashboard.category as {
                column: string;
                index: number;
              };
              const values = dashboard.values as Array<{
                column: string;
                index: number;
              }>;
              const aggregation = String(dashboard.aggregation ?? "sum");
              const aggregateFormula = (
                value: string,
                categoryCell: string,
              ) => {
                const categoryRange = sourceColumn(category.index);
                if (aggregation === "count")
                  return `=COUNTIFS(${categoryRange},${categoryCell})`;
                if (aggregation === "average")
                  return `=IFERROR(AVERAGEIFS(${value},${categoryRange},${categoryCell}),"")`;
                if (aggregation === "min")
                  return `=MINIFS(${value},${categoryRange},${categoryCell})`;
                if (aggregation === "max")
                  return `=MAXIFS(${value},${categoryRange},${categoryCell})`;
                return `=SUMIFS(${value},${categoryRange},${categoryCell})`;
              };
              const title = `VynorAI dashboard: ${values.map((entry) => entry.column).join(", ")} by ${category.column}`;
              sheet.getRange("A1").values = [[title]];
              sheet.getRange("A1").format.font.bold = true;
              const kpis: string[][] = [
                ["KPI", "Value"],
                ["Data rows", `=ROWS(${sourceColumn(category.index)})`],
                ...values.flatMap((entry) => [
                  [
                    `Total ${entry.column}`,
                    `=SUM(${sourceColumn(entry.index)})`,
                  ],
                  [
                    `Average ${entry.column}`,
                    `=IFERROR(AVERAGE(${sourceColumn(entry.index)}),"")`,
                  ],
                ]),
              ];
              const kpiRange = sheet.getRangeByIndexes(2, 0, kpis.length, 2);
              kpiRange.formulas = kpis.map((row, rowIndex) =>
                row.map((cell, columnIndex) =>
                  rowIndex === 0 || columnIndex === 0 ? literal(cell) : cell,
                ),
              );
              kpiRange.format.autofitColumns();
              sheet.getRangeByIndexes(2, 0, 1, 2).format.font.bold = true;

              const categories = [
                ...new Set(
                  rows
                    .map((row: any[]) =>
                      String(row[category.index] ?? "").trim(),
                    )
                    .filter(Boolean),
                ),
              ].slice(0, 50);
              for (const [index, value] of values.entries()) {
                const summaryColumn = 14 + index * 2;
                if (dashboardSampled) {
                  const categoryRange = sourceColumn(category.index);
                  const letter = columnLetter(summaryColumn);
                  const shown = Math.max(1, categories.length);
                  sheet.getRangeByIndexes(0, summaryColumn, 1, 2).values = [
                    [literal(category.column), literal(value.column)],
                  ];
                  sheet.getRange(`${letter}2`).formulas = [
                    [
                      `=TAKE(SORT(UNIQUE(FILTER(${categoryRange},${categoryRange}<>""))),50)`,
                    ],
                  ];
                  const measure = aggregateFormula(
                    sourceColumn(value.index),
                    "c",
                  ).slice(1);
                  sheet.getRange(
                    `${columnLetter(summaryColumn + 1)}2`,
                  ).formulas = [[`=BYROW(${letter}2#,LAMBDA(c,${measure}))`]];
                  await context.sync();
                  const chartRange = sheet.getRangeByIndexes(
                    0,
                    summaryColumn,
                    shown + 1,
                    2,
                  );
                  const chart = sheet.charts.add(
                    "ColumnClustered",
                    chartRange,
                    "Columns",
                  );
                  chart.name = `${action.name}_chart_${index + 1}`;
                  chart.title.text = `${value.column} by ${category.column}`;
                  chart.setPosition(`F${3 + index * 18}`);
                  continue;
                }
                const summary = [
                  [category.column, value.column],
                  ...categories.map((name, rowIndex) => [
                    literal(name),
                    aggregateFormula(
                      sourceColumn(value.index),
                      `${columnLetter(summaryColumn)}${rowIndex + 2}`,
                    ),
                  ]),
                ];
                const summaryRange = sheet.getRangeByIndexes(
                  0,
                  summaryColumn,
                  summary.length,
                  2,
                );
                summaryRange.formulas = summary.map((row, rowIndex) =>
                  row.map((cell, columnIndex) =>
                    rowIndex === 0 || columnIndex === 0 ? literal(cell) : cell,
                  ),
                );
                if (categories.length > 0) {
                  const chart = sheet.charts.add(
                    "ColumnClustered",
                    summaryRange,
                    "Columns",
                  );
                  chart.name = `${action.name}_chart_${index + 1}`;
                  chart.title.text = `${value.column} by ${category.column}`;
                  chart.setPosition(`F${3 + index * 18}`);
                }
              }
              const pivot = sheet.pivotTables.add(
                action.name,
                sourceRange(),
                sheet.getRange(`A${kpis.length + 5}`),
              );
              await context.sync();
              pivot.rowHierarchies.add(
                pivot.hierarchies.getItem(category.column),
              );
              for (const value of values) {
                const field = pivot.dataHierarchies.add(
                  pivot.hierarchies.getItem(value.column),
                );
                field.summarizeBy =
                  {
                    sum: "Sum",
                    count: "Count",
                    average: "Average",
                    min: "Min",
                    max: "Max",
                  }[aggregation] ?? "Sum";
              }
              await context.sync();
            }
          } else if (
            action.kind === "chart" &&
            plan.profile?.sample &&
            action.spec?.chartType === "histogram"
          ) {
            // Very large data: ten COUNTIFS bins over every row, charted as columns.
            const spec = action.spec;
            const headers = await readHeaderCells();
            const parsed = parseLocalRange(
              localExcelAddress(plan.sourceAddress),
            );
            const cells = histogramCells(
              {
                sheetName: plan.worksheetName,
                startColumn: parsed.startColumn,
                startRow: parsed.startRow - 1,
                endRow: parsed.endRow - 1,
                columns: headers.length,
              },
              spec.valueIndex as number,
              String(spec.valueColumn),
            );
            sheet.getRangeByIndexes(0, 0, cells.length, 4).formulas = cells.map(
              (row, rowIndex) =>
                row.map((cell) => (rowIndex === 0 ? literal(cell) : cell)),
            );
            await context.sync();
            sheet.getRangeByIndexes(0, 0, 1, 4).format.font.bold = true;
            const chart = sheet.charts.add(
              "ColumnClustered",
              sheet.getRangeByIndexes(0, 0, cells.length, 2),
              "Columns",
            );
            chart.name = action.name;
            chart.title.text = `${spec.valueColumn} distribution`;
            chart.setPosition("F2");
            await context.sync();
          } else if (action.kind === "chart") {
            const existing = sheet.charts.getItemOrNullObject(action.name);
            existing.load("isNullObject");
            await context.sync();
            if (!existing.isNullObject) result.status = "exists";
            else {
              const spec = action.spec;
              if (spec?.pivotSourceName) {
                if (
                  options.supportsExcelApi &&
                  !options.supportsExcelApi("1.8")
                )
                  throw new Error(
                    "skipped_unsupported: pivot-result charts need ExcelApi 1.8",
                  );
                const pivot = context.workbook.pivotTables.getItemOrNullObject(
                  spec.pivotSourceName,
                );
                pivot.load("isNullObject");
                await context.sync();
                if (pivot.isNullObject)
                  throw new Error(
                    "pivot_result_unavailable: the PivotTable was not created before its chart",
                  );
                const pivotRange = pivot.layout?.getRange?.();
                if (!pivotRange)
                  throw new Error(
                    "pivot_result_unavailable: this Excel host cannot expose the PivotTable layout range",
                  );
                const pivotChartTypes: Record<string, string> = {
                  column: "ColumnClustered",
                  line: "Line",
                  bar: "BarClustered",
                  pie: "Pie",
                  "stacked-column": "ColumnStacked",
                  "stacked-bar": "BarStacked",
                  area: "Area",
                  combo: "ColumnClustered",
                };
                const chart = sheet.charts.add(
                  pivotChartTypes[spec.chartType] ?? "ColumnClustered",
                  pivotRange,
                  "Columns",
                );
                chart.name = action.name;
                chart.setPosition("H3");
                chart.title.text = `PivotTable result: ${spec.valueColumn} by ${spec.categoryColumn}`;
                if (spec.showDataLabels) {
                  try {
                    chart.dataLabels.showValue = true;
                  } catch {
                    // Older hosts may not expose chart data labels; keep the chart itself.
                  }
                }
                await context.sync();
              } else if (spec?.categoryColumn) {
                if (
                  options.supportsExcelApi &&
                  !options.supportsExcelApi("1.7")
                )
                  throw new Error(
                    "skipped_unsupported: column-aware charts need ExcelApi 1.7",
                  );
                let source = actionSourceRange();
                let categoryIndex = spec.categoryIndex as number;
                let valueIndex = spec.valueIndex as number;
                let extraIndexes: number[] = spec.extraValueIndexes ?? [];
                let secondary: number[] = spec.secondaryIndexes ?? [];
                const sourceData = splitHeader(await readSourceValues());
                const seenCategories = sourceData.rows.map((row: any[]) =>
                  String(row[categoryIndex] ?? ""),
                );
                const repeats =
                  new Set(seenCategories).size < seenCategories.length &&
                  !/date|day|week|month|quarter|year|period|time/i.test(
                    String(spec.categoryColumn),
                  );
                if (
                  spec.chartType !== "histogram" &&
                  (options.aggregateCharts || repeats)
                ) {
                  // One summed row per category, written next to the chart, so a chart shows the
                  // same totals a pivot would instead of one bar per raw row.
                  try {
                    const { headers, rows } = sourceData;
                    const wanted = [valueIndex, ...extraIndexes];
                    const totals = new Map<string, number[]>();
                    for (const row of rows) {
                      const key = String(row[categoryIndex] ?? "");
                      const sums = totals.get(key) ?? wanted.map(() => 0);
                      wanted.forEach((index, at) => {
                        const n = Number(row[index]);
                        if (Number.isFinite(n)) sums[at] += n;
                      });
                      totals.set(key, sums);
                    }
                    const out: (string | number)[][] = [
                      [
                        headers[categoryIndex],
                        ...wanted.map((i) => headers[i]),
                      ],
                      ...[...totals].map(([key, sums]) => [key, ...sums]),
                    ];
                    const block = sheet.getRangeByIndexes(
                      19,
                      0,
                      out.length,
                      out[0].length,
                    );
                    if (typeof block.getColumn !== "function")
                      throw new Error("summary block unsupported");
                    block.values = out;
                    await context.sync();
                    source = block;
                    secondary = secondary.map((i) => wanted.indexOf(i) + 1);
                    categoryIndex = 0;
                    valueIndex = 1;
                    extraIndexes = extraIndexes.map((_, at) => at + 2);
                  } catch {
                    // The summary block could not be written: chart the raw rows instead.
                  }
                }
                const chartTypes: Record<string, string> = {
                  column: "ColumnClustered",
                  line: "Line",
                  bar: "BarClustered",
                  pie: "Pie",
                  "stacked-column": "ColumnStacked",
                  "stacked-bar": "BarStacked",
                  area: "Area",
                  combo: "ColumnClustered",
                  histogram: "Histogram",
                  waterfall: "Waterfall",
                };
                const chart = sheet.charts.add(
                  chartTypes[spec.chartType] ?? "ColumnClustered",
                  source.getColumn(valueIndex),
                  "Columns",
                );
                chart.name = action.name;
                chart.setPosition("H3");
                chart.title.text =
                  spec.chartType === "histogram"
                    ? `${spec.valueColumn} distribution`
                    : `${[spec.valueColumn, ...(spec.extraValueColumns ?? [])].join(", ")} by ${spec.categoryColumn}`;
                if (spec.showDataLabels) {
                  try {
                    chart.dataLabels.showValue = true;
                  } catch {
                    // Older hosts may not expose chart data labels; keep the chart itself.
                  }
                }
                // Axis titles and the legend are presentation only: a host that refuses them must
                // not fail the chart itself.
                try {
                  const extras = spec.extraValueIndexes ?? [];
                  chart.legend.visible =
                    extras.length > 0 || spec.chartType === "pie";
                  if (
                    spec.chartType !== "pie" &&
                    spec.chartType !== "histogram"
                  ) {
                    chart.axes.categoryAxis.title.text = String(
                      spec.categoryColumn,
                    );
                    chart.axes.valueAxis.title.text =
                      extras.length > 0 ? "Value" : String(spec.valueColumn);
                    chart.axes.valueAxis.numberFormat = "#,##0";
                  }
                } catch {
                  // Left as the host default.
                }
                await context.sync();
                const dataOf = (index: number) =>
                  source
                    .getColumn(index)
                    .getOffsetRange(1, 0)
                    .getResizedRange(-1, 0);
                if (spec.chartType !== "histogram")
                  chart.series
                    .getItemAt(0)
                    .setXAxisValues(dataOf(categoryIndex));
                extraIndexes.forEach((index, position) => {
                  const extra = chart.series.add(
                    String(
                      spec.extraValueColumns?.[position] ??
                        `Series ${position + 2}`,
                    ),
                  );
                  extra.setValues(dataOf(index));
                  extra.setXAxisValues(dataOf(categoryIndex));
                  // A series on a very different scale gets its own axis so it stays readable.
                  if (secondary.includes(index)) {
                    try {
                      extra.axisGroup = "Secondary";
                    } catch {
                      // The host keeps it on the primary axis.
                    }
                  }
                  if (spec.chartType === "combo") {
                    try {
                      extra.chartType = "Line";
                    } catch {
                      // Older hosts keep the additional series as columns.
                    }
                  }
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
              let pivot: any;
              const formulaSummary = async () => {
                const headers = await readHeaderCells();
                const fallback = pivotFallbackFormula({
                  sheetName: plan.worksheetName,
                  localAddress: localExcelAddress(plan.sourceAddress),
                  headers,
                  rowsColumn: action.spec!.rowsColumn!,
                  valuesColumns: [
                    action.spec!.valuesColumn!,
                    ...(action.spec!.extraValuesColumns ?? []),
                  ],
                  aggregation: action.spec!.aggregation,
                  topN: action.spec!.topN,
                  lowest: action.spec!.lowest,
                });
                sheet.getRange("A2").values = [
                  [
                    "A live formula summary of the same grouping (a PivotTable is not used on very large data in Excel on the web).",
                  ],
                ];
                sheet.getRangeByIndexes(
                  2,
                  0,
                  1,
                  fallback.headers.length,
                ).values = [fallback.headers.map(literal)];
                sheet.getRange("A4").formulas = [[fallback.formula]];
                sheet.getRangeByIndexes(
                  2,
                  0,
                  1,
                  fallback.headers.length,
                ).format.font.bold = true;
                await context.sync();
              };
              if (plan.profile?.sample && action.spec?.rowsColumn) {
                // Very large data: Excel on the web times out or refuses PivotTableCollection.add
                // (GeneralException after about a minute), so the grouping is one live formula that
                // Excel calculates over every row, like the other very-large-data results.
                await formulaSummary();
              } else {
                try {
                  pivot = sheet.pivotTables.add(
                    action.name,
                    actionSourceRange(),
                    sheet.getRange("A3"),
                  );
                  await context.sync();
                } catch (pivotError) {
                  if (!action.spec?.rowsColumn) throw pivotError;
                  pivot = undefined;
                  await formulaSummary();
                }
              }
              if (pivot && action.spec?.rowsColumn) {
                const field = await pivotFieldResolver(pivot);
                pivot.rowHierarchies.add(field(action.spec.rowsColumn));
                if (action.spec.subRowsColumn)
                  pivot.rowHierarchies.add(field(action.spec.subRowsColumn));
                const total = pivot.dataHierarchies.add(
                  field(action.spec.valuesColumn),
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
                const dataFields: any[] = [total];
                for (const extraName of action.spec.extraValuesColumns ?? []) {
                  const more = pivot.dataHierarchies.add(field(extraName));
                  more.summarizeBy =
                    summarize[action.spec.aggregation ?? "sum"] ?? "Sum";
                  dataFields.push(more);
                }
                if (action.spec.showAs) {
                  const calculation =
                    action.spec.showAs === "percent-of-column"
                      ? "PercentOfColumnTotal"
                      : "PercentOfGrandTotal";
                  for (const field of dataFields) {
                    try {
                      field.showAs = { calculation };
                    } catch {
                      // Older hosts keep the plain totals.
                    }
                  }
                }
                if (action.spec.topN) {
                  // Biggest first, then only the top N rows. Older hosts keep every row.
                  try {
                    total.load("name");
                    await context.sync();
                    const rowField = field(
                      action.spec.rowsColumn,
                    ).fields.getItem(field.nameOf(action.spec.rowsColumn));
                    rowField.applyFilter({
                      valueFilter: {
                        condition: action.spec.lowest ? "BottomN" : "TopN",
                        selectionType: "Items",
                        threshold: action.spec.topN,
                        value: total.name,
                      },
                    });
                    await context.sync();
                    try {
                      rowField.sortByValues(
                        action.spec.lowest ? "Ascending" : "Descending",
                        total,
                      );
                      await context.sync();
                    } catch {
                      // The filter alone still limits the rows.
                    }
                  } catch {
                    // The host has no PivotTable filters: every row stays.
                  }
                }
                if (action.spec.columnsColumn)
                  pivot.columnHierarchies.add(field(action.spec.columnsColumn));
                if (action.spec.filterColumn)
                  pivot.filterHierarchies.add(field(action.spec.filterColumn));
                await context.sync();
              }
            }
          } else if (action.kind === "clean" && plan.profile?.sample) {
            if (sheetExists) {
              result.status = "exists";
            } else {
              // Very large data: one spilled formula cleans every row inside Excel.
              const headers = await readHeaderCells();
              const parsed = parseLocalRange(
                localExcelAddress(plan.sourceAddress),
              );
              const operations = (action.spec?.operations ?? [
                "trim",
              ]) as string[];
              const formula = cleanFormula(
                {
                  sheetName: plan.worksheetName,
                  startColumn: parsed.startColumn,
                  startRow: parsed.startRow - 1,
                  endRow: parsed.endRow - 1,
                  columns: headers.length,
                },
                {
                  operations,
                  fillBlanks: action.spec?.fillBlanks as
                    | string
                    | number
                    | undefined,
                  fillBlanksColumnIndex: action.spec?.fillBlanksColumnIndex as
                    | number
                    | undefined,
                },
              );
              sheet.getRangeByIndexes(0, 0, 1, headers.length).values = [
                headers.map(literal),
              ];
              sheet.getRange("A2").formulas = [[formula]];
              sheet.getRangeByIndexes(
                0,
                0,
                1,
                headers.length,
              ).format.font.bold = true;
              await context.sync();
              await copyColumnFormats(
                sheet,
                headers.map((_header, index) => index),
              );
            }
          } else if (action.kind === "clean") {
            if (sheetExists) {
              result.status = "exists";
            } else {
              const { headers, rows } = splitHeader(await readSourceValues());
              const cleaned = cleanRows(
                rows,
                (action.spec?.operations ?? ["trim"]) as CleanOperation[],
                action.spec?.fillBlanks as string | number | undefined,
                action.spec?.fillBlanksColumnIndex as number | undefined,
              );
              const out = [headers, ...cleaned.rows].map((row) =>
                row.map(literal),
              );
              sheet.getRangeByIndexes(0, 0, out.length, headers.length).values =
                out;
              await context.sync();
              for (const column of cleaned.dateColumns) {
                sheet.getRangeByIndexes(
                  1,
                  column,
                  cleaned.rows.length,
                  1,
                ).numberFormat = Array.from(
                  { length: cleaned.rows.length },
                  () => ["yyyy-mm-dd"],
                );
              }
              if (cleaned.dateColumns.length > 0 && cleaned.rows.length > 0)
                await context.sync();
            }
          } else if (
            action.kind === "view" &&
            (plan.profile?.sample || action.spec?.where)
          ) {
            if (sheetExists) {
              result.status = "exists";
            } else {
              // Very large data: one spilled formula, Excel filters and sorts every row itself.
              const headers = await readHeaderCells();
              const spec = action.spec ?? {};
              const parsed = parseLocalRange(
                localExcelAddress(plan.sourceAddress),
              );
              const formula = viewFormula(
                {
                  sheetName: plan.worksheetName,
                  startColumn: parsed.startColumn,
                  startRow: parsed.startRow - 1,
                  endRow: parsed.endRow - 1,
                  columns: headers.length,
                },
                {
                  sort: spec.sort
                    ? { index: spec.sort.index, direction: spec.sort.direction }
                    : undefined,
                  filter: spec.filter
                    ? {
                        index: spec.filter.index,
                        operator: spec.filter.operator,
                        value: spec.filter.value,
                      }
                    : undefined,
                  where: spec.where
                    ? parseExpression(String(spec.where), headers.map(String))
                        .ast
                    : undefined,
                  limit: spec.limit,
                },
              );
              sheet.getRangeByIndexes(0, 0, 1, headers.length).values = [
                headers.map(literal),
              ];
              sheet.getRange("A2").formulas = [[formula]];
              sheet.getRangeByIndexes(
                0,
                0,
                1,
                headers.length,
              ).format.font.bold = true;
              await context.sync();
              await copyColumnFormats(
                sheet,
                headers.map((_header, index) => index),
              );
              try {
                sheet
                  .getRangeByIndexes(0, 0, 1, headers.length)
                  .format.autofitColumns();
                await context.sync();
              } catch {
                // Presentation only.
              }
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
                limit: spec.limit,
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
          } else if (action.kind === "statistics") {
            const spec = action.spec?.statistics;
            if (!spec)
              throw new Error("statistics needs explicit column choices");
            if (plan.normalization)
              throw new Error("Statistics need a range with one header row");
            if (sheetExists) {
              result.status = "exists";
            } else {
              let headers: string[];
              if (plan.profile?.sample) {
                // Very large data: only the header row is needed, the formulas cover every row.
                const headerRow = sourceRange().getRow(0);
                headerRow.load("values");
                await context.sync();
                headers = (headerRow.values[0] ?? []).map((cell: any) =>
                  String(cell ?? ""),
                );
              } else {
                headers = splitHeader(await readSourceValues()).headers;
              }
              const parsed = parseLocalRange(
                localExcelAddress(plan.sourceAddress),
              );
              const range = {
                sheetName: plan.worksheetName,
                startColumn: parsed.startColumn,
                startRow: parsed.startRow - 1,
                endRow: parsed.endRow - 1,
              };
              let cells: string[][];
              if (spec.mode === "describe")
                cells = buildDescribeCells(
                  range,
                  headers,
                  (spec.columns ?? []).map((entry: any) => entry.index),
                );
              else if (spec.mode === "correlation")
                cells = buildCorrelationCells(
                  range,
                  headers,
                  spec.pair?.[0]?.index ?? 0,
                  spec.pair?.[1]?.index ?? 0,
                );
              else if (spec.mode === "advanced-forecast")
                cells = buildAdvancedForecastCells(
                  range,
                  headers,
                  spec.value?.index ?? 0,
                  spec.periods ?? 3,
                  spec.date?.index,
                );
              else if (spec.mode === "financial")
                cells = buildFinancialCells(
                  range,
                  headers,
                  (spec.columns ?? []).map((entry: any) => entry.index),
                );
              else if (spec.mode === "anomaly")
                cells = buildAnomalyCells(
                  range,
                  headers,
                  spec.value?.index ?? 0,
                );
              else if (spec.mode === "forecast" && plan.profile?.sample)
                cells = buildForecastCellsLarge(
                  range,
                  headers,
                  spec.value?.index ?? 0,
                  spec.periods ?? 3,
                );
              else if (spec.mode === "forecast")
                cells = buildForecastCells(
                  range,
                  headers,
                  spec.value?.index ?? 0,
                  spec.periods ?? 3,
                );
              else
                cells = buildInsightReportCells(
                  range,
                  headers,
                  spec.value?.index ?? 0,
                  spec.category?.index,
                  spec.date?.index,
                );
              const width = Math.max(...cells.map((row) => row.length));
              const grid = sheet.getRangeByIndexes(0, 0, cells.length, width);
              grid.formulas = cells.map((row, rowIndex) =>
                row.map((cell, columnIndex) =>
                  rowIndex === 0 ||
                  (!["forecast", "advanced-forecast"].includes(spec.mode) &&
                    columnIndex === 0)
                    ? literal(cell)
                    : cell,
                ),
              );
              await context.sync();
              sheet.getRangeByIndexes(0, 0, 1, width).format.font.bold = true;
              try {
                // Readable numbers: two decimals everywhere except the Count row.
                const body = sheet.getRangeByIndexes(
                  spec.mode === "forecast" ? 1 : 1,
                  spec.mode === "forecast" ? 1 : 1,
                  Math.max(1, cells.length - 1),
                  Math.max(1, width - 1),
                );
                body.numberFormat = Array.from(
                  { length: Math.max(1, cells.length - 1) },
                  (_, rowIndex) =>
                    Array.from({ length: Math.max(1, width - 1) }, () =>
                      spec.mode === "describe" && rowIndex === 0
                        ? "0"
                        : "#,##0.00",
                    ),
                );
              } catch {
                // Formatting is presentation only.
              }
              grid.format.autofitColumns();
              if (
                ["forecast", "advanced-forecast"].includes(spec.mode) &&
                cells.length > 3
              ) {
                try {
                  const chart = sheet.charts.add(
                    "Line",
                    sheet.getRangeByIndexes(0, 1, cells.length, 2),
                    "Columns",
                  );
                  chart.name = action.name;
                  chart.title.text = `${spec.value?.column ?? "Value"} forecast`;
                  chart.setPosition(plan.profile?.sample ? "G2" : "E2");
                  chart.series
                    .getItemAt(0)
                    .setXAxisValues(
                      sheet.getRangeByIndexes(1, 0, cells.length - 1, 1),
                    );
                  chart.series
                    .getItemAt(1)
                    .setXAxisValues(
                      sheet.getRangeByIndexes(1, 0, cells.length - 1, 1),
                    );
                } catch {
                  // The table is the answer; the chart is a convenience.
                }
              }
              await context.sync();
            }
          } else if (
            action.kind === "quality" &&
            (action.spec?.qualityMode === "formula" ||
              action.spec?.qualityMode === "repair")
          ) {
            if (sheetExists) {
              result.status = "exists";
            } else {
              const formulaRange = sourceRange();
              formulaRange.load(["formulas", "values"]);
              await context.sync();
              const report = inspectFormulas({
                worksheetName: plan.worksheetName,
                address: plan.sourceAddress,
                formulas: formulaRange.formulas,
                values: formulaRange.values,
              });
              if (action.spec?.qualityMode === "repair") {
                const formulas = formulaRange.formulas as any[][];
                const values = formulaRange.values as any[][];
                let itemIndex = 0;
                const repaired = formulas.map((row, rowIndex) =>
                  row.map((formula, columnIndex) => {
                    if (
                      typeof formula === "string" &&
                      formula.startsWith("=")
                    ) {
                      const item = report.items[itemIndex++];
                      return item?.repair?.candidate ?? formula;
                    }
                    return literal(values[rowIndex]?.[columnIndex]);
                  }),
                );
                const repairedRange = sheet.getRangeByIndexes(
                  0,
                  0,
                  repaired.length,
                  repaired[0]?.length ?? 0,
                );
                repairedRange.formulas = repaired;
                await context.sync();
              } else {
                const rows: any[][] = [
                  ["Formula audit", "Value"],
                  ["Formula cells", report.formulaCellCount],
                  ["Error cells", report.errorCellCount],
                  [
                    "Possible direct circular references",
                    report.possibleCircularReferenceCount,
                  ],
                  ["Inconsistent formulas", report.inconsistentFormulaCount],
                  ["Hard-coded numeric cells", report.hardCodedCellCount],
                  [],
                  [
                    "Address",
                    "Formula",
                    "References",
                    "Errors",
                    "Possible circular reference",
                    "Inconsistent formula",
                    "Explanation",
                    "Repair guidance",
                  ],
                  ...report.items
                    .slice(0, 500)
                    .map((item) => [
                      item.address,
                      literal(item.formula),
                      item.references.join(", "),
                      item.errors.join(", "),
                      item.possibleCircularReference ? "Yes" : "No",
                      item.inconsistentFormula ? "Yes" : "No",
                      item.explanation,
                      item.repair
                        ? `${item.repair.candidate ? `Suggested repair: ${item.repair.candidate}. ` : ""}${item.repair.guidance}`
                        : "",
                    ]),
                ];
                if (report.items.length > 500)
                  rows.push([
                    "Note",
                    `Only the first 500 of ${report.items.length} formula cells are listed.`,
                  ]);
                const width = Math.max(...rows.map((row) => row.length), 1);
                const padded = rows.map((row) => {
                  const cells = row.map((cell) => literal(cell));
                  while (cells.length < width) cells.push("");
                  return cells;
                });
                sheet.getRangeByIndexes(0, 0, padded.length, width).values =
                  padded;
                sheet.getRangeByIndexes(0, 0, 1, width).format.font.bold = true;
                sheet.getRangeByIndexes(5, 0, 1, width).format.font.bold = true;
                sheet
                  .getRangeByIndexes(0, 0, padded.length, width)
                  .format.autofitColumns();
                await context.sync();
              }
            }
          } else if (action.kind === "quality" && plan.profile?.sample) {
            if (sheetExists) {
              result.status = "exists";
            } else {
              // Very large data: a small table of live formulas, Excel counts every row.
              const headers = await readHeaderCells();
              const parsed = parseLocalRange(
                localExcelAddress(plan.sourceAddress),
              );
              const cells = qualityReportCells(
                {
                  sheetName: plan.worksheetName,
                  startColumn: parsed.startColumn,
                  startRow: parsed.startRow - 1,
                  endRow: parsed.endRow - 1,
                  columns: headers.length,
                },
                headers,
              );
              const width = Math.max(...cells.map((row) => row.length));
              sheet.getRangeByIndexes(0, 0, cells.length, width).formulas =
                cells.map((row, rowIndex) => {
                  const padded = row.map((cell, columnIndex) =>
                    cell.startsWith("=") && (rowIndex < 3 || columnIndex > 0)
                      ? cell
                      : literal(cell),
                  );
                  while (padded.length < width) padded.push("");
                  return padded;
                });
              await context.sync();
              sheet.getRangeByIndexes(0, 0, 1, 1).format.font.bold = true;
              sheet.getRangeByIndexes(2, 0, 1, width).format.font.bold = true;
              sheet
                .getRangeByIndexes(2, 0, cells.length - 2, width)
                .format.autofitColumns();
              await context.sync();
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
              // Very large data: the formatted sheet shows the first rows only.
              const { headers, rows } = plan.profile?.sample
                ? splitHeader(await readSourceHead(LARGE_FORMAT_ROWS + 1))
                : splitHeader(await readSourceValues());
              const out = [headers, ...rows].map((row) => row.map(literal));
              const columns = headers.length;
              // Keep each source column's own format: dates stay dates, codes such as 0112559962 stay text.
              let sourceFormats: any = null;
              try {
                sourceFormats = sourceRange().getAbsoluteResizedRange(
                  out.length,
                  columns,
                );
                sourceFormats.load("numberFormat");
                await context.sync();
              } catch {
                sourceFormats = null; // formats are presentation only
              }
              const keptFormat = new Set<number>();
              for (let column = 0; column < columns; column += 1) {
                const format = String(
                  sourceFormats?.numberFormat?.[1]?.[column] ?? "General",
                );
                const code = rows.some(
                  (row) =>
                    typeof row[column] === "string" &&
                    /^0\d/.test(String(row[column])),
                );
                const own = code ? "@" : format;
                if (own !== "General") {
                  keptFormat.add(column);
                  sheet.getRangeByIndexes(
                    1,
                    column,
                    out.length,
                    1,
                  ).numberFormat = out.map(() => [own]) as any;
                }
              }
              await context.sync();
              sheet.getRangeByIndexes(0, 0, out.length, columns).values = out;
              await context.sync();
              const headerRange = sheet.getRangeByIndexes(0, 0, 1, columns);
              headerRange.format.font.bold = true;
              headerRange.format.font.color = "#FFFFFF";
              headerRange.format.fill.color = "#123A6B";
              if (spec.freezeHeader !== false) sheet.freezePanes.freezeRows(1);
              if (rows.length > 0) {
                for (const entry of spec.columnFormats ?? [])
                  if (!keptFormat.has(entry.index))
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
                  } else if (rule.rule === "icon-set") {
                    const icons = range.conditionalFormats.add("IconSet");
                    icons.iconSet.style = "ThreeArrows";
                  } else if (rule.rule === "negative") {
                    const negative = range.conditionalFormats.add("CellValue");
                    negative.cellValue.rule = {
                      formula1: "0",
                      operator: "LessThan",
                    };
                    negative.cellValue.format.font.color = "#C00000";
                    negative.cellValue.format.fill.color = "#FFC7CE";
                  } else if (rule.rule === "custom-formula") {
                    const custom = range.conditionalFormats.add("Custom");
                    const letter = expressionColumnLetter(rule.index);
                    custom.custom.rule.formula = `=${letter}2${rule.operator}${String(rule.value)}`;
                    custom.custom.format.fill.color = "#FFF2CC";
                  } else if (
                    rule.rule === "top-n" ||
                    rule.rule === "bottom-n"
                  ) {
                    const topBottom = range.conditionalFormats.add("TopBottom");
                    topBottom.topBottom.rule = {
                      rank: rule.n,
                      type: rule.rule === "top-n" ? "TopItems" : "BottomItems",
                    };
                    topBottom.topBottom.format.fill.color = "#C6EFCE";
                  } else if (rule.rule === "text-contains") {
                    const contains =
                      range.conditionalFormats.add("ContainsText");
                    contains.textComparison.rule = {
                      operator: "Contains",
                      text: rule.text,
                    };
                    contains.textComparison.format.fill.color = "#FFF2CC";
                  } else if (rule.rule === "date-range") {
                    const start = /^(\d{4})-(\d{2})-(\d{2})$/.exec(
                      rule.startDate ?? "",
                    );
                    const end = /^(\d{4})-(\d{2})-(\d{2})$/.exec(
                      rule.endDate ?? "",
                    );
                    if (!start || !end)
                      throw new Error("date range needs validated ISO dates");
                    const custom = range.conditionalFormats.add("Custom");
                    const letter = expressionColumnLetter(rule.index);
                    const dateFormula = (parts: RegExpExecArray) =>
                      `DATE(${Number(parts[1])},${Number(parts[2])},${Number(parts[3])})`;
                    custom.custom.rule.formula = `=AND(ISNUMBER(${letter}2),${letter}2>=${dateFormula(start)},${letter}2<=${dateFormula(end)})`;
                    custom.custom.format.fill.color = "#FFF2CC";
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
                  } else if (check.rule === "between") {
                    range.dataValidation.rule = {
                      decimal: {
                        formula1: check.min,
                        formula2: check.max,
                        operator: "Between",
                      },
                    };
                  } else if (check.rule === "date") {
                    range.dataValidation.rule = {
                      date: {
                        formula1: "1900-01-01",
                        operator: "GreaterThanOrEqualTo",
                      },
                    };
                  } else if (check.rule === "max-length") {
                    range.dataValidation.rule = {
                      textLength: {
                        formula1: check.max,
                        operator: "LessThanOrEqualTo",
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
                if (spec.inputMessage) {
                  const promptRange = sheet.getRangeByIndexes(
                    1,
                    spec.inputMessage.index,
                    rows.length,
                    1,
                  );
                  promptRange.dataValidation.prompt = {
                    showPrompt: true,
                    title: spec.inputMessage.title,
                    message: spec.inputMessage.message,
                  };
                }
                if (spec.dependentDropdown) {
                  const dependent = spec.dependentDropdown;
                  const groups = dependent.groups ?? [];
                  if (!groups.length)
                    throw new Error("dependent drop-down has no helper groups");
                  if (groups.some((group: any) => takenObjects.has(group.name)))
                    throw new Error(
                      "dependent drop-down helper names already exist; undo the older result first",
                    );
                  const helperStart = columns + 1;
                  const helperRows =
                    1 +
                    Math.max(
                      ...groups.map((group: any) => group.values.length),
                    );
                  const helper = sheet.getRangeByIndexes(
                    0,
                    helperStart,
                    helperRows,
                    groups.length,
                  );
                  helper.values = Array.from({ length: helperRows }, (_, row) =>
                    groups.map((group: any) =>
                      row === 0
                        ? group.name
                        : literal(group.values[row - 1] ?? ""),
                    ),
                  );
                  helper.format.columnHidden = true;
                  const escapedSheet = String(action.targetSheet).replace(
                    /'/g,
                    "''",
                  );
                  groups.forEach((group: any, index: number) => {
                    const helperColumn = expressionColumnLetter(
                      helperStart + index,
                    );
                    context.workbook.names.add(
                      group.name,
                      `='${escapedSheet}'!$${helperColumn}$2:$${helperColumn}$${helperRows}`,
                    );
                    takenObjects.add(group.name);
                  });
                  const parentColumn = expressionColumnLetter(
                    dependent.parentIndex,
                  );
                  const childRange = sheet.getRangeByIndexes(
                    1,
                    dependent.childIndex,
                    rows.length,
                    1,
                  );
                  childRange.dataValidation.rule = {
                    list: {
                      inCellDropDown: true,
                      source: `=INDIRECT("VynorAI_DD_"&SUBSTITUTE(SUBSTITUTE($${parentColumn}2," ","_"),"-","_"))`,
                    },
                  };
                  result.createdNames = groups.map((group: any) => group.name);
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
          } else if (action.kind === "unpivot") {
            const spec = action.spec;
            if (
              !Array.isArray(spec?.unpivotValueIndexes) ||
              spec.unpivotValueIndexes.length < 2 ||
              !spec.unpivotNameColumn ||
              !spec.unpivotValueColumn
            )
              throw new Error(
                "unpivot needs explicit value columns and output names",
              );
            if (sheetExists) {
              result.status = "exists";
            } else if (plan.profile?.sample) {
              // Very large data: one spilled formula over the first rows (see the warning).
              const headers = await readHeaderCells();
              const values = spec.unpivotValueIndexes as number[];
              if (
                values.some(
                  (index) =>
                    headers[index] !==
                    spec.unpivotValueColumns?.[values.indexOf(index)],
                )
              )
                throw new Error(
                  "The unpivot source changed after the preview. Preview again.",
                );
              const dimensions = headers
                .map((_header, index) => index)
                .filter((index) => !values.includes(index));
              const parsed = parseLocalRange(
                localExcelAddress(plan.sourceAddress),
              );
              const outHeaders = [
                ...dimensions.map((index) => headers[index]),
                spec.unpivotNameColumn,
                spec.unpivotValueColumn,
              ];
              sheet.getRangeByIndexes(0, 0, 1, outHeaders.length).values = [
                outHeaders.map(literal),
              ];
              sheet.getRange("A2").formulas = [
                [
                  unpivotFormula(
                    {
                      sheetName: plan.worksheetName,
                      startColumn: parsed.startColumn,
                      startRow: parsed.startRow - 1,
                      endRow: parsed.endRow - 1,
                      columns: headers.length,
                    },
                    {
                      dimensions,
                      values,
                      valueHeaders: values.map((index) => headers[index]),
                    },
                  ),
                ],
              ];
              sheet.getRangeByIndexes(
                0,
                0,
                1,
                outHeaders.length,
              ).format.font.bold = true;
              await context.sync();
            } else {
              const { headers, rows } = splitHeader(await readSourceValues());
              const values = spec.unpivotValueIndexes as number[];
              if (
                values.some(
                  (index) =>
                    headers[index] !==
                    spec.unpivotValueColumns?.[values.indexOf(index)],
                )
              )
                throw new Error(
                  "The unpivot source changed after the preview. Preview again.",
                );
              const dimensions = headers
                .map((_header, index) => index)
                .filter((index) => !values.includes(index));
              const outHeaders = [
                ...dimensions.map((index) => headers[index]),
                spec.unpivotNameColumn,
                spec.unpivotValueColumn,
              ];
              sheet.getRangeByIndexes(0, 0, 1, outHeaders.length).values = [
                outHeaders,
              ];
              const parsed = parseLocalRange(
                localExcelAddress(plan.sourceAddress),
              );
              const quotedSheet = `'${String(plan.worksheetName).replace(/'/g, "''")}'!`;
              const formulas = rows.flatMap((_row, rowIndex) =>
                values.map((valueIndex) => {
                  const sourceRow = parsed.startRow + rowIndex + 1;
                  const reference = (index: number) =>
                    `=${quotedSheet}${columnLetter(parsed.startColumn + index)}${sourceRow}`;
                  return [
                    ...dimensions.map(reference),
                    `="${String(headers[valueIndex]).replace(/"/g, '""')}"`,
                    reference(valueIndex),
                  ];
                }),
              );
              if (formulas.length > 0)
                sheet.getRangeByIndexes(
                  1,
                  0,
                  formulas.length,
                  outHeaders.length,
                ).formulas = formulas;
              await context.sync();
            }
          } else if (action.kind === "split-column") {
            const spec = action.spec;
            if (
              !spec?.splitSourceColumn ||
              !Number.isInteger(spec.splitSourceIndex) ||
              !spec.splitFirstColumn ||
              !spec.splitLastColumn
            )
              throw new Error(
                "split-column needs explicit source and output choices",
              );
            if (sheetExists) {
              result.status = "exists";
            } else if (plan.profile?.sample) {
              // Very large data: the source column and its two parts are spilled formulas over every row.
              const headers = await readHeaderCells();
              if (headers[spec.splitSourceIndex] !== spec.splitSourceColumn)
                throw new Error(
                  "The split source changed after the preview. Preview again.",
                );
              const parsed = parseLocalRange(
                localExcelAddress(plan.sourceAddress),
              );
              const formulas = splitColumnFormulas(
                {
                  sheetName: plan.worksheetName,
                  startColumn: parsed.startColumn,
                  startRow: parsed.startRow - 1,
                  endRow: parsed.endRow - 1,
                  columns: headers.length,
                },
                spec.splitSourceIndex,
              );
              sheet.getRangeByIndexes(0, 0, 1, 3).values = [
                [
                  literal(spec.splitSourceColumn),
                  literal(spec.splitFirstColumn),
                  literal(spec.splitLastColumn),
                ],
              ];
              sheet.getRange("A2:C2").formulas = [
                [formulas.source, formulas.first, formulas.last],
              ];
              sheet.getRangeByIndexes(0, 0, 1, 3).format.font.bold = true;
              await context.sync();
              await copyColumnFormats(sheet, [spec.splitSourceIndex]);
            } else {
              const { headers, rows } = splitHeader(await readSourceValues());
              if (headers[spec.splitSourceIndex] !== spec.splitSourceColumn)
                throw new Error(
                  "The split source changed after the preview. Preview again.",
                );
              const sourceLetter = expressionColumnLetter(
                spec.splitSourceIndex,
              );
              const out = [
                [...headers, spec.splitFirstColumn, spec.splitLastColumn],
                ...rows.map((row) => [...row, "", ""]),
              ].map((row) => row.map(literal));
              sheet.getRangeByIndexes(
                0,
                0,
                out.length,
                headers.length + 2,
              ).values = out;
              await context.sync();
              if (rows.length > 0) {
                sheet.getRangeByIndexes(
                  1,
                  headers.length,
                  rows.length,
                  2,
                ).formulas = rows.map((_row, index) => {
                  const rowNumber = index + 2;
                  return [
                    `=IFERROR(LEFT(${sourceLetter}${rowNumber},FIND(" ",${sourceLetter}${rowNumber}&" ")-1),"")`,
                    `=IFERROR(TRIM(MID(${sourceLetter}${rowNumber},FIND(" ",${sourceLetter}${rowNumber}&" ")+1,999)),"")`,
                  ];
                });
                await context.sync();
              }
            }
          } else if (action.kind === "lookup-columns") {
            const spec = action.spec;
            const returnHeaders = spec?.lookupReturnHeaders;
            const returnIndexes = spec?.lookupReturnIndexes;
            if (
              !spec?.lookupSheet ||
              !Array.isArray(returnHeaders) ||
              !Array.isArray(returnIndexes) ||
              returnHeaders.length < 2 ||
              returnHeaders.length !== returnIndexes.length
            )
              throw new Error(
                "lookup-columns needs explicit lookup return columns",
              );
            if (sheetExists) {
              result.status = "exists";
            } else {
              const largeLookup = Boolean(plan.profile?.sample);
              const { headers, rows } = largeLookup
                ? { headers: await readHeaderCells(), rows: [] as any[][] }
                : splitHeader(await readSourceValues());
              const other = context.workbook.worksheets.getItemOrNullObject(
                spec.lookupSheet,
              );
              other.load("isNullObject");
              await context.sync();
              if (other.isNullObject)
                throw new Error(
                  `The sheet "${spec.lookupSheet}" was not found any more.`,
                );
              const used = other.getUsedRangeOrNullObject(true);
              used.load(["isNullObject", "values", "rowCount"]);
              await context.sync();
              const lookupHeader = (used.values?.[0] ?? []).map((cell: any) =>
                String(cell ?? ""),
              );
              const sourceKeyIndexes = spec.sourceKeyIndexes ?? [
                spec.sourceKeyIndex,
              ];
              const lookupKeyIndexes = spec.lookupKeyIndexes ?? [
                spec.lookupKeyIndex,
              ];
              const lookupKeyHeaders = spec.lookupKeyHeaders ?? [
                spec.lookupKeyHeader,
              ];
              const sourceKeyColumns = spec.sourceKeyColumns ?? [
                spec.sourceKeyColumn,
              ];
              if (
                used.isNullObject ||
                sourceKeyIndexes.length !== lookupKeyIndexes.length ||
                sourceKeyIndexes.length !== lookupKeyHeaders.length ||
                sourceKeyIndexes.length !== sourceKeyColumns.length ||
                sourceKeyIndexes.some(
                  (index: number) =>
                    !Number.isInteger(index) ||
                    headers[index] !==
                      sourceKeyColumns[sourceKeyIndexes.indexOf(index)],
                ) ||
                lookupKeyIndexes.some(
                  (index: number) =>
                    lookupHeader[index] !==
                    lookupKeyHeaders[lookupKeyIndexes.indexOf(index)],
                ) ||
                returnIndexes.some(
                  (index: number, at: number) =>
                    lookupHeader[index] !== returnHeaders[at],
                )
              )
                throw new Error(
                  "The lookup sheet changed after the preview. Preview again.",
                );
              if (spec.lookupMatchMode === "approximate") {
                if (sourceKeyIndexes.length !== 1)
                  throw new Error(
                    "Approximate lookup supports one key column only.",
                  );
                const keyValues = (used.values ?? [])
                  .slice(1)
                  .map((row: any[]) => row[lookupKeyIndexes[0]]);
                const compare = (left: any, right: any) =>
                  typeof left === "number" && typeof right === "number"
                    ? left - right
                    : String(left ?? "").localeCompare(
                        String(right ?? ""),
                        undefined,
                        { numeric: true, sensitivity: "base" },
                      );
                for (let index = 1; index < keyValues.length; index += 1)
                  if (compare(keyValues[index - 1], keyValues[index]) > 0)
                    throw new Error(
                      "Approximate lookup requires the lookup key column to be sorted ascending.",
                    );
              }
              if (largeLookup) {
                // Very large data: the key column plus one spilled lookup per returned column.
                const parsed = parseLocalRange(
                  localExcelAddress(plan.sourceAddress),
                );
                const range = {
                  sheetName: plan.worksheetName,
                  startColumn: parsed.startColumn,
                  startRow: parsed.startRow - 1,
                  endRow: parsed.endRow - 1,
                  columns: headers.length,
                };
                sheet.getRangeByIndexes(
                  0,
                  0,
                  1,
                  1 + returnHeaders.length,
                ).values = [
                  [literal(headers[0]), ...returnHeaders.map(literal)],
                ];
                sheet.getRange("A2").formulas = [[keyColumnFormula(range)]];
                returnIndexes.forEach((returnIndex: number, at: number) => {
                  sheet.getRangeByIndexes(1, 1 + at, 1, 1).formulas = [
                    [
                      addColumnFormula(range, {
                        lookup: {
                          sheet: spec.lookupSheet as string,
                          sourceKeyIndexes,
                          lookupKeyIndexes,
                          returnIndex,
                          rows: spec.lookupRows as number,
                          matchMode: spec.lookupMatchMode ?? "exact",
                        },
                      }),
                    ],
                  ];
                });
                sheet.getRangeByIndexes(
                  0,
                  0,
                  1,
                  1 + returnHeaders.length,
                ).format.font.bold = true;
                await context.sync();
              } else {
                const out = [
                  [...headers, ...returnHeaders],
                  ...rows.map((row) => [
                    ...row,
                    ...returnHeaders.map(() => ""),
                  ]),
                ].map((row) => row.map(literal));
                sheet.getRangeByIndexes(
                  0,
                  0,
                  out.length,
                  headers.length + returnHeaders.length,
                ).values = out;
                await context.sync();
                if (rows.length > 0) {
                  sheet.getRangeByIndexes(
                    1,
                    headers.length,
                    rows.length,
                    returnIndexes.length,
                  ).formulas = rows.map((_row, index) =>
                    returnIndexes.map((returnIndex) =>
                      buildLookupFormula(
                        spec.lookupSheet as string,
                        index + 2,
                        sourceKeyIndexes,
                        lookupKeyIndexes,
                        returnIndex,
                        spec.lookupRows as number,
                        spec.lookupMatchMode ?? "exact",
                        spec.lookupMethod ?? "index-match",
                      ),
                    ),
                  );
                  await context.sync();
                }
              }
            }
          } else if (action.kind === "add-column") {
            const spec = action.spec;
            if (!spec?.columnName)
              throw new Error("add-column needs explicit column choices");
            if (sheetExists) {
              result.status = "exists";
            } else {
              const largeSource = Boolean(plan.profile?.sample);
              const { headers, rows } = largeSource
                ? { headers: await readHeaderCells(), rows: [] as any[][] }
                : splitHeader(await readSourceValues());
              const rowTotal = largeSource
                ? Number(plan.profile.sample.totalRows) - 1
                : rows.length;
              let lookupFormula: ((rowNumber: number) => string) | undefined;
              if (spec.lookupSheet !== undefined) {
                const other = context.workbook.worksheets.getItemOrNullObject(
                  spec.lookupSheet,
                );
                other.load("isNullObject");
                await context.sync();
                if (other.isNullObject)
                  throw new Error(
                    `The sheet "${spec.lookupSheet}" was not found any more.`,
                  );
                const used = other.getUsedRangeOrNullObject(true);
                used.load(["isNullObject", "values", "rowCount"]);
                await context.sync();
                const header = (used.values?.[0] ?? []).map((cell: any) =>
                  String(cell ?? ""),
                );
                const sourceKeyIndexes = spec.sourceKeyIndexes ?? [
                  spec.sourceKeyIndex,
                ];
                const lookupKeyIndexes = spec.lookupKeyIndexes ?? [
                  spec.lookupKeyIndex,
                ];
                const lookupKeyHeaders = spec.lookupKeyHeaders ?? [
                  spec.lookupKeyHeader,
                ];
                const sourceKeyColumns = spec.sourceKeyColumns ?? [
                  spec.sourceKeyColumn,
                ];
                if (
                  used.isNullObject ||
                  sourceKeyIndexes.length !== lookupKeyIndexes.length ||
                  sourceKeyIndexes.length !== lookupKeyHeaders.length ||
                  sourceKeyIndexes.length !== sourceKeyColumns.length ||
                  sourceKeyIndexes.some(
                    (index: number) =>
                      !Number.isInteger(index) ||
                      headers[index] !==
                        sourceKeyColumns[sourceKeyIndexes.indexOf(index)],
                  ) ||
                  lookupKeyIndexes.some(
                    (index: number) =>
                      header[index] !==
                      lookupKeyHeaders[lookupKeyIndexes.indexOf(index)],
                  ) ||
                  header[spec.lookupReturnIndex as number] !==
                    spec.lookupReturnHeader
                )
                  throw new Error(
                    "The lookup sheet changed after the preview. Preview again.",
                  );
                if (spec.lookupMatchMode === "approximate") {
                  const keyValues = (used.values ?? [])
                    .slice(1)
                    .map((row: any[]) => row[lookupKeyIndexes[0]]);
                  const compare = (left: any, right: any) =>
                    typeof left === "number" && typeof right === "number"
                      ? left - right
                      : String(left ?? "").localeCompare(
                          String(right ?? ""),
                          undefined,
                          { numeric: true, sensitivity: "base" },
                        );
                  for (let index = 1; index < keyValues.length; index += 1)
                    if (compare(keyValues[index - 1], keyValues[index]) > 0)
                      throw new Error(
                        "Approximate lookup requires the lookup key column to be sorted ascending.",
                      );
                }
                lookupFormula = (rowNumber) => {
                  return buildLookupFormula(
                    spec.lookupSheet,
                    rowNumber,
                    sourceKeyIndexes,
                    lookupKeyIndexes,
                    spec.lookupReturnIndex as number,
                    spec.lookupRows as number,
                    spec.lookupMatchMode ?? "exact",
                    spec.lookupMethod ?? "index-match",
                  );
                };
              }
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
              const runningTotalFormula =
                spec.derived === "running-total"
                  ? (rowNumber: number) => {
                      if (!Number.isInteger(spec.sourceIndex))
                        throw new Error(
                          "The running total source is missing from the approved plan",
                        );
                      const sourceLetter = expressionColumnLetter(
                        spec.sourceIndex,
                      );
                      return `=SUM($${sourceLetter}$2:${sourceLetter}${rowNumber})`;
                    }
                  : undefined;
              const rankFormula =
                spec.derived === "rank"
                  ? (rowNumber: number) => {
                      if (!Number.isInteger(spec.sourceIndex))
                        throw new Error(
                          "The rank source is missing from the approved plan",
                        );
                      const sourceLetter = expressionColumnLetter(
                        spec.sourceIndex,
                      );
                      const lastRow = rowTotal + 1;
                      return `=RANK.EQ(${sourceLetter}${rowNumber},$${sourceLetter}$2:$${sourceLetter}$${lastRow},0)`;
                    }
                  : undefined;
              const percentChangeFormula =
                spec.derived === "percent-change"
                  ? (rowNumber: number) => {
                      if (!Number.isInteger(spec.sourceIndex))
                        throw new Error(
                          "The percent-change source is missing from the approved plan",
                        );
                      if (rowNumber === 2) return '=""';
                      const sourceLetter = expressionColumnLetter(
                        spec.sourceIndex,
                      );
                      return `=IFERROR((${sourceLetter}${rowNumber}-${sourceLetter}${rowNumber - 1})/${sourceLetter}${rowNumber - 1},"")`;
                    }
                  : undefined;
              const yoyFormula =
                spec.derived === "yoy"
                  ? (rowNumber: number) => {
                      if (
                        !Number.isInteger(spec.sourceIndex) ||
                        !Number.isInteger(spec.lag)
                      )
                        throw new Error(
                          "The YoY source or lag is missing from the approved plan",
                        );
                      if (rowNumber < spec.lag + 2) return '=""';
                      const sourceLetter = expressionColumnLetter(
                        spec.sourceIndex,
                      );
                      const previousRow = rowNumber - spec.lag;
                      return `=IFERROR((${sourceLetter}${rowNumber}-${sourceLetter}${previousRow})/${sourceLetter}${previousRow},"")`;
                    }
                  : undefined;
              const movingAverageFormula =
                spec.derived === "moving-average"
                  ? (rowNumber: number) => {
                      if (
                        !Number.isInteger(spec.sourceIndex) ||
                        !Number.isInteger(spec.window)
                      )
                        throw new Error(
                          "The moving-average source or window is missing from the approved plan",
                        );
                      const sourceLetter = expressionColumnLetter(
                        spec.sourceIndex,
                      );
                      const firstRow = rowNumber - spec.window + 1;
                      return rowNumber < spec.window + 1
                        ? '=""'
                        : `=AVERAGE(${sourceLetter}${firstRow}:${sourceLetter}${rowNumber})`;
                    }
                  : undefined;
              const dateGroupFormula =
                spec.derived === "date-group"
                  ? (rowNumber: number) => {
                      if (
                        !Number.isInteger(spec.sourceIndex) ||
                        !["month", "quarter", "year"].includes(
                          String(spec.group),
                        )
                      )
                        throw new Error(
                          "The date-group source or group is missing from the approved plan",
                        );
                      const sourceLetter = expressionColumnLetter(
                        spec.sourceIndex,
                      );
                      if (spec.group === "month")
                        return `=TEXT(${sourceLetter}${rowNumber},"yyyy-mm")`;
                      if (spec.group === "year")
                        return `=YEAR(${sourceLetter}${rowNumber})`;
                      return `="Q"&ROUNDUP(MONTH(${sourceLetter}${rowNumber})/3,0)&" "&YEAR(${sourceLetter}${rowNumber})`;
                    }
                  : undefined;
              const combineFormula =
                spec.derived === "combine"
                  ? (rowNumber: number) => {
                      if (
                        !Number.isInteger(spec.sourceIndex) ||
                        !Number.isInteger(spec.sourceIndex2) ||
                        spec.separator !== " - "
                      )
                        throw new Error(
                          "The combine sources or separator is missing from the approved plan",
                        );
                      const leftLetter = expressionColumnLetter(
                        spec.sourceIndex,
                      );
                      const rightLetter = expressionColumnLetter(
                        spec.sourceIndex2,
                      );
                      return `=${leftLetter}${rowNumber}&" - "&${rightLetter}${rowNumber}`;
                    }
                  : undefined;
              const rowFormula = (rowNumber: number): string =>
                lookupFormula
                  ? lookupFormula(rowNumber)
                  : expressionAst
                    ? expressionToFormula(
                        expressionAst,
                        (column) =>
                          `${expressionColumnLetter(column)}${rowNumber}`,
                        (column) =>
                          `${expressionColumnLetter(column)}$2:${expressionColumnLetter(column)}${rows.length + 1}`,
                      )
                    : runningTotalFormula
                      ? runningTotalFormula(rowNumber)
                      : rankFormula
                        ? rankFormula(rowNumber)
                        : percentChangeFormula
                          ? percentChangeFormula(rowNumber)
                          : yoyFormula
                            ? yoyFormula(rowNumber)
                            : movingAverageFormula
                              ? movingAverageFormula(rowNumber)
                              : dateGroupFormula
                                ? dateGroupFormula(rowNumber)
                                : combineFormula
                                  ? combineFormula(rowNumber)
                                  : computedColumnFormula(
                                      rowNumber,
                                      spec.leftIndex as number,
                                      spec.operator as "+",
                                      spec.rightIndex as number,
                                    );
              if (largeSource) {
                // Very large data: no copy of the data. Two spilled formulas, the first source
                // column (to match each row) and the computed column, both calculated by Excel.
                const parsed = parseLocalRange(
                  localExcelAddress(plan.sourceAddress),
                );
                const range = {
                  sheetName: plan.worksheetName,
                  startColumn: parsed.startColumn,
                  startRow: parsed.startRow - 1,
                  endRow: parsed.endRow - 1,
                  columns: headers.length,
                };
                const formula = addColumnFormula(
                  range,
                  {
                    leftIndex: spec.leftIndex,
                    operator: spec.operator,
                    rightIndex: spec.rightIndex,
                    derived: spec.derived,
                    sourceIndex: spec.sourceIndex,
                    sourceIndex2: spec.sourceIndex2,
                    lag: spec.lag,
                    window: spec.window,
                    group: spec.group,
                    separator: spec.separator,
                    lookup:
                      spec.lookupSheet !== undefined
                        ? {
                            sheet: spec.lookupSheet,
                            sourceKeyIndexes: spec.sourceKeyIndexes ?? [
                              spec.sourceKeyIndex,
                            ],
                            lookupKeyIndexes: spec.lookupKeyIndexes ?? [
                              spec.lookupKeyIndex,
                            ],
                            returnIndex: spec.lookupReturnIndex,
                            rows: spec.lookupRows,
                            matchMode: spec.lookupMatchMode ?? "exact",
                          }
                        : undefined,
                  },
                  expressionAst,
                );
                sheet.getRangeByIndexes(0, 0, 1, 2).values = [
                  [literal(headers[0]), literal(spec.columnName)],
                ];
                sheet.getRange("A2").formulas = [[keyColumnFormula(range)]];
                sheet.getRange("B2").formulas = [[formula]];
                sheet.getRangeByIndexes(0, 0, 1, 2).format.font.bold = true;
                await context.sync();
                if (spec.percentFormat) {
                  sheet.getRange("B2:B1048576").numberFormat = "0.0%" as any;
                  await context.sync();
                }
              } else {
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
                    rowFormula(index + 2),
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
            }
          } else {
            throw new Error(`unsupported action ${action.kind}`);
          }
        }
      } catch (error) {
        result.status = "failed";
        result.error = errorText(error);
      }
      result.ms = Date.now() - actionStarted;
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
  /^[A-Za-z0-9_]{1,18}_Vynor_(Result|Clean|Calc|Totals|Format|Report|View)(?: (d{1,2}))?$/;
const CREATED_TABLE = /^[A-Za-z0-9_]{1,18}_Vynor_table(?:_\d{1,2})?$/;
const CREATED_NAME =
  /^(?:VynorAI_[A-Za-z0-9_]+_\d+(?:_\d+)?|VynorAI_DD_[A-Za-z0-9_]+)$/;

export interface RollbackReport {
  removedSheets: string[];
  convertedTables: string[];
  removedNames: string[];
  skipped: string[];
}

/**
 * Removes only result sheets that the current apply report marked as newly created and the Table
 * this add-in created in the session. Names are a second fail-closed check, not ownership proof.
 * A Table is converted back to a plain range; the cell values are kept.
 */
export async function rollbackCreatedItems(
  runtime: ExcelRuntimeLike,
  items: { sheets: string[]; tables: string[]; names?: string[] },
  confirmed: boolean,
): Promise<RollbackReport> {
  if (!confirmed)
    throw new Error("Explicit confirmation is required before rollback");
  return runtime.run(async (context) => {
    const report: RollbackReport = {
      removedSheets: [],
      convertedTables: [],
      removedNames: [],
      skipped: [],
    };
    for (const name of [...new Set(items.names ?? [])]) {
      if (!CREATED_NAME.test(name)) {
        report.skipped.push(name);
        continue;
      }
      const named = context.workbook.names.getItemOrNullObject(name);
      named.load("isNullObject");
      await context.sync();
      if (named.isNullObject) continue;
      named.delete();
      await context.sync();
      report.removedNames.push(name);
    }
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
      const sheet = context.workbook.worksheets.getItemOrNullObject(name);
      sheet.load("isNullObject");
      await context.sync();
      if (sheet.isNullObject) continue;
      // Ours when the ownership marker is there, or (older results) the legacy name matches.
      let marked = false;
      try {
        const marker = sheet.customProperties.getItemOrNullObject("vynorai");
        marker.load("isNullObject");
        await context.sync();
        marked = !marker.isNullObject;
      } catch {
        marked = false;
      }
      if (!marked && !CREATED_SHEET.test(name)) {
        report.skipped.push(name);
        continue;
      }
      sheet.delete();
      await context.sync();
      report.removedSheets.push(name);
    }
    return report;
  });
}
