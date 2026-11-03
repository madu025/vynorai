/**
 * Sheet layout of the general dashboard (pure): a title bar, KPI cards, a breakdown PivotTable with
 * a slicer beside it, charts on the right and the charts' live data further right. The Excel writer
 * in officeExcel.ts only places it, so the layout is tested without Excel. When the host refuses a
 * PivotTable (Excel on the web for some sources) the writer puts `fallbackBreakdown` in its place;
 * when slicers are not supported the PivotTable's own filter stays the way to filter.
 */
import type {
  Audience,
  BusinessTarget,
  CurrencyGuess,
} from "./businessContext.js";
import { usageColumnLetter } from "./usageLayout.js";
import { workbookText, type WorkbookLanguage } from "./workbookText.js";

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
  /** The block is one spilling row: the number format also covers this many rows (spill room). */
  spillRows?: number;
  /** Card accent colour (KPI blocks): a line on top of the card and the value's colour. */
  accent?: string;
  /** Columns the block's one column is merged across (a KPI card on the grid). */
  span?: number;
}

/**
 * How a chart reads: a ranked bar for many categories, a doughnut for the share of a few, and
 * columns for the further measures. Designer dashboards mix these instead of repeating one type.
 */
export type DashboardChartKind = "bar" | "doughnut" | "column" | "line";

/** Business measures a request may name; a named one that is no column gets a note. */
const MEASURE_WORDS = [
  "profit",
  "revenue",
  "margin",
  "cost",
  "expense",
  "income",
  "discount",
  "tax",
];

/**
 * Measures the request names that no header holds ("Sales and Profit" over Sales and Cost gives
 * ["Profit"]). The dashboard then says so instead of quietly leaving them out (live run 2026-11-02).
 */
export function missingMeasures(
  request: string,
  headers: readonly string[],
): string[] {
  const asked = request.toLowerCase();
  const names = headers.map((header) => header.toLowerCase());
  return MEASURE_WORDS.filter(
    (word) =>
      new RegExp(`\\b${word}s?\\b`).test(asked) &&
      // "profit margin" asks for the margin, not the profit amount.
      !new RegExp(`\\b${word}s?\\s+(margin|%|ratio|rate)`).test(asked) &&
      // "Profit Margin" or "Tax %" is a ratio, not the amount the person asked for.
      !names.some(
        (name) =>
          name.includes(word) &&
          (word === "margin" || !/margin|%|ratio|rate|percent/.test(name)),
      ),
  ).map((word) => word[0].toUpperCase() + word.slice(1));
}

/** Months shown in the trend: the latest two years. */
export const TREND_MAX_MONTHS = 24;
const DATE_HEADER = /\b(date|month|period|day)\b|දිනය|මාසය|தேதி/i;
/** Excel serials from 1955 to 2119: numbers outside are not dates. */
const isDateSerial = (cell: unknown) =>
  typeof cell === "number" && cell >= 20000 && cell <= 80000;

/** Excel serial of the first day of the month that holds `serial`. */
export function monthStartSerial(serial: number): number {
  const day = new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * 86400000);
  const start = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), 1);
  return Math.round((start - Date.UTC(1899, 11, 30)) / 86400000);
}

/**
 * The date column for a monthly trend and its months (oldest first, at most the latest
 * TREND_MAX_MONTHS). A column counts when its header names a date, or its number format is a date
 * format, and at least 80% of its filled cells are date serials. Undefined when there is none or
 * the data spans fewer than two months.
 */
export function findTrendColumn(
  headers: readonly string[],
  rows: readonly (readonly unknown[])[],
  numberFormats?: readonly unknown[],
): { index: number; months: number[] } | undefined {
  for (const [index, header] of headers.entries()) {
    const format = String(numberFormats?.[index] ?? "");
    const dateFormat = /[dy]/i.test(format) && !/[#0]/.test(format);
    if (!DATE_HEADER.test(header) && !dateFormat) continue;
    const cells = rows
      .map((row) => row[index])
      .filter((cell) => cell !== "" && cell !== null && cell !== undefined);
    const serials = cells.filter(isDateSerial) as number[];
    if (!serials.length || serials.length < cells.length * 0.8) continue;
    const months = [...new Set(serials.map(monthStartSerial))].sort(
      (a, b) => a - b,
    );
    if (months.length < 2) continue;
    return { index, months: months.slice(-TREND_MAX_MONTHS) };
  }
  return undefined;
}

/** Card and series colours, in order; dark enough for white text and for a white page. */
export const DASHBOARD_PALETTE = [
  "#2F5597",
  "#00A3A3",
  "#F28E2B",
  "#7B61C9",
  "#E15759",
  "#59A14F",
];
/** Page behind the cards and charts, and the card face. */
export const DASHBOARD_PAGE = "#F3F4F6";
export const DASHBOARD_CARD = "#FFFFFF";
/** A doughnut stays readable up to five slices; more read better as a ranked bar. */
export const DOUGHNUT_MAX = 5;

/**
 * A KPI value in K or M when it is large, so the card shows 1.3M rather than 1,254,300. Plain
 * number formats only: a currency format keeps its own symbol and digits.
 */
export function compactFormat(format: string): string {
  if (format === "#,##0" || format === "#,##0.00")
    return '[>=1000000]#,##0.0,,"M";[>=100000]#,##0.0,"K";' + format;
  return format;
}

export function dashboardChartKind(
  index: number,
  categories: number,
  sampled: boolean,
  aggregation: DashboardAggregation,
): DashboardChartKind {
  if (index > 0) return "column";
  const additive = aggregation === "sum" || aggregation === "count";
  if (!sampled && additive && categories >= 2 && categories <= DOUGHNUT_MAX)
    return "doughnut";
  return "bar";
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
  kind: DashboardChartKind;
  /** Series colour. */
  color: string;
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
  /** Rows (from row 1) the light page colour covers, under the title bar. */
  pageRows: number;
  /** Row heights in points: a tall title bar and roomy KPI cards, like a web dashboard. */
  rowHeights: Array<{ row: number; height: number }>;
  /** First column of the chart data; the writer hides it when charts can plot hidden cells. */
  helperColumn: number;
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
  /**
   * The source is an Excel Table in Excel with dynamic arrays: the chart data, the month list and
   * the formula breakdown spill, so categories and months added later appear without a rebuild.
   */
  live?: boolean;
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
  /** Language of the words written on the sheet; English when not given. */
  language?: WorkbookLanguage;
  /** Monthly trend of the first value: the date column and its month starts (Excel serials). */
  trend?: { name: string; ref: string; months: number[] };
  /** Per value column: every number is whole, so no decimals are shown. */
  wholeNumbers?: boolean[];
  /** Measures the request named that are not columns (see missingMeasures). */
  missing?: string[];
}

/** Categories shown in a management view: the headline few. Others keep the longer list. */
export const MANAGEMENT_TOP = 10;
export const DEFAULT_TOP = 50;

/**
 * A 12-column grid like a web dashboard: KPI cards share the full width, charts sit two per row
 * under them, and the breakdown with its slicer comes last (redesign 2026-11-02).
 */
const GRID_COLUMNS = 12;
const GRID_WIDTH = 72;
const CARD_COLUMNS = 6;
const CHART_SPAN = GRID_COLUMNS / 2;
/** First chart row, under the KPI cards and the note row. */
const CHART_TOP = 7;
// The chart data sits far right (AO), off the page: hiding it blanked the charts unless Excel
// plotted hidden cells, which did not take in Excel desktop (live run 2026-11-02).
const HELPER_COLUMN = 40; // AO
const KPI_ROW = 3;
const NOTE_ROW = 6;
const CHART_ROW = 3;
const CHART_HEIGHT = 16;

/** One aggregate of a value column over a category value (a cell or a lambda parameter). */
export function categoryAggregateFormula(
  aggregation: DashboardAggregation,
  valueRef: string,
  categoryRef: string,
  categoryCell: string,
): string {
  if (aggregation === "count")
    return `COUNTIFS(${categoryRef},${categoryCell})`;
  if (aggregation === "average")
    return `IFERROR(AVERAGEIFS(${valueRef},${categoryRef},${categoryCell}),"")`;
  if (aggregation === "min")
    return `MINIFS(${valueRef},${categoryRef},${categoryCell})`;
  if (aggregation === "max")
    return `MAXIFS(${valueRef},${categoryRef},${categoryCell})`;
  return `SUMIFS(${valueRef},${categoryRef},${categoryCell})`;
}

/** The headline figure of a value column over every row. */
function headlineFormula(
  aggregation: DashboardAggregation,
  ref: string,
): string {
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
  const groups = new Map<
    string,
    { sum: number; count: number; min: number; max: number }
  >();
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
    const value =
      typeof raw === "number"
        ? raw
        : Number(String(raw ?? "").replace(/,/g, ""));
    if (aggregation === "count") group.count += 1;
    else if (Number.isFinite(value) && String(raw ?? "").trim() !== "") {
      group.sum += value;
      group.count += 1;
      group.min = Math.min(group.min, value);
      group.max = Math.max(group.max, value);
    }
    groups.set(name, group);
  }
  const score = (group: {
    sum: number;
    count: number;
    min: number;
    max: number;
  }) =>
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

export function buildDashboardLayout(
  input: DashboardLayoutInput,
): DashboardLayout {
  const blocks: DashboardBlock[] = [];
  const charts: DashboardChartPlan[] = [];
  const notes: string[] = [];
  const { aggregation, values } = input;
  const text = workbookText(input.language);
  const label = text.aggregate(aggregation);
  const currencyOk = input.currency && !input.currency.mixed;
  const valueFormats = values.map((_, index) =>
    aggregation === "count"
      ? "#,##0"
      : currencyOk && input.money[index]
        ? input.currency!.numberFormat
        : aggregation !== "average" && input.wholeNumbers?.[index]
          ? "#,##0"
          : "#,##0.00",
  );
  const spill = input.sampled || Boolean(input.live);
  const shown = spill ? dashboardTopN(input.audience) : input.categories.length;

  const title = text.valuesBy(
    values.map((value) => value.name),
    input.categoryName,
  );
  blocks.push({
    row: 0,
    col: 0,
    cells: [[title.toUpperCase()]],
    style: "title",
  });
  const audienceText =
    input.audience === "management"
      ? text.management
      : input.audience === "operational"
        ? text.operational
        : "";
  const currencyText = currencyOk ? text.amountsIn(input.currency!.code) : "";
  blocks.push({
    row: 1,
    col: 0,
    cells: [
      [
        `${audienceText ? `${audienceText} ` : ""}${text.liveFormulas(input.sourceLabel)}${currencyText}`,
      ],
    ],
    style: "subtitle",
  });

  // Chart data first: the "top category" card reads it.
  const topCount = input.sampled ? shown : Math.max(1, input.categories.length);
  const helperRefs: Array<{ names: string; values: string }> = [];
  values.forEach((value, index) => {
    const col = HELPER_COLUMN + index * 3;
    const letter = usageColumnLetter(col);
    const valueLetter = usageColumnLetter(col + 1);
    if (index === 0)
      blocks.push({
        row: 0,
        col,
        cells: [[text.chartData]],
        style: "helper",
      });
    blocks.push({
      row: 1,
      col,
      cells: [[input.categoryName, text.aggregateOf(label, value.name)]],
      style: "table-header",
    });
    if (spill) {
      const lambda = categoryAggregateFormula(
        aggregation,
        value.ref,
        input.categoryRef,
        "c",
      );
      const categories = `UNIQUE(FILTER(${input.categoryRef},${input.categoryRef}<>""))`;
      blocks.push({
        row: 2,
        col,
        cells: [
          [
            {
              f: `=TAKE(SORTBY(${categories},BYROW(${categories},LAMBDA(c,${lambda})),-1),${shown})`,
            },
            { f: `=BYROW(${letter}3#,LAMBDA(c,${lambda}))` },
          ],
        ],
        style: "table-body",
        numberFormat: valueFormats[index],
        spillRows: shown,
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
    if (spill || input.categories.length) {
      const top = CHART_ROW + index * (CHART_HEIGHT + 1);
      charts.push({
        title: text.aggregateOfBy(label, value.name, input.categoryName),
        headerRow: 1,
        col,
        dataRows: topCount,
        from: `${usageColumnLetter(0)}${top + 1}`,
        to: `${usageColumnLetter(CHART_SPAN - 1)}${top + CHART_HEIGHT}`,
        numberFormat: valueFormats[index],
        kind: dashboardChartKind(
          index,
          input.categories.length,
          input.sampled,
          aggregation,
        ),
        color: DASHBOARD_PALETTE[index % DASHBOARD_PALETTE.length],
      });
    }
  });

  // Month totals of the first measure (last two feed the first card's change line).
  let trendValues: string | undefined;
  // The month column and date column, so every value card can compare its own last two months.
  let monthsRef: string | undefined;
  let trendDateRef: string | undefined;
  // Monthly trend of the first measure, as a line under the other charts.
  if (input.trend && input.trend.months.length >= 2 && values.length) {
    const col = HELPER_COLUMN + values.length * 3;
    const letter = usageColumnLetter(col);
    const { ref, months } = input.trend;
    trendValues = input.live
      ? `${usageColumnLetter(col + 1)}3#`
      : `${usageColumnLetter(col + 1)}$3:${usageColumnLetter(col + 1)}${months.length + 2}`;
    monthsRef = input.live
      ? `${letter}3#`
      : `${letter}$3:${letter}${months.length + 2}`;
    trendDateRef = ref;
    const value = values[0];
    const monthCell = (row: number) => `${letter}${row + 3}`;
    const between = (row: number) =>
      `${ref},">="&${monthCell(row)},${ref},"<"&EDATE(${monthCell(row)},1)`;
    const monthly = (row: number) =>
      aggregation === "count"
        ? `COUNTIFS(${between(row)})`
        : aggregation === "average"
          ? `IFERROR(AVERAGEIFS(${value.ref},${between(row)}),0)`
          : aggregation === "min"
            ? `MINIFS(${value.ref},${between(row)})`
            : aggregation === "max"
              ? `MAXIFS(${value.ref},${between(row)})`
              : `SUMIFS(${value.ref},${between(row)})`;
    blocks.push({
      row: 1,
      col,
      cells: [[input.trend.name, text.aggregateOf(label, value.name)]],
      style: "table-header",
    });
    if (input.live) {
      // Every month from the first date to the last (latest 24), so a new month appears by itself.
      const monthly = (m: string) =>
        aggregation === "count"
          ? `COUNTIFS(${ref},">="&${m},${ref},"<"&EDATE(${m},1))`
          : aggregation === "average"
            ? `IFERROR(AVERAGEIFS(${value.ref},${ref},">="&${m},${ref},"<"&EDATE(${m},1)),0)`
            : aggregation === "min"
              ? `MINIFS(${value.ref},${ref},">="&${m},${ref},"<"&EDATE(${m},1))`
              : aggregation === "max"
                ? `MAXIFS(${value.ref},${ref},">="&${m},${ref},"<"&EDATE(${m},1))`
                : `SUMIFS(${value.ref},${ref},">="&${m},${ref},"<"&EDATE(${m},1))`;
      blocks.push({
        row: 2,
        col,
        cells: [
          [
            {
              f: `=LET(d,FILTER(${ref},ISNUMBER(${ref})),s,EOMONTH(MIN(d),-1)+1,n,DATEDIF(s,MAX(d),"m")+1,TAKE(EDATE(s,SEQUENCE(n,1,0)),-24))`,
            },
          ],
        ],
        style: "table-body",
        numberFormat: "mmm yyyy",
        spillRows: 24,
      });
      blocks.push({
        row: 2,
        col: col + 1,
        cells: [[{ f: `=BYROW(${letter}3#,LAMBDA(m,${monthly("m")}))` }]],
        style: "table-body",
        numberFormat: valueFormats[0],
        spillRows: 24,
      });
    } else {
      blocks.push({
        row: 2,
        col,
        cells: months.map((month) => [month]),
        style: "table-body",
        numberFormat: "mmm yyyy",
      });
      blocks.push({
        row: 2,
        col: col + 1,
        cells: months.map((_, row) => [{ f: `=${monthly(row)}` }]),
        style: "table-body",
        numberFormat: valueFormats[0],
      });
    }
    const top = CHART_ROW + charts.length * (CHART_HEIGHT + 1);
    charts.push({
      title: text.byMonth(label, value.name),
      headerRow: 1,
      col,
      dataRows: months.length,
      from: `${usageColumnLetter(0)}${top + 1}`,
      to: `${usageColumnLetter(CHART_SPAN - 1)}${top + CHART_HEIGHT}`,
      numberFormat: valueFormats[0],
      kind: "line",
      color: DASHBOARD_PALETTE[charts.length % DASHBOARD_PALETTE.length],
    });
  }

  // KPI cards: label, value and a small line under it, one card per column.
  interface Card {
    label: string;
    value: DashboardCell;
    sub: DashboardCell;
    format: string;
  }
  const cards: Card[] = [];
  const records: Card = {
    label: text.records,
    // Rows with a category: a table row whose cells were cleared is not a record.
    value: { f: `=SUMPRODUCT(--(LEN(${input.categoryRef})>0))` },
    // Excel 2016 and 2019 have no UNIQUE: the count is written as text when every row was read.
    sub: spill
      ? {
          f: `=IFERROR(COUNTA(UNIQUE(FILTER(${input.categoryRef},${input.categoryRef}<>""))),"")&"${text.categoryValues(input.categoryName.replace(/"/g, "'"))}"`,
        }
      : `${input.totalCategories ?? input.categories.length}${text.categoryValues(input.categoryName)}`,
    format: "#,##0",
  };
  // Every value card says how the latest month compares with the one before: "▲ 12.5% vs previous
  // month"; with no usable trend (or a zero before) it keeps the average line.
  const valueSub = (index: number, value: { ref: string }): DashboardCell => {
    const average =
      aggregation === "sum"
        ? `"${text.averagePrefix}"&TEXT(IFERROR(AVERAGE(${value.ref}),0),"#,##0.00")`
        : '""';
    if (!trendValues || !monthsRef || !trendDateRef || aggregation !== "sum")
      return aggregation === "sum" ? { f: `=${average}` } : "";
    // The first measure reads its monthly totals from the chart table; the others add up their own
    // last two months from the data.
    const monthTotal = (at: string) =>
      `SUMIFS(${value.ref},${trendDateRef},">="&${at},${trendDateRef},"<"&EDATE(${at},1))`;
    const lastMonth = `INDEX(${monthsRef},ROWS(${monthsRef}))`;
    const monthBefore = `INDEX(${monthsRef},ROWS(${monthsRef})-1)`;
    const last =
      index === 0
        ? `INDEX(${trendValues},ROWS(${trendValues}))`
        : monthTotal(lastMonth);
    const before =
      index === 0
        ? `INDEX(${trendValues},ROWS(${trendValues})-1)`
        : monthTotal(monthBefore);
    return {
      f: `=IFERROR(IF(${before}=0,${average},IF(${last}>=${before},"▲ ","▼ ")&TEXT(ABS(${last}/${before}-1),"0.0%")&" ${text.vsPreviousMonth}"),${average})`,
    };
  };
  const valueCards: Card[] = values.map((value, index) => ({
    label: text.valueCard(label, value.name).toUpperCase(),
    value: { f: headlineFormula(aggregation, value.ref) },
    sub: valueSub(index, value),
    format: compactFormat(valueFormats[index]),
  }));
  const targetCards: Card[] = [];
  if (input.target) {
    const at = input.target.column ?? 0;
    const value = values[at] ?? values[0];
    const total = headlineFormula(aggregation, value.ref).slice(1);
    const targetText = formatNumber(input.target.value);
    targetCards.push({
      label: text.percentOf(input.target.label).toUpperCase(),
      value: { f: `=IFERROR(${total}/${input.target.value},0)` },
      // A bullet bar in text (Office.js cannot draw one in a cell): ten blocks, filled to the share
      // of the target reached, then the target in words.
      sub: {
        f: `=REPT("█",ROUND(MIN(1,IFERROR(${total}/${input.target.value},0))*10,0))&REPT("░",10-ROUND(MIN(1,IFERROR(${total}/${input.target.value},0))*10,0))&" ${`${value.name} ${input.target.label} ${targetText}`.replace(/"/g, "'")}"`,
      },
      format: "0.0%",
    });
    targetCards.push({
      label: text.gapTo(input.target.label).toUpperCase(),
      // Past the target the gap is 0, not a negative number; the sub line says by how much.
      value: { f: `=MAX(0,${input.target.value}-${total})` },
      sub: {
        f: `=IF(${total}>=${input.target.value},"${text.reached(input.target.label).replace(/"/g, "'")} (+"&TEXT(${total}-${input.target.value},"#,##0")&")","${text.stillToGo}")`,
      },
      format: valueFormats[values.indexOf(value)] ?? "#,##0.00",
    });
  }
  const topCards: Card[] = helperRefs.length
    ? [
        {
          label: text.top(input.categoryName).toUpperCase(),
          value: {
            f: `=IFERROR(INDEX(${helperRefs[0].names},MATCH(MAX(${helperRefs[0].values}),${helperRefs[0].values},0)),"")`,
          },
          sub: text.topBy(label, values[0].name),
          format: "@",
        },
      ]
    : [];
  // Six cards fit above the breakdown; the record count gives way first, then the gap card.
  let chosen = [records, ...valueCards, ...targetCards, ...topCards];
  if (chosen.length > CARD_COLUMNS)
    chosen = chosen.filter((card) => card !== records);
  if (chosen.length > CARD_COLUMNS && targetCards[1])
    chosen = chosen.filter((card) => card !== targetCards[1]);
  chosen = chosen.slice(0, CARD_COLUMNS);
  // Cards share the full grid width: three cards span four columns each, four span three.
  const span = Math.max(
    1,
    Math.floor(GRID_COLUMNS / Math.max(1, chosen.length)),
  );
  chosen.forEach((card, index) => {
    const accent = DASHBOARD_PALETTE[index % DASHBOARD_PALETTE.length];
    const col = index * span;
    blocks.push({
      row: KPI_ROW,
      col,
      cells: [[card.label]],
      style: "kpi-label",
      accent,
      span,
    });
    blocks.push({
      row: KPI_ROW + 1,
      col,
      cells: [[card.value]],
      style: "kpi-value",
      accent,
      span,
      ...(card.format !== "@" ? { numberFormat: card.format } : {}),
    });
    blocks.push({
      row: KPI_ROW + 2,
      col,
      cells: [[card.sub]],
      style: "kpi-sub",
      span,
    });
  });

  // Charts two per row under the cards; a lone last chart keeps half the width.
  charts.forEach((chart, index) => {
    const top = CHART_TOP + Math.floor(index / 2) * (CHART_HEIGHT + 1);
    const left = (index % 2) * CHART_SPAN;
    chart.from = `${usageColumnLetter(left)}${top + 1}`;
    chart.to = `${usageColumnLetter(left + CHART_SPAN - 1)}${top + CHART_HEIGHT}`;
  });
  const SECTION_ROW =
    CHART_TOP + Math.ceil(charts.length / 2) * (CHART_HEIGHT + 1) + 1;
  const PIVOT_ROW = SECTION_ROW + 1;

  if (input.currency?.mixedBy)
    notes.push(text.mixedRows(input.currency.mixed!, input.currency.mixedBy));
  else if (input.currency?.mixed)
    notes.push(text.mixedColumns(input.currency.mixed));
  if (
    !input.sampled &&
    input.totalCategories &&
    input.totalCategories > input.categories.length
  )
    notes.push(
      text.largestShown(
        input.categories.length,
        input.totalCategories,
        input.categoryName,
      ),
    );
  if (input.sampled) notes.push(text.largeData(shown, input.categoryName));
  for (const name of input.missing ?? []) notes.push(text.missingMeasure(name));
  // Spilled chart data follows new categories, so the order note applies only to fixed lists.
  if (!spill && input.categories.length) notes.push(text.chartOrder);
  notes.push(text.pivotRefresh);

  blocks.push({
    row: SECTION_ROW,
    col: 0,
    cells: [[text.breakdownBy(input.categoryName).toUpperCase()]],
    style: "section",
  });

  // The formula table used when the host cannot make a PivotTable.
  const fallbackBreakdown: DashboardBlock[] = [
    {
      row: PIVOT_ROW,
      col: 0,
      cells: [
        [
          input.categoryName,
          ...values.map((value) => text.aggregateOf(label, value.name)),
        ],
      ],
      style: "table-header",
    },
  ];
  if (spill) {
    const primary = values[0];
    const categories = `UNIQUE(FILTER(${input.categoryRef},${input.categoryRef}<>""))`;
    const ranking = `BYROW(c,LAMBDA(x,${categoryAggregateFormula(aggregation, primary.ref, input.categoryRef, "x")}))`;
    fallbackBreakdown.push({
      row: PIVOT_ROW + 1,
      col: 0,
      cells: [
        [
          {
            f: `=LET(c,${categories},a,${ranking},TAKE(SORTBY(c,a,-1),${shown}))`,
          },
          ...values.map((value) => ({
            f: `=BYROW(A${PIVOT_ROW + 2}#,LAMBDA(c,${categoryAggregateFormula(aggregation, value.ref, input.categoryRef, "c")}))`,
          })),
        ],
      ],
      style: "table-body",
    });
  } else if (input.categories.length)
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
    ...Array.from({ length: GRID_COLUMNS }, (_, col) => ({
      col,
      width: col === 0 ? GRID_WIDTH + 24 : GRID_WIDTH,
    })),
    ...values.flatMap((_, index) => [
      { col: HELPER_COLUMN + index * 3, width: 110 },
      { col: HELPER_COLUMN + index * 3 + 1, width: 95 },
    ]),
  ];

  if (notes.length)
    blocks.push({
      row: NOTE_ROW,
      col: 0,
      cells: [[notes.join(" ")]],
      style: "note",
    });

  return {
    title,
    blocks,
    charts,
    pivotAnchor: `A${PIVOT_ROW + 1}`,
    slicerAnchor: `${usageColumnLetter(values.length + 2)}${PIVOT_ROW + 1}`,
    fallbackBreakdown,
    columnWidths,
    titleWidth: GRID_COLUMNS,
    rowHeights: [
      { row: 0, height: 36 },
      { row: 1, height: 20 },
      { row: KPI_ROW, height: 22 },
      { row: KPI_ROW + 1, height: 38 },
      { row: KPI_ROW + 2, height: 20 },
    ],
    helperColumn: HELPER_COLUMN,
    pageRows: Math.max(PIVOT_ROW + shown + 3, PIVOT_ROW + 14),
    valueFormats,
    notes,
  };
}
