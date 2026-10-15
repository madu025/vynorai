/**
 * A person-readable picture of what a plan will create. The raw plan stays available under
 * "Technical details"; this is what the preview card shows first: a headline, where it goes, the
 * exact rules that will be applied (formats, highlights, drop-downs) and a small visual built from
 * the person's own selected data. Nothing is simulated or invented.
 */

import { parseExpression } from "./expression.js";
import { previewExpressionValue } from "./previewValue.js";
import {
  correlation,
  describeColumns,
  linearForecast,
  numericSeries,
  buildInsightReportPreview,
} from "./statistics.js";

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
  statistics: ["Statistics", "සංඛ්‍යාලේඛන"],
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
  "icon-set": ["arrow icons (up, flat, down)", "ඊතල අයිකන (ඉහළ, සමාන, පහළ)"],
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
      const secondary = (spec.secondaryIndexes ?? []) as number[];
      if (secondary.length) {
        const slowNames = secondary
          .map((index) => String(headers[index] ?? index))
          .join(", ");
        item.details.push(
          say(
            `${slowNames} is on a second axis on the right, because its numbers are on a very different scale.`,
            `${slowNames} දකුණු දෙවන අක්ෂයේ පෙන්වයි; එහි සංඛ්‍යා ඉතා වෙනස් පරිමාණයක ඇත.`,
          ),
        );
      }
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
        } else if (entry.rule === "between") {
          item.details.push(
            say(
              `${entry.column}: only numbers from ${entry.min} to ${entry.max} are accepted`,
              `${entry.column}: ${entry.min} සිට ${entry.max} දක්වා සංඛ්‍යා පමණක් පිළිගනී`,
            ),
          );
        } else if (entry.rule === "max-length") {
          item.details.push(
            say(
              `${entry.column}: at most ${entry.max} characters`,
              `${entry.column}: උපරිම අකුරු ${entry.max}`,
            ),
          );
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
    } else if (action.kind === "clean") {
      const operations = (spec.operations ?? []) as string[];
      const labels = operations.map((operation) => {
        if (operation === "text-to-number")
          return say(
            "numbers stored as text",
            "à¶´à·à¶¨ à¶½à·™à·ƒ à¶­à·’à¶¶à·– à·ƒà¶‚à¶›à·Šâ€à¶ºà·",
          );
        if (operation === "text-to-date")
          return say(
            "unambiguous ISO text dates",
            "à¶±à·’à·€à·à¶»à¶¯à·’ ISO à¶´à·à¶¨ à¶¯à·’à¶±",
          );
        if (operation === "fill-blanks")
          return say(
            `blank cells with ${String(spec.fillBlanks)}`,
            `à·„à·’à·ƒà·Š à¶­à·“à¶»à·” ${String(spec.fillBlanks)} à·€à¶½à·’à¶±à·Š`,
          );
        if (operation === "dedupe")
          return say(
            "exact duplicate rows",
            "à·ƒà¶¸à·à¶± à¶´à·”à¶±à¶»à·à·€à¶»à·Šà¶­à¶± à¶´à·šà·…à·’",
          );
        return say("extra spaces", "අමතර හිස් ඉඩ");
      });
      if (labels.length)
        item.details.push(
          say(
            `Creates a cleaned copy: ${labels.join(", ")}.`,
            `පිරිසිදු පිටපතක් සාදයි: ${labels.join(", ")}.`,
          ),
        );
      if (operations.includes("text-to-date"))
        item.details.push(
          say(
            "Only YYYY-MM-DD dates convert; ambiguous dates remain text.",
            "YYYY-MM-DD දින පමණක් පරිවර්තනය වේ; සැක සහිත දින පාඨ ලෙස පවතී.",
          ),
        );
    } else if (action.kind === "pivot-table") {
      if (
        Number.isInteger(spec.rowsIndex) &&
        Number.isInteger(spec.valuesIndex)
      ) {
        // Show the answer itself: the grouped numbers the PivotTable will contain.
        const aggregation = String(spec.aggregation ?? "sum");
        const valueIndexes: number[] = [
          spec.valuesIndex,
          ...((spec.extraValuesIndexes ?? []) as number[]),
        ];
        const groups = new Map<string, number[][]>();
        for (const row of rows) {
          const key = cell(row[spec.rowsIndex]);
          const list =
            groups.get(key) ?? valueIndexes.map(() => [] as number[]);
          valueIndexes.forEach((index, at) =>
            list[at].push(numeric(row[index])),
          );
          groups.set(key, list);
        }
        const reduce = (values: number[]) => {
          if (!values.length) return 0;
          if (aggregation === "count") return values.length;
          if (aggregation === "min") return Math.min(...values);
          if (aggregation === "max") return Math.max(...values);
          const total = values.reduce((sum, value) => sum + value, 0);
          return aggregation === "average" ? total / values.length : total;
        };
        const share = spec.showAs === "percent-of-total";
        const format = (value: number) => String(Math.round(value * 100) / 100);
        const keys = [...groups.keys()].slice(0, 6);
        const totals = valueIndexes.map((_, at) =>
          reduce([...groups.values()].flatMap((list) => list[at])),
        );
        const body = keys.map((key) => [
          key,
          ...valueIndexes.map((_, at) => {
            const value = reduce(groups.get(key)![at]);
            return share && totals[at]
              ? `${Math.round((value / totals[at]) * 1000) / 10}%`
              : format(value);
          }),
        ]);
        if (aggregation !== "average")
          body.push([
            say("Grand total", "මුළු එකතුව"),
            ...totals.map((value) => (share ? "100%" : format(value))),
          ]);
        const names = [spec.valuesColumn, ...(spec.extraValuesColumns ?? [])];
        item.table = {
          headers: [
            String(spec.rowsColumn),
            ...names.map((name: string) => `${agg(aggregation)} — ${name}`),
          ],
          rows: body,
          barColumns: [],
          dropdownColumns: [],
        };
        if (share)
          item.details.push(
            say(
              "Values are shown as a share of the grand total.",
              "අගයන් මුළු එකතුවේ කොටසක් ලෙස පෙන්වයි.",
            ),
          );
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
      const how =
        spec.derived === "running-total"
          ? `Running total of ${spec.sourceColumn}`
          : spec.derived === "rank"
            ? `Rank of ${spec.sourceColumn} (highest first)`
            : spec.derived === "percent-change"
              ? `Percent change of ${spec.sourceColumn} (row over row)`
              : spec.derived === "moving-average"
                ? `${spec.window}-period moving average of ${spec.sourceColumn}`
                : spec.derived === "yoy"
                  ? `YoY change of ${spec.sourceColumn}`
                  : spec.derived === "date-group"
                    ? `${spec.group} grouping of ${spec.sourceColumn}`
                    : spec.derived === "combine"
                      ? `${spec.sourceColumn} combined with ${spec.sourceColumn2}`
                      : spec.expression
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
        } else if (
          spec.derived === "running-total" &&
          spec.sourceColumn &&
          Number.isInteger(spec.sourceIndex)
        ) {
          const source = spec.sourceIndex as number;
          const kept = MAX_TABLE_COLUMNS - 1;
          let total = 0;
          table.headers = [
            ...table.headers.slice(0, kept),
            String(spec.columnName),
          ];
          table.rows = rows.slice(0, MAX_TABLE_ROWS).map((row, at) => {
            const value = Number(row[source]);
            if (!Number.isFinite(value))
              return [...table.rows[at].slice(0, kept), "…"];
            total += value;
            return [
              ...table.rows[at].slice(0, kept),
              String(Math.round(total * 100) / 100),
            ];
          });
        } else if (
          spec.derived === "rank" &&
          spec.sourceColumn &&
          Number.isInteger(spec.sourceIndex)
        ) {
          const source = spec.sourceIndex as number;
          const values = rows.map((row) => Number(row[source]));
          const kept = MAX_TABLE_COLUMNS - 1;
          table.headers = [
            ...table.headers.slice(0, kept),
            String(spec.columnName),
          ];
          table.rows = rows.slice(0, MAX_TABLE_ROWS).map((row, at) => {
            const value = Number(row[source]);
            if (!Number.isFinite(value))
              return [...table.rows[at].slice(0, kept), "…"];
            const rank =
              1 + values.filter((candidate) => candidate > value).length;
            return [...table.rows[at].slice(0, kept), String(rank)];
          });
        } else if (
          spec.derived === "percent-change" &&
          spec.sourceColumn &&
          Number.isInteger(spec.sourceIndex)
        ) {
          const source = spec.sourceIndex as number;
          const kept = MAX_TABLE_COLUMNS - 1;
          table.headers = [
            ...table.headers.slice(0, kept),
            String(spec.columnName),
          ];
          table.rows = rows.slice(0, MAX_TABLE_ROWS).map((row, at) => {
            if (at === 0) return [...table.rows[at].slice(0, kept), "—"];
            const current = Number(row[source]);
            const previous = Number(rows[at - 1][source]);
            if (
              !Number.isFinite(current) ||
              !Number.isFinite(previous) ||
              previous === 0
            )
              return [...table.rows[at].slice(0, kept), "…"];
            return [
              ...table.rows[at].slice(0, kept),
              `${Math.round(((current - previous) / previous) * 1000) / 10}%`,
            ];
          });
        } else if (
          spec.derived === "moving-average" &&
          spec.sourceColumn &&
          Number.isInteger(spec.sourceIndex) &&
          Number.isInteger(spec.window)
        ) {
          const source = spec.sourceIndex as number;
          const window = spec.window as number;
          const kept = MAX_TABLE_COLUMNS - 1;
          table.headers = [
            ...table.headers.slice(0, kept),
            String(spec.columnName),
          ];
          table.rows = rows.slice(0, MAX_TABLE_ROWS).map((row, at) => {
            if (at < window - 1) return [...table.rows[at].slice(0, kept), "—"];
            const values = rows
              .slice(at - window + 1, at + 1)
              .map((entry) => Number(entry[source]));
            if (values.some((value) => !Number.isFinite(value)))
              return [...table.rows[at].slice(0, kept), "…"];
            const average =
              values.reduce((sum, value) => sum + value, 0) / window;
            return [
              ...table.rows[at].slice(0, kept),
              String(Math.round(average * 100) / 100),
            ];
          });
        } else if (
          spec.derived === "yoy" &&
          spec.sourceColumn &&
          Number.isInteger(spec.sourceIndex) &&
          Number.isInteger(spec.lag)
        ) {
          const source = spec.sourceIndex as number;
          const lag = spec.lag as number;
          const kept = MAX_TABLE_COLUMNS - 1;
          table.headers = [
            ...table.headers.slice(0, kept),
            String(spec.columnName),
          ];
          table.rows = rows.slice(0, MAX_TABLE_ROWS).map((row, at) => {
            if (at < lag) return [...table.rows[at].slice(0, kept), "—"];
            const current = Number(row[source]);
            const previous = Number(rows[at - lag][source]);
            if (
              !Number.isFinite(current) ||
              !Number.isFinite(previous) ||
              previous === 0
            )
              return [...table.rows[at].slice(0, kept), "…"];
            return [
              ...table.rows[at].slice(0, kept),
              `${Math.round(((current - previous) / previous) * 1000) / 10}%`,
            ];
          });
        } else if (
          spec.derived === "date-group" &&
          spec.sourceColumn &&
          Number.isInteger(spec.sourceIndex) &&
          ["month", "quarter", "year"].includes(String(spec.group))
        ) {
          const source = spec.sourceIndex as number;
          const group = spec.group as "month" | "quarter" | "year";
          const kept = MAX_TABLE_COLUMNS - 1;
          const groupDate = (value: unknown) => {
            const numericValue = Number(value);
            const date = Number.isFinite(numericValue)
              ? new Date(Date.UTC(1899, 11, 30) + numericValue * 86400000)
              : new Date(String(value));
            if (Number.isNaN(date.getTime())) return "…";
            if (group === "year") return String(date.getUTCFullYear());
            if (group === "quarter")
              return `Q${Math.floor(date.getUTCMonth() / 3) + 1} ${date.getUTCFullYear()}`;
            return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
          };
          table.headers = [
            ...table.headers.slice(0, kept),
            String(spec.columnName),
          ];
          table.rows = rows
            .slice(0, MAX_TABLE_ROWS)
            .map((row, at) => [
              ...table.rows[at].slice(0, kept),
              groupDate(row[source]),
            ]);
        } else if (
          spec.derived === "combine" &&
          spec.sourceColumn &&
          spec.sourceColumn2 &&
          Number.isInteger(spec.sourceIndex) &&
          Number.isInteger(spec.sourceIndex2)
        ) {
          const first = spec.sourceIndex as number;
          const second = spec.sourceIndex2 as number;
          const kept = MAX_TABLE_COLUMNS - 1;
          table.headers = [
            ...table.headers.slice(0, kept),
            String(spec.columnName),
          ];
          table.rows = rows.slice(0, MAX_TABLE_ROWS).map((row, at) => {
            const left = row[first] == null ? "" : String(row[first]);
            const right = row[second] == null ? "" : String(row[second]);
            return [
              ...table.rows[at].slice(0, kept),
              left && right ? `${left} - ${right}` : left || right,
            ];
          });
        } else if (spec.leftColumn && spec.rightColumn && spec.operator) {
          const left = headers.indexOf(String(spec.leftColumn));
          const right = headers.indexOf(String(spec.rightColumn));
          if (left >= 0 && right >= 0) {
            const kept = MAX_TABLE_COLUMNS - 1;
            const compute = (row: unknown[]) => {
              const x = Number(row[left]);
              const y = Number(row[right]);
              if (!Number.isFinite(x) || !Number.isFinite(y)) return "…";
              const value =
                spec.operator === "+"
                  ? x + y
                  : spec.operator === "-"
                    ? x - y
                    : spec.operator === "*"
                      ? x * y
                      : y === 0
                        ? "#DIV/0!"
                        : x / y;
              return typeof value === "number"
                ? String(Math.round(value * 100) / 100)
                : value;
            };
            table.headers = [
              ...table.headers.slice(0, kept),
              String(spec.columnName),
            ];
            table.rows = rows
              .slice(0, MAX_TABLE_ROWS)
              .map((row, at) => [
                ...table.rows[at].slice(0, kept),
                compute(row as unknown[]),
              ]);
          }
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
            spec.highlight.rule === "top-n" ||
              spec.highlight.rule === "bottom-n"
              ? `Highlights the ${spec.highlight.rule === "top-n" ? "top" : "bottom"} ${spec.highlight.n ?? 1} in ${spec.highlight.column}`
              : `Highlights ${spec.highlight.rule} in ${spec.highlight.column}`,
            `${spec.highlight.column} හි ${spec.highlight.rule} උද්දීපනය`,
          ),
        );
      if (spec.limit)
        item.details.push(
          say(
            `Shows only the first ${spec.limit} rows`,
            `පළමු පේළි ${spec.limit} පමණක් පෙන්වයි`,
          ),
        );
    } else if (action.kind === "clean") {
      item.details.push(
        say(
          `Cleans a copy: ${(spec.operations ?? []).join(", ")}`,
          `පිටපතක් පිරිසිදු කරයි: ${(spec.operations ?? []).join(", ")}`,
        ),
      );
    } else if (action.kind === "dashboard" && spec.dashboard) {
      const dashboard = spec.dashboard as {
        category: { column: string; index: number };
        values: Array<{ column: string; index: number }>;
        aggregation: string;
      };
      const groups = new Map<string, number[][]>();
      for (const row of rows) {
        const key = cell(row[dashboard.category.index]);
        if (!key) continue;
        const values =
          groups.get(key) ?? dashboard.values.map(() => [] as number[]);
        dashboard.values.forEach((entry, index) =>
          values[index].push(numeric(row[entry.index])),
        );
        groups.set(key, values);
      }
      const aggregate = (values: number[]) => {
        if (!values.length) return 0;
        if (dashboard.aggregation === "count") return values.length;
        if (dashboard.aggregation === "average")
          return values.reduce((sum, value) => sum + value, 0) / values.length;
        if (dashboard.aggregation === "min") return Math.min(...values);
        if (dashboard.aggregation === "max") return Math.max(...values);
        return values.reduce((sum, value) => sum + value, 0);
      };
      const categories = [...groups.keys()].slice(0, MAX_POINTS);
      item.title = say(
        `Dashboard: ${dashboard.values.map((entry) => entry.column).join(", ")} by ${dashboard.category.column}`,
        `දත්ත පුවරුව: ${dashboard.category.column} අනුව`,
      );
      item.chart = {
        type: "column",
        categories,
        series: dashboard.values.map((entry, index) => ({
          name: entry.column,
          values: categories.map((key) => aggregate(groups.get(key)![index])),
        })),
      };
      item.table = {
        headers: [say("KPI", "දර්ශකය"), say("Value", "අගය")],
        rows: [
          [say("Data rows", "දත්ත පේළි"), String(rows.length)],
          ...dashboard.values.flatMap((entry) => {
            const numbers = rows.map((row) => numeric(row[entry.index]));
            const total = numbers.reduce((sum, value) => sum + value, 0);
            return [
              [`${say("Total", "එකතුව")} ${entry.column}`, String(total)],
              [
                `${say("Average", "සාමාන්‍යය")} ${entry.column}`,
                String(
                  numbers.length
                    ? Math.round((total / numbers.length) * 100) / 100
                    : 0,
                ),
              ],
            ];
          }),
        ].slice(0, MAX_TABLE_ROWS),
        barColumns: [],
        dropdownColumns: [],
      };
      item.details.push(
        say(
          "One new result sheet with live KPI formulas, one chart per value column, and a PivotTable. Your original data is not changed.",
          "සජීවී KPI සූත්‍ර, අගය තීරුවකට ප්‍රස්ථාරයක් සහ PivotTable එකක් ඇති අලුත් ප්‍රතිඵල පත්‍රිකාවක්.",
        ),
      );
    } else if (action.kind === "statistics" && spec.statistics) {
      const stats = spec.statistics;
      if (stats.mode === "describe") {
        const columns = (stats.columns ?? []) as Array<{
          column: string;
          index: number;
        }>;
        const measures = describeColumns(
          rows as any,
          columns.map((entry) => entry.index),
        );
        item.table = {
          headers: ["Measure", ...columns.map((entry) => entry.column)],
          rows: measures.map((entry) => [
            entry.measure,
            ...entry.values.map((value) => String(value)),
          ]),
          barColumns: [],
          dropdownColumns: [],
        };
        item.details.push(
          say(
            "Live formulas: they update when your data changes.",
            "සජීවී සූත්‍ර: දත්ත වෙනස් වන විට යාවත්කාලීන වේ.",
          ),
        );
      } else if (stats.mode === "correlation") {
        const pair = (stats.pair ?? []) as Array<{
          column: string;
          index: number;
        }>;
        const result = correlation(rows as any, pair[0].index, pair[1].index);
        item.table = {
          headers: ["Pair", "Correlation (r)", "R squared"],
          rows: [
            [
              `${pair[0].column} and ${pair[1].column}`,
              String(result.r),
              String(result.rSquared),
            ],
          ],
          barColumns: [],
          dropdownColumns: [],
        };
        const strength =
          typeof result.r === "number"
            ? Math.abs(result.r) >= 0.7
              ? "strong"
              : Math.abs(result.r) >= 0.4
                ? "moderate"
                : "weak"
            : "";
        if (strength && typeof result.r === "number")
          item.details.push(
            say(
              `A ${strength} ${result.r > 0 ? "positive" : "negative"} relationship`,
              `${strength === "strong" ? "ශක්තිමත්" : strength === "moderate" ? "මධ්‍යම" : "දුර්වල"} ${(result.r as number) > 0 ? "ධනාත්මක" : "ඍණාත්මක"} සම්බන්ධයක්`,
            ),
          );
      } else if (stats.mode === "forecast") {
        const value = stats.value as { column: string; index: number };
        const periods = Number(stats.periods ?? 3);
        const known = numericSeries(rows as any, value.index);
        const next = linearForecast(known, periods);
        item.table = {
          headers: ["Period", `Forecast ${value.column}`],
          rows: next.map((entry, at) => [
            String(known.length + at + 1),
            String(entry),
          ]),
          barColumns: [],
          dropdownColumns: [],
        };
        item.details.push(
          say(
            `A straight-line trend through ${known.length} values, extended ${periods} periods.`,
            `අගයන් ${known.length} හරහා සරල රේඛා ප්‍රවණතාවක්, කාල පරිච්ඡේද ${periods} දක්වා දිගු කර ඇත.`,
          ),
        );
      } else {
        const value = stats.value as { column: string; index: number };
        const preview = buildInsightReportPreview(
          rows as any,
          headers,
          value.index,
          stats.category?.index,
          stats.date?.index,
        );
        item.title = say(
          "Deterministic insight report",
          "නිශ්චිත අවබෝධතා වාර්තාව",
        );
        item.table = {
          headers: preview.headers,
          rows: preview.rows,
          barColumns: [],
          dropdownColumns: [],
        };
        item.details.push(
          say(
            "Writes live formulas for change, trend, IQR anomalies and contributors. Nothing is sent to AI.",
            "වෙනස, ප්‍රවණතාව, IQR අසාමාන්‍යතා සහ දායකයන් සඳහා සජීවී සූත්‍ර ලියයි. AI වෙත කිසිවක් නොයැවේ.",
          ),
        );
      }
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
  if (name === sourceSheet || !taken.has(name)) return name;
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

const KIND_PREFIX: Record<string, string> = {
  clean: "Cleaned",
  format: "Formatted",
  view: "View of",
  quality: "Quality of",
  statistics: "Statistics of",
  summary: "Summary of",
  dashboard: "Dashboard of",
  "add-column": "Calc of",
  "new-sheet": "Result of",
  table: "Table of",
};

/**
 * A readable result-sheet name ("Sales by Month", "Pivot - Sales by Region") instead of the
 * internal "<Sheet>_Vynor_Result". Names that are not the add-in's own stay untouched.
 */
export function friendlySheetName(
  action: { kind: string; targetSheet: string; spec?: any },
  sourceSheet: string,
): string {
  const planned = String(action.targetSheet ?? "");
  if (planned === sourceSheet || !/_Vynor_[A-Za-z]+$/.test(planned))
    return planned;
  const spec = action.spec ?? {};
  let label = "";
  if (action.kind === "chart" && spec.valueColumn && spec.categoryColumn)
    label = `${[spec.valueColumn, ...(spec.extraValueColumns ?? [])].join(" & ")} by ${spec.categoryColumn}`;
  else if (
    action.kind === "pivot-table" &&
    spec.valuesColumn &&
    spec.rowsColumn
  )
    label = `Pivot - ${spec.valuesColumn} by ${spec.rowsColumn}`;
  else if (action.kind === "statistics" && spec.statistics?.mode === "forecast")
    label = `Forecast of ${spec.statistics.value?.column ?? sourceSheet}`;
  else if (action.kind === "statistics" && spec.statistics?.mode === "insights")
    label = `Insights of ${spec.statistics.value?.column ?? sourceSheet}`;
  else if (action.kind === "dashboard" && spec.dashboard)
    label = `Dashboard ${spec.dashboard.values?.map((entry: any) => entry.column).join("-") ?? sourceSheet} ${spec.dashboard.category?.column ?? sourceSheet}`;
  else if (
    action.kind === "statistics" &&
    spec.statistics?.mode === "correlation"
  )
    label = `Correlation ${spec.statistics.pair?.map((entry: any) => entry.column).join(" and ") ?? ""}`;
  else if (action.kind === "chart") label = `Chart of ${sourceSheet}`;
  else if (action.kind === "pivot-table") label = `Pivot of ${sourceSheet}`;
  else label = `${KIND_PREFIX[action.kind] ?? "Result of"} ${sourceSheet}`;
  const clean = label
    .replace(/[\/?*[\]:]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return (clean || planned).slice(0, 27).trim();
}

/** friendlySheetName made unique among the sheets that already exist: "Name", "Name (2)", ... */
export function plannedSheetName(
  action: { kind: string; targetSheet: string; spec?: any },
  sourceSheet: string,
  taken: Set<string>,
  maxLength = 31,
): string {
  const base = friendlySheetName(action, sourceSheet);
  if (
    base === sourceSheet ||
    !/_Vynor_[A-Za-z]+$/.test(String(action.targetSheet ?? ""))
  )
    return resolveSheetName(base, action.kind, sourceSheet, taken, maxLength);
  if (!taken.has(base)) return base;
  for (let attempt = 2; attempt < 100; attempt += 1) {
    const suffix = ` (${attempt})`;
    const candidate = `${base.slice(0, maxLength - suffix.length)}${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
  return base;
}
