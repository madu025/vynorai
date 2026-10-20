/**
 * A person-readable picture of what a plan will create. The raw plan stays available under
 * "Technical details"; this is what the preview card shows first: a headline, where it goes, the
 * exact rules that will be applied (formats, highlights, drop-downs) and a small visual built from
 * the person's own selected data. Nothing is simulated or invented.
 */

import { UsageAccumulator } from "./usageDashboard.js";
import { parseExpression } from "./expression.js";
import { previewExpressionValue } from "./previewValue.js";
import {
  correlation,
  describeColumns,
  linearForecast,
  numericSeries,
  buildInsightReportPreview,
} from "./statistics.js";
import {
  advancedForecast,
  findAnomalies,
  financialMetrics,
} from "./advancedAnalytics.js";

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

export const KIND_TITLES: Record<string, [string, string, string]> = {
  unpivot: ["Unpivoted long table", "දිගු ආකෘති වගුව", "நீண்ட வடிவ அட்டவணை"],
  chart: ["Chart", "ප්‍රස්තාරය", "வரைபடம்"],
  "pivot-table": ["PivotTable", "PivotTable", "PivotTable"],
  "named-range": ["Named range", "නම් කළ පරාසය", "பெயரிடப்பட்ட வரம்பு"],
  slicer: ["Slicer", "පෙරහන් පාලකය", "Slicer வடிகட்டி"],
  table: ["Formatted table", "හැඩසවි කළ වගුව", "வடிவமைத்த அட்டவணை"],
  "new-sheet": ["Result sheet", "ප්‍රතිඵල පත්‍රිකාව", "முடிவுத் தாள்"],
  clean: [
    "Cleaned copy of the data",
    "පිරිසිදු කළ දත්ත පිටපත",
    "சுத்தம் செய்த தரவு நகல்",
  ],
  "add-column": ["Calculated column", "ගණනය කළ තීරුව", "கணக்கிடப்பட்ட நிரல்"],
  view: ["Filtered view", "පෙරහන් කළ දසුන", "வடிகட்டிய காட்சி"],
  summary: [
    "Summary by group",
    "කණ්ඩායම් අනුව සාරාංශය",
    "குழு வாரியான சுருக்கம்",
  ],
  format: [
    "Presentable copy",
    "ඉදිරිපත් කිරීමට සුදුසු පිටපත",
    "முன்வைக்கத் தகுந்த நகல்",
  ],
  quality: [
    "Data quality report",
    "දත්ත ගුණාත්මක වාර්තාව",
    "தரவுத் தர அறிக்கை",
  ],
  statistics: ["Statistics", "සංඛ්‍යාලේඛන", "புள்ளிவிபரங்கள்"],
  "lookup-columns": ["Lookup columns", "Lookup columns", "Lookup columns"],
  "export-csv": ["CSV export", "CSV අපනයනය", "CSV ஏற்றுமதி"],
  "export-pdf": ["PDF export", "PDF අපනයනය", "PDF ஏற்றுமதி"],
};

/** The text of an [English, Sinhala, Tamil] triple for the language. */
function pick(
  triple: readonly [string, string, string],
  language: OutcomeLanguage,
): string {
  return language === "si"
    ? triple[1]
    : language === "ta"
      ? triple[2]
      : triple[0];
}

export function kindTitle(kind: string, language: OutcomeLanguage): string {
  const triple = KIND_TITLES[kind];
  if (!triple) return kind;
  return pick(triple, language);
}

function cell(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).slice(0, 24);
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** Excel keeps dates as day numbers; a date column in a picture shows 04-Mar-25, not 45720.96. */
function dateColumns(headers: string[], rows: unknown[][]): Set<number> {
  const found = new Set<number>();
  headers.forEach((header, index) => {
    if (!/date|time|\bday\b/i.test(String(header))) return;
    const values = rows
      .map((row) => row[index])
      .filter((value) => value !== null && value !== undefined && value !== "");
    if (
      values.length &&
      values.every(
        (value) => typeof value === "number" && value > 20000 && value < 80000,
      )
    )
      found.add(index);
  });
  return found;
}

function dateCell(value: unknown): string {
  if (typeof value !== "number") return cell(value);
  const date = new Date(Math.round((Math.floor(value) - 25569) * 86400000));
  return `${String(date.getUTCDate()).padStart(2, "0")}-${MONTHS[date.getUTCMonth()]}-${String(date.getUTCFullYear()).slice(2)}`;
}

function numeric(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

const AGGREGATIONS: Record<string, [string, string, string]> = {
  sum: ["Total", "එකතුව", "மொத்தம்"],
  average: ["Average", "සාමාන්‍යය", "சராசரி"],
  count: ["Count", "ගණන", "எண்ணிக்கை"],
  min: ["Smallest", "කුඩාම", "மிகச் சிறியது"],
  max: ["Largest", "විශාලම", "மிகப் பெரியது"],
};

const CONDITIONAL: Record<string, [string, string, string]> = {
  "date-range": [
    "highlight dates in range",
    "දින පරාසය උද්දීපනය",
    "திகதி வரம்பைச் சிறப்பித்தல்",
  ],
  "text-contains": [
    "highlight matching text",
    "ගැළපෙන පෙළ උද්දීපනය",
    "பொருந்தும் உரையைச் சிறப்பித்தல்",
  ],
  "custom-formula": [
    "custom numeric formula",
    "අභිරුචි සංඛ්‍යාත්මක සූත්‍රය",
    "தனிப்பயன் எண் சூத்திரம்",
  ],
  "top-n": [
    "highlight top values",
    "ඉහළම අගයන් උද්දීපනය",
    "உயர்ந்த மதிப்புகளைச் சிறப்பித்தல்",
  ],
  "bottom-n": [
    "highlight bottom values",
    "පහළම අගයන් උද්දීපනය",
    "குறைந்த மதிப்புகளைச் சிறப்பித்தல்",
  ],
  "data-bars": [
    "data bars",
    "දත්ත තීරු (data bars)",
    "தரவுப் பட்டைகள் (data bars)",
  ],
  "color-scale": ["colour scale", "වර්ණ පරිමාණය", "வண்ண அளவுகோல்"],
  negative: [
    "highlight negative values",
    "සෘණ අගයන් උද්දීපනය",
    "எதிர்மறை மதிப்புகளைச் சிறப்பித்தல்",
  ],
  "icon-set": [
    "arrow icons (up, flat, down)",
    "ඊතල අයිකන (ඉහළ, සමාන, පහළ)",
    "அம்புக்குறி ஐகான்கள் (மேல், சமம், கீழ்)",
  ],
  duplicates: [
    "highlight duplicates",
    "පුනරාවර්තන උද්දීපනය",
    "நகல்களைச் சிறப்பித்தல்",
  ],
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
  const say = (en: string, sinhala: string, tamil: string) =>
    pick([en, sinhala, tamil], language);
  const agg = (name: string | undefined) =>
    pick(AGGREGATIONS[name ?? "sum"] ?? AGGREGATIONS.sum, language);
  return actions.map((action) => {
    const spec = action.spec ?? {};
    const item: OutcomeItem = {
      kind: action.kind,
      title: kindTitle(action.kind, language),
      where: String(action.targetSheet ?? ""),
      details: [],
    };
    if (action.kind === "slicer") {
      const column = String(spec.slicerColumn ?? "selected field");
      item.details.push(
        say(
          `Creates a ${column} slicer on a copied result table; source data stays unchanged. ExcelApi 1.10 or later is required.`,
          `${column} සඳහා පෙරහන් පාලකයක් නව copy table එකක සාදයි; මුල් දත්ත වෙනස් නොවේ. ExcelApi 1.10 හෝ පසු version එක අවශ්‍යයි.`,
          `${column} க்கான Slicer ஒன்றை நகலெடுத்த முடிவு அட்டவணையில் உருவாக்கும்; மூலத் தரவு மாறாது. ExcelApi 1.10 அல்லது அதற்குப் பிந்திய பதிப்பு தேவை.`,
        ),
      );
      return item;
    }
    if (action.kind === "unpivot") {
      const valueIndexes = Array.isArray(spec.unpivotValueIndexes)
        ? spec.unpivotValueIndexes.filter((index: unknown) =>
            Number.isInteger(index),
          )
        : [];
      const dimensions = headers
        .map((header, index) => ({ header, index }))
        .filter(({ index }) => !valueIndexes.includes(index));
      const previewRows: string[][] = [];
      for (const row of rows.slice(0, MAX_TABLE_ROWS)) {
        for (const index of valueIndexes) {
          previewRows.push([
            ...dimensions.map(({ index: dimensionIndex }) =>
              cell(row[dimensionIndex]),
            ),
            cell(headers[index]),
            cell(row[index]),
          ]);
        }
      }
      item.table = {
        headers: [
          ...dimensions.map(({ header }) => cell(header)),
          String(spec.unpivotNameColumn ?? "Name"),
          String(spec.unpivotValueColumn ?? "Value"),
        ],
        rows: previewRows.slice(0, MAX_TABLE_ROWS),
        barColumns: [],
        dropdownColumns: [],
      };
      item.details.push(
        say(
          `Turns ${valueIndexes.length} value columns into long-format rows; source data stays unchanged.`,
          `Unpivot ${valueIndexes.length} value columns into long-format rows; source data stays unchanged.`,
          `${valueIndexes.length} மதிப்பு நிரல்களை நீண்ட வடிவ வரிசைகளாக மாற்றும்; மூலத் தரவு மாறாது.`,
        ),
      );
      return item;
    }
    if (action.kind === "export-csv") {
      item.details.push(
        say(
          "Copies the selected data to a new VynorAI result sheet and downloads a sanitized CSV after confirmation. Source data stays unchanged.",
          "තෝරාගත් දත්ත නව VynorAI ප්‍රතිඵල පත්‍රයකට පිටපත් කර, තහවුරු කළ පසු ආරක්ෂිත CSV ගොනුවක් බාගත කරයි. මුල් දත්ත වෙනස් නොවේ.",
          "தெரிந்தெடுத்த தரவை புதிய VynorAI முடிவுத் தாளுக்கு நகலெடுத்து, உறுதிப்படுத்திய பின் பாதுகாப்பான CSV கோப்பைப் பதிவிறக்கும். மூலத் தரவு மாறாது.",
        ),
      );
      return item;
    }
    if (action.kind === "export-pdf") {
      item.details.push(
        say(
          "Copies the selected data to a new VynorAI result sheet and downloads a PDF of the workbook after confirmation. Source data stays unchanged.",
          "තෝරාගත් දත්ත නව VynorAI ප්‍රතිඵල පත්‍රයකට පිටපත් කර, තහවුරු කළ පසු workbook එකේ PDF එකක් බාගත කරයි. මුල් දත්ත වෙනස් නොවේ.",
          "தெரிந்தெடுத்த தரவை புதிய VynorAI முடிவுத் தாளுக்கு நகலெடுத்து, உறுதிப்படுத்திய பின் workbook இன் PDF ஒன்றைப் பதிவிறக்கும். மூலத் தரவு மாறாது.",
        ),
      );
      return item;
    }
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
      const isHistogram = spec.chartType === "histogram";
      item.chart = {
        type: String(spec.chartType ?? "column"),
        categories: isHistogram
          ? slice.map((_, index) => String(index + 1))
          : slice.map((row) => cell(row[categoryIndex])),
        series: valueIndexes.map((index: number) => ({
          name: String(headers[index] ?? `Column ${index + 1}`),
          values: slice.map((row) => numeric(row[index])),
        })),
      };
      const names = item.chart.series.map((entry) => entry.name).join(", ");
      const by = headers[categoryIndex] ?? "";
      item.title =
        language === "si"
          ? `${kindTitle("chart", language)}: ${names} — ${by} අනුව`
          : language === "ta"
            ? `${kindTitle("chart", language)}: ${names} — ${by} வாரியாக`
            : isHistogram
              ? `Histogram preview: ${names}`
              : `${item.chart.type[0].toUpperCase()}${item.chart.type.slice(1)} chart: ${names} by ${by}`;
      item.details.push(
        say(
          `Compares ${names} for each ${by}.`,
          `${by} එක් එකක් සඳහා ${names} සසඳයි.`,
          `ஒவ்வொரு ${by} க்கும் ${names} ஐ ஒப்பிடும்.`,
        ),
      );
      if (isHistogram)
        item.details.push(
          "Shows the selected numeric values; Excel will group them into histogram bins when applied.",
        );
      if (spec.chartType === "combo")
        item.details.push(
          say(
            "The first series uses columns; additional series use line overlays.",
            "මුල් series එක columns ලෙසත්, අමතර series line overlays ලෙසත් පෙන්වයි.",
            "முதல் series columns ஆகவும், மற்ற series line overlays ஆகவும் காட்டப்படும்.",
          ),
        );
      if (spec.showDataLabels)
        item.details.push(
          say(
            "Shows the value on each chart data point.",
            "සෑම chart data point එකකම අගය පෙන්වයි.",
            "ஒவ்வொரு chart data point இலும் மதிப்பைக் காட்டும்.",
          ),
        );
      if (spec.pivotSourceName)
        item.details.push(
          say(
            "Uses the created PivotTable result as the chart source; the original data stays unchanged.",
            "සාදන ලද PivotTable result එක chart source ලෙස භාවිතා කරයි; මුල් data එක වෙනස් නොවේ.",
            "உருவாக்கிய PivotTable முடிவை chart source ஆகப் பயன்படுத்தும்; மூலத் தரவு மாறாது.",
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
            `${slowNames} வலப்பக்க இரண்டாவது அச்சில் காட்டப்படும்; அதன் எண்கள் மிகவும் வேறுபட்ட அளவில் உள்ளன.`,
          ),
        );
      }
      return item;
    }

    const columns = Math.min(headers.length, MAX_TABLE_COLUMNS);
    const shownRows = rows.slice(0, MAX_TABLE_ROWS);
    const dateAt = dateColumns(
      headers.slice(0, columns).map(String),
      shownRows,
    );
    const table: OutcomeTable = {
      headers: headers.slice(0, columns).map(cell),
      rows: shownRows.map((row) =>
        row
          .slice(0, columns)
          .map((value, index) =>
            dateAt.has(index) ? dateCell(value) : cell(value),
          ),
      ),
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
            "கீழே உருட்டும்போதும் தலைப்பு வரிசை தெரிந்துகொண்டே இருக்கும்.",
          ),
        );
      if (spec.autofit)
        item.details.push(
          say(
            "Column widths fit their content.",
            "තීරු පළල අන්තර්ගතයට ගැළපේ.",
            "நிரல் அகலங்கள் உள்ளடக்கத்துக்கு ஏற்ப அமையும்.",
          ),
        );
      for (const entry of spec.columnFormats ?? [])
        item.details.push(
          say(
            `${entry.column}: number format ${entry.format}`,
            `${entry.column}: අංක ආකෘතිය ${entry.format}`,
            `${entry.column}: எண் வடிவம் ${entry.format}`,
          ),
        );
      for (const entry of spec.conditional ?? []) {
        const rule = pick(
          CONDITIONAL[entry.rule] ?? [entry.rule, entry.rule, entry.rule],
          language,
        );
        item.details.push(
          entry.rule === "custom-formula"
            ? `${entry.column}: ${rule} (${entry.operator}${entry.value})`
            : entry.rule === "top-n" || entry.rule === "bottom-n"
              ? `${entry.column}: ${rule} (${entry.n})`
              : entry.rule === "text-contains"
                ? `${entry.column}: ${rule} (${entry.text})`
                : entry.rule === "date-range"
                  ? `${entry.column}: ${rule} (${entry.startDate} to ${entry.endDate})`
                  : `${entry.column}: ${rule}`,
        );
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
              `${entry.column}: கீழிறங்கு பட்டியல் (${values})`,
            ),
          );
          if (entry.index < columns) table.dropdownColumns.push(entry.index);
        } else if (entry.rule === "between") {
          item.details.push(
            say(
              `${entry.column}: only numbers from ${entry.min} to ${entry.max} are accepted`,
              `${entry.column}: ${entry.min} සිට ${entry.max} දක්වා සංඛ්‍යා පමණක් පිළිගනී`,
              `${entry.column}: ${entry.min} முதல் ${entry.max} வரையான எண்கள் மட்டுமே ஏற்கப்படும்`,
            ),
          );
        } else if (entry.rule === "date") {
          item.details.push(
            say(
              `${entry.column}: only dates are accepted`,
              `${entry.column}: දින වකවානු පමණක් පිළිගනී`,
              `${entry.column}: திகதிகள் மட்டுமே ஏற்கப்படும்`,
            ),
          );
        } else if (entry.rule === "max-length") {
          item.details.push(
            say(
              `${entry.column}: at most ${entry.max} characters`,
              `${entry.column}: උපරිම අකුරු ${entry.max}`,
              `${entry.column}: அதிகபட்சம் ${entry.max} எழுத்துகள்`,
            ),
          );
        } else {
          item.details.push(
            say(
              `${entry.column}: only numbers 0 or higher are accepted`,
              `${entry.column}: 0 හෝ ඊට වැඩි සංඛ්‍යා පමණක් පිළිගනී`,
              `${entry.column}: 0 அல்லது அதற்கு மேற்பட்ட எண்கள் மட்டுமே ஏற்கப்படும்`,
            ),
          );
        }
      }
      if (spec.inputMessage) {
        item.details.push(
          say(
            `${spec.inputMessage.column}: input message “${spec.inputMessage.message}”`,
            `${spec.inputMessage.column}: input message “${spec.inputMessage.message}”`,
            `${spec.inputMessage.column}: உள்ளீட்டுச் செய்தி (input message) “${spec.inputMessage.message}”`,
          ),
        );
      }
      if (spec.dependentDropdown) {
        const dependent = spec.dependentDropdown;
        const groups = (dependent.groups ?? [])
          .map(
            (group: any) =>
              `${group.key}: ${group.values.slice(0, 5).join(", ")}`,
          )
          .join("; ");
        item.details.push(
          say(
            `${dependent.childColumn} depends on ${dependent.parentColumn} (${groups})`,
            `${dependent.parentColumn} අනුව ${dependent.childColumn} ලැයිස්තුව වෙනස් වේ (${groups})`,
            `${dependent.parentColumn} க்கு ஏற்ப ${dependent.childColumn} பட்டியல் மாறும் (${groups})`,
          ),
        );
        if (!table.dropdownColumns.includes(dependent.childIndex))
          table.dropdownColumns.push(dependent.childIndex);
      }
      if (spec.totalRow)
        item.details.push(
          say(
            "A total row is added under the data.",
            "දත්ත යටින් එකතු පේළියක් එක් කෙරේ.",
            "தரவின் கீழே ஒரு மொத்த வரிசை சேர்க்கப்படும்.",
          ),
        );
    } else if (action.kind === "clean") {
      const operations = (spec.operations ?? []) as string[];
      const labels = operations.map((operation) => {
        if (operation === "text-to-number")
          return say(
            "numbers stored as text",
            "පාඨ ලෙස තිබූ සංඛ්‍යා",
            "உரையாகச் சேமிக்கப்பட்ட எண்கள்",
          );
        if (operation === "text-to-date")
          return say(
            "unambiguous ISO text dates",
            "නිවැරදි ISO පාඨ දින",
            "தெளிவான ISO உரைத் திகதிகள்",
          );
        if (operation === "fill-blanks")
          return say(
            `blank${spec.fillBlanksColumn ? ` in ${spec.fillBlanksColumn}` : ""} cells with ${String(spec.fillBlanks)}`,
            `හිස් තීරු ${String(spec.fillBlanks)} වලින්`,
            `${spec.fillBlanksColumn ? `${spec.fillBlanksColumn} இலுள்ள ` : ""}வெற்றுக் கலங்கள் ${String(spec.fillBlanks)} ஆல் நிரப்பப்படும்`,
          );
        if (operation === "fuzzy-dedupe")
          return say(
            "near-duplicate rows (one-character tolerance)",
            "එක් අක්ෂරයක වෙනසක් ඇති ආසන්න duplicate පේළි",
            "ஒரு எழுத்து மட்டும் வேறுபடும் கிட்டத்தட்ட ஒரே மாதிரியான வரிசைகள்",
          );
        if (operation === "dedupe")
          return say(
            "exact duplicate rows",
            "සමාන පුනරාවර්තන පේළි",
            "முற்றிலும் ஒரே மாதிரியான நகல் வரிசைகள்",
          );
        return say("extra spaces", "අමතර හිස් ඉඩ", "மேலதிக இடைவெளிகள்");
      });
      if (labels.length)
        item.details.push(
          say(
            `Creates a cleaned copy: ${labels.join(", ")}.`,
            `පිරිසිදු පිටපතක් සාදයි: ${labels.join(", ")}.`,
            `சுத்தம் செய்த நகலை உருவாக்கும்: ${labels.join(", ")}.`,
          ),
        );
      if (operations.includes("text-to-date"))
        item.details.push(
          say(
            "Only YYYY-MM-DD dates convert; ambiguous dates remain text.",
            "YYYY-MM-DD දින පමණක් පරිවර්තනය වේ; සැක සහිත දින පාඨ ලෙස පවතී.",
            "YYYY-MM-DD திகதிகள் மட்டுமே மாற்றப்படும்; தெளிவற்ற திகதிகள் உரையாகவே இருக்கும்.",
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
        const allKeys = [...groups.keys()];
        if (spec.topN)
          allKeys.sort((a, b) =>
            spec.lowest
              ? reduce(groups.get(a)![0]) - reduce(groups.get(b)![0])
              : reduce(groups.get(b)![0]) - reduce(groups.get(a)![0]),
          );
        const keys = allKeys.slice(0, Math.min(6, spec.topN ?? 6));
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
            say("Grand total", "මුළු එකතුව", "முழு மொத்தம்"),
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
              "மதிப்புகள் முழு மொத்தத்தின் பங்காகக் காட்டப்படும்.",
            ),
          );
      }
      if (!spec.rowsColumn || !spec.valuesColumn)
        item.details.push(
          say(
            "Summarizes your numbers by category in a PivotTable.",
            "ඔබේ සංඛ්‍යා කාණ්ඩ අනුව PivotTable එකක සාරාංශ කරයි.",
            "உங்கள் எண்களை வகை வாரியாக PivotTable ஒன்றில் சுருக்கும்.",
          ),
        );
      else
        item.details.push(
          say(
            `${agg(spec.aggregation)} of ${spec.valuesColumn} for each ${spec.rowsColumn}` +
              (spec.subRowsColumn
                ? `, then ${spec.subRowsColumn} under each`
                : "") +
              (spec.columnsColumn ? `, split by ${spec.columnsColumn}` : "") +
              (spec.filterColumn ? `, filter on ${spec.filterColumn}` : ""),
            `${spec.rowsColumn} එක් එකක් සඳහා ${spec.valuesColumn} හි ${agg(spec.aggregation)}` +
              (spec.subRowsColumn
                ? `, ඊට පසු එක් එකක් යටතේ ${spec.subRowsColumn}`
                : "") +
              (spec.columnsColumn ? `, ${spec.columnsColumn} අනුව බෙදා` : "") +
              (spec.filterColumn ? `, ${spec.filterColumn} මත පෙරහන` : ""),
            `ஒவ்வொரு ${spec.rowsColumn} க்கும் ${spec.valuesColumn} இன் ${agg(spec.aggregation)}` +
              (spec.subRowsColumn
                ? `, அதன் பின் ஒவ்வொன்றின் கீழும் ${spec.subRowsColumn}`
                : "") +
              (spec.columnsColumn
                ? `, ${spec.columnsColumn} வாரியாகப் பிரித்து`
                : "") +
              (spec.filterColumn ? `, ${spec.filterColumn} மீது வடிகட்டி` : ""),
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
          `${spec.groupColumn} வாரியாகக் குழுக்கள்: ${(spec.groups ?? []).slice(0, 6).join(", ")}. ${parts}`,
        ),
      );
      item.details.push(
        say(
          "Uses live formulas, so it updates when your data changes.",
          "සජීවී සූත්‍ර භාවිතා කරයි; දත්ත වෙනස් වන විට යාවත්කාලීන වේ.",
          "நேரடி சூத்திரங்களைப் பயன்படுத்துவதால், உங்கள் தரவு மாறும்போது இதுவும் புதுப்பிக்கப்படும்.",
        ),
      );
    } else if (action.kind === "split-column") {
      const source = Number(spec.splitSourceIndex);
      const kept = MAX_TABLE_COLUMNS - 2;
      const splitValue = (value: unknown) => {
        const text = value == null ? "" : String(value).trim();
        const at = text.indexOf(" ");
        return [
          at < 0 ? text : text.slice(0, at),
          at < 0 ? "" : text.slice(at + 1).trim(),
        ];
      };
      table.headers = [
        ...table.headers.slice(0, kept),
        String(spec.splitFirstColumn),
        String(spec.splitLastColumn),
      ];
      table.rows = rows.slice(0, MAX_TABLE_ROWS).map((row, at) => {
        const [first, last] = splitValue(row[source]);
        return [...table.rows[at].slice(0, kept), first, last];
      });
      item.details.push(
        say(
          `Splits ${spec.splitSourceColumn} into ${spec.splitFirstColumn} and ${spec.splitLastColumn}.`,
          `${spec.splitSourceColumn} ${spec.splitFirstColumn} සහ ${spec.splitLastColumn} ලෙස වෙන් කරයි.`,
          `${spec.splitSourceColumn} ஐ ${spec.splitFirstColumn}, ${spec.splitLastColumn} எனப் பிரிக்கும்.`,
        ),
      );
    } else if (action.kind === "lookup-columns" && spec.lookupSheet) {
      const sourceKeys = Array.isArray(spec.sourceKeyColumns)
        ? spec.sourceKeyColumns.join(" + ")
        : String(spec.sourceKeyColumn ?? "");
      const lookupKeys = Array.isArray(spec.lookupKeyHeaders)
        ? spec.lookupKeyHeaders.join(" + ")
        : String(spec.lookupKeyHeader ?? "");
      const methodDescription =
        spec.lookupMethod === "xlookup"
          ? " using XLOOKUP"
          : " using INDEX/MATCH";
      const returnHeaders = Array.isArray(spec.lookupReturnHeaders)
        ? spec.lookupReturnHeaders
        : [];
      const keep = Math.max(0, MAX_TABLE_COLUMNS - returnHeaders.length);
      table.headers = [...table.headers.slice(0, keep), ...returnHeaders];
      table.rows = rows
        .slice(0, MAX_TABLE_ROWS)
        .map((row) => [
          ...row.slice(0, keep).map(cell),
          ...returnHeaders.map(() => "—"),
        ]);
      item.details.push(
        say(
          `Brings ${returnHeaders.join(", ")} from sheet "${spec.lookupSheet}" by matching ${sourceKeys} with ${lookupKeys}${methodDescription}.`,
          `"${spec.lookupSheet}" පත්‍රිකාවෙන් ${returnHeaders.join(", ")} ගෙන එයි — ${sourceKeys} සහ ${lookupKeys} ගැළපීමෙන්.`,
          `"${spec.lookupSheet}" தாளில் இருந்து ${returnHeaders.join(", ")} ஐக் கொண்டுவரும் — ${sourceKeys} ஐ ${lookupKeys} உடன் பொருத்தி.`,
        ),
      );
      item.details.push(
        say(
          "Values will be live formulas on the new result sheet; source data remains unchanged.",
          "නව ප්‍රතිඵල පත්‍රිකාවේ සජීවී formulas භාවිතා වේ; මුල් දත්ත වෙනස් නොවේ.",
          "புதிய முடிவுத் தாளில் மதிப்புகள் நேரடி formulas ஆக இருக்கும்; மூலத் தரவு மாறாது.",
        ),
      );
    } else if (action.kind === "add-column" && spec.lookupSheet) {
      const sourceKeys = Array.isArray(spec.sourceKeyColumns)
        ? spec.sourceKeyColumns.join(" + ")
        : String(spec.sourceKeyColumn ?? "");
      const lookupKeys = Array.isArray(spec.lookupKeyHeaders)
        ? spec.lookupKeyHeaders.join(" + ")
        : String(spec.lookupKeyHeader ?? "");
      const matchDescription =
        spec.lookupMatchMode === "approximate"
          ? " using approximate matching (lookup values must be sorted ascending)"
          : "";
      const methodDescription =
        spec.lookupMethod === "xlookup"
          ? " using XLOOKUP"
          : " using INDEX/MATCH";
      item.details.push(
        say(
          `Brings "${spec.lookupReturnHeader}" from sheet "${spec.lookupSheet}" by matching ${sourceKeys} with ${lookupKeys}${matchDescription}${methodDescription}.`,
          `"${spec.lookupSheet}" පත්‍රිකාවෙන් "${spec.lookupReturnHeader}" ගෙන එයි — ${spec.sourceKeyColumn} සහ ${spec.lookupKeyHeader} ගැළපීමෙන්.`,
          `"${spec.lookupSheet}" தாளில் இருந்து "${spec.lookupReturnHeader}" ஐக் கொண்டுவரும் — ${sourceKeys} ஐ ${lookupKeys} உடன் பொருத்தி.`,
        ),
      );
      item.details.push(
        say(
          "Rows with no match stay blank.",
          "ගැළපීමක් නැති පේළි හිස්ව පවතී.",
          "பொருத்தம் இல்லாத வரிசைகள் வெறுமையாக இருக்கும்.",
        ),
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
          `புதிய நிரல் "${spec.columnName}" = ${how}`,
        ),
      );
    } else if (action.kind === "view") {
      if (spec.sort)
        item.details.push(
          say(
            `Sorted by ${spec.sort.column} (${spec.sort.direction === "desc" ? "largest first" : "smallest first"})`,
            `${spec.sort.column} අනුව පෙළගැස්වේ`,
            `${spec.sort.column} படி வரிசைப்படுத்தப்படும் (${spec.sort.direction === "desc" ? "பெரியது முதலில்" : "சிறியது முதலில்"})`,
          ),
        );
      if (spec.thenSort)
        item.details.push(
          say(
            `Then by ${spec.thenSort.column} (${spec.thenSort.direction === "desc" ? "largest first" : "smallest first"}) when the first column ties`,
            `ඉන්පසු ${spec.thenSort.column} අනුව පෙළගැස්වේ`,
            `முதல் நிரல் சமமாக இருந்தால், பின்னர் ${spec.thenSort.column} படி வரிசைப்படுத்தப்படும் (${spec.thenSort.direction === "desc" ? "பெரியது முதலில்" : "சிறியது முதலில்"})`,
          ),
        );
      if (spec.filter)
        item.details.push(
          say(
            `Only rows where ${spec.filter.column} ${spec.filter.operator} ${spec.filter.value}`,
            `${spec.filter.column} ${spec.filter.operator} ${spec.filter.value} වන පේළි පමණි`,
            `${spec.filter.column} ${spec.filter.operator} ${spec.filter.value} ஆக உள்ள வரிசைகள் மட்டும்`,
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
            spec.highlight.rule === "top-n" ||
              spec.highlight.rule === "bottom-n"
              ? `${spec.highlight.column} இல் ${spec.highlight.rule === "top-n" ? "உயர்ந்த" : "குறைந்த"} ${spec.highlight.n ?? 1} மதிப்புகளைச் சிறப்பித்துக் காட்டும்`
              : `${spec.highlight.column} இல் ${spec.highlight.rule} ஐச் சிறப்பித்துக் காட்டும்`,
          ),
        );
      if (spec.where)
        item.details.push(
          say(
            `Shows only the rows where ${spec.where}`,
            `${spec.where} සත්‍ය වන පේළි පමණක් පෙන්වයි`,
            `${spec.where} உண்மையாகும் வரிசைகளை மட்டும் காட்டும்`,
          ),
        );
      if (spec.limit)
        item.details.push(
          say(
            `Shows only the first ${spec.limit} rows`,
            `පළමු පේළි ${spec.limit} පමණක් පෙන්වයි`,
            `முதல் ${spec.limit} வரிசைகளை மட்டும் காட்டும்`,
          ),
        );
    } else if (action.kind === "clean") {
      item.details.push(
        say(
          `Cleans a copy: ${(spec.operations ?? []).join(", ")}`,
          `පිටපතක් පිරිසිදු කරයි: ${(spec.operations ?? []).join(", ")}`,
          `நகலைச் சுத்தம் செய்யும்: ${(spec.operations ?? []).join(", ")}`,
        ),
      );
    } else if (action.kind === "dashboard" && spec.dashboard?.usage) {
      // Usage dashboard: the picture is computed from the rows read for the preview (a sample on big data).
      const dashboard = spec.dashboard as {
        category: { column: string; index: number };
        values: Array<{ column: string; index: number }>;
        usage: {
          item: { column: string; index: number };
          unit?: { column: string; index: number };
        };
      };
      const accumulator = new UsageAccumulator();
      for (const row of rows)
        accumulator.add(
          row[dashboard.category.index],
          row[dashboard.usage.item.index],
          row[dashboard.values[0].index],
          dashboard.usage.unit ? row[dashboard.usage.unit.index] : undefined,
        );
      const usage = accumulator.finish(8);
      const top = usage.units[0];
      item.title = say(
        `Usage dashboard: ${dashboard.values[0].column} by ${dashboard.category.column} and ${dashboard.usage.item.column}`,
        `භාවිත දත්ත පුවරුව: ${dashboard.category.column} සහ ${dashboard.usage.item.column} අනුව`,
        `பயன்பாட்டுத் தரவுப் பலகை: ${dashboard.values[0].column} — ${dashboard.category.column}, ${dashboard.usage.item.column} வாரியாக`,
      );
      if (top) {
        const ranked = usage.topByUnit[top.label] ?? [];
        item.chart = {
          type: "bar",
          categories: ranked.map((entry) => entry.entity),
          series: [
            {
              name: `${dashboard.values[0].column} (${top.label})`,
              values: ranked.map((entry) => entry.quantity),
            },
          ],
        };
      }
      item.table = {
        headers: [
          say("KPI", "දර්ශකය", "குறிகாட்டி"),
          say("Value", "අගය", "மதிப்பு"),
        ],
        rows: [
          [`${dashboard.category.column}s`, String(usage.entities)],
          [`${dashboard.usage.item.column}s`, String(usage.items)],
          ...usage.units
            .slice(0, 4)
            .map((unit) => [
              `${dashboard.values[0].column} (${unit.label})`,
              String(unit.total),
            ]),
        ].slice(0, MAX_TABLE_ROWS),
        barColumns: [],
        dropdownColumns: [],
      };
      item.details.push(
        say(
          "One new result sheet: totals for each unit (never added together), a lookup of one id, the top ids with charts. Your original data is not changed.",
          "අලුත් ප්‍රතිඵල පත්‍රිකාවක්: එකක් එකක් අනුව එකතු (මිශ්‍ර නොකර), ID සෙවුමක්, ඉහළම ID සහ ප්‍රස්ථාර. ඔබේ මුල් දත්ත වෙනස් නොවේ.",
          "ஒரு புதிய முடிவுத் தாள்: ஒவ்வொரு அலகுக்குமான மொத்தங்கள் (ஒன்றாகக் கூட்டப்படாது), ஒரு ID தேடல், முன்னணி ID கள் வரைபடங்களுடன். உங்கள் மூலத் தரவு மாறாது.",
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
        `தரவுப் பலகை: ${dashboard.values.map((entry) => entry.column).join(", ")} — ${dashboard.category.column} வாரியாக`,
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
        headers: [
          say("KPI", "දර්ශකය", "குறிகாட்டி"),
          say("Value", "අගය", "மதிப்பு"),
        ],
        rows: [
          [say("Data rows", "දත්ත පේළි", "தரவு வரிசைகள்"), String(rows.length)],
          ...dashboard.values.flatMap((entry) => {
            const numbers = rows.map((row) => numeric(row[entry.index]));
            const total = numbers.reduce((sum, value) => sum + value, 0);
            return [
              [
                `${say("Total", "එකතුව", "மொத்தம்")} ${entry.column}`,
                String(total),
              ],
              [
                `${say("Average", "සාමාන්‍යය", "சராசரி")} ${entry.column}`,
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
          "நேரடி KPI சூத்திரங்கள், ஒவ்வொரு மதிப்பு நிரலுக்கும் ஒரு வரைபடம், ஒரு PivotTable கொண்ட புதிய முடிவுத் தாள். உங்கள் மூலத் தரவு மாறாது.",
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
            "நேரடி சூத்திரங்கள்: உங்கள் தரவு மாறும்போது புதுப்பிக்கப்படும்.",
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
              `${strength === "strong" ? "வலுவான" : strength === "moderate" ? "மிதமான" : "பலவீனமான"} ${(result.r as number) > 0 ? "நேர்மறை" : "எதிர்மறை"} தொடர்பு`,
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
            `${known.length} மதிப்புகளின் ஊடாக நேர்கோட்டுப் போக்கு, ${periods} காலப்பகுதிகள் வரை நீட்டிக்கப்பட்டுள்ளது.`,
          ),
        );
      } else if (stats.mode === "advanced-forecast") {
        const value = stats.value as { column: string; index: number };
        const periods = Number(stats.periods ?? 6);
        const result = advancedForecast(
          rows.map((row) => row[value.index]),
          periods,
        );
        item.table = {
          headers: [
            "Period",
            `Forecast ${value.column}`,
            "Lower 95%",
            "Upper 95%",
          ],
          rows: result.forecast
            .slice(0, MAX_TABLE_ROWS)
            .map((entry, at) => [
              String(at + 1),
              String(entry),
              String(result.lower[at]),
              String(result.upper[at]),
            ]),
          barColumns: [],
          dropdownColumns: [],
        };
        item.details.push(
          say(
            `Forecast with a seasonal index and approximate 95% interval; slope ${result.slope}.`,
            `සෘතුමය දර්ශකය සහ ආසන්න 95% පරාසය සහිත අනාවැකියක්; slope ${result.slope}.`,
            `பருவகாலச் சுட்டெண் மற்றும் ஏறத்தாழ 95% இடைவெளியுடன் கூடிய முன்னறிவிப்பு; slope ${result.slope}.`,
          ),
        );
        if (result.warning) item.details.push(result.warning);
      } else if (stats.mode === "financial") {
        const columns = (stats.columns ?? []) as Array<{
          column: string;
          index: number;
        }>;
        const total = (index: number) =>
          rows.reduce(
            (sum, row) =>
              sum +
              (typeof row[index] === "number" ? (row[index] as number) : 0),
            0,
          );
        const metrics = financialMetrics({
          revenue: total(columns[0].index),
          cogs: total(columns[1].index),
          operatingExpenses: total(columns[2].index),
          ...(columns[3] ? { depreciation: total(columns[3].index) } : {}),
          ...(columns[4] ? { interest: total(columns[4].index) } : {}),
          ...(columns[5] ? { taxes: total(columns[5].index) } : {}),
          ...(columns[6] ? { investedCapital: total(columns[6].index) } : {}),
        });
        item.table = {
          headers: ["Metric", "Value"],
          rows: Object.entries(metrics)
            .slice(0, MAX_TABLE_ROWS)
            .map(([key, value]) => [key, String(value)]),
          barColumns: [],
          dropdownColumns: [],
        };
        item.details.push(
          say(
            "Financial metrics are calculated in the result sheet from live source formulas.",
            "මූල්‍ය දර්ශක live source formulas වලින් report sheet එකේ ගණනය වේ.",
            "நிதி அளவீடுகள் நேரடி source formulas இலிருந்து முடிவுத் தாளில் கணக்கிடப்படும்.",
          ),
        );
      } else if (stats.mode === "anomaly") {
        const value = stats.value as { column: string; index: number };
        const anomalies = findAnomalies(rows.map((row) => row[value.index]));
        item.table = {
          headers: ["Column", "Anomalies in preview"],
          rows: [[value.column, String(anomalies.length)]],
          barColumns: [],
          dropdownColumns: [],
        };
        item.details.push(
          say(
            "IQR screening only; an anomaly is not proof of fraud.",
            "මෙය IQR පරීක්ෂාවක් පමණි; anomaly එකක් වංචාවක් බවට සාක්ෂියක් නොවේ.",
            "இது IQR சோதனை மட்டுமே; ஒரு anomaly மோசடிக்கான சான்று அல்ல.",
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
          "விதிமுறை அடிப்படையிலான பகுப்பாய்வு அறிக்கை",
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
            "மாற்றம், போக்கு, IQR அசாதாரண மதிப்புகள், பங்களிப்பாளர்கள் ஆகியவற்றுக்கு நேரடி சூத்திரங்களை எழுதும். AI இற்கு எதுவும் அனுப்பப்படாது.",
          ),
        );
      }
    } else if (action.kind === "quality") {
      if (spec.qualityMode === "formula")
        item.details.push(
          say(
            "Audits formula cells, errors, references, inconsistent copied formulas, hard-coded numbers and possible direct circular references in a new report sheet.",
            "නව වාර්තා පත්‍රිකාවක සූත්‍ර කොටු, දෝෂ, යොමු, අසමාන පිටපත් කළ සූත්‍ර, සූත්‍ර තීරුවල hard-coded අංක සහ සෘජු වටකුරු යොමු පරීක්ෂා කරයි.",
            "புதிய அறிக்கைத் தாளில் சூத்திரக் கலங்கள், பிழைகள், குறிப்புகள், ஒத்திசையாத நகலெடுத்த சூத்திரங்கள், hard-coded எண்கள், சாத்தியமான நேரடிச் சுற்றுக் குறிப்புகள் (circular references) ஆகியவற்றைச் சோதிக்கும்.",
          ),
        );
      if (spec.qualityMode === "repair")
        item.details.push(
          say(
            "Creates a repaired copy for safe formula errors such as #DIV/0!; unresolved #REF! formulas remain unchanged for manual review.",
            "#DIV/0! වැනි ආරක්ෂිත සූත්‍ර දෝෂ සඳහා පිටපතක් සකසයි; විසඳිය නොහැකි #REF! සූත්‍ර අතින් පරීක්ෂා කිරීමට එසේම තබයි.",
            "#DIV/0! போன்ற பாதுகாப்பாகத் திருத்தக்கூடிய சூத்திரப் பிழைகளுக்குத் திருத்திய நகலை உருவாக்கும்; தீர்க்க முடியாத #REF! சூத்திரங்கள் கைமுறைச் சரிபார்ப்புக்காக மாற்றமின்றி விடப்படும்.",
          ),
        );
      item.details.push(
        say(
          "Checks blanks, duplicates, mixed text and numbers, extra spaces and outliers.",
          "හිස් කොටු, පුනරාවර්තන, මිශ්‍ර පෙළ සහ අංක, අමතර ඉඩ සහ අසාමාන්‍ය අගයන් පරීක්ෂා කරයි.",
          "வெற்றுக் கலங்கள், நகல்கள், கலந்த உரை மற்றும் எண்கள், மேலதிக இடைவெளிகள், அசாதாரண மதிப்புகள் ஆகியவற்றைச் சோதிக்கும்.",
        ),
      );
    } else if (action.kind === "table") {
      item.details.push(
        say(
          "Your range becomes an Excel table with filter buttons.",
          "ඔබේ පරාසය පෙරහන් බොත්තම් සහිත Excel වගුවක් වේ.",
          "உங்கள் வரம்பு வடிகட்டிப் பொத்தான்களுடன் கூடிய Excel அட்டவணையாக மாறும்.",
        ),
      );
    }
    item.details.push(
      say(
        "Your original data is not changed.",
        "ඔබේ මූලාශ්‍ර දත්ත වෙනස් නොවේ.",
        "உங்கள் மூலத் தரவு மாறாது.",
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
  "export-csv": "CSV export of",
  "export-pdf": "PDF export of",
  "add-column": "Calc of",
  "lookup-columns": "Lookup of",
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
  else if (
    action.kind === "statistics" &&
    spec.statistics?.mode === "advanced-forecast"
  )
    label = `Advanced forecast of ${spec.statistics.value?.column ?? sourceSheet}`;
  else if (
    action.kind === "statistics" &&
    spec.statistics?.mode === "financial"
  )
    label = "Financial metrics report";
  else if (action.kind === "statistics" && spec.statistics?.mode === "anomaly")
    label = `Anomaly report for ${spec.statistics.value?.column ?? sourceSheet}`;
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
