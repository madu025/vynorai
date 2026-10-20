/**
 * Sheet layout of the usage dashboard (pure): what goes in which cell. The Excel writer only places
 * it, so the layout is tested without Excel.
 */
import {
  MAX_UNIT_BLOCKS,
  type UnitGroup,
  type UsageResult,
} from "./usageDashboard.js";

export type BlockStyle =
  | "title"
  | "subtitle"
  | "kpi-label"
  | "kpi-value"
  | "section"
  | "input"
  | "lookup-label"
  | "lookup-value"
  | "table-header"
  | "table-body"
  | "note";

export interface LayoutBlock {
  row: number;
  col: number;
  /** A string starting with "=" is a formula; everything else is written as text or a number. */
  cells: Array<Array<string | number>>;
  style: BlockStyle;
  /** Text format for identifiers such as 0112097342, so leading zeros stay. */
  text?: boolean;
  /** Excel number format for the cells of this block. */
  numberFormat?: string;
}

export interface LayoutChart {
  title: string;
  /** The entity and value columns of a table: header row, the entity column, number of data rows. */
  headerRow: number;
  col: number;
  dataRows: number;
  from: string;
  to: string;
}

export interface UsageLayout {
  blocks: LayoutBlock[];
  charts: LayoutChart[];
  dataBars: Array<{ row: number; col: number; rows: number }>;
  note: string;
}

export interface LayoutRefs {
  entityName: string;
  itemName: string;
  quantityName: string;
  /** Absolute ranges of the source columns (data rows only), for example 'Data'!$J$2:$J$366379. */
  entity: string;
  item: string;
  quantity: string;
  unit?: string;
}

export function usageColumnLetter(index: number): string {
  let n = index;
  let out = "";
  do {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
}

const quote = (text: string) => `"${text.replace(/"/g, '""')}"`;

/** A live total for one unit group: each raw spelling is filtered and scaled on its own. */
function unitTotalFormula(
  refs: LayoutRefs,
  group: UnitGroup | undefined,
  scope?: string,
): string {
  if (!refs.unit || !group) {
    return scope
      ? `=IFERROR(SUM(FILTER(${refs.quantity},${scope})),0)`
      : `=SUM(${refs.quantity})`;
  }
  const parts = group.raw.map((entry) => {
    const test = `(${refs.unit}=${quote(entry.text)})`;
    const condition = scope ? `(${scope})*${test}` : test;
    const sum = `SUM(FILTER(${refs.quantity},${condition}))`;
    return entry.factor === 1 ? sum : `${entry.factor}*${sum}`;
  });
  return `=IFERROR(${parts.join("+")},0)`;
}

export function buildUsageLayout(
  result: UsageResult,
  refs: LayoutRefs,
  snapshotText: string,
): UsageLayout {
  const blocks: LayoutBlock[] = [];
  const charts: LayoutChart[] = [];
  const dataBars: UsageLayout["dataBars"] = [];
  const unitBlocks = result.units.slice(0, MAX_UNIT_BLOCKS);
  const hiddenUnits = result.units.slice(MAX_UNIT_BLOCKS);
  const entityLabel = refs.entityName;
  const itemLabel = refs.itemName;

  blocks.push({
    row: 0,
    col: 0,
    cells: [[`${entityLabel} ${itemLabel} usage dashboard`.toUpperCase()]],
    style: "title",
  });
  blocks.push({
    row: 1,
    col: 0,
    cells: [
      [
        `Totals and the lookup are live formulas over every row. The top tables are a snapshot taken ${snapshotText}.`,
      ],
    ],
    style: "subtitle",
  });

  // KPI row: label above value, one KPI every second column.
  const kpis: Array<{ label: string; formula: string }> = [
    {
      label: `${entityLabel}s`.toUpperCase(),
      formula: `=COUNTA(UNIQUE(FILTER(${refs.entity},${refs.entity}<>"")))`,
    },
    {
      label: `DISTINCT ${itemLabel}s`.toUpperCase(),
      formula: `=COUNTA(UNIQUE(FILTER(${refs.item},${refs.item}<>"")))`,
    },
    ...unitBlocks.map((group) => ({
      label: `${refs.quantityName} (${group.label})`.toUpperCase(),
      formula: unitTotalFormula(refs, group),
    })),
  ];
  kpis.forEach((kpi, index) => {
    blocks.push({
      row: 3,
      col: index * 2,
      cells: [[kpi.label]],
      style: "kpi-label",
    });
    blocks.push({
      row: 4,
      col: index * 2,
      cells: [[kpi.formula]],
      style: "kpi-value",
      numberFormat: index < 2 ? "#,##0" : "#,##0.00",
    });
  });

  // Lookup: type an entity and read its figures.
  blocks.push({
    row: 6,
    col: 0,
    cells: [
      [
        `${entityLabel.toUpperCase()} LOOKUP: type or paste a ${entityLabel} in B8`,
      ],
    ],
    style: "section",
  });
  const firstEntity =
    result.topByUnit[unitBlocks[0]?.label ?? ""]?.[0]?.entity ??
    result.topByItems[0]?.entity ??
    "";
  blocks.push({
    row: 7,
    col: 0,
    cells: [[entityLabel]],
    style: "lookup-label",
  });
  blocks.push({
    row: 7,
    col: 1,
    cells: [[firstEntity]],
    style: "input",
    text: true,
  });
  const scope = `${refs.entity}=$B$8`;
  const lookups: Array<{ label: string; formula: string; format: string }> = [
    {
      label: `${itemLabel}s`,
      formula: `=IFERROR(COUNTA(UNIQUE(FILTER(${refs.item},${scope}))),0)`,
      format: "#,##0",
    },
    ...unitBlocks.map((group) => ({
      label: `${refs.quantityName} (${group.label})`,
      formula: unitTotalFormula(refs, group, scope),
      format: "#,##0.00",
    })),
    {
      label: "Lines",
      formula: `=COUNTIFS(${refs.entity},$B$8)`,
      format: "#,##0",
    },
  ];
  lookups.forEach((entry, index) => {
    blocks.push({
      row: 7,
      col: 2 + index * 2,
      cells: [[entry.label]],
      style: "lookup-label",
    });
    blocks.push({
      row: 7,
      col: 3 + index * 2,
      cells: [[entry.formula]],
      style: "lookup-value",
      numberFormat: entry.format,
    });
  });

  // Top tables, side by side: one per unit, then the entities with the most distinct items.
  const tableTop = 9;
  let col = 0;
  const addTable = (
    heading: string,
    valueHeader: string,
    rows: Array<[string, number]>,
    withChart: boolean,
  ) => {
    blocks.push({ row: tableTop, col, cells: [[heading]], style: "section" });
    blocks.push({
      row: tableTop + 1,
      col,
      cells: [["Rank", entityLabel, valueHeader]],
      style: "table-header",
    });
    if (rows.length) {
      blocks.push({
        row: tableTop + 2,
        col,
        cells: rows.map(([name, value], index) => [index + 1, name, value]),
        style: "table-body",
        text: true,
      });
      dataBars.push({ row: tableTop + 2, col: col + 2, rows: rows.length });
      if (withChart)
        charts.push({
          title: heading,
          headerRow: tableTop + 1,
          col: col + 1,
          dataRows: rows.length,
          from: "A1",
          to: "A1",
        });
    }
    col += 4;
  };
  for (const group of unitBlocks)
    addTable(
      `Top ${result.topByUnit[group.label]?.length ?? 0} ${entityLabel}s by ${refs.quantityName} (${group.label})`,
      group.label,
      (result.topByUnit[group.label] ?? []).map((row) => [
        row.entity,
        row.quantity,
      ]),
      true,
    );
  addTable(
    `${entityLabel}s with the most distinct ${itemLabel}s`,
    `${itemLabel}s`,
    result.topByItems.map((row) => [row.entity, row.items]),
    false,
  );

  // Charts sit under the tables, two across; the writer places them from these corner cells.
  const chartTop = tableTop + 14;
  charts.forEach((chart, index) => {
    const startCol = (index % 2) * 8;
    const startRow = chartTop + Math.floor(index / 2) * 18;
    chart.from = `${usageColumnLetter(startCol)}${startRow + 1}`;
    chart.to = `${usageColumnLetter(startCol + 7)}${startRow + 17}`;
  });

  const note = [
    "Quantities of different units are never added together; metres are shown as kilometres.",
    result.skipped
      ? `${result.skipped.toLocaleString("en-US")} rows without a ${entityLabel}, ${itemLabel} or number were left out.`
      : "",
    hiddenUnits.length
      ? `Other units not shown: ${hiddenUnits.map((u) => `${u.label} (${u.total.toLocaleString("en-US")})`).join(", ")}.`
      : "",
  ]
    .filter(Boolean)
    .join(" ");
  blocks.push({ row: tableTop + 12, col: 0, cells: [[note]], style: "note" });

  return { blocks, charts, dataBars, note };
}
