/**
 * Decides what a new chart plots. With no address (or the whole used range) it reads a small sample
 * and charts the numeric columns with the first text column as labels, never the sheet blindly.
 * Also names the chart and picks a value-axis number format from the same sample.
 */
import { boxAddress, CHART_LIMITS, type Box } from "./chartPlacement.js";

const blank = (cell: unknown) =>
  cell === "" || cell === null || cell === undefined;

/**
 * Headers that name an identifier, not a measure. "No", "Num" and "Number" count only as the LAST
 * word ("Order No", "Invoice Number", "Phone #"): "Number of Orders" and "No. of Units" are measures.
 */
const ID_HEADER =
  /(^|[^a-z])(id|code|ref|sku|phone|zip|postal|year)([^a-z]|$)|(^|[^a-z])(no|num|number|#)\.?\s*$/i;

export interface ChartColumns {
  /** 0-based column (within the sample) of the labels, if any. */
  label?: number;
  values: number[];
}

/** The columns of a sample (header row first) to plot; undefined when no column holds amounts. */
export function pickChartColumns(
  sample: readonly (readonly unknown[])[],
): ChartColumns | undefined {
  const [header = [], ...rows] = sample;
  let label: number | undefined;
  const values: number[] = [];
  header.forEach((_, c) => {
    const cells = rows.map((row) => row[c]).filter((cell) => !blank(cell));
    if (!cells.length) return;
    const numbers = cells.filter(
      (cell): cell is number => typeof cell === "number",
    );
    if (numbers.length / cells.length >= 0.6) {
      const name = String(header[c] ?? "");
      const unique = new Set(numbers).size === numbers.length;
      // Counting 1, 2, 3 … down a column is a row number, not an amount.
      const counting =
        numbers.length > 2 &&
        unique &&
        numbers.every(
          (n, i) =>
            Number.isInteger(n) && (i === 0 || n - numbers[i - 1] === 1),
        );
      if (!ID_HEADER.test(name) && !counting) values.push(c);
    } else if (
      label === undefined &&
      cells.every((cell) => typeof cell === "string")
    ) {
      label = c;
    }
  });
  return values.length ? { label, values } : undefined;
}

/**
 * Charts need one rectangle: the longest run of neighbouring columns holding the most value
 * columns (the label column joins when it touches that run). Returns 0-based columns.
 */
export function contiguousRun(picked: ChartColumns): {
  first: number;
  last: number;
  label: boolean;
  dropped: number;
} {
  const wanted = [...picked.values];
  if (picked.label !== undefined) wanted.push(picked.label);
  wanted.sort((a, b) => a - b);
  const runs: number[][] = [];
  for (const column of wanted) {
    const run = runs[runs.length - 1];
    if (run && run[run.length - 1] === column - 1) run.push(column);
    else runs.push([column]);
  }
  const count = (run: number[]) =>
    run.filter((column) => picked.values.includes(column)).length;
  const best = runs.reduce((a, b) => (count(b) > count(a) ? b : a));
  return {
    first: best[0],
    last: best[best.length - 1],
    label: picked.label !== undefined && best.includes(picked.label),
    dropped: picked.values.length - count(best),
  };
}

/** "Net Amount by Region", "Qty and Price by Region", "Qty, Price and 2 more by Region". */
export function autoChartTitle(
  valueHeaders: string[],
  labelHeader?: string,
): string {
  const names = valueHeaders.map((h) => h.trim()).filter(Boolean);
  if (!names.length) return "";
  const what =
    names.length === 1
      ? names[0]
      : names.length === 2
        ? `${names[0]} and ${names[1]}`
        : `${names[0]}, ${names[1]} and ${names.length - 2} more`;
  const by = labelHeader?.trim();
  return by ? `${what} by ${by}` : what;
}

/** Value-axis number format for the plotted numbers: thousands separators, or percent for fractions. */
export function axisNumberFormat(
  numbers: readonly number[],
): string | undefined {
  if (!numbers.length) return undefined;
  const top = Math.max(...numbers.map(Math.abs));
  if (top >= 1000) return "#,##0";
  if (top <= 1 && numbers.some((n) => !Number.isInteger(n))) {
    const fine = numbers.some(
      (n) => Math.abs(n * 100 - Math.round(n * 100)) > 1e-9,
    );
    return fine ? "0.0%" : "0%";
  }
  return undefined;
}

export interface ChartSourcePlan {
  /** 0-based box in the sheet. */
  box: Box;
  title: string;
  axisFormat?: string;
  /** Plain-words note when the plan differs from the whole range. */
  note?: string;
}

const TOO_WIDE = (columns: number) =>
  `${columns} columns is too many for a chart (at most ${CHART_LIMITS.maxCols}); name the columns to chart, or chart a summary table (GROUPBY) instead`;
const TOO_LONG = (rows: number) =>
  `${rows} rows is too many for a chart (at most ${CHART_LIMITS.maxRows}); chart a summary table (GROUPBY) instead`;

/** Throws the plain-words refusal when a chart source is too big. */
export function checkChartSize(rows: number, columns: number): void {
  if (rows > CHART_LIMITS.maxRows) throw new Error(TOO_LONG(rows));
  if (columns > CHART_LIMITS.maxCols) throw new Error(TOO_WIDE(columns));
}

/**
 * Plan for a source box whose first `sample.length` rows are known. `infer` is true when the
 * agent did not name the columns (no address, or the whole used range).
 */
export function planChartSource(
  box: Box,
  sample: readonly (readonly unknown[])[],
  infer: boolean,
): ChartSourcePlan {
  let target = box;
  let note: string | undefined;
  let valueColumns: number[];
  let labelColumn: number | undefined;
  if (infer) {
    if (box.columns > CHART_LIMITS.maxSampleCols)
      throw new Error(TOO_WIDE(box.columns));
    const picked = pickChartColumns(sample);
    if (!picked)
      throw new Error(
        "No column of numbers to chart here; name the columns, or chart a summary table (GROUPBY) instead",
      );
    const run = contiguousRun(picked);
    target = {
      ...box,
      column: box.column + run.first,
      columns: run.last - run.first + 1,
    };
    labelColumn = run.label ? picked.label : undefined;
    valueColumns = picked.values.filter((c) => c >= run.first && c <= run.last);
    if (run.dropped)
      note = `${run.dropped} number column(s) not next to the others were left out of the chart`;
  } else {
    const picked = pickChartColumns(sample);
    valueColumns = picked?.values ?? [];
    labelColumn = picked?.label;
  }
  checkChartSize(target.rows, target.columns);
  const header = sample[0] ?? [];
  const name = (c: number) => String(header[c] ?? "");
  const numbers = valueColumns.flatMap((c) =>
    sample
      .slice(1)
      .map((row) => row[c])
      .filter((cell): cell is number => typeof cell === "number"),
  );
  return {
    box: target,
    title: autoChartTitle(
      valueColumns.map(name),
      labelColumn === undefined ? undefined : name(labelColumn),
    ),
    axisFormat: axisNumberFormat(numbers),
    note,
  };
}

export const planAddress = (plan: ChartSourcePlan): string =>
  boxAddress(plan.box);

/** The slice of Excel's worksheet this needs. */
export interface ChartSourceSheet {
  getRange(address: string): any;
  getUsedRange(valuesOnly?: boolean): any;
  getRangeByIndexes(
    row: number,
    column: number,
    rows: number,
    columns: number,
  ): any;
}

const GEOMETRY = ["rowIndex", "columnIndex", "rowCount", "columnCount"];
const boxOf = (r: any): Box => ({
  row: Number(r.rowIndex),
  column: Number(r.columnIndex),
  rows: Number(r.rowCount),
  columns: Number(r.columnCount),
});

/**
 * Reads the geometry of the requested source (and the used range), then only a small sample, and
 * plans the chart. `sync` is the context's sync.
 */
export async function resolveChartSource(
  sheet: ChartSourceSheet,
  sync: () => Promise<void>,
  address?: string,
): Promise<ChartSourcePlan> {
  const used = sheet.getUsedRange(true);
  used.load(GEOMETRY);
  const asked = address ? sheet.getRange(address) : used;
  if (address) asked.load(GEOMETRY);
  await sync();
  const box = boxOf(asked);
  const usedBox = boxOf(used);
  const whole =
    !address ||
    (box.row === usedBox.row &&
      box.column === usedBox.column &&
      box.rows === usedBox.rows &&
      box.columns === usedBox.columns);
  // Refuse a huge source before any cell is read.
  if (!whole || box.columns > CHART_LIMITS.maxSampleCols)
    checkChartSize(box.rows, box.columns);
  else if (box.rows > CHART_LIMITS.maxRows) throw new Error(TOO_LONG(box.rows));
  const sampleRange = sheet.getRangeByIndexes(
    box.row,
    box.column,
    Math.min(box.rows, CHART_LIMITS.sampleRows),
    Math.min(box.columns, CHART_LIMITS.maxSampleCols),
  );
  sampleRange.load("values");
  await sync();
  return planChartSource(box, sampleRange.values as unknown[][], whole);
}
