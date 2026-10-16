/**
 * Sinhala wording for the messages the task pane builds at run time (status line, change note,
 * preview summary). Static labels live in i18n.ts. A message is matched as a whole first, then
 * sentence by sentence; anything unknown stays in English so nothing is ever mistranslated.
 */

const EXACT: Record<string, string> = {
  "Sparklines are not available in this Excel add-in yet. Use a line chart on a new result sheet instead.":
    "මෙම Excel add-in එකේ Sparklines තවම ලබාගත නොහැක. ඒ වෙනුවට අලුත් result sheet එකක line chart එකක් භාවිතා කරන්න.",
  "Scheduled refresh is not available in this add-in yet. Run the request again when you want a fresh, reviewed result.":
    "නියමිත වේලාවට refresh කිරීම තවම ලබාගත නොහැක. අලුත්, පරීක්ෂා කළ result එකක් අවශ්‍ය වූ විට ඉල්ලීම නැවත run කරන්න.",
  "Email delivery is not enabled. VynorAI will not request Mail permissions or send workbook data by email.":
    "Email යැවීම සක්‍රීය කර නැත. VynorAI Mail permissions ඉල්ලා workbook data email මගින් නොයවයි.",
  "export-csv": "CSV අපනයනය",
  "export-pdf": "PDF අපනයනය",
  "No preview yet.": "තවමත් පෙරදසුනක් නැත.",
  "Nothing has changed in your workbook yet.":
    "ඔබේ වැඩපොතේ තවමත් කිසිදු වෙනසක් සිදු කර නැත.",
  "Preview cancelled. Nothing has changed in your workbook.":
    "පෙරදසුන අවලංගු කරන ලදී. ඔබේ වැඩපොතේ කිසිදු වෙනසක් සිදු කර නැත.",
  "inconsistent formula pattern": "අසමාන formula රටාව",
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
  "Use these steps": "මෙම පියවර භාවිතා කරන්න",
  "Describe what you want first, then plan the steps.":
    "ඔබට අවශ්‍ය දේ මුලින් ලියන්න, ඉන්පසු පියවර සැලසුම් කරන්න.",
  "Excel could not find that sheet or range. Click a cell inside your table and try again.":
    "Excel හට එම පත්‍රිකාව හෝ පරාසය සොයාගත නොහැකි විය. ඔබේ වගුව ඇතුළත කොටුවක් ක්ලික් කර නැවත උත්සාහ කරන්න.",
  "OAuth state validation failed: that sign-in attempt expired or was replaced. Press Sign in once more":
    "එම පිවිසුම් උත්සාහය කල් ඉකුත් විය හෝ අලුත් එකකින් ප්‍රතිස්ථාපනය විය. නැවත පිවිසෙන්න ඔබන්න.",
  "AI analysis needs your explicit consent first.":
    "AI විශ්ලේෂණයට පළමුව ඔබේ පැහැදිලි කැමැත්ත අවශ්‍යයි.",
  "The AI answer did not match the expected format and was discarded.":
    "AI පිළිතුර අපේක්ෂිත ආකෘතියට නොගැළපුණු නිසා ඉවත දමන ලදී. නැවත උත්සාහ කරන්න.",
  "Too many analysis requests. Wait a minute and try again.":
    "විශ්ලේෂණ ඉල්ලීම් ඉතා වැඩියි. විනාඩියක් රැඳී නැවත උත්සාහ කරන්න.",
  "The AI service is unavailable right now. Try again later.":
    "AI සේවාව මේ මොහොතේ ලබා ගත නොහැක. පසුව නැවත උත්සාහ කරන්න.",
  "The local summary was rejected. Select the range again.":
    "දේශීය සාරාංශය ප්‍රතික්ෂේප විය. පරාසය නැවත තෝරන්න.",
  "The summary was rejected because it contained more than allowed.":
    "අවසර ඇති ප්‍රමාණයට වඩා අඩංගු නිසා සාරාංශය ප්‍රතික්ෂේප විය.",
  "Your Microsoft 365 organization is not enabled in VynorAI yet.":
    "ඔබේ Microsoft 365 සංවිධානය VynorAI හි තවම සක්‍රිය කර නැත.",
  "Your organization is enabled in VynorAI, but not for this Excel action.":
    "ඔබේ සංවිධානය VynorAI හි සක්‍රියයි, නමුත් මෙම Excel ක්‍රියාව සඳහා නොවේ.",
  "Your Microsoft account must be linked to a VynorAI account by an administrator.":
    "ඔබේ Microsoft ගිණුම පරිපාලකයෙකු විසින් VynorAI ගිණුමකට සම්බන්ධ කළ යුතුය.",
  "Microsoft consent is missing a required Excel permission.":
    "Microsoft කැමැත්තෙහි අවශ්‍ය Excel අවසරයක් නොමැත.",
  "The linked VynorAI account has no credits available.":
    "සම්බන්ධ VynorAI ගිණුමේ ක්‍රෙඩිට් ඉතිරි නැත.",
  "VynorAI could not be reached. Check the network and retry.":
    "VynorAI වෙත ළඟා විය නොහැක. ජාලය පරීක්ෂා කර නැවත උත්සාහ කරන්න.",
  "The approval no longer matches this preview. Inspect again.":
    "අනුමැතිය මෙම පෙරදසුනට තවදුරටත් නොගැළපේ. නැවත පරීක්ෂා කරන්න.",
  "This approval was already used. Inspect the selection again for a new preview.":
    "මෙම අනුමැතිය දැනටමත් භාවිතා කර ඇත. නව පෙරදසුනක් සඳහා නැවත පරීක්ෂා කරන්න.",
  "Select one complete header row and at least one data row.":
    "සම්පූර්ණ ශීර්ෂ පේළියක් සහ අවම වශයෙන් දත්ත පේළියක් තෝරන්න.",
  "The first selected row has blank or merged headers. Select a flat table with one complete header row.":
    "තෝරාගත් පළමු පේළියේ හිස් හෝ ඒකාබද්ධ ශීර්ෂ ඇත. සම්පූර්ණ ශීර්ෂ පේළියක් සහිත සරල වගුවක් තෝරන්න.",
  "Select one rectangular Excel range.":
    "සෘජුකෝණාස්‍රාකාර Excel පරාසයක් තෝරන්න.",
  "The selected range is too large. Select at most 100,000 cells and 100 columns.":
    "තෝරාගත් පරාසය ඉතා විශාලයි. උපරිම කොටු 100,000ක් සහ තීරු 100ක් තෝරන්න.",
  "The selection is too wide. Select at most 100 columns.":
    "තෝරාගත් පරාසය ඉතා පළලයි. උපරිම තීරු 100ක් තෝරන්න.",
  "This data is too large to read in full. A PivotTable works on every row; select at most 100,000 cells for other results.":
    "මෙම දත්ත සම්පූර්ණයෙන් කියවීමට නොහැකි තරම් විශාලයි. PivotTable එක සියලු පේළි මත ක්‍රියා කරයි; අනෙක් ප්‍රතිඵල සඳහා කොටු 100,000ක් දක්වා තෝරන්න.",
  "The VynorAI service is busy or restarting. Try again in a moment.":
    "VynorAI සේවාව කාර්යබහුලයි හෝ නැවත ආරම්භ වෙමින් පවතී. මොහොතකින් නැවත උත්සාහ කරන්න.",
  "Click a cell inside your table (or select it) so it has a header row and at least one data row.":
    "ඔබේ වගුව ඇතුළත කොටුවක් ක්ලික් කරන්න (හෝ වගුව තෝරන්න); එහි ශීර්ෂ පේළියක් සහ දත්ත පේළියක් තිබිය යුතුය.",
  "Preparing the preview. Nothing changes until you confirm.":
    "පෙරදසුන සූදානම් කරමින්. ඔබ තහවුරු කරන තුරු කිසිවක් වෙනස් නොවේ.",
  "A Microsoft sign-in window is already open. Finish it, or close it and press Sign in again.":
    "Microsoft පිවිසුම් කවුළුවක් දැනටමත් විවෘතයි. එය සම්පූර්ණ කරන්න, නැතහොත් වසා නැවත පිවිසෙන්න ඔබන්න.",
  "The sign-in window was blocked. Allow pop-ups for this page, then press Sign in again.":
    "පිවිසුම් කවුළුව අවහිර විය. මෙම පිටුවට pop-ups ඉඩ දී නැවත පිවිසෙන්න ඔබන්න.",
  "The browser blocked the sign-in window. Allow pop-ups for Office, then press Sign in again.":
    "බ්‍රවුසරය පිවිසුම් කවුළුව අවහිර කළා. Office සඳහා pop-ups ඉඩ දී නැවත පිවිසෙන්න ඔබන්න.",
  Columns: "තීරු",
  "Data quality": "දත්ත ගුණාත්මකභාවය",
  Recommendations: "නිර්දේශ",
  "No safe recommendation was found.": "ආරක්ෂිත නිර්දේශයක් හමු නොවීය.",
  "Advice only: no workbook action is available for this.":
    "උපදෙස් පමණි: මේ සඳහා වැඩපොතේ ක්‍රියාවක් නොමැත.",
  Done: "සම්පූර්ණයි",
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
  statistics: "සංඛ්‍යාලේඛන",
  view: "පෙරහන් කළ දසුන",
  "lookup-columns": "Lookup columns",
};

type Template = [RegExp, (...groups: string[]) => string];

const TEMPLATES: Template[] = [
  [
    /^(\d+) formula cell\(s\), (\d+) error cell\(s\), (\d+) possible direct circular reference\(s\), (\d+) inconsistent formula\(s\), (\d+) hard-coded numeric cell\(s\)\.$/,
    (formulas, errors, circular, inconsistent, hardCoded) =>
      `formula cells ${formulas}ක්, දෝෂ cells ${errors}ක්, සෘජු circular references ${circular}ක්, අසමාන formulas ${inconsistent}ක්, formula columns තුළ hard-coded numeric cells ${hardCoded}ක්.`,
  ],
  [
    /^Writing result rows: (\d+)\/(\d+)\.\.\.$/,
    (done, total) => `ප්‍රතිඵල පේළි ලියමින්: ${done}/${total}...`,
  ],
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
