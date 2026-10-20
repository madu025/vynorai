/**
 * Words the add-in writes into the workbook itself (dashboard titles, KPI labels, chart titles and
 * sheet notes), in English, Sinhala or Tamil. Column and sheet names are the person's own and are
 * never translated; formulas never change with the language. English wording is the original text,
 * so English results are byte-for-byte what they were before.
 */
import type { Language } from "./i18n.js";

export type WorkbookLanguage = Language;

type Aggregation = "sum" | "count" | "average" | "min" | "max";

export interface WorkbookText {
  aggregate: (aggregation: Aggregation) => string;
  /** "Net Amount, Qty by Region" (the dashboard title, upper-cased by the caller). */
  valuesBy: (values: string[], category: string) => string;
  management: string;
  operational: string;
  liveFormulas: (source: string) => string;
  amountsIn: (code: string) => string;
  chartData: string;
  /** "Total of Net Amount": a helper table header and a breakdown column header. */
  aggregateOf: (label: string, value: string) => string;
  /** "Total of Net Amount by Region": a dashboard chart title. */
  aggregateOfBy: (label: string, value: string, category: string) => string;
  records: string;
  /** " Region values", after a count of distinct categories. */
  categoryValues: (category: string) => string;
  /** "TOTAL NET AMOUNT" before upper-casing. */
  valueCard: (label: string, value: string) => string;
  /** The text before the average in `="Average "&TEXT(...)`. */
  averagePrefix: string;
  percentOf: (target: string) => string;
  gapTo: (target: string) => string;
  reached: (target: string) => string;
  stillToGo: string;
  top: (category: string) => string;
  topBy: (label: string, value: string) => string;
  breakdownBy: (category: string) => string;
  mixedRows: (currencies: string[], by: string) => string;
  mixedColumns: (currencies: string[]) => string;
  largestShown: (shown: number, total: number, category: string) => string;
  largeData: (shown: number, category: string) => string;
  chartOrder: string;
  pivotFallback: (reason: string) => string;
  slicerFailed: (category: string) => string;
  slicerNeedsVersion: (category: string) => string;
  /** Chart titles of the plain chart, histogram, PivotTable chart and forecast. */
  chartBy: (values: string[], category: string) => string;
  distribution: (value: string) => string;
  pivotChart: (value: string, category: string) => string;
  forecast: (value: string) => string;
  /** Value axis title when a chart shows several value columns. */
  valueAxis: string;
}

const EN: WorkbookText = {
  aggregate: (aggregation) =>
    ({
      sum: "Total",
      count: "Count",
      average: "Average",
      min: "Lowest",
      max: "Highest",
    })[aggregation],
  valuesBy: (values, category) => `${values.join(", ")} by ${category}`,
  management:
    "Management summary: the headline numbers and the largest categories.",
  operational:
    "Operational view: every category, with a slicer to work through them.",
  liveFormulas: (source) => `Live formulas over every row of ${source}.`,
  amountsIn: (code) => ` Amounts in ${code}.`,
  chartData: "Chart data (live formulas)",
  aggregateOf: (label, value) => `${label} of ${value}`,
  aggregateOfBy: (label, value, category) =>
    `${label} of ${value} by ${category}`,
  records: "RECORDS",
  categoryValues: (category) => ` ${category} values`,
  valueCard: (label, value) => `${label} ${value}`,
  averagePrefix: "Average ",
  percentOf: (target) => `% OF ${target}`,
  gapTo: (target) => `GAP TO ${target}`,
  reached: (target) => `${target} reached`,
  stillToGo: "still to go",
  top: (category) => `TOP ${category}`,
  topBy: (label, value) => `by ${label.toLowerCase()} of ${value}`,
  breakdownBy: (category) => `BREAKDOWN BY ${category}`,
  mixedRows: (currencies, by) =>
    `The rows are in ${currencies.join(" and ")} (see ${by}), so a total over all rows mixes currencies; filter the PivotTable by ${by} before comparing amounts.`,
  mixedColumns: (currencies) =>
    `The value columns are in different currencies (${currencies.join(", ")}); they are shown side by side and never added together.`,
  largestShown: (shown, total, category) =>
    `The charts show the ${shown} largest of ${total} ${category} values; the totals and the PivotTable cover all of them.`,
  largeData: (shown, category) =>
    `The data is large, so the charts list up to ${shown} ${category} values from a live formula; the totals cover every row.`,
  chartOrder:
    "The chart order is from when the dashboard was made; the figures stay live.",
  pivotFallback: (reason) =>
    `This Excel could not create a PivotTable here (${reason}), so the breakdown is a formula table; it still updates with the data.`,
  slicerFailed: (category) =>
    `A ${category} slicer could not be added in this Excel; use the filter button on the PivotTable's row labels instead.`,
  slicerNeedsVersion: (category) =>
    `Slicers need Excel 2021 or Microsoft 365; use the filter button on the PivotTable's row labels to pick ${category} values.`,
  chartBy: (values, category) => `${values.join(", ")} by ${category}`,
  distribution: (value) => `${value} distribution`,
  pivotChart: (value, category) => `PivotTable result: ${value} by ${category}`,
  forecast: (value) => `${value} forecast`,
  valueAxis: "Value",
};

const SI: WorkbookText = {
  aggregate: (aggregation) =>
    ({
      sum: "එකතුව",
      count: "ගණන",
      average: "සාමාන්‍යය",
      min: "අඩුම",
      max: "වැඩිම",
    })[aggregation],
  valuesBy: (values, category) => `${category} අනුව ${values.join(", ")}`,
  management: "කළමනාකරණ සාරාංශය: ප්‍රධාන සංඛ්‍යා සහ විශාලතම කාණ්ඩ.",
  operational:
    "මෙහෙයුම් දසුන: සෑම කාණ්ඩයක්ම, ඒවා එකින් එක බැලීමට slicer එකක් සමඟ.",
  liveFormulas: (source) => `${source} හි සෑම පේළියක් මතම සජීවී සූත්‍ර.`,
  amountsIn: (code) => ` මුදල් ${code} වලින්.`,
  chartData: "ප්‍රස්තාර දත්ත (සජීවී සූත්‍ර)",
  aggregateOf: (label, value) => `${value} ${label}`,
  aggregateOfBy: (label, value, category) =>
    `${category} අනුව ${value} ${label}`,
  records: "වාර්තා ගණන",
  categoryValues: (category) => ` ${category} අගයන්`,
  valueCard: (label, value) => `${value} ${label}`,
  averagePrefix: "සාමාන්‍යය ",
  percentOf: (target) => `${target} හි %`,
  gapTo: (target) => `${target} දක්වා පරතරය`,
  reached: (target) => `${target} ළඟා විය`,
  stillToGo: "තව ඉතිරියි",
  top: (category) => `ඉහළම ${category}`,
  topBy: (label, value) => `${value} ${label} අනුව`,
  breakdownBy: (category) => `${category} අනුව විස්තරය`,
  mixedRows: (currencies, by) =>
    `පේළි ${currencies.join(" සහ ")} මුදල් වලින් ඇත (${by} බලන්න), එබැවින් සියලු පේළිවල එකතුව මුදල් වර්ග මිශ්‍ර කරයි; මුදල් සසඳන්න පෙර PivotTable එක ${by} අනුව පෙරහන් කරන්න.`,
  mixedColumns: (currencies) =>
    `අගය තීරු වෙනස් මුදල් වර්ගවල ඇත (${currencies.join(", ")}); ඒවා පැත්තෙන් පැත්තට පෙන්වන අතර කිසි විටෙක එකතු නොකෙරේ.`,
  largestShown: (shown, total, category) =>
    `ප්‍රස්තාර පෙන්වන්නේ ${category} අගයන් ${total}න් විශාලතම ${shown} පමණි; එකතු සහ PivotTable එක සියල්ලම ආවරණය කරයි.`,
  largeData: (shown, category) =>
    `දත්ත විශාල නිසා ප්‍රස්තාර සජීවී සූත්‍රයකින් ${category} අගයන් ${shown}ක් දක්වා පෙන්වයි; එකතු සෑම පේළියක්ම ආවරණය කරයි.`,
  chartOrder:
    "ප්‍රස්තාරයේ අනුපිළිවෙල dashboard එක සාදන විට තිබූ ලෙසයි; සංඛ්‍යා සජීවීව යාවත්කාලීන වේ.",
  pivotFallback: (reason) =>
    `මෙම Excel හට මෙහි PivotTable එකක් සෑදිය නොහැකි විය (${reason}), එබැවින් විස්තරය සූත්‍ර වගුවකි; එය දත්ත සමඟ තවමත් යාවත්කාලීන වේ.`,
  slicerFailed: (category) =>
    `මෙම Excel හි ${category} slicer එකක් එක් කළ නොහැකි විය; ඒ වෙනුවට PivotTable හි row labels මත ඇති filter බොත්තම භාවිතා කරන්න.`,
  slicerNeedsVersion: (category) =>
    `Slicers සඳහා Excel 2021 හෝ Microsoft 365 අවශ්‍යයි; ${category} අගයන් තෝරා ගැනීමට PivotTable හි row labels මත ඇති filter බොත්තම භාවිතා කරන්න.`,
  chartBy: (values, category) => `${category} අනුව ${values.join(", ")}`,
  distribution: (value) => `${value} ව්‍යාප්තිය`,
  pivotChart: (value, category) =>
    `PivotTable ප්‍රතිඵලය: ${category} අනුව ${value}`,
  forecast: (value) => `${value} පුරෝකථනය`,
  valueAxis: "අගය",
};

const TA: WorkbookText = {
  aggregate: (aggregation) =>
    ({
      sum: "மொத்தம்",
      count: "எண்ணிக்கை",
      average: "சராசரி",
      min: "குறைந்தபட்சம்",
      max: "அதிகபட்சம்",
    })[aggregation],
  valuesBy: (values, category) => `${category} வாரியாக ${values.join(", ")}`,
  management: "நிர்வாகச் சுருக்கம்: முக்கிய எண்களும் மிகப்பெரிய வகைகளும்.",
  operational:
    "செயல்பாட்டுப் பார்வை: ஒவ்வொரு வகையும், அவற்றை ஒவ்வொன்றாகப் பார்க்க ஒரு slicer உடன்.",
  liveFormulas: (source) =>
    `${source} இன் ஒவ்வொரு வரிசையின் மீதும் நேரடி சூத்திரங்கள்.`,
  amountsIn: (code) => ` தொகைகள் ${code} இல்.`,
  chartData: "வரைபடத் தரவு (நேரடி சூத்திரங்கள்)",
  aggregateOf: (label, value) => `${value} ${label}`,
  aggregateOfBy: (label, value, category) =>
    `${category} வாரியாக ${value} ${label}`,
  records: "பதிவுகள்",
  categoryValues: (category) => ` ${category} மதிப்புகள்`,
  valueCard: (label, value) => `${value} ${label}`,
  averagePrefix: "சராசரி ",
  percentOf: (target) => `${target} இன் %`,
  gapTo: (target) => `${target} வரை இடைவெளி`,
  reached: (target) => `${target} எட்டப்பட்டது`,
  stillToGo: "இன்னும் மீதம்",
  top: (category) => `முதல் ${category}`,
  topBy: (label, value) => `${value} ${label} அடிப்படையில்`,
  breakdownBy: (category) => `${category} வாரியான பிரிவு`,
  mixedRows: (currencies, by) =>
    `வரிசைகள் ${currencies.join(" மற்றும் ")} நாணயங்களில் உள்ளன (${by} பார்க்கவும்), எனவே எல்லா வரிசைகளின் மொத்தம் நாணயங்களைக் கலக்கிறது; தொகைகளை ஒப்பிடும் முன் PivotTable ஐ ${by} மூலம் வடிகட்டவும்.`,
  mixedColumns: (currencies) =>
    `மதிப்பு நெடுவரிசைகள் வெவ்வேறு நாணயங்களில் உள்ளன (${currencies.join(", ")}); அவை அருகருகே காட்டப்படுகின்றன, ஒருபோதும் கூட்டப்படுவதில்லை.`,
  largestShown: (shown, total, category) =>
    `வரைபடங்கள் ${total} ${category} மதிப்புகளில் மிகப்பெரிய ${shown} ஐ மட்டும் காட்டுகின்றன; மொத்தங்களும் PivotTable உம் அனைத்தையும் உள்ளடக்குகின்றன.`,
  largeData: (shown, category) =>
    `தரவு பெரியது, எனவே வரைபடங்கள் ஒரு நேரடி சூத்திரத்திலிருந்து ${shown} ${category} மதிப்புகள் வரை காட்டுகின்றன; மொத்தங்கள் ஒவ்வொரு வரிசையையும் உள்ளடக்குகின்றன.`,
  chartOrder:
    "வரைபட வரிசை dashboard உருவாக்கப்பட்ட நேரத்தில் இருந்தபடியே உள்ளது; எண்கள் நேரடியாகப் புதுப்பிக்கப்படுகின்றன.",
  pivotFallback: (reason) =>
    `இந்த Excel இங்கு PivotTable ஐ உருவாக்க முடியவில்லை (${reason}), எனவே பிரிவு ஒரு சூத்திர அட்டவணையாக உள்ளது; அது தரவுடன் இன்னும் புதுப்பிக்கப்படுகிறது.`,
  slicerFailed: (category) =>
    `இந்த Excel இல் ${category} slicer ஐச் சேர்க்க முடியவில்லை; அதற்குப் பதிலாக PivotTable இன் row labels இல் உள்ள filter பொத்தானைப் பயன்படுத்தவும்.`,
  slicerNeedsVersion: (category) =>
    `Slicers க்கு Excel 2021 அல்லது Microsoft 365 தேவை; ${category} மதிப்புகளைத் தேர்ந்தெடுக்க PivotTable இன் row labels இல் உள்ள filter பொத்தானைப் பயன்படுத்தவும்.`,
  chartBy: (values, category) => `${category} வாரியாக ${values.join(", ")}`,
  distribution: (value) => `${value} பரவல்`,
  pivotChart: (value, category) =>
    `PivotTable முடிவு: ${category} வாரியாக ${value}`,
  forecast: (value) => `${value} முன்னறிவிப்பு`,
  valueAxis: "மதிப்பு",
};

const TEXTS: Record<WorkbookLanguage, WorkbookText> = {
  en: EN,
  si: SI,
  ta: TA,
};

export function workbookText(language: WorkbookLanguage = "en"): WorkbookText {
  return TEXTS[language] ?? EN;
}
