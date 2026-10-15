/**
 * Sinhala wording for the messages the task pane builds at run time (status line, change note,
 * preview summary). Static labels live in i18n.ts. A message is matched as a whole first, then
 * sentence by sentence; anything unknown stays in English so nothing is ever mistranslated.
 */

const EXACT: Record<string, string> = {
  "No preview yet.": "තවමත් පෙරදසුනක් නැත.",
  "Nothing has changed in your workbook yet.":
    "ඔබේ වැඩපොතේ තවමත් කිසිදු වෙනසක් සිදු කර නැත.",
  "Applied. Your source data was not changed.":
    "යොදන ලදී. ඔබේ මූලාශ්‍ර දත්ත වෙනස් වී නැත.",
  "Undone. What this add-in created was removed.":
    "ආපසු හැරවිණි. මෙම add-in එක සාදන ලද දෑ ඉවත් කරන ලදී.",
  "Partly applied. See the steps and Diagnostics.":
    "අර්ධ වශයෙන් යොදන ලදී. පියවර සහ දෝෂ විමර්ශන තොරතුරු බලන්න.",
  "Signed out. Sign in to inspect selected Excel data.":
    "ඉවත් විය. තෝරාගත් Excel දත්ත පරීක්ෂා කිරීමට නැවත පිවිසෙන්න.",
  "Sign in to inspect selected Excel data.":
    "තෝරාගත් Excel දත්ත පරීක්ෂා කිරීමට පිවිසෙන්න.",
  "Signed in. Select data and inspect it.":
    "පිවිසුණා. දත්ත තෝරා ඒවා පරීක්ෂා කරන්න.",
  "Opening Microsoft sign-in...": "Microsoft පිවිසුම විවෘත කරමින්...",
  "Completing Microsoft sign-in...": "Microsoft පිවිසුම සම්පූර්ණ කරමින්...",
  "M365 OAuth configuration is missing.": "M365 OAuth වින්‍යාසය සොයාගත නොහැක.",
  "Microsoft session changed or expired. Sign in again to continue.":
    "Microsoft සැසිය වෙනස් වී හෝ කල් ඉකුත් වී ඇත. ඉදිරියට යාමට නැවත පිවිසෙන්න.",
  "Sign in before inspecting Excel data.":
    "Excel දත්ත පරීක්ෂා කිරීමට පෙර පිවිසෙන්න.",
  "Sign in before analyzing Excel data.":
    "Excel දත්ත විශ්ලේෂණයට පෙර පිවිසෙන්න.",
  "Inspecting selected formulas locally...":
    "තෝරාගත් සූත්‍ර මෙම උපාංගයේම පරීක්ෂා කරමින්...",
  "Formula inspection is ready. Nothing was sent or changed.":
    "සූත්‍ර පරීක්ෂාව සූදානම්. කිසිවක් යවා හෝ වෙනස් කර නැත.",
  "Inspecting the selected range...": "තෝරාගත් පරාසය පරීක්ෂා කරමින්...",
  "Answered from the selected data. Nothing was sent.":
    "තෝරාගත් දත්ත අනුව පිළිතුරු දෙන ලදී. කිසිවක් යවා නැත.",
  "Say what to create: a table, chart, result sheet, PivotTable, clean-up, or a computed column. Or ask a question about the data.":
    "සෑදිය යුත්තේ කුමක්දැයි පවසන්න: වගුවක්, ප්‍රස්තාරයක්, ප්‍රතිඵල පත්‍රිකාවක්, PivotTable එකක්, දත්ත පිරිසිදු කිරීමක් හෝ ගණනය කළ තීරුවක්. නැතහොත් දත්ත ගැන ප්‍රශ්නයක් අසන්න.",
  "The server preview does not match the selection. See Diagnostics.":
    "සේවාදායකයේ පෙරදසුන ඔබේ තේරීමට ගැළපෙන්නේ නැත. දෝෂ විමර්ශන තොරතුරු බලන්න.",
  "Preview ready. Nothing has changed yet. Review it before applying.":
    "පෙරදසුන සූදානම්. තවමත් කිසිවක් වෙනස් වී නැත. යෙදීමට පෙර එය පරීක්ෂා කරන්න.",
  "Create a preview before applying.": "යෙදීමට පෙර පෙරදසුනක් සාදන්න.",
  "Requesting approval...": "අනුමැතිය ඉල්ලමින්...",
  "Applying approved changes...": "අනුමත වෙනස්කම් යොදමින්...",
  "Column choice set. Click Inspect and preview; nothing changes until you confirm.":
    "තීරු තේරීම සකසන ලදී. “පරීක්ෂා කර පෙරදසුන බලන්න” ඔබන්න; ඔබ තහවුරු කරන තුරු කිසිවක් වෙනස් නොවේ.",
  "Instruction set. Click Inspect and preview; nothing changes until you confirm.":
    "උපදෙස සකසන ලදී. “පරීක්ෂා කර පෙරදසුන බලන්න” ඔබන්න; ඔබ තහවුරු කරන තුරු කිසිවක් වෙනස් නොවේ.",
  "Use this recommendation": "මෙම නිර්දේශය භාවිතා කරන්න",
  Columns: "තීරු",
  "Data quality": "දත්ත ගුණාත්මකභාවය",
  Recommendations: "නිර්දේශ",
  "No safe recommendation was found.": "ආරක්ෂිත නිර්දේශයක් හමු නොවීය.",
  "Advice only: no workbook action is available for this.":
    "උපදෙස් පමණි: මේ සඳහා වැඩපොතේ ක්‍රියාවක් නොමැත.",
  Done: "සම්පූර්ණයි",
  "AI analysis needs your explicit consent first.":
    "AI විශ්ලේෂණයට පළමුව ඔබේ පැහැදිලි කැමැත්ත අවශ්‍යයි.",
  "Review exactly what will be sent, then confirm to continue.":
    "යවනු ලබන දේ හරියටම පරීක්ෂා කර, ඉදිරියට යාමට තහවුරු කරන්න.",
  "Nothing was sent.": "කිසිවක් යවා නැත.",
  "Analyzing the summary...": "සාරාංශය විශ්ලේෂණය කරමින්...",
  "Analysis ready. It is advice only; nothing has changed.":
    "විශ්ලේෂණය සූදානම්. මෙය උපදෙස් පමණි; කිසිවක් වෙනස් වී නැත.",
  "Diagnostics copied. They contain no tokens or cell values.":
    "දෝෂ විමර්ශන තොරතුරු පිටපත් කරන ලදී. ඒවායේ ටෝකන හෝ කොටු අගයන් අඩංගු නොවේ.",
  "Workbook overview ready. Only names and sizes were read.":
    "වැඩපොතේ සාරාංශය සූදානම්. කියවනු ලැබුවේ නම් සහ ප්‍රමාණ පමණි.",
  "Remove the result sheets and Table this add-in created? Your original data is not touched.":
    "මෙම add-in එක සාදන ලද ප්‍රතිඵල පත්‍රිකා සහ වගුව ඉවත් කරන්නද? ඔබේ මූලාශ්‍ර දත්ත නොවෙනස්ව පවතී.",
  Remove: "ඉවත් කරන්න",
  "result sheet": "ප්‍රතිඵල පත්‍රිකාව",
  table: "වගුව",
  chart: "ප්‍රස්තාරය",
  "pivot-table": "PivotTable",
  "new-sheet": "ප්‍රතිඵල පත්‍රිකාව",
  clean: "දත්ත පිරිසිදු කිරීම",
  "add-column": "ගණනය කළ තීරුව",
  summary: "සාරාංශ වගුව",
  format: "හැඩසවි කිරීම",
  quality: "දත්ත ගුණාත්මක වාර්තාව",
  view: "පෙරහන් කළ දසුන",
};

type Template = [RegExp, (...groups: string[]) => string];

const TEMPLATES: Template[] = [
  [
    /^Found your table at (.+). Preview ready. Nothing has changed yet. Review it before applying.$/,
    (address) =>
      `ඔබේ වගුව ${address} හි හමු විය. පෙරදසුන සූදානම්. තවමත් කිසිවක් වෙනස් වී නැත. යෙදීමට පෙර එය පරීක්ෂා කරන්න.`,
  ],
  [
    /^Reading selected rows: (\d+)\/(\d+)\.\.\.$/,
    (done, total) => `තෝරාගත් පේළි කියවමින්: ${done}/${total}...`,
  ],
  [
    /^VynorAI request failed \((.+)\)\. See Diagnostics\.$/,
    (code) =>
      `VynorAI ඉල්ලීම අසාර්ථක විය (${code}). දෝෂ විමර්ශන තොරතුරු බලන්න.`,
  ],
  [
    /^Removed (\d+) sheet\(s\) and converted (\d+) table\(s\) back to a range\.$/,
    (sheets, tables) =>
      `පත්‍රිකා ${sheets}ක් ඉවත් කර, වගු ${tables}ක් නැවත සාමාන්‍ය පරාසයක් බවට හරවන ලදී.`,
  ],
  [
    /^Applied (\d+) of (\d+) actions\. Failed: (.+)\. See Diagnostics\.(.*)$/,
    (done, total, failed, rest) =>
      `ක්‍රියා ${total}න් ${done}ක් යොදන ලදී. අසාර්ථක වූ: ${failed}. දෝෂ විමර්ශන තොරතුරු බලන්න.${rest}`,
  ],
  [
    /^Applied: (.+)\. Source data unchanged: (yes|NO)\.(.*)$/,
    (done, unchanged, rest) =>
      `යොදන ලදී: ${done}. මූලාශ්‍ර දත්ත වෙනස් නොවීම: ${unchanged === "yes" ? "ඔව්" : "නැත — පරීක්ෂා කරන්න"}.${rest}`,
  ],
];

export function localizeMessageSi(text: string): string {
  const trimmed = text.trim();
  if (EXACT[trimmed]) return EXACT[trimmed];
  for (const [pattern, build] of TEMPLATES) {
    const match = pattern.exec(trimmed);
    if (match) return build(...match.slice(1));
  }
  return text;
}

/** Preview summary line: "<actions> on <sheets>. N data rows, M columns. Your source data stays unchanged." */
export function previewSummarySi(parts: {
  actions: string[];
  sheets: string[];
  rows: number;
  columns: number;
  warnings: string[];
}): string {
  const actions = parts.actions.map((kind) => EXACT[kind] ?? kind).join(", ");
  return (
    `${actions} — ${parts.sheets.join(", ")} පත්‍රිකාවේ. ` +
    `දත්ත පේළි ${parts.rows}ක් සහ තීරු ${parts.columns}ක්. ` +
    `ඔබේ මූලාශ්‍ර දත්ත වෙනස් නොවේ.` +
    (parts.warnings.length ? ` ${parts.warnings.join(" ")}` : "")
  );
}
