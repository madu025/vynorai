/**
 * Sheet layout of the general dashboard (pure): a title bar, KPI cards, a breakdown PivotTable with
 * a slicer beside it, charts on the right and the charts' live data further right. The Excel writer
 * in officeExcel.ts only places it, so the layout is tested without Excel. When the host refuses a
 * PivotTable (Excel on the web for some sources) the writer puts `fallbackBreakdown` in its place;
 * when slicers are not supported the PivotTable's own filter stays the way to filter.
 */
import type { Audience, BusinessTarget, CurrencyGuess } from "./businessContext.js";
import { usageColumnLetter } from "./usageLayout.js";

export type DashboardAggregation = "sum" | "count" | "average" | "min" | "max";

/** A formula cell; every plain string is written as text (a leading "=" is escaped by the writer). */
export interface FormulaCell {
  f: string;
}
export type DashboardCell = string | number | FormulaCell;

export type DashboardStyle =
  | "title"
  | "subtitle"
  | "kpi-label"
  | "kpi-value"
  | "kpi-sub"
  | "note"
  | "section"
  | "table-header"
  | "table-body"
  | "helper";

export interface DashboardBlock {
  row: number;
  col: number;
  cells: DashboardCell[][];
  style: DashboardStyle;
  /** One number format for every cell of the block. */
  numberFormat?: string;
}

export interface DashboardChartPlan {
  title: string;
  /** Header row and first column of the two-column (category, value) source table. */
  headerRow: number;
  col: number;
  /** Data rows of the source table; the writer charts header + these rows. */
  dataRows: number;
  /** Top-left and bottom-right cells of the chart. */
  from: string;
  to: string;
  numberFormat?: string;
}

export interface DashboardLayout {
  title: string;
  blocks: DashboardBlock[];
  charts: DashboardChartPlan[];
  /** Where the PivotTable starts (its top-left cell). */
  pivotAnchor: string;
  /** Cell the slicer is placed at, beside the PivotTable. */
  slicerAnchor: string;
  /** Formula breakdown written at pivotAnchor when no PivotTable can be made. */
  fallbackBreakdown: DashboardBlock[];
  columnWidths: Array<{ col: number; width: number }>;
  /** Width of the title bar in columns. */
  titleWidth: number;
  /** Number format per value column, also used for the PivotTable values. */
  valueFormats: string[];
  /** Plain-language notes shown on the sheet and in the result message. */
  notes: string[];
}

export interface DashboardLayoutInput {
  categoryName: string;
  /** Absolute reference of the category column's data rows, e.g. 'Data'!$A$2:$A$500. */
  categoryRef: string;
  values: Array<{ name: string; ref: string }>;
  aggregation: DashboardAggregation;
  /**
   * Categories in the order to show them (largest first), already cut to the shown number. Empty
   * when the source is too large to read: the chart data is then a spilled formula over every row.
   */
  categories: string[];
  sampled: boolean;
  /** Distinct categories in the data; used for the note when only the largest are shown. */
  totalCategories?: number;
  currency?: CurrencyGuess;
  /** Per value column: does it hold money? Only money gets the currency format. */
  money: boolean[];
  audience: Audience;
  /** Target for one of the values (column = index into `values`). */
  target?: BusinessTarget;
  /** Where the data comes from, for the subtitle: 'Sales'!A1:D500. */
  sourceLabel: string;
}

/** Categories shown in a management view: the headline few. Others keep the longer list. */
export const MANAGEMENT_TOP = 10;
export const DEFAULT_TOP = 50;

const CARD_COLUMNS = 6;
const CARD_WIDTH = 120;
const GAP_COLUMN = CARD_COLUMNS; // G: a thin gap before the charts
const CHART_COLUMN = CARD_COLUMNS + 1; // H
const CHART_SPAN = 7; // H:N
const HELPER_COLUMN = CHART_COLUMN + CHART_SPAN + 2; // Q
const KPI_ROW = 3;
const NOTE_ROW = 6;
const SECTION_ROW = 8;
const PIVOT_ROW = 9;
const CHART_ROW = 3;
const CHART_HEIGHT = 16;

const AGGREGATE_LABEL: Record<DashboardAggregation, string> = {
  sum: "Total",
  count: "Count",
  average: "Average",
  min: "Lowest",
  max: "Highest",
};

/** One aggregate of a value column over a category value (a cell or a lambda parameter). */
export function categoryAggregateFormula(
  aggregation: DashboardAggregation,
  valueRef: string,
  categoryRef: string,
  categoryCell: string,
): string {
  if (aggregation === "count") return `COUNTIFS(${categoryRef},${categoryCell})`;
  if (aggregation === "average")
    return `IFERROR(AVERAGEIFS(${valueRef},${categoryRef},${categoryCell}),"")`;
  if (aggregation === "min")
    return `MINIFS(${valueRef},${categoryRef},${categoryCell})`;
  if (aggregation === "max")
    return `MAXIFS(${valueRef},${categoryRef},${categoryCell})`;
  return `SUMIFS(${valueRef},${categoryRef},${categoryCell})`;
}

/** The headline figure of a value column over every row. */
function headlineFormula(aggregation: DashboardAggregation, ref: string): string {
  if (aggregation === "count") return `=COUNT(${ref})`;
  if (aggregation === "average") return `=IFERROR(AVERAGE(${ref}),0)`;
  if (aggregation === "min") return `=MIN(${ref})`;
  if (aggregation === "max") return `=MAX(${ref})`;
  return `=SUM(${ref})`;
}

/**
 * Orders categories by the aggregate of one value column, largest first, from rows already read.
 * Ties keep the alphabetical order so the same data always gives the same dashboard.
 */
export function rankCategories(
  rows: unknown[][],
  categoryIndex: number,
  valueIndex: number,
  aggregation: DashboardAggregation,
): string[] {
  const groups = new Map<string, { sum: number; count: number; min: number; max: number }>();
  for (const row of rows) {
    const name = String(row[categoryIndex] ?? "").trim();
    if (!name) continue;
    const group = groups.get(name) ?? {
      sum: 0,
      count: 0,
      min: Infinity,
      max: -Infinity,
    };
    const raw = row[valueIndex];
    const value = typeof raw === "number" ? raw : Number(String(raw ?? "").replace(/,/g, ""));
    if (aggregation === "count") group.count += 1;
    else if (Number.isFinite(value) && String(raw ?? "").trim() !== "") {
      group.sum += value;
      group.count += 1;
      group.min = Math.min(group.min, value);
      group.max = Math.max(group.max, value);
    }
    groups.set(name, group);
  }
  const score = (group: { sum: number; count: number; min: number; max: number }) =>
    aggregation === "count"
      ? group.count
      : aggregation === "average"
        ? group.count
          ? group.sum / group.count
          : -Infinity
        : aggregation === "min"
          ? Number.isFinite(group.min)
            ? group.min
            : -Infinity
          : aggregation === "max"
            ? Number.isFinite(group.max)
              ? group.max
              : -Infinity
            : group.sum;
  return [...groups.entries()]
    .sort((a, b) => score(b[1]) - score(a[1]) || a[0].localeCompare(b[0]))
    .map(([name]) => name);
}

/** How many categories the dashboard shows for this audience. */
export function dashboardTopN(audience: Audience): number {
  return audience === "management" ? MANAGEMENT_TOP : DEFAULT_TOP;
}

const formatNumber = (value: number) =>
  value.toLocaleString("en-US", { maximumFractionDigits: 2 });

export function buildDashboardLayout(input: DashboardLayoutInput): DashboardLayout {
  const blocks: DashboardBlock[] = [];
  const charts: DashboardChartPlan[] = [];
  const notes: string[] = [];
  const { aggregation, values } = input;
  const label = AGGREGATE_LABEL[aggregation];
  const currencyOk = input.currency && !input.currency.mixed;
  const valueFormats = values.map((_, index) =>
    aggregation === "count"
      ? "#,##0"
      : currencyOk && input.money[index]
        ? input.currency!.numberFormat
        : "#,##0.00",
  );
  const shown = input.sampled
    ? dashboardTopN(input.audience)
    : input.categories.length;

  const title = `${values.map((value) => value.name).join(", ")} by ${input.categoryName}`;
  blocks.push({ row: 0, col: 0, cells: [[title.toUpperCase()]], style: "title" });
  const audienceText =
    input.audience === "management"
      ? "Management summary: the headline numbers and the largest categories."
      : input.audience === "operational"
        ? "Operational view: every category, with a slicer to work through them."
        : "";
  const currencyText = currencyOk
    ? ` Amounts in ${input.currency!.code}.`
    : "";
  blocks.push({
    row: 1,
    col: 0,
    cells: [
      [
        `${audienceText ? `${audienceText} ` : ""}Live formulas over every row of ${input.sourceLabel}.${currencyText}`,
      ],
    ],
    style: "subtitle",
  });

  // Chart data first: the "top category" card reads it.
  const topCount = input.sampled
    ? shown
    : Math.max(1, input.categories.length);
  const helperRefs: Array<{ names: string; values: string }> = [];
  values.forEach((value, index) => {
    const col = HELPER_COLUMN + index * 3;
    const letter = usageColumnLetter(col);
    const valueLetter = usageColumnLetter(col + 1);
    if (index === 0)
      blocks.push({
        row: 0,
        col,
        cells: [["Chart data (live formulas)"]],
        style: "helper",
      });
    blocks.push({
      row: 1,
      col,
      cells: [[input.categoryName, `${label} of ${value.name}`]],
      style: "table-header",
    });
    if (input.sampled) {
      const lambda = categoryAggregateFormula(
        aggregation,
        value.ref,
        input.categoryRef,
        "c",
      );
      blocks.push({
        row: 2,
        col,
        cells: [
          [
            {
              f: `=TAKE(SORT(UNIQUE(FILTER(${input.categoryRef},${input.categoryRef}<>""))),${shown})`,
            },
            { f: `=BYROW(${letter}3#,LAMBDA(c,${lambda}))` },
          ],
        ],
        style: "table-body",
        numberFormat: valueFormats[index],
      });
      helperRefs.push({ names: `${letter}3#`, values: `${valueLetter}3#` });
    } else if (input.categories.length) {
      blocks.push({
        row: 2,
        col,
        cells: input.categories.map((name, rowIndex) => [
          name,
          {
            f: `=${categoryAggregateFormula(aggregation, value.ref, input.categoryRef, `${letter}${rowIndex + 3}`)}`,
          },
        ]),
        style: "table-body",
        numberFormat: valueFormats[index],
      });
      const last = input.categories.length + 2;
      helperRefs.push({
        names: `$${letter}$3:$${letter}$${last}`,
        values: `$${valueLetter}$3:$${valueLetter}$${last}`,
      });
    }
    if (input.sampled || input.categories.length) {
      const top = CHART_ROW + index * (CHART_HEIGHT + 1);
      charts.push({
        title: `${label} of ${value.name} by ${input.categoryName}`,
        headerRow: 1,
        col,
        dataRows: topCount,
        from: `${usageColumnLetter(CHART_COLUMN)}${top + 1}`,
        to: `${usageColumnLetter(CHART_COLUMN + CHART_SPAN - 1)}${top + CHART_HEIGHT}`,
        numberFormat: valueFormats[index],
      });
    }
  });

  // KPI cards: label, value and a small line under it, one card per column.
  interface Card {
    label: string;
    value: DashboardCell;
    sub: DashboardCell;
    format: string;
  }
  const cards: Card[] = [];
  const records: Card = {
    label: "RECORDS",
    value: { f: `=ROWS(${input.categoryRef})` },
    // Excel 2016 and 2019 have no UNIQUE: the count is written as text when every row was read.
    sub: input.sampled
      ? {
          f: `=IFERROR(COUNTA(UNIQUE(FILTER(${input.categoryRef},${input.categoryRef}<>""))),"")&" ${input.categoryName.replace(/"/g, "'")} values"`,
        }
      : `${input.totalCategories ?? input.categories.length} ${input.categoryName} values`,
    format: "#,##0",
  };
  const valueCards: Card[] = values.map((value, index) => ({
    label: `${label} ${value.name}`.toUpperCase(),
    value: { f: headlineFormula(aggregation, value.ref) },
    sub:
      aggregation === "sum"
        ? { f: `="Average "&TEXT(IFERROR(AVERAGE(${value.ref}),0),"#,##0.00")` }
        : "",
    format: valueFormats[index],
  }));
  const targetCards: Card[] = [];
  if (input.target) {
    const at = input.target.column ?? 0;
    const value = values[at] ?? values[0];
    const total = headlineFormula(aggregation, value.ref).slice(1);
    const targetText = formatNumber(input.target.value);
    targetCards.push({
      label: `% OF ${input.target.label}`.toUpperCase(),
      value: { f: `=IFERROR(${total}/${input.target.value},0)` },
      sub: `${value.name} ${input.target.label} ${targetText}`,
      format: "0.0%",
    });
    targetCards.push({
      label: `GAP TO ${input.target.label}`.toUpperCase(),
      value: { f: `=${input.target.value}-${total}` },
      sub: { f: `=IF(${total}>=${input.target.value},"${input.target.label} reached","still to go")` },
      format: valueFormats[values.indexOf(value)] ?? "#,##0.00",
    });
  }
  const topCards: Card[] = helperRefs.length
    ? [
        {
          label: `TOP ${input.categoryName}`.toUpperCase(),
          value: {
            f: `=IFERROR(INDEX(${helperRefs[0].names},MATCH(MAX(${helperRefs[0].values}),${helperRefs[0].values},0)),"")`,
          },
          sub: `by ${label.toLowerCase()} of ${values[0].name}`,
          format: "@",
        },
      ]
    : [];
  // Six cards fit above the breakdown; the record count gives way first, then the gap card.
  let chosen = [records, ...valueCards, ...targetCards, ...topCards];
  if (chosen.length > CARD_COLUMNS) chosen = chosen.filter((card) => card !== records);
  if (chosen.length > CARD_COLUMNS && targetCards[1])
    chosen = chosen.filter((card) => card !== targetCards[1]);
  chosen = chosen.slice(0, CARD_COLUMNS);
  chosen.forEach((card, index) => {
    blocks.push({ row: KPI_ROW, col: index, cells: [[card.label]], style: "kpi-label" });
    blocks.push({
      row: KPI_ROW + 1,
      col: index,
      cells: [[card.value]],
      style: "kpi-value",
      ...(card.format !== "@" ? { numberFormat: card.format } : {}),
    });
    blocks.push({ row: KPI_ROW + 2, col: index, cells: [[card.sub]], style: "kpi-sub" });
  });

  if (input.currency?.mixed)
    notes.push(
      `The value columns are in different currencies (${input.currency.mixed.join(", ")}); they are shown side by side and never added together.`,
    );
  if (!input.sampled && input.totalCategories && input.totalCategories > input.categories.length)
    notes.push(
      `The charts show the ${input.categories.length} largest of ${input.totalCategories} ${input.categoryName} values; the totals and the PivotTable cover all of them.`,
    );
  if (input.sampled)
    notes.push(
      `The data is large, so the charts list up to ${shown} ${input.categoryName} values from a live formula; the totals cover every row.`,
    );
  if (!input.sampled && input.categories.length)
    notes.push("The chart order is from when the dashboard was made; the figures stay live.");

  blocks.push({
    row: SECTION_ROW,
    col: 0,
    cells: [[`BREAKDOWN BY ${input.categoryName}`.toUpperCase()]],
    style: "section",
  });

  // The formula table used when the host cannot make a PivotTable.
  const fallbackBreakdown: DashboardBlock[] = [
    {
      row: PIVOT_ROW,
      col: 0,
      cells: [[input.categoryName, ...values.map((value) => `${label} of ${value.name}`)]],
      style: "table-header",
    },
  ];
  if (input.sampled)
    fallbackBreakdown.push({
      row: PIVOT_ROW + 1,
      col: 0,
      cells: [
        [
          {
            f: `=TAKE(SORT(UNIQUE(FILTER(${input.categoryRef},${input.categoryRef}<>""))),${shown})`,
          },
          ...values.map((value) => ({
            f: `=BYROW(A${PIVOT_ROW + 2}#,LAMBDA(c,${categoryAggregateFormula(aggregation, value.ref, input.categoryRef, "c")}))`,
          })),
        ],
      ],
      style: "table-body",
    });
  else if (input.categories.length)
    fallbackBreakdown.push({
      row: PIVOT_ROW + 1,
      col: 0,
      cells: input.categories.map((name, rowIndex) => [
        name,
        ...values.map((value) => ({
          f: `=${categoryAggregateFormula(aggregation, value.ref, input.categoryRef, `$A${PIVOT_ROW + 2 + rowIndex}`)}`,
        })),
      ]),
      style: "table-body",
    });

  const columnWidths = [
    ...Array.from({ length: CARD_COLUMNS }, (_, col) => ({ col, width: CARD_WIDTH })),
    { col: GAP_COLUMN, width: 14 },
    ...values.flatMap((_, index) => [
      { col: HELPER_COLUMN + index * 3, width: 110 },
      { col: HELPER_COLUMN + index * 3 + 1, width: 95 },
    ]),
  ];

  if (notes.length)
    blocks.push({ row: NOTE_ROW, col: 0, cells: [[notes.join(" ")]], style: "note" });

  return {
    title,
    blocks,
    charts,
    pivotAnchor: `A${PIVOT_ROW + 1}`,
    slicerAnchor: `${usageColumnLetter(values.length + 2)}${PIVOT_ROW + 1}`,
    fallbackBreakdown,
    columnWidths,
    titleWidth: CHART_COLUMN + CHART_SPAN,
    valueFormats,
    notes,
  };
}
