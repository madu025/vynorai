/**
 * Tamil wording for the messages the task pane builds at run time (status line, change note,
 * preview summary). Static labels live in i18n.ts. A message is matched as a whole first, then
 * by template; anything unknown stays in English so nothing is ever mistranslated.
 * Needs a review by a native Tamil speaker before wide release.
 */

const EXACT: Record<string, string> = {
  "Sparklines are not available in this Excel add-in yet. Use a line chart on a new result sheet instead.":
    "இந்த Excel add-in-இல் Sparklines இன்னும் கிடைக்கவில்லை. அதற்குப் பதிலாக புதிய முடிவுத் தாளில் ஒரு line chart-ஐப் பயன்படுத்தவும்.",
  "Scheduled refresh is not available in this add-in yet. Run the request again when you want a fresh, reviewed result.":
    "குறிப்பிட்ட நேரத்தில் refresh செய்யும் வசதி இந்த add-in-இல் இன்னும் கிடைக்கவில்லை. புதிய, சரிபார்த்த முடிவு தேவைப்படும்போது கோரிக்கையை மீண்டும் இயக்கவும்.",
  "Email delivery is not enabled. VynorAI will not request Mail permissions or send workbook data by email.":
    "Email அனுப்புதல் இயக்கப்படவில்லை. VynorAI Mail அனுமதிகளைக் கேட்காது; பணிப்புத்தகத் தரவை email மூலம் அனுப்பாது.",
  "export-csv": "CSV ஏற்றுமதி",
  "export-pdf": "PDF ஏற்றுமதி",
  "No preview yet.": "இன்னும் முன்னோட்டம் இல்லை.",
  "Nothing has changed in your workbook yet.":
    "உங்கள் பணிப்புத்தகத்தில் இன்னும் எதுவும் மாறவில்லை.",
  "Preview cancelled. Nothing has changed in your workbook.":
    "முன்னோட்டம் ரத்து செய்யப்பட்டது. உங்கள் பணிப்புத்தகத்தில் எதுவும் மாறவில்லை.",
  "inconsistent formula pattern": "பொருந்தாத formula முறை",
  "Applied. Your source data was not changed.":
    "பயன்படுத்தப்பட்டது. உங்கள் மூலத் தரவு மாற்றப்படவில்லை.",
  "Undone. What this add-in created was removed.":
    "மீளமைக்கப்பட்டது. இந்த add-in உருவாக்கியவை நீக்கப்பட்டன.",
  "Partly applied. See the steps and Diagnostics.":
    "பகுதியாக மட்டும் பயன்படுத்தப்பட்டது. படிகளையும் கண்டறிதல் விவரங்களையும் பார்க்கவும்.",
  "Signed out. Sign in to inspect selected Excel data.":
    "வெளியேறினீர்கள். தேர்ந்தெடுத்த Excel தரவைச் சரிபார்க்க மீண்டும் உள்நுழையவும்.",
  "Sign in to inspect selected Excel data.":
    "தேர்ந்தெடுத்த Excel தரவைச் சரிபார்க்க உள்நுழையவும்.",
  "Signed in. Select data and inspect it.":
    "உள்நுழைந்தீர்கள். தரவைத் தேர்ந்தெடுத்துச் சரிபார்க்கவும்.",
  "Opening Microsoft sign-in...": "Microsoft உள்நுழைவைத் திறக்கிறது...",
  "Completing Microsoft sign-in...": "Microsoft உள்நுழைவை முடிக்கிறது...",
  "M365 OAuth configuration is missing.": "M365 OAuth அமைப்பு காணப்படவில்லை.",
  "Microsoft session changed or expired. Sign in again to continue.":
    "Microsoft அமர்வு மாறியுள்ளது அல்லது காலாவதியாகிவிட்டது. தொடர மீண்டும் உள்நுழையவும்.",
  "Sign in before inspecting Excel data.":
    "Excel தரவைச் சரிபார்க்கும் முன் உள்நுழையவும்.",
  "Sign in before analyzing Excel data.":
    "Excel தரவைப் பகுப்பாய்வு செய்யும் முன் உள்நுழையவும்.",
  "Inspecting selected formulas locally...":
    "தேர்ந்தெடுத்த சூத்திரங்களை இந்தச் சாதனத்திலேயே சரிபார்க்கிறது...",
  "Formula inspection is ready. Nothing was sent or changed.":
    "சூத்திரச் சரிபார்ப்பு தயார். எதுவும் அனுப்பப்படவில்லை, மாற்றப்படவில்லை.",
  "Inspecting the selected range...":
    "தேர்ந்தெடுத்த வரம்பைச் சரிபார்க்கிறது...",
  "Answered from the selected data. Nothing was sent.":
    "தேர்ந்தெடுத்த தரவிலிருந்து பதில் அளிக்கப்பட்டது. எதுவும் அனுப்பப்படவில்லை.",
  "Say what to create: a table, chart, result sheet, PivotTable, clean-up, or a computed column. Or ask a question about the data.":
    "எதை உருவாக்க வேண்டும் என்று சொல்லுங்கள்: அட்டவணை, விளக்கப்படம், முடிவுத் தாள், PivotTable, தரவைச் சுத்தம் செய்தல் அல்லது கணக்கிடப்பட்ட நெடுவரிசை. அல்லது தரவைப் பற்றி ஒரு கேள்வி கேளுங்கள்.",
  "The server preview does not match the selection. See Diagnostics.":
    "சேவையகத்தின் முன்னோட்டம் உங்கள் தேர்வுடன் பொருந்தவில்லை. கண்டறிதல் விவரங்களைப் பார்க்கவும்.",
  "Preview ready. Nothing has changed yet. Review it before applying.":
    "முன்னோட்டம் தயார். இன்னும் எதுவும் மாறவில்லை. பயன்படுத்தும் முன் அதைச் சரிபார்க்கவும்.",
  "Create a preview before applying.":
    "பயன்படுத்தும் முன் ஒரு முன்னோட்டத்தை உருவாக்கவும்.",
  "Requesting approval...": "ஒப்புதல் கோருகிறது...",
  "Applying approved changes...":
    "ஒப்புதல் பெற்ற மாற்றங்களைப் பயன்படுத்துகிறது...",
  "Column choice set. Click Inspect and preview; nothing changes until you confirm.":
    "நெடுவரிசைத் தேர்வு அமைக்கப்பட்டது. “சரிபார்த்து முன்னோட்டம்” என்பதைக் கிளிக் செய்யவும்; நீங்கள் உறுதிசெய்யும் வரை எதுவும் மாறாது.",
  "Instruction set. Click Inspect and preview; nothing changes until you confirm.":
    "அறிவுறுத்தல் அமைக்கப்பட்டது. “சரிபார்த்து முன்னோட்டம்” என்பதைக் கிளிக் செய்யவும்; நீங்கள் உறுதிசெய்யும் வரை எதுவும் மாறாது.",
  "Use this recommendation": "இந்தப் பரிந்துரையைப் பயன்படுத்து",
  "Use these steps": "இந்தப் படிகளைப் பயன்படுத்து",
  "I remember this request from before, so no AI call was needed.":
    "இந்தக் கோரிக்கை முன்பே எனக்கு நினைவில் உள்ளது, எனவே AI அழைப்பு தேவைப்படவில்லை.",
  "I could not read that directly. Agree below and the AI will interpret it; only column names and types are sent.":
    "இதை என்னால் நேரடியாகப் புரிந்துகொள்ள முடியவில்லை. கீழே ஒப்புக்கொண்டால் AI அதை விளக்கும்; நெடுவரிசைப் பெயர்களும் வகைகளும் மட்டுமே அனுப்பப்படும்.",
  'I am not sure I read that correctly. Agree below and the AI will interpret it; only column names and types are sent. Turn on "AI reads every request" in the menu to skip this question.':
    "இதைச் சரியாகப் புரிந்துகொண்டேனா என்று உறுதியாகத் தெரியவில்லை. கீழே ஒப்புக்கொண்டால் AI அதை விளக்கும்; நெடுவரிசைப் பெயர்களும் வகைகளும் மட்டுமே அனுப்பப்படும். இந்தக் கேள்வியைத் தவிர்க்க மெனுவில் “AI reads every request” என்பதை இயக்கவும்.",
  "Describe what you want first, then plan the steps.":
    "முதலில் உங்களுக்கு என்ன வேண்டும் என்று எழுதுங்கள், பின்னர் படிகளைத் திட்டமிடுங்கள்.",
  "Excel could not find that sheet or range. Click a cell inside your table and try again.":
    "அந்தத் தாளையோ வரம்பையோ Excel-ஆல் கண்டுபிடிக்க முடியவில்லை. உங்கள் அட்டவணைக்குள் ஒரு கலத்தைக் கிளிக் செய்து மீண்டும் முயற்சிக்கவும்.",
  "OAuth state validation failed: that sign-in attempt expired or was replaced. Press Sign in once more":
    "அந்த உள்நுழைவு முயற்சி காலாவதியானது அல்லது புதிய முயற்சியால் மாற்றப்பட்டது. மீண்டும் உள்நுழை என்பதை அழுத்தவும்.",
  "AI analysis needs your explicit consent first.":
    "AI பகுப்பாய்வுக்கு முதலில் உங்கள் தெளிவான ஒப்புதல் தேவை.",
  "The AI answer did not match the expected format and was discarded.":
    "AI பதில் எதிர்பார்த்த வடிவத்தில் இல்லாததால் நிராகரிக்கப்பட்டது. மீண்டும் முயற்சிக்கவும்.",
  "Too many analysis requests. Wait a minute and try again.":
    "பகுப்பாய்வுக் கோரிக்கைகள் அதிகமாக உள்ளன. ஒரு நிமிடம் காத்திருந்து மீண்டும் முயற்சிக்கவும்.",
  "The AI service is unavailable right now. Try again later.":
    "AI சேவை தற்போது கிடைக்கவில்லை. பின்னர் மீண்டும் முயற்சிக்கவும்.",
  "The local summary was rejected. Select the range again.":
    "உள்ளூர்ச் சுருக்கம் நிராகரிக்கப்பட்டது. வரம்பை மீண்டும் தேர்ந்தெடுக்கவும்.",
  "The summary was rejected because it contained more than allowed.":
    "அனுமதிக்கப்பட்டதை விட அதிகமான தகவல் இருந்ததால் சுருக்கம் நிராகரிக்கப்பட்டது.",
  "Your Microsoft 365 organization is not enabled in VynorAI yet.":
    "உங்கள் Microsoft 365 நிறுவனம் VynorAI-இல் இன்னும் இயக்கப்படவில்லை.",
  "Your organization is enabled in VynorAI, but not for this Excel action.":
    "உங்கள் நிறுவனம் VynorAI-இல் இயக்கப்பட்டுள்ளது, ஆனால் இந்த Excel செயலுக்கு அல்ல.",
  "Your Microsoft account must be linked to a VynorAI account by an administrator.":
    "உங்கள் Microsoft கணக்கை ஒரு நிர்வாகி VynorAI கணக்குடன் இணைக்க வேண்டும்.",
  "Microsoft consent is missing a required Excel permission.":
    "Microsoft ஒப்புதலில் தேவையான Excel அனுமதி ஒன்று இல்லை.",
  "The linked VynorAI account has no credits available.":
    "இணைக்கப்பட்ட VynorAI கணக்கில் கிரெடிட் மீதம் இல்லை.",
  "VynorAI could not be reached. Check the network and retry.":
    "VynorAI-ஐ அணுக முடியவில்லை. இணைய இணைப்பைச் சரிபார்த்து மீண்டும் முயற்சிக்கவும்.",
  "The approval no longer matches this preview. Inspect again.":
    "இந்த ஒப்புதல் இனி இந்த முன்னோட்டத்துடன் பொருந்தவில்லை. மீண்டும் சரிபார்க்கவும்.",
  "This approval was already used. Inspect the selection again for a new preview.":
    "இந்த ஒப்புதல் ஏற்கனவே பயன்படுத்தப்பட்டுவிட்டது. புதிய முன்னோட்டத்திற்குத் தேர்வை மீண்டும் சரிபார்க்கவும்.",
  "Select one complete header row and at least one data row.":
    "முழுமையான ஒரு தலைப்பு வரிசையையும் குறைந்தது ஒரு தரவு வரிசையையும் தேர்ந்தெடுக்கவும்.",
  "The first selected row has blank or merged headers. Select a flat table with one complete header row.":
    "தேர்ந்தெடுத்த முதல் வரிசையில் வெற்று அல்லது இணைக்கப்பட்ட தலைப்புகள் உள்ளன. முழுமையான ஒரு தலைப்பு வரிசை கொண்ட எளிய அட்டவணையைத் தேர்ந்தெடுக்கவும்.",
  "Select one rectangular Excel range.":
    "ஒரு செவ்வக வடிவ Excel வரம்பைத் தேர்ந்தெடுக்கவும்.",
  "The selected range is too large. Select at most 100,000 cells and 100 columns.":
    "தேர்ந்தெடுத்த வரம்பு மிகப் பெரியது. அதிகபட்சம் 100,000 கலங்களையும் 100 நெடுவரிசைகளையும் தேர்ந்தெடுக்கவும்.",
  "The selection is too wide. Select at most 100 columns.":
    "தேர்வு மிக அகலமாக உள்ளது. அதிகபட்சம் 100 நெடுவரிசைகளைத் தேர்ந்தெடுக்கவும்.",
  "This data is too large to read in full. A PivotTable works on every row; select at most 100,000 cells for other results.":
    "இந்தத் தரவு முழுமையாகப் படிக்க முடியாத அளவுக்குப் பெரியது. PivotTable எல்லா வரிசைகளிலும் வேலை செய்யும்; மற்ற முடிவுகளுக்கு அதிகபட்சம் 100,000 கலங்களைத் தேர்ந்தெடுக்கவும்.",
  "The VynorAI service is busy or restarting. Try again in a moment.":
    "VynorAI சேவை மும்முரமாக உள்ளது அல்லது மீண்டும் தொடங்குகிறது. சிறிது நேரத்தில் மீண்டும் முயற்சிக்கவும்.",
  "Click a cell inside your table (or select it) so it has a header row and at least one data row.":
    "உங்கள் அட்டவணைக்குள் ஒரு கலத்தைக் கிளிக் செய்யவும் (அல்லது அட்டவணையைத் தேர்ந்தெடுக்கவும்); அதில் ஒரு தலைப்பு வரிசையும் குறைந்தது ஒரு தரவு வரிசையும் இருக்க வேண்டும்.",
  "Preparing the preview. Nothing changes until you confirm.":
    "முன்னோட்டத்தைத் தயாரிக்கிறது. நீங்கள் உறுதிசெய்யும் வரை எதுவும் மாறாது.",
  "A Microsoft sign-in window is already open. Finish it, or close it and press Sign in again.":
    "Microsoft உள்நுழைவுச் சாளரம் ஏற்கனவே திறந்துள்ளது. அதை முடிக்கவும், அல்லது மூடிவிட்டு மீண்டும் உள்நுழை என்பதை அழுத்தவும்.",
  "The sign-in window was blocked. Allow pop-ups for this page, then press Sign in again.":
    "உள்நுழைவுச் சாளரம் தடுக்கப்பட்டது. இந்தப் பக்கத்திற்கு pop-ups-ஐ அனுமதித்து, மீண்டும் உள்நுழை என்பதை அழுத்தவும்.",
  "The browser blocked the sign-in window. Allow pop-ups for Office, then press Sign in again.":
    "உலாவி உள்நுழைவுச் சாளரத்தைத் தடுத்தது. Office-க்கு pop-ups-ஐ அனுமதித்து, மீண்டும் உள்நுழை என்பதை அழுத்தவும்.",
  Columns: "நெடுவரிசைகள்",
  "Data quality": "தரவுத் தரம்",
  Recommendations: "பரிந்துரைகள்",
  "No safe recommendation was found.":
    "பாதுகாப்பான பரிந்துரை எதுவும் கிடைக்கவில்லை.",
  "Advice only: no workbook action is available for this.":
    "ஆலோசனை மட்டுமே: இதற்குப் பணிப்புத்தகச் செயல் எதுவும் இல்லை.",
  Done: "முடிந்தது",
  "Review exactly what will be sent, then confirm to continue.":
    "அனுப்பப்படுவதைச் சரியாகச் சரிபார்த்து, தொடர உறுதிசெய்யவும்.",
  "Nothing was sent.": "எதுவும் அனுப்பப்படவில்லை.",
  "Analyzing the summary...": "சுருக்கத்தைப் பகுப்பாய்வு செய்கிறது...",
  "Analysis ready. It is advice only; nothing has changed.":
    "பகுப்பாய்வு தயார். இது ஆலோசனை மட்டுமே; எதுவும் மாறவில்லை.",
  "Diagnostics copied. They contain no tokens or cell values.":
    "கண்டறிதல் விவரங்கள் நகலெடுக்கப்பட்டன. அவற்றில் டோக்கன்களோ கல மதிப்புகளோ இல்லை.",
  "Workbook overview ready. Only names and sizes were read.":
    "பணிப்புத்தக மேலோட்டம் தயார். பெயர்களும் அளவுகளும் மட்டுமே படிக்கப்பட்டன.",
  "Remove the result sheets and Table this add-in created? Your original data is not touched.":
    "இந்த add-in உருவாக்கிய முடிவுத் தாள்களையும் அட்டவணையையும் நீக்கவா? உங்கள் மூலத் தரவு மாறாது.",
  Remove: "நீக்கு",
  "result sheet": "முடிவுத் தாள்",
  table: "அட்டவணை",
  chart: "விளக்கப்படம்",
  "pivot-table": "PivotTable",
  "new-sheet": "முடிவுத் தாள்",
  clean: "தரவைச் சுத்தம் செய்தல்",
  "add-column": "கணக்கிடப்பட்ட நெடுவரிசை",
  summary: "சுருக்க அட்டவணை",
  format: "வடிவமைப்பு",
  quality: "தரவுத் தர அறிக்கை",
  statistics: "புள்ளிவிவரங்கள்",
  view: "வடிகட்டிய காட்சி",
  "lookup-columns": "Lookup columns",
};

type Template = [RegExp, (...groups: string[]) => string];

const TEMPLATES: Template[] = [
  [
    /^(\d+) formula cell\(s\), (\d+) error cell\(s\), (\d+) possible direct circular reference\(s\), (\d+) inconsistent formula\(s\), (\d+) hard-coded numeric cell\(s\)\.$/,
    (formulas, errors, circular, inconsistent, hardCoded) =>
      `formula cells ${formulas}, பிழை cells ${errors}, நேரடி circular references ${circular}, பொருந்தாத formulas ${inconsistent}, formula columns-இல் hard-coded numeric cells ${hardCoded}.`,
  ],
  [
    /^Writing result rows: (\d+)\/(\d+)\.\.\.$/,
    (done, total) => `முடிவு வரிசைகளை எழுதுகிறது: ${done}/${total}...`,
  ],
  [
    /^Found your table at (.+). Preview ready. Nothing has changed yet. Review it before applying.$/,
    (address) =>
      `உங்கள் அட்டவணை ${address} இல் கண்டறியப்பட்டது. முன்னோட்டம் தயார். இன்னும் எதுவும் மாறவில்லை. பயன்படுத்தும் முன் அதைச் சரிபார்க்கவும்.`,
  ],
  [
    /^Reading selected rows: (\d+)\/(\d+)\.\.\.$/,
    (done, total) => `தேர்ந்தெடுத்த வரிசைகளைப் படிக்கிறது: ${done}/${total}...`,
  ],
  [
    /^VynorAI request failed \((.+)\)\. See Diagnostics\.$/,
    (code) =>
      `VynorAI கோரிக்கை தோல்வியடைந்தது (${code}). கண்டறிதல் விவரங்களைப் பார்க்கவும்.`,
  ],
  [
    /^Removed (\d+) sheet\(s\) and converted (\d+) table\(s\) back to a range\.$/,
    (sheets, tables) =>
      `${sheets} தாள்கள் நீக்கப்பட்டு, ${tables} அட்டவணைகள் மீண்டும் சாதாரண வரம்பாக மாற்றப்பட்டன.`,
  ],
  [
    /^Applied (\d+) of (\d+) actions\. Failed: (.+)\. See Diagnostics\.(.*)$/,
    (done, total, failed, rest) =>
      `${total} செயல்களில் ${done} பயன்படுத்தப்பட்டன. தோல்வியடைந்தவை: ${failed}. கண்டறிதல் விவரங்களைப் பார்க்கவும்.${rest}`,
  ],
  [
    /^Applied: (.+)\. Source data unchanged: (yes|NO)\.(.*)$/,
    (done, unchanged, rest) =>
      `பயன்படுத்தப்பட்டது: ${done}. மூலத் தரவு மாறாமல் உள்ளதா: ${unchanged === "yes" ? "ஆம்" : "இல்லை — சரிபார்க்கவும்"}.${rest}`,
  ],
];

export function localizeMessageTa(text: string): string {
  const trimmed = text.trim();
  if (EXACT[trimmed]) return EXACT[trimmed];
  for (const [pattern, build] of TEMPLATES) {
    const match = pattern.exec(trimmed);
    if (match) return build(...match.slice(1));
  }
  return text;
}

/** Preview summary line: "<actions> on <sheets>. N data rows, M columns. Your source data stays unchanged." */
export function previewSummaryTa(parts: {
  actions: string[];
  sheets: string[];
  rows: number;
  columns: number;
  warnings: string[];
}): string {
  const actions = parts.actions.map((kind) => EXACT[kind] ?? kind).join(", ");
  return (
    `${actions} — ${parts.sheets.join(", ")} தாளில். ` +
    `${parts.rows} தரவு வரிசைகள், ${parts.columns} நெடுவரிசைகள். ` +
    `உங்கள் மூலத் தரவு மாறாது.` +
    (parts.warnings.length ? ` ${parts.warnings.join(" ")}` : "")
  );
}

export const TAMIL_MESSAGE_KEYS = Object.keys(EXACT);
