/**
 * Sinhala and Tamil for the one-line descriptions of the workbook-object tools (agentActions.ts
 * `describe`). The sentences are built from fixed frames plus an action word taken from a closed
 * list, so each frame is matched whole and the action word is looked up; anything not in the table
 * (a column name, a value, a formula) is kept as it is. Text that matches no frame is returned
 * unchanged, so English never gets worse.
 */
type Lang = "si" | "ta";

const WORDS: Record<Lang, Record<string, string>> = {
  si: {
    "insert rows": "පේළි ඇතුළත් කරන්න", "delete rows": "පේළි මකන්න",
    "insert columns": "තීරු ඇතුළත් කරන්න", "delete columns": "තීරු මකන්න",
    "hide rows": "පේළි සඟවන්න", "unhide rows": "පේළි පෙන්වන්න",
    "hide columns": "තීරු සඟවන්න", "unhide columns": "තීරු පෙන්වන්න",
    "group rows": "පේළි කාණ්ඩ කරන්න", "ungroup rows": "පේළි කාණ්ඩ ඉවත් කරන්න",
    "group columns": "තීරු කාණ්ඩ කරන්න", "ungroup columns": "තීරු කාණ්ඩ ඉවත් කරන්න",
    "column width": "තීරු පළල", "row height": "පේළි උස",
    "clear contents": "අන්තර්ගතය මකන්න", "clear formats": "ආකෘති මකන්න",
    merge: "ඒකාබද්ධ කරන්න", unmerge: "ඒකාබද්ධය අහෝසි කරන්න",
    "fill down": "පහළට පුරවන්න", "fill right": "දකුණට පුරවන්න",
    move: "ගෙන යන්න", "paste values": "අගයන් අලවන්න", transpose: "පේළි තීරු මාරු කරන්න",
    "remove duplicates": "අනුපිටපත් ඉවත් කරන්න",
    rename: "නම වෙනස් කරන්න", hide: "සඟවන්න", unhide: "පෙන්වන්න", copy: "පිටපත් කරන්න",
    delete: "මකන්න", "tab color": "ටැබ් වර්ණය", "freeze rows": "පේළි ශීත කරන්න",
    "freeze columns": "තීරු ශීත කරන්න", "freeze at": "මෙතැන ශීත කරන්න", unfreeze: "ශීතය ඉවත් කරන්න",
    activate: "සක්‍රිය කරන්න", "gridlines on": "ජාල රේඛා පෙන්වන්න", "gridlines off": "ජාල රේඛා සඟවන්න",
    title: "මාතෘකාව", "axis titles": "අක්ෂ මාතෘකා", "data labels on": "දත්ත ලේබල් පෙන්වන්න",
    "data labels off": "දත්ත ලේබල් සඟවන්න", legend: "ප්‍රධාන සටහන", "series color": "ශ්‍රේණි වර්ණය",
    "chart type": "ප්‍රස්තාර වර්ගය", position: "ස්ථානය", trendline: "ප්‍රවණතා රේඛාව",
    protect: "ආරක්ෂා කරන්න", unprotect: "ආරක්ෂාව ඉවත් කරන්න",
    "lock cells": "කොටු අගුළු දමන්න", "unlock cells": "කොටු අගුළු ඇරින්න",
    refresh: "නැවුම් කරන්න", create: "සාදන්න",
    style: "විලාසය", "total row on": "එකතු පේළිය පෙන්වන්න", "total row off": "එකතු පේළිය සඟවන්න",
    resize: "ප්‍රමාණය වෙනස් කරන්න", "add column": "තීරුවක් එක් කරන්න", "convert to range": "පරාසයක් බවට හරවන්න",
    sort: "වර්ග කරන්න", filter: "පෙරන්න", "clear filter": "පෙරහන ඉවත් කරන්න",
    "add row": "පේළියක් එක් කරන්න", "add value": "අගයක් එක් කරන්න", "add filter": "පෙරහනක් එක් කරන්න",
    "remove field": "ක්ෂේත්‍රය ඉවත් කරන්න", "summarize by": "සාරාංශ කරන්නේ", "show as": "පෙන්වන්නේ",
    "number format": "අංක ආකෘතිය", layout: "පිරිසැලසුම", "subtotals on": "උප එකතු පෙන්වන්න",
    "subtotals off": "උප එකතු සඟවන්න", "grand totals on": "මුළු එකතු පෙන්වන්න", "grand totals off": "මුළු එකතු සඟවන්න",
    "sort labels": "ලේබල් වර්ග කරන්න", "sort values": "අගයන් වර්ග කරන්න",
    "secondary axis": "ද්විතීය අක්ෂය", "series type": "ශ්‍රේණි වර්ගය",
  },
  ta: {
    "insert rows": "வரிசைகளைச் செருகு", "delete rows": "வரிசைகளை நீக்கு",
    "insert columns": "நெடுவரிசைகளைச் செருகு", "delete columns": "நெடுவரிசைகளை நீக்கு",
    "hide rows": "வரிசைகளை மறை", "unhide rows": "வரிசைகளைக் காட்டு",
    "hide columns": "நெடுவரிசைகளை மறை", "unhide columns": "நெடுவரிசைகளைக் காட்டு",
    "group rows": "வரிசைகளைக் குழுவாக்கு", "ungroup rows": "வரிசைக் குழுவை நீக்கு",
    "group columns": "நெடுவரிசைகளைக் குழுவாக்கு", "ungroup columns": "நெடுவரிசைக் குழுவை நீக்கு",
    "column width": "நெடுவரிசை அகலம்", "row height": "வரிசை உயரம்",
    "clear contents": "உள்ளடக்கத்தை அழி", "clear formats": "வடிவங்களை அழி",
    merge: "ஒன்றிணை", unmerge: "இணைப்பை நீக்கு",
    "fill down": "கீழே நிரப்பு", "fill right": "வலப்புறம் நிரப்பு",
    move: "நகர்த்து", "paste values": "மதிப்புகளை ஒட்டு", transpose: "வரிசை நெடுவரிசையை மாற்று",
    "remove duplicates": "நகல்களை நீக்கு",
    rename: "பெயர் மாற்று", hide: "மறை", unhide: "காட்டு", copy: "நகலெடு",
    delete: "நீக்கு", "tab color": "தாவல் நிறம்", "freeze rows": "வரிசைகளை உறைய வை",
    "freeze columns": "நெடுவரிசைகளை உறைய வை", "freeze at": "இங்கே உறைய வை", unfreeze: "உறைவை நீக்கு",
    activate: "செயல்படுத்து", "gridlines on": "கட்டக் கோடுகளைக் காட்டு", "gridlines off": "கட்டக் கோடுகளை மறை",
    title: "தலைப்பு", "axis titles": "அச்சு தலைப்புகள்", "data labels on": "தரவு லேபிள்களைக் காட்டு",
    "data labels off": "தரவு லேபிள்களை மறை", legend: "விளக்கம்", "series color": "தொடர் நிறம்",
    "chart type": "விளக்கப்பட வகை", position: "இடம்", trendline: "போக்குக் கோடு",
    protect: "பாதுகாக்க", unprotect: "பாதுகாப்பை நீக்கு",
    "lock cells": "கலங்களைப் பூட்டு", "unlock cells": "கலங்களைத் திற",
    refresh: "புதுப்பி", create: "உருவாக்கு",
    style: "பாணி", "total row on": "மொத்த வரிசையைக் காட்டு", "total row off": "மொத்த வரிசையை மறை",
    resize: "அளவை மாற்று", "add column": "நெடுவரிசையைச் சேர்", "convert to range": "வரம்பாக மாற்று",
    sort: "வரிசைப்படுத்து", filter: "வடிகட்டு", "clear filter": "வடிகட்டியை அழி",
    "add row": "வரிசையைச் சேர்", "add value": "மதிப்பைச் சேர்", "add filter": "வடிகட்டியைச் சேர்",
    "remove field": "புலத்தை நீக்கு", "summarize by": "சுருக்கும் முறை", "show as": "காட்டும் முறை",
    "number format": "எண் வடிவம்", layout: "அமைப்பு", "subtotals on": "துணை மொத்தங்களைக் காட்டு",
    "subtotals off": "துணை மொத்தங்களை மறை", "grand totals on": "மொத்தங்களைக் காட்டு", "grand totals off": "மொத்தங்களை மறை",
    "sort labels": "லேபிள்களை வரிசைப்படுத்து", "sort values": "மதிப்புகளை வரிசைப்படுத்து",
    "secondary axis": "இரண்டாம் அச்சு", "series type": "தொடர் வகை",
  },
};

const T: Record<Lang, Record<string, string>> = {
  si: {
    undo: "(ආපසු හැරවීමෙන් නැවත ලැබේ)",
    hiddenNotDeleted: "(පේළි සඟවයි, මකන්නේ නැත)",
    copyKept: "(ආපසු හැරවීම සඳහා සැඟවූ පිටපතක් තබයි)",
    permanent: "ස්ථිරවම (පිටපතක් නොතබයි, ආපසු හැරවීමට නොහැක)",
    chartNoUndo: "(Agent එක නොදැමූ ප්‍රස්තාරයක් ආපසු හැරවීමෙන් නැවත ලබා ගත නොහැක)",
    live: "සජීවී සූත්‍ර ලෙස",
    deleteRows: "පේළි මකන්න",
    where: "කොන්දේසිය",
    clearFilter: "පෙරහන ඉවත් කරන්න",
    removeFilter: "පෙරහන් බොත්තම් ඉවත් කරන්න",
    filter: "පෙරහන",
    removeCf: "කොන්දේසි සහිත හැඩගැන්වීම ඉවත් කරන්න",
    cf: "කොන්දේසි සහිත හැඩගැන්වීම",
    removeValidation: "වලංගුකරණය ඉවත් කරන්න",
    validation: "වලංගුකරණය",
    toTable: "Excel වගුවක් බවට හරවන්න",
    table: "වගුව",
    addName: "නම එක් කරන්න", delName: "නම මකන්න", renName: "නම වෙනස් කරන්න",
    pivot: "PivotTable",
    chart: "ප්‍රස්තාරය",
    pageSetup: "පිටු සැකසුම",
    replace: "ප්‍රතිස්ථාපනය",
    withText: "මෙයින්",
    inPlace: "ස්ථානයේම පිරිසිදු කරන්න",
    goal: "ඉලක්කය සොයන්න",
    join: "සම්බන්ධ කරන්න",
    append: "එකතු කරන්න",
    reconcile: "ගැළපීම බලන්න",
    sheet: "පත්‍රිකාව",
    cleanKept: "(සූත්‍ර සහ ආරම්භක බිංදු සහිත අංක නොවෙනස්ව පවතී; ආපසු හැරවීමෙන් නැවත ලැබේ)",
    comment: "අදහස",
  },
  ta: {
    undo: "(செயல்தவிர்த்தால் மீளும்)",
    hiddenNotDeleted: "(வரிசைகள் மறைக்கப்படும், நீக்கப்படாது)",
    copyKept: "(செயல்தவிர்க்க மறைக்கப்பட்ட நகல் வைக்கப்படும்)",
    permanent: "நிரந்தரமாக (நகல் வைக்கப்படாது, செயல்தவிர்க்க முடியாது)",
    chartNoUndo: "(Agent சேர்க்காத விளக்கப்படத்தை செயல்தவிர்த்து மீட்க முடியாது)",
    live: "நேரடி சூத்திரங்களாக",
    deleteRows: "வரிசைகளை நீக்கு",
    where: "நிபந்தனை",
    clearFilter: "வடிகட்டியை அழி",
    removeFilter: "வடிகட்டி பொத்தான்களை நீக்கு",
    filter: "வடிகட்டி",
    removeCf: "நிபந்தனை வடிவமைப்பை நீக்கு",
    cf: "நிபந்தனை வடிவமைப்பு",
    removeValidation: "சரிபார்ப்பை நீக்கு",
    validation: "சரிபார்ப்பு",
    toTable: "Excel அட்டவணையாக மாற்று",
    table: "அட்டவணை",
    addName: "பெயரைச் சேர்", delName: "பெயரை நீக்கு", renName: "பெயரை மாற்று",
    pivot: "PivotTable",
    chart: "விளக்கப்படம்",
    pageSetup: "பக்க அமைப்பு",
    replace: "மாற்று",
    withText: "இதனால்",
    inPlace: "இடத்திலேயே சுத்தம் செய்",
    goal: "இலக்கைத் தேடு",
    join: "இணை",
    append: "சேர்",
    reconcile: "ஒப்பிடு",
    sheet: "தாள்",
    cleanKept: "(சூத்திரங்களும் முன்னணி பூஜ்ஜியம் உள்ள எண்களும் மாறாது; செயல்தவிர்த்தால் மீளும்)",
    comment: "கருத்து",
  },
};

const COMMENT: Record<Lang, Record<string, string>> = {
  si: {
    "Add a note to": "සටහනක් එක් කරන්න", "Add a comment to": "අදහසක් එක් කරන්න",
    "Reply the comment on": "අදහසට පිළිතුරු දෙන්න", "Resolve the comment on": "අදහස විසඳූ ලෙස සලකුණු කරන්න",
    "Reopen the comment on": "අදහස නැවත විවෘත කරන්න",
  },
  ta: {
    "Add a note to": "குறிப்பைச் சேர்", "Add a comment to": "கருத்தைச் சேர்",
    "Reply the comment on": "கருத்துக்குப் பதிலளி", "Resolve the comment on": "கருத்தை தீர்க்கப்பட்டதாகக் குறி",
    "Reopen the comment on": "கருத்தை மீண்டும் திற",
  },
};

const word = (lang: Lang, key: string) => WORDS[lang][key.replace(/_/g, " ")] ?? key;

/** "insert rows 5 at 2" -> the longest action word from the list ("insert rows") and the rest. */
function splitAction(lang: Lang, text: string): [string, string] {
  const plain = text.replace(/_/g, " ");
  const key = Object.keys(WORDS[lang])
    .filter((k) => plain === k || plain.startsWith(`${k} `))
    .sort((a, b) => b.length - a.length)[0];
  if (!key) return [text, ""];
  return [WORDS[lang][key], plain.slice(key.length).trim()];
}
const withRest = (action: string, rest: string) => (rest ? `${action} ${rest}` : action);
const KNOWN = (key: string) => key.replace(/_/g, " ") in WORDS.si;
const AT = "('[^']+'![^\\s,]+)";

type Frame = [RegExp, (lang: Lang, ...groups: string[]) => string];

const FRAMES: Frame[] = [
  [/^Delete the rows of (.+) where (.+)$/, (l, at, cond) => `${T[l].deleteRows}: ${at}, ${T[l].where}: ${cond}`],
  [/^Clear the filter on (.+)$/, (l, at) => `${T[l].clearFilter}: ${at}`],
  [/^Remove the filter buttons from (.+)$/, (l, at) => `${T[l].removeFilter}: ${at}`],
  [/^Filter (.+?) on (.+?): (.+?)(?: \(rows are hidden, not deleted\))?$/, (l, at, col, what) => `${T[l].filter} ${at} (${col}): ${what} ${T[l].hiddenNotDeleted}`],
  [/^Remove the conditional formatting from (.+)$/, (l, at) => `${T[l].removeCf}: ${at}`],
  [/^Conditional format (.+?): (.+)$/, (l, at, rest) => `${T[l].cf} ${at}: ${rest}`],
  [/^Remove validation from (.+)$/, (l, at) => `${T[l].removeValidation}: ${at}`],
  [/^Validation on (.+?): (.+)$/, (l, at, rest) => `${T[l].validation} ${at}: ${rest}`],
  [/^Turn (.+?) into an Excel Table(?: "(.+)")?$/, (l, at, name) => `${at} ${T[l].toTable}${name ? ` "${name}"` : ""}`],
  [/^Table "(.+?)": (.+)$/, (l, table, text) => `${T[l].table} "${table}": ${withRest(...splitAction(l, text))}`],
  [/^Add the name (.+)$/, (l, rest) => `${T[l].addName}: ${rest}`],
  [/^Delete the name (.+)$/, (l, rest) => `${T[l].delName}: ${rest}`],
  [/^Rename the name (.+)$/, (l, rest) => `${T[l].renName}: ${rest}`],
  [/^PivotTable "(.+?)": (.+)$/, (l, pivot, text) => `${T[l].pivot} "${pivot}": ${withRest(...splitAction(l, text))}`],
  [/^Chart "(.+?)" on '(.+?)': (.+?)( \(a chart the agent did not add cannot be restored by undo\))?$/, (l, chart, sheet, text, note) => `${T[l].chart} "${chart}" ('${sheet}'): ${withRest(...splitAction(l, text))}${note ? ` ${T[l].chartNoUndo}` : ""}`],
  [/^Page setup of "(.+?)": (.+)$/, (l, sheet, rest) => `${T[l].pageSetup} "${sheet}": ${rest}`],
  [/^Replace "(.*)" with "(.*)" in (.+?)( \(whole cell\))? \(undo restores it\)$/, (l, from, to, where, whole) => `${T[l].replace}: "${from}" → "${to}", ${where}${whole ? " (whole cell)" : ""} ${T[l].undo}`],
  [/^Clean (.+?) in place: (.+?) \(formulas and IDs with leading zeros are kept; undo restores it\)$/, (l, at, op) => `${T[l].inPlace}: ${at}, ${op.replace(/_/g, " ")} ${T[l].cleanKept}`],
  [/^Goal seek: change (.+?) until (.+?) = (.+)$/, (l, change, formula, target) => `${T[l].goal}: ${change} → ${formula} = ${target}`],
  [/^Join (.+?) with (.+?) on (.+?) into (.+?) as live formulas$/, (l, a, b, on, into) => `${T[l].join}: ${a} + ${b} (${on}) → ${into}, ${T[l].live}`],
  [/^Append (.+?) under (.+?) \(columns matched by header\) into (.+?) as live formulas$/, (l, b, a, into) => `${T[l].append}: ${b} → ${a}, ${into}, ${T[l].live}`],
  [/^Reconcile (.+?) with (.+?) on (.+?) into (.+?) as live formulas$/, (l, a, b, on, into) => `${T[l].reconcile}: ${a} / ${b} (${on}) → ${into}, ${T[l].live}`],
  [/^Loan schedule: (.+?) at (.+?)% for (.+?) years, (.+?) payments a year, into (.+?) as live formulas$/, (l, amount, rate, years, per, into) => l === "si" ? `ණය ගෙවීම් කාලසටහන: ${amount}, ${rate}%, වසර ${years}, වසරකට ගෙවීම් ${per} → ${into}, ${T[l].live}` : `கடன் தவணை அட்டவணை: ${amount}, ${rate}%, ${years} ஆண்டுகள், ஆண்டுக்கு ${per} தவணைகள் → ${into}, ${T[l].live}`],
  [/^(XNPV and XIRR|NPV, IRR) and payback of (.+?) at (.+?)% into (.+?) as live formulas$/, (l, kind, flows, rate, into) => l === "si" ? `${kind} සහ ආපසු ගෙවීමේ කාලය: ${flows}, ${rate}% → ${into}, ${T[l].live}` : `${kind} மற்றும் திரும்பப் பெறும் காலம்: ${flows}, ${rate}% → ${into}, ${T[l].live}`],
  [/^Budget against actual by (.+?): (.+?) vs (.+?) into (.+?) as live formulas$/, (l, by, actual, budget, into) => l === "si" ? `අයවැය සහ සැබෑ අගය (${by}): ${actual} සහ ${budget} → ${into}, ${T[l].live}` : `பட்ஜெட் மற்றும் உண்மை (${by}): ${actual} மற்றும் ${budget} → ${into}, ${T[l].live}`],
  [/^Receivables ageing of (.+?) as of (.+?) \(0-30, 31-60, 61-90, over 90 days\) into (.+?) as live formulas$/, (l, amounts, asOf, into) => l === "si" ? `ලැබිය යුතු මුදල් වයස් විශ්ලේෂණය: ${amounts}, ${asOf} දිනට (දින 0-30, 31-60, 61-90, 90ට වැඩි) → ${into}, ${T[l].live}` : `பெறத்தக்க தொகை வயது பகுப்பாய்வு: ${amounts}, ${asOf} வரை (0-30, 31-60, 61-90, 90க்கு மேல்) → ${into}, ${T[l].live}`],
  [/^Compare (\d+) scenarios \((.+?)\) on (.+?) into (.+?) as values \(inputs are put back\)$/, (l, n, names, outputs, into) => l === "si" ? `තත්ත්ව ${n} ක් සසඳන්න (${names}): ${outputs} → ${into}, අගයන් ලෙස (ආදාන නැවත තබයි)` : `${n} சூழ்நிலைகளை ஒப்பிடு (${names}): ${outputs} → ${into}, மதிப்புகளாக (உள்ளீடுகள் மீண்டும் வைக்கப்படும்)`],
  [/^Two-input data table of (.+?): (.+?) x (.+?) \((.+?)\) into (.+?) as values \(inputs are put back\)$/, (l, outputs, a, b, size, into) => l === "si" ? `ආදාන දෙකක දත්ත වගුව: ${outputs}, ${a} × ${b} (${size}) → ${into}, අගයන් ලෙස (ආදාන නැවත තබයි)` : `இரு உள்ளீட்டு தரவு அட்டவணை: ${outputs}, ${a} × ${b} (${size}) → ${into}, மதிப்புகளாக (உள்ளீடுகள் மீண்டும் வைக்கப்படும்)`],
  [/^Data table of (.+?) for (\d+) values of (.+?) into (.+?) as values \(inputs are put back\)$/, (l, outputs, n, input, into) => l === "si" ? `දත්ත වගුව: ${outputs}, ${input} හි අගයන් ${n} → ${into}, අගයන් ලෙස (ආදාන නැවත තබයි)` : `தரவு அட்டவணை: ${outputs}, ${input} இன் மதிப்புகள் ${n} → ${into}, மதிப்புகளாக (உள்ளீடுகள் மீண்டும் வைக்கப்படும்)`],
  // "<action> sheet "X"" and "<action> 'S'!A1 ... (undo restores it)": the action word is looked up.
  [/^([a-z_ ]+?) sheet "(.+?)"(.*)$/, (l, action, sheet, rest) => `${T[l].sheet} "${sheet}": ${word(l, action)}${rest
    .replace(" (a hidden copy is kept for undo)", ` ${T[l].copyKept}`)
    .replace(" PERMANENTLY (no copy is kept, undo cannot bring it back)", ` ${T[l].permanent}`)}`],
  [/^(Add a note to|Add a comment to|Reply the comment on|Resolve the comment on|Reopen the comment on) (.+)$/, (l, verb, rest) => `${COMMENT[l][verb] ?? T[l].comment}: ${rest}`],
  [/^([a-z_ ]+?) ('[^']+'![^\s]*)(.*) \(undo restores it\)$/, (l, action, at, rest) => `${word(l, action)}: ${at}${rest} ${T[l].undo}`],
];

export function localizeAction(text: string, lang: Lang): string {
  const trimmed = text.trim();
  for (const [pattern, build] of FRAMES) {
    const match = pattern.exec(trimmed);
    if (!match) continue;
    // A leading action word must come from the closed list, else the frame is not ours.
    const first = match[1];
    if (/^[a-z_ ]+$/.test(first) && pattern.source.startsWith("^([a-z_ ]+?)") && !KNOWN(first))
      continue;
    return build(lang, ...match.slice(1).map((group) => group ?? ""));
  }
  return text;
}

export const ACTION_FRAME_COUNT = FRAMES.length;
void AT;
