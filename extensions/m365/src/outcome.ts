/**
 * A person-readable picture of what a plan will create. The raw plan stays available under
 * "Technical details"; this is what the preview card shows first: a headline, where it goes, the
 * exact rules that will be applied (formats, highlights, drop-downs) and a small visual built from
 * the person's own selected data. Nothing is simulated or invented.
 */

import { parseExpression } from "./expression.js";
import { previewExpressionValue } from "./previewValue.js";

export type OutcomeLanguage = "en" | "si" | "ta";

export interface OutcomeChart {
  type: string;
  categories: string[];
  series: Array<{ name: string; values: number[] }>;
}

export interface OutcomeTable {
  headers: string[];
  rows: string[][];
  /** Column positions (in `headers`) that get data bars, and their largest value. */
  barColumns: Array<{ index: number; max: number }>;
  /** Column positions that become a drop-down list. */
  dropdownColumns: number[];
}

export interface OutcomeItem {
  kind: string;
  title: string;
  where: string;
  details: string[];
  chart?: OutcomeChart;
  table?: OutcomeTable;
}

const MAX_POINTS = 12;
const MAX_TABLE_ROWS = 4;
const MAX_TABLE_COLUMNS = 5;

const KIND_TITLES: Record<string, [string, string]> = {
  chart: ["Chart", "ප්‍රස්තාරය"],
  "pivot-table": ["PivotTable", "PivotTable"],
  table: ["Formatted table", "හැඩසවි කළ වගුව"],
  "new-sheet": ["Result sheet", "ප්‍රතිඵල පත්‍රිකාව"],
  clean: ["Cleaned copy of the data", "පිරිසිදු කළ දත්ත පිටපත"],
  "add-column": ["Calculated column", "ගණනය කළ තීරුව"],
  view: ["Filtered view", "පෙරහන් කළ දසුන"],
  summary: ["Summary by group", "කණ්ඩායම් අනුව සාරාංශය"],
  format: ["Presentable copy", "ඉදිරිපත් කිරීමට සුදුසු පිටපත"],
  quality: ["Data quality report", "දත්ත ගුණාත්මක වාර්තාව"],
};

export function kindTitle(kind: string, language: OutcomeLanguage): string {
  const pair = KIND_TITLES[kind];
  if (!pair) return kind;
  return language === "si" ? pair[1] : pair[0];
}

function cell(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).slice(0, 24);
}

function numeric(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

const AGGREGATIONS: Record<string, [string, string]> = {
  sum: ["Total", "එකතුව"],
  average: ["Average", "සාමාන්‍යය"],
  count: ["Count", "ගණන"],
  min: ["Smallest", "කුඩාම"],
  max: ["Largest", "විශාලම"],
};

const CONDITIONAL: Record<string, [string, string]> = {
  "data-bars": ["data bars", "දත්ත තීරු (data bars)"],
  "color-scale": ["colour scale", "වර්ණ පරිමාණය"],
  negative: ["highlight negative values", "සෘණ අගයන් උද්දීපනය"],
  duplicates: ["highlight duplicates", "පුනරාවර්තන උද්දීපනය"],
};

export function buildOutcomes(
  actions: Array<{
    kind: string;
    targetSheet?: string;
    spec?: Record<string, any>;
  }>,
  headers: string[],
  rows: unknown[][],
  language: OutcomeLanguage = "en",
): OutcomeItem[] {
  const si = language === "si";
  const say = (en: string, sinhala: string) => (si ? sinhala : en);
  const agg = (name: string | undefined) => {
    const pair = AGGREGATIONS[name ?? "sum"] ?? AGGREGATIONS.sum;
    return si ? pair[1] : pair[0];
  };
  return actions.map((action) => {
    const spec = action.spec ?? {};
    const item: OutcomeItem = {
      kind: action.kind,
      title: kindTitle(action.kind, language),
      where: String(action.targetSheet ?? ""),
      details: [],
    };
    if (action.kind === "chart" && Number.isInteger(spec.valueIndex)) {
      const valueIndexes = [
        spec.valueIndex,
        ...(Array.isArray(spec.extraValueIndexes)
          ? spec.extraValueIndexes
          : []),
      ].filter((index) => Number.isInteger(index));
      const categoryIndex = Number.isInteger(spec.categoryIndex)
        ? spec.categoryIndex
        : 0;
      const slice = rows.slice(0, MAX_POINTS);
      item.chart = {
        type: String(spec.chartType ?? "column"),
        categories: slice.map((row) => cell(row[categoryIndex])),
        series: valueIndexes.map((index: number) => ({
          name: String(headers[index] ?? `Column ${index + 1}`),
          values: slice.map((row) => numeric(row[index])),
        })),
      };
      const names = item.chart.series.map((entry) => entry.name).join(", ");
      const by = headers[categoryIndex] ?? "";
      item.title = si
        ? `${kindTitle("chart", language)}: ${names} — ${by} අනුව`
        : `${item.chart.type[0].toUpperCase()}${item.chart.type.slice(1)} chart: ${names} by ${by}`;
      item.details.push(
        say(
          `Compares ${names} for each ${by}.`,
          `${by} එක් එකක් සඳහා ${names} සසඳයි.`,
        ),
      );
      return item;
    }

    const columns = Math.min(headers.length, MAX_TABLE_COLUMNS);
    const shownRows = rows.slice(0, MAX_TABLE_ROWS);
    const table: OutcomeTable = {
      headers: headers.slice(0, columns).map(cell),
      rows: shownRows.map((row) => row.slice(0, columns).map(cell)),
      barColumns: [],
      dropdownColumns: [],
    };
    item.table = table;

    if (action.kind === "format") {
      if (spec.freezeHeader)
        item.details.push(
          say(
            "The header row stays visible while you scroll.",
            "පහළට යන විට ශීර්ෂ පේළිය දිගටම පෙනේ.",
          ),
        );
      if (spec.autofit)
        item.details.push(
          say("Column widths fit their content.", "තීරු පළල අන්තර්ගතයට ගැළපේ."),
        );
      for (const entry of spec.columnFormats ?? [])
        item.details.push(
          say(
            `${entry.column}: number format ${entry.format}`,
            `${entry.column}: අංක ආකෘතිය ${entry.format}`,
          ),
        );
      for (const entry of spec.conditional ?? []) {
        const pair = CONDITIONAL[entry.rule] ?? [entry.rule, entry.rule];
        item.details.push(`${entry.column}: ${si ? pair[1] : pair[0]}`);
        if (entry.rule === "data-bars" && entry.index < columns) {
          const max = Math.max(
            1,
            ...rows.map((row) => numeric(row[entry.index])),
          );
          table.barColumns.push({ index: entry.index, max });
        }
      }
      for (const entry of spec.validation ?? []) {
        if (entry.rule === "list") {
          const values = (entry.values ?? []).slice(0, 8).join(", ");
          item.details.push(
            say(
              `${entry.column}: drop-down list (${values})`,
              `${entry.column}: පතන ලැයිස්තුව (${values})`,
            ),
          );
          if (entry.index < columns) table.dropdownColumns.push(entry.index);
        } else {
          item.details.push(
            say(
              `${entry.column}: only numbers 0 or higher are accepted`,
              `${entry.column}: 0 හෝ ඊට වැඩි සංඛ්‍යා පමණක් පිළිගනී`,
            ),
          );
        }
      }
      if (spec.totalRow)
        item.details.push(
          say(
            "A total row is added under the data.",
            "දත්ත යටින් එකතු පේළියක් එක් කෙරේ.",
          ),
        );
    } else if (action.kind === "pivot-table") {
      if (
        Number.isInteger(spec.rowsIndex) &&
        Number.isInteger(spec.valuesIndex)
      ) {
        // Show the answer itself: the grouped totals the PivotTable will contain.
        const aggregation = String(spec.aggregation ?? "sum");
        const groups = new Map<string, number[]>();
        for (const row of rows) {
          const key = cell(row[spec.rowsIndex]);
          const list = groups.get(key) ?? [];
          list.push(numeric(row[spec.valuesIndex]));
          groups.set(key, list);
        }
        const reduce = (values: number[]) => {
          if (aggregation === "count") return values.length;
          if (aggregation === "min") return Math.min(...values);
          if (aggregation === "max") return Math.max(...values);
          const total = values.reduce((sum, value) => sum + value, 0);
          return aggregation === "average" ? total / values.length : total;
        };
        const format = (value: number) => String(Math.round(value * 100) / 100);
        const label = `${agg(aggregation)} — ${spec.valuesColumn}`;
        const body = [...groups.entries()]
          .slice(0, 6)
          .map(([key, values]) => [key, format(reduce(values))]);
        const everything = [...groups.values()].flat();
        if (everything.length && aggregation !== "average")
          body.push([
            say("Grand total", "මුළු එකතුව"),
            format(reduce(everything)),
          ]);
        item.table = {
          headers: [String(spec.rowsColumn), label],
          rows: body,
          barColumns: [],
          dropdownColumns: [],
        };
      }
      if (!spec.rowsColumn || !spec.valuesColumn)
        item.details.push(
          say(
            "Summarizes your numbers by category in a PivotTable.",
            "ඔබේ සංඛ්‍යා කාණ්ඩ අනුව PivotTable එකක සාරාංශ කරයි.",
          ),
        );
      else
        item.details.push(
          say(
            `${agg(spec.aggregation)} of ${spec.valuesColumn} for each ${spec.rowsColumn}` +
              (spec.columnsColumn ? `, split by ${spec.columnsColumn}` : "") +
              (spec.filterColumn ? `, filter on ${spec.filterColumn}` : ""),
            `${spec.rowsColumn} එක් එකක් සඳහා ${spec.valuesColumn} හි ${agg(spec.aggregation)}` +
              (spec.columnsColumn ? `, ${spec.columnsColumn} අනුව බෙදා` : "") +
              (spec.filterColumn ? `, ${spec.filterColumn} මත පෙරහන` : ""),
          ),
        );
    } else if (action.kind === "summary") {
      const parts = (spec.summaryValues ?? [])
        .map((entry: any) => `${agg(entry.aggregation)} — ${entry.column}`)
        .join("; ");
      item.details.push(
        say(
          `Groups by ${spec.groupColumn}: ${(spec.groups ?? []).slice(0, 6).join(", ")}. ${parts}`,
          `${spec.groupColumn} අනුව කණ්ඩායම්: ${(spec.groups ?? []).slice(0, 6).join(", ")}. ${parts}`,
        ),
      );
      item.details.push(
        say(
          "Uses live formulas, so it updates when your data changes.",
          "සජීවී සූත්‍ර භාවිතා කරයි; දත්ත වෙනස් වන විට යාවත්කාලීන වේ.",
        ),
      );
    } else if (action.kind === "add-column" && spec.lookupSheet) {
      item.details.push(
        say(
          `Brings "${spec.lookupReturnHeader}" from sheet "${spec.lookupSheet}" by matching ${spec.sourceKeyColumn} with ${spec.lookupKeyHeader}.`,
          `"${spec.lookupSheet}" පත්‍රිකාවෙන් "${spec.lookupReturnHeader}" ගෙන එයි — ${spec.sourceKeyColumn} සහ ${spec.lookupKeyHeader} ගැළපීමෙන්.`,
        ),
      );
      item.details.push(
        say("Rows with no match stay blank.", "ගැළපීමක් නැති පේළි හිස්ව පවතී."),
      );
    } else if (action.kind === "add-column") {
      const how = spec.expression
        ? spec.expression
        : `${spec.leftColumn} ${spec.operator} ${spec.rightColumn}`;
      // Show the new column with its real values so the person sees the answer, not only a rule.
      try {
        if (spec.expression) {
          const parsed = parseExpression(String(spec.expression), headers);
          const kept = MAX_TABLE_COLUMNS - 1;
          table.headers = [
            ...table.headers.slice(0, kept),
            String(spec.columnName),
          ];
          table.rows = rows
            .slice(0, MAX_TABLE_ROWS)
            .map((row, at) => [
              ...table.rows[at].slice(0, kept),
              previewExpressionValue(parsed.ast, row as unknown[]) ?? "…",
            ]);
        }
      } catch {
        // The picture is optional; the rule line above still tells the story.
      }
      item.details.push(
        say(
          `New column "${spec.columnName}" = ${how}`,
          `නව තීරුව "${spec.columnName}" = ${how}`,
        ),
      );
    } else if (action.kind === "view") {
      if (spec.sort)
        item.details.push(
          say(
            `Sorted by ${spec.sort.column} (${spec.sort.direction === "desc" ? "largest first" : "smallest first"})`,
            `${spec.sort.column} අනුව පෙළගැස්වේ`,
          ),
        );
      if (spec.filter)
        item.details.push(
          say(
            `Only rows where ${spec.filter.column} ${spec.filter.operator} ${spec.filter.value}`,
            `${spec.filter.column} ${spec.filter.operator} ${spec.filter.value} වන පේළි පමණි`,
          ),
        );
      if (spec.highlight)
        item.details.push(
          say(
            `Highlights ${spec.highlight.rule} in ${spec.highlight.column}`,
            `${spec.highlight.column} හි ${spec.highlight.rule} උද්දීපනය`,
          ),
        );
    } else if (action.kind === "clean") {
      item.details.push(
        say(
          `Cleans a copy: ${(spec.operations ?? []).join(", ")}`,
          `පිටපතක් පිරිසිදු කරයි: ${(spec.operations ?? []).join(", ")}`,
        ),
      );
    } else if (action.kind === "quality") {
      item.details.push(
        say(
          "Checks blanks, duplicates, mixed text and numbers, extra spaces and outliers.",
          "හිස් කොටු, පුනරාවර්තන, මිශ්‍ර පෙළ සහ අංක, අමතර ඉඩ සහ අසාමාන්‍ය අගයන් පරීක්ෂා කරයි.",
        ),
      );
    } else if (action.kind === "table") {
      item.details.push(
        say(
          "Your range becomes an Excel table with filter buttons.",
          "ඔබේ පරාසය පෙරහන් බොත්තම් සහිත Excel වගුවක් වේ.",
        ),
      );
    }
    item.details.push(
      say(
        "Your original data is not changed.",
        "ඔබේ මූලාශ්‍ර දත්ත වෙනස් නොවේ.",
      ),
    );
    return item;
  });
}

/**
 * The sheet name an apply will really use: the planned name, or "<name> (2)", "(3)"... when that
 * sheet already exists. Used by the apply and by the preview so both show the same name.
 */
export function resolveSheetName(
  name: string,
  kind: string,
  sourceSheet: string,
  taken: Set<string>,
  maxLength = 31,
): string {
  if (kind === "table" || name === sourceSheet || !taken.has(name)) return name;
  const tag = name.match(/_Vynor_[A-Za-z]+$/)?.[0] ?? "";
  const stem = name.slice(0, name.length - tag.length);
  for (let attempt = 2; attempt < 100; attempt += 1) {
    const suffix = ` (${attempt})`;
    const room = maxLength - tag.length - suffix.length;
    const candidate = `${stem.slice(0, Math.max(1, room))}${tag}${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
  return name;
}
