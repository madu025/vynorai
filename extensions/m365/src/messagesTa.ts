/**
 * Tamil wording for the messages the task pane builds at run time (status line, change note,
 * preview summary). Static labels live in i18n.ts. A message is matched as a whole first, then
 * by template; anything unknown stays in English so nothing is ever mistranslated.
 * Needs a review by a native Tamil speaker before wide release.
 */
import { localizeAction } from "./messagesActions.js";

const EXACT: Record<string, string> = {
  "Sign in to refresh capabilities.":
    "திறன்களைப் புதுப்பிக்க முதலில் உள்நுழையவும்.",
  "Refreshing Excel capability report...":
    "Excel திறன் அறிக்கை புதுப்பிக்கப்படுகிறது...",
  "Power Pivot is not available in this add-in. Use a regular PivotTable or a formula report on a new sheet instead.":
    "இந்த add-in-இல் Power Pivot கிடைக்காது. அதற்குப் பதிலாக புதிய தாளில் சாதாரண PivotTable அல்லது சூத்திர அறிக்கையைப் பயன்படுத்தவும்.",
  "The Excel Data Model is not available in this add-in. Use a regular PivotTable or a formula report with lookups across sheets instead.":
    "இந்த add-in-இல் Excel Data Model கிடைக்காது. அதற்குப் பதிலாக சாதாரண PivotTable அல்லது தாள்களுக்கு இடையே lookup கொண்ட சூத்திர அறிக்கையைப் பயன்படுத்தவும்.",
  "PivotTables on an OLAP or Data Model source are not available in this add-in. Use a regular PivotTable on a table, or a formula report, instead.":
    "OLAP அல்லது Data Model மூலத்தின் மீதான PivotTable இந்த add-in-இல் கிடைக்காது. அதற்குப் பதிலாக அட்டவணையின் மீது சாதாரண PivotTable அல்லது சூத்திர அறிக்கையைப் பயன்படுத்தவும்.",
  "Running VBA or COM automation is not available in this add-in. I can write the macro as text for you to review and run yourself.":
    "இந்த add-in-இல் VBA அல்லது COM automation-ஐ இயக்க முடியாது. macro-வை உரையாக எழுதித் தருகிறேன்; நீங்களே சரிபார்த்து இயக்கவும்.",
  "Solver is not available in this add-in. Use a what-if sensitivity table that tries each value and shows the results instead.":
    "இந்த add-in-இல் Solver கிடைக்காது. அதற்குப் பதிலாக ஒவ்வொரு மதிப்பையும் முயன்று முடிவுகளைக் காட்டும் what-if உணர்திறன் அட்டவணையைப் பயன்படுத்தவும்.",
  "Scenario Manager is not available in this add-in. Use a what-if sensitivity table with the scenarios side by side instead.":
    "இந்த add-in-இல் Scenario Manager கிடைக்காது. அதற்குப் பதிலாக சூழ்நிலைகளை அருகருகே காட்டும் what-if உணர்திறன் அட்டவணையைப் பயன்படுத்தவும்.",
  "Python is not run in this add-in, and nothing needs to be installed on your computer. Use a formula, a PivotTable or the built-in analysis instead.":
    "இந்த add-in-இல் Python இயங்காது; உங்கள் கணினியில் எதையும் நிறுவ வேண்டியதுமில்லை. அதற்குப் பதிலாக சூத்திரம், PivotTable அல்லது உள்ளமைந்த பகுப்பாய்வைப் பயன்படுத்தவும்.",
  "This runs outside the workbook only after you approve it. Nothing has been run.":
    "இது நீங்கள் ஒப்புக்கொண்ட பின்பே பணிப்புத்தகத்திற்கு வெளியே இயங்கும். எதுவும் இயக்கப்படவில்லை.",
  "Checking the result…": "முடிவைச் சரிபார்க்கிறது…",
  "Checking safety…": "பாதுகாப்பைச் சரிபார்க்கிறது…",
  "Preview ready. Nothing changed yet.":
    "முன்னோட்டம் தயார். இன்னும் எதுவும் மாறவில்லை.",
  "Sparklines are not available in this Excel add-in yet. Use a line chart on a new result sheet instead.":
    "இந்த Excel add-in-இல் Sparklines இன்னும் கிடைக்கவில்லை. அதற்குப் பதிலாக புதிய முடிவுத் தாளில் ஒரு line chart-ஐப் பயன்படுத்தவும்.",
  "Scheduled refresh is not available in this add-in yet. Run the request again when you want a fresh, reviewed result.":
    "குறிப்பிட்ட நேரத்தில் refresh செய்யும் வசதி இந்த add-in-இல் இன்னும் கிடைக்கவில்லை. புதிய, சரிபார்த்த முடிவு தேவைப்படும்போது கோரிக்கையை மீண்டும் இயக்கவும்.",
  "Scheduled refresh is due. Preparing a fresh preview for “1”.":
    "திட்டமிட்ட refresh நேரம் வந்துவிட்டது. “1”க்கான புதிய முன்னோட்டத்தைத் தயார் செய்கிறது.",
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
  "Create a report first.": "முதலில் ஓர் அறிக்கையை உருவாக்கவும்.",
  "No numbers found there. Pick or paste cells with a header row and a number column.":
    "அங்கு எண்கள் எதுவும் இல்லை. தலைப்பு வரிசையும் எண் நெடுவரிசையும் உள்ள கலங்களைத் தேர்ந்தெடுக்கவும் அல்லது ஒட்டவும்.",
  Applied: "பயன்படுத்தப்பட்டது",
  "No changes yet": "இன்னும் மாற்றங்கள் இல்லை",
  "Text copied.": "உரை நகலெடுக்கப்பட்டது.",
  "Could not copy the text.": "உரையை நகலெடுக்க முடியவில்லை.",
  "The card could not be made. See Diagnostics.":
    "அட்டையை உருவாக்க முடியவில்லை. Diagnostics-ஐப் பாருங்கள்.",
  "Make a report first.": "முதலில் ஓர் அறிக்கையை உருவாக்கவும்.",
  "Nothing was sent to AI.": "AI-க்கு எதுவும் அனுப்பப்படவில்லை.",
  "Writing the message...": "செய்தியை எழுதுகிறது...",
  "The message was written by AI. Read and edit it before you send the report.":
    "இந்தச் செய்தியை AI எழுதியது. அறிக்கையை அனுப்பும் முன் அதைப் படித்துத் திருத்தவும்.",
  "Enter a recipient and subject first.":
    "முதலில் பெறுநரையும் தலைப்பையும் உள்ளிடவும்.",
  "Preparing the approved report variants...":
    "ஒப்புதல் பெற்ற அறிக்கைப் பதிப்புகளைத் தயாரிக்கிறது...",
  "Microsoft did not give this add-in permission to send mail (your organization's administrator may need to approve it). Nothing was sent. Use the link below to open the report as a draft in Outlook on the web.":
    "மின்னஞ்சல் அனுப்ப Microsoft இந்த add-in-க்கு அனுமதி வழங்கவில்லை (உங்கள் நிறுவனத்தின் நிர்வாகி அதை அங்கீகரிக்க வேண்டியிருக்கலாம்). எதுவும் அனுப்பப்படவில்லை. அறிக்கையை Outlook web-இல் வரைவாகத் திறக்கக் கீழே உள்ள இணைப்பைப் பயன்படுத்தவும்.",
  "Code is ready to copy. Nothing was run or changed.":
    "குறியீடு நகலெடுக்கத் தயார். எதுவும் இயக்கப்படவில்லை, மாற்றப்படவில்லை.",
  "Nothing was changed.": "எதுவும் மாற்றப்படவில்லை.",
  "Code copied.": "குறியீடு நகலெடுக்கப்பட்டது.",
  "Select the code and copy it with Ctrl+C.":
    "குறியீட்டைத் தேர்ந்தெடுத்து Ctrl+C மூலம் நகலெடுக்கவும்.",
  "Asking the AI to read your request (only column names and types are sent)...":
    "உங்கள் கோரிக்கையைப் படிக்குமாறு AI-யிடம் கேட்கிறது (நெடுவரிசைப் பெயர்களும் வகைகளும் மட்டுமே அனுப்பப்படும்)...",
  "Planning the steps...": "படிகளைத் திட்டமிடுகிறது...",
  "The AI understood your request. Preparing the preview; nothing changes until you confirm.":
    "AI உங்கள் கோரிக்கையைப் புரிந்துகொண்டது. முன்னோட்டத்தைத் தயாரிக்கிறது; நீங்கள் உறுதிசெய்யும் வரை எதுவும் மாறாது.",
  "Preview adjusted. Rechecking the plan...":
    "முன்னோட்டம் சரிசெய்யப்பட்டது. திட்டத்தை மீண்டும் சரிபார்க்கிறது...",
  "No older VynorAI result sheets found.":
    "பழைய VynorAI முடிவுத் தாள்கள் எதுவும் கிடைக்கவில்லை.",
  "There are no older VynorAI result sheets.":
    "பழைய VynorAI முடிவுத் தாள்கள் எதுவும் இல்லை.",
  "Enter the request again before refreshing this result.":
    "இந்த முடிவைப் புதுப்பிக்கும் முன் கோரிக்கையை மீண்டும் உள்ளிடவும்.",
  "Refreshing the preview. Nothing changes until you confirm.":
    "முன்னோட்டத்தைப் புதுப்பிக்கிறது. நீங்கள் உறுதிசெய்யும் வரை எதுவும் மாறாது.",
  "Planning the next step...": "அடுத்த படியைத் திட்டமிடுகிறது...",
  "Running the selected tool...": "தேர்ந்தெடுத்த கருவியை இயக்குகிறது...",
  "Checking the tool result...": "கருவியின் முடிவைச் சரிபார்க்கிறது...",
  "A planner agent is splitting the request into steps...":
    "திட்டமிடும் agent கோரிக்கையைப் படிகளாகப் பிரிக்கிறது...",
  "Correcting the plan after the review...":
    "மதிப்பாய்வுக்குப் பின் திட்டத்தைத் திருத்துகிறது...",
  "Stopped. Nothing was changed.": "நிறுத்தப்பட்டது. எதுவும் மாற்றப்படவில்லை.",
  "The agent could not finish. Nothing was changed.":
    "Agent-ஆல் முடிக்க முடியவில்லை. எதுவும் மாற்றப்படவில்லை.",
  "Describe what you want first.":
    "முதலில் உங்களுக்கு என்ன வேண்டும் என்று விவரிக்கவும்.",
  "Sign in first.": "முதலில் உள்நுழையவும்.",
  "The agent is working. Nothing changes until you approve.":
    "Agent வேலை செய்கிறது. நீங்கள் ஒப்புதல் அளிக்கும் வரை எதுவும் மாறாது.",
  "Discarded. Nothing was changed.":
    "நிராகரிக்கப்பட்டது. எதுவும் மாற்றப்படவில்லை.",
  "Applying the approved changes...":
    "ஒப்புதல் பெற்ற மாற்றங்களைப் பயன்படுத்துகிறது...",
  "Applying failed. See Diagnostics.":
    "பயன்படுத்துவது தோல்வியடைந்தது. கண்டறிதல் விவரங்களைப் பார்க்கவும்.",
  "Verifying the applied result...":
    "பயன்படுத்திய முடிவை உறுதிப்படுத்துகிறது...",
  "Applied. Undo puts everything back.":
    "பயன்படுத்தப்பட்டது. மீளமைத்தால் அனைத்தும் முன்பு போல் ஆகும்.",
  "Partly applied. Undo puts everything back.":
    "ஓரளவு பயன்படுத்தப்பட்டது. மீளமைத்தால் அனைத்தும் முன்பு போல் ஆகும்.",
  "The agent stopped at its step limit. Try a smaller request.":
    "Agent படி வரம்பில் நின்றது. சிறிய கோரிக்கையை முயற்சிக்கவும்.",
  "Something went wrong. See Diagnostics.":
    "ஏதோ தவறு நடந்தது. கண்டறிதல் விவரங்களைப் பார்க்கவும்.",
  "I did not answer this time and nothing was changed. Please try again or ask in other words.":
    "இந்த முறை நான் பதிலளிக்கவில்லை; எதுவும் மாற்றப்படவில்லை. மீண்டும் முயற்சிக்கவும் அல்லது வேறு வார்த்தைகளில் கேளுங்கள்.",
  "The AI is still working on the last request. Try again when it finishes.":
    "AI இன்னும் முந்தைய கோரிக்கையில் வேலை செய்கிறது. அது முடிந்த பின் மீண்டும் முயற்சிக்கவும்.",
  "Asking the AI for ideas...": "AI இடம் யோசனைகளைக் கேட்கிறது...",
  "Ideas ready. Tap one to put it in the request box.":
    "யோசனைகள் தயார். ஒன்றைத் தட்டி கோரிக்கை பெட்டியில் வையுங்கள்.",
  "No new ideas this time.": "இந்த முறை புதிய யோசனைகள் இல்லை.",
  "The selection changed, so those ideas were dropped. Tap More ideas again.":
    'தேர்வு மாறியதால் அந்த யோசனைகள் நீக்கப்பட்டன. மீண்டும் "மேலும் யோசனைகள்" என்பதைத் தட்டுங்கள்.',
  "The ideas could not be made. See Diagnostics.":
    "யோசனைகளை உருவாக்க முடியவில்லை. கண்டறிதல் விவரங்களைப் பார்க்கவும்.",
  "Undoing the agent's changes...": "Agent செய்த மாற்றங்களை மீளமைக்கிறது...",
  "Undone. The workbook is back as it was.":
    "மீளமைக்கப்பட்டது. பணிப்புத்தகம் முன்பு இருந்தபடியே உள்ளது.",
  "Undo did not finish. See Diagnostics.":
    "மீளமைப்பு முடியவில்லை. கண்டறிதல் விவரங்களைப் பார்க்கவும்.",
  "Could not load that language. Check the connection and try again.":
    "அந்த மொழியை ஏற்ற முடியவில்லை. இணைப்பைச் சரிபார்த்து மீண்டும் முயலவும்.",
  "No VynorAI Log exists for this workbook yet.":
    "இந்தப் பணிப்புத்தகத்திற்கு இன்னும் VynorAI பதிவு இல்லை.",
  "Opened VynorAI Log. It records applied and undone changes.":
    "VynorAI பதிவு திறக்கப்பட்டது. பயன்படுத்திய மற்றும் செயல்தவிர்த்த மாற்றங்கள் இதில் பதிவாகும்.",
  "VynorAI Log could not be opened. Check workbook permissions.":
    "VynorAI பதிவைத் திறக்க முடியவில்லை. பணிப்புத்தக அனுமதிகளைச் சரிபார்க்கவும்.",
  "Preparing the secure VynorAI connection...":
    "பாதுகாப்பான VynorAI இணைப்பைத் தயாரிக்கிறது...",
  "VynorAI connection page opened. Sign in there and confirm the Microsoft account.":
    "VynorAI இணைப்புப் பக்கம் திறக்கப்பட்டது. அங்கு உள்நுழைந்து Microsoft கணக்கை உறுதிப்படுத்தவும்.",
  "The VynorAI connection window was blocked. Allow pop-ups for this page, then press Connect VynorAI account again.":
    "VynorAI இணைப்பு சாளரம் தடுக்கப்பட்டது. இந்தப் பக்கத்திற்கு pop-ups-ஐ அனுமதித்து Connect VynorAI account-ஐ மீண்டும் அழுத்தவும்.",
  "The connection code expired. Start Connect VynorAI account again.":
    "இணைப்புக் குறியீடு காலாவதியானது. VynorAI கணக்கை இணை என்பதை மீண்டும் தொடங்கவும்.",
  "The connection is still waiting for confirmation. Finish the browser page, then try Connect VynorAI account again.":
    "இணைப்பு இன்னும் உறுதிப்படுத்தலுக்காகக் காத்திருக்கிறது. உலாவிப் பக்கத்தை முடித்து, மீண்டும் VynorAI கணக்கை இணை என்பதை அழுத்தவும்.",
  "VynorAI account connection failed.": "VynorAI கணக்கை இணைக்க முடியவில்லை.",
  "This Microsoft account is not connected to a VynorAI account yet. Connect one to continue.":
    "இந்த Microsoft கணக்கு இன்னும் VynorAI கணக்குடன் இணைக்கப்படவில்லை. தொடர ஒன்றை இணைக்கவும்.",
  "VynorAI account connection required.": "VynorAI கணக்கு இணைப்பு தேவை.",
  "Checking your VynorAI account connection...":
    "உங்கள் VynorAI கணக்கு இணைப்பைச் சரிபார்க்கிறது...",
  "Undo did not finish. Press Undo again.":
    "மீளமைப்பு முடியவில்லை. மீண்டும் மீளமை அழுத்தவும்.",
  "Forgot the saved choices for this workbook.":
    "இந்தப் பணிப்புத்தகத்திற்குச் சேமித்த தேர்வுகள் மறக்கப்பட்டன.",
  "Copied. Paste it into WhatsApp; nothing was sent.":
    "நகலெடுக்கப்பட்டது. அதை WhatsApp-இல் paste செய்யவும்; எதுவும் அனுப்பப்படவில்லை.",
  "The summary could not be made. See Diagnostics.":
    "சுருக்கத்தை உருவாக்க முடியவில்லை. கண்டறிதல் விவரங்களைப் பார்க்கவும்.",
  "Refreshing the preview for the current selection...":
    "தற்போதைய தேர்வுக்கான முன்னோட்டத்தைப் புதுப்பிக்கிறது...",
  "A reviewer agent is checking ranges, formulas and totals...":
    "ஒரு மதிப்பாய்வு agent வரம்புகள், சூத்திரங்கள் மற்றும் மொத்தங்களைச் சரிபார்க்கிறது...",
  "A reviewer agent is checking that every part is covered and nothing is overwritten...":
    "ஒரு மதிப்பாய்வு agent ஒவ்வொரு பகுதியும் உள்ளடக்கப்பட்டுள்ளதா, எதுவும் மேலெழுதப்படவில்லையா என்று சரிபார்க்கிறது...",
  "Not sent yet · approval required":
    "இன்னும் அனுப்பப்படவில்லை · ஒப்புதல் தேவை",
  "Size calculated after approval": "ஒப்புதலுக்குப் பிறகு அளவு கணக்கிடப்படும்",
  pending: "நிலுவையில்",
  active: "நடைபெறுகிறது",
  done: "முடிந்தது",
  "key evidence found": "முக்கிய ஆதாரம் கிடைத்தது",
  "checking keys": "விசைகளைச் சரிபார்க்கிறது",
  "building plan": "திட்டத்தை உருவாக்குகிறது",
  "plan ready": "திட்டம் தயார்",
  "preview staged": "முன்னோட்டம் தயார்",
  "checking calculations": "கணக்கீடுகளைச் சரிபார்க்கிறது",
  "checks completed": "சரிபார்ப்புகள் முடிந்தன",
  "checking write safety": "எழுதும் பாதுகாப்பைச் சரிபார்க்கிறது",
  "checks passed": "சரிபார்ப்புகள் தேறின",
  skipped: "தவிர்க்கப்பட்டது",
  "no plan needed": "திட்டம் தேவையில்லை",
  "not needed for this request": "இந்தக் கோரிக்கைக்குத் தேவையில்லை",
  "no join found between the ranges": "வரம்புகளுக்கிடையே இணைப்பு கிடைக்கவில்லை",
  "answer ready, nothing to change": "பதில் தயார், மாற்ற எதுவுமில்லை",
  "not needed, nothing was changed": "தேவையில்லை, எதுவும் மாற்றப்படவில்லை",
  "did not finish": "முடிக்கவில்லை",
  "simple change, checked by rules only":
    "எளிய மாற்றம், விதிகளால் மட்டும் சரிபார்க்கப்பட்டது",
  "not run, the builder corrected first":
    "இயக்கப்படவில்லை, முதலில் builder திருத்தியது",
  stopped: "நிறுத்தப்பட்டது",
  applied: "பயன்படுத்தப்பட்டது",
  failed: "தோல்வி",
  "waiting for apply": "பயன்படுத்துவதற்காகக் காத்திருக்கிறது",
  "reading results back": "முடிவுகளை மீண்டும் வாசிக்கிறது",
  "read-back completed": "மீண்டும் வாசிப்பு முடிந்தது",
  "Looking at the workbook": "பணிப்புத்தகத்தைப் பார்க்கிறது",
  Working: "செயல்படுகிறது",
  Planning: "திட்டமிடுகிறது",
  Executing: "செயல்படுத்துகிறது",
  Verifying: "சரிபார்க்கிறது",
  "Final answer": "இறுதிப் பதில்",
  Reviewing: "மதிப்பாய்வு செய்கிறது",
  Correcting: "திருத்துகிறது",
  Discarded: "நிராகரிக்கப்பட்டது",
  Applying: "பயன்படுத்துகிறது",
  Undone: "செயல்தவிர்க்கப்பட்டது",
  Stopped: "நிறுத்தப்பட்டது",
  "Chart result": "வரைபட முடிவு",
  "Dashboard sheet": "டாஷ்போர்டு தாள்",
  "Quality report": "தரவு தர அறிக்கை",
  "Formula audit": "சூத்திரத் தணிக்கை",
  "Forecast report": "முன்கணிப்பு அறிக்கை",
  "Clean result sheet": "சுத்தம் செய்த முடிவுத் தாள்",
  Cell: "கலம்",
  Agree: "ஒப்புக்கொள்கிறேன்",
  Cancel: "ரத்து செய்",
  Add: "சேர்",
  Replace: "மாற்று",
  Confirm: "உறுதிசெய்",
  "(empty)": "(வெற்று)",
  Now: "இப்போது",
  "After approval": "ஒப்புதலுக்குப் பிறகு",
  "Ideas for the selected columns": "தேர்ந்தெடுத்த நெடுவரிசைகளுக்கான யோசனைகள்",
  "Waiting for approval": "ஒப்புதலுக்காகக் காத்திருக்கிறது",
  "Inspecting the selected data and preparing a safe plan.":
    "தேர்ந்தெடுத்த தரவைச் சரிபார்த்து பாதுகாப்பான திட்டத்தைத் தயாரிக்கிறது.",
  "AI reads every request: ON (click to turn off)":
    "AI ஒவ்வொரு கோரிக்கையையும் படிக்கிறது: இயக்கத்தில் (அணைக்க கிளிக் செய்யவும்)",
  "AI reads every request: OFF (click to turn on)":
    "AI ஒவ்வொரு கோரிக்கையையும் படிக்கிறது: அணைந்துள்ளது (இயக்க கிளிக் செய்யவும்)",
  "Agent (preview): ON (click to turn off)":
    "Agent (முன்னோட்டம்): இயக்கத்தில் (அணைக்க கிளிக் செய்யவும்)",
  "Agent (preview): OFF (click to turn on)":
    "Agent (முன்னோட்டம்): அணைந்துள்ளது (இயக்க கிளிக் செய்யவும்)",
  "Agent workflow is not available for this account. Use local preview.":
    "இந்தக் கணக்கிற்கு Agent பணிப்பாய்வு கிடைக்கவில்லை. உள்ளூர் முன்னோட்டத்தைப் பயன்படுத்தவும்.",
  "Create a preview or report first.":
    "முதலில் முன்னோட்டம் அல்லது அறிக்கையை உருவாக்கவும்.",
  "Create and verify a report before sharing it.":
    "பகிர்வதற்கு முன் அறிக்கையை உருவாக்கிச் சரிபார்க்கவும்.",
  "Creating and verifying the Outlook draft...":
    "Outlook வரைவை உருவாக்கிச் சரிபார்க்கிறது...",
  "New chat. Select your data and describe what you want.":
    "புதிய உரையாடல். உங்கள் தரவைத் தேர்ந்தெடுத்து தேவையானதை விவரிக்கவும்.",
  "Requesting Microsoft draft and large-attachment permission...":
    "Microsoft வரைவு மற்றும் பெரிய இணைப்பு அனுமதியைக் கோருகிறது...",
  "Requesting Microsoft email permission...":
    "Microsoft மின்னஞ்சல் அனுமதியைக் கோருகிறது...",
  "Sending and verifying the approved report...":
    "அங்கீகரிக்கப்பட்ட அறிக்கையை அனுப்பிச் சரிபார்க்கிறது...",
  "The agent answered. Nothing was changed.":
    "Agent பதிலளித்தது. எதுவும் மாற்றப்படவில்லை.",
  "The agent prepared changes. Nothing has changed yet: review them, then approve.":
    "Agent மாற்றங்களைத் தயாரித்தது. இன்னும் எதுவும் மாற்றப்படவில்லை: அவற்றை மதிப்பாய்வு செய்து ஒப்புதல் அளிக்கவும்.",
  "Excel computed": "Excel கணக்கிட்டது",
  "one-to-one": "ஒன்று-ஒன்று",
  "one-to-many": "ஒன்று-பல",
  "many-to-one": "பல-ஒன்று",
  "many-to-many": "பல-பல",
  "Clean keys first": "முதலில் விசைகளைச் சுத்தம் செய்யவும்",
  "Keys are consistent": "விசைகள் சீராக உள்ளன",
  "rows repeat another row exactly":
    "வரிசைகள் மற்றொரு வரிசையுடன் முற்றிலும் ஒத்துள்ளன",
  Fix: "சரிசெய்",
  Review: "மதிப்பாய்வு",
  Look: "பார்",
  // Key figures at the top of the preview card (previewKpis.ts).
  Total: "மொத்தம்",
  Average: "சராசரி",
  Count: "எண்ணிக்கை",
  Smallest: "மிகச் சிறியது",
  Largest: "மிகப் பெரியது",
  "Top group": "முதன்மைக் குழு",
  "Lowest group": "குறைந்த குழு",
  "of total": "மொத்தத்தில்",
  Rows: "வரிசைகள்",
  groups: "குழுக்கள்",
  "(blank)": "(வெற்று)",
  Checked: "சரிபார்த்தவை",
  Clean: "சுத்தமானவை",
  "To review": "மதிப்பாய்வுக்கு",
  columns: "நெடுவரிசைகள்",
  findings: "கண்டறிதல்கள்",
  "Payroll sheet": "சம்பளத் தாள்",
  "EPF, ETF and APIT for the employees in this list":
    "இந்தப் பட்டியலில் உள்ள ஊழியர்களுக்கு EPF, ETF, APIT",
  "VAT column": "VAT நெடுவரிசை",
  "Month column": "மாத நெடுவரிசை",
};

/** The second half of a team sentence from describeReview. */
function tail(rest: string): string {
  if (rest === "worked on this.") return "இதில் பணியாற்றினர்.";
  if (rest === "checked the plan: no problems found.")
    return "திட்டத்தைச் சரிபார்த்தனர்: சிக்கல்கள் இல்லை.";
  const corrected =
    /^checked the plan and found (\d+) problem\(s\); the plan was corrected\.$/.exec(
      rest,
    );
  if (corrected)
    return ((n) =>
      `திட்டத்தைச் சரிபார்த்து ${n} சிக்கல்கள் கண்டறிந்து, திட்டம் திருத்தப்பட்டது.`)(
      corrected[1],
    );
  const found = /^checked the plan and found: (.+)$/.exec(rest);
  if (found)
    return ((what) => `திட்டத்தைச் சரிபார்த்து கண்டறிந்தது: ${what}`)(found[1]);
  return rest;
}

type Template = [RegExp, (...groups: string[]) => string];

const TEMPLATES: Template[] = [
  [
    /^dates in (.+) are stored as text$/,
    (c) => `${c} இல் தேதிகள் உரையாகச் சேமிக்கப்பட்டுள்ளன`,
  ],
  [/^unusual (.+) values?$/, (c) => `வழக்கத்துக்கு மாறான ${c} மதிப்பு`],
  [/^blank cells? in (.+)$/, (c) => `${c} இல் வெற்றுக் கலங்கள்`],
  [
    /^of (.+) comes from one (.+) \((.+)\)$/,
    (m, g, v) => `${m} இன் பெரும்பகுதி ஒரே ${g} இலிருந்து (${v})`,
  ],

  [
    /^checks passed · (\d+) calculation\(s\)$/,
    (n) => `சரிபார்ப்புகள் தேறின · ${n} கணக்கீடுகள்`,
  ],
  [/^(\d+) issue\(s\): (.+)$/, (n, first) => `${n} சிக்கல்கள்: ${first}`],
  [
    /^(\d+) change\(s\) read back(?:, (\d+) failed)?$/,
    (n, failed) =>
      `${n} மாற்றங்கள் மீண்டும் வாசிக்கப்பட்டன${failed ? `, ${failed} தோல்வி` : ""}`,
  ],
  [
    /^(.+) → (.+) · (one-to-one|one-to-many|many-to-one|many-to-many) · ([\d,]+) unmatched rows · ([\d,]+) duplicate keys$/,
    (a, b, card, unmatched, dup) =>
      `${a} → ${b} · ${localizeMessageTa(card)} · பொருந்தாத வரிசைகள் ${unmatched} · மீண்டும் வரும் விசைகள் ${dup}`,
  ],

  [/^([\d,]+) unmatched rows$/, (n) => `பொருந்தாத வரிசைகள் ${n}`],
  [/^([\d,]+) duplicate keys$/, (n) => `மீண்டும் வரும் விசைகள் ${n}`],

  [
    /^Outlook draft created for (.+) and verified by Microsoft Graph\.$/,
    (who) =>
      `Outlook வரைவு ${who} க்காக உருவாக்கப்பட்டு Microsoft Graph மூலம் சரிபார்க்கப்பட்டது.`,
  ],
  [
    /^Report sent to (.+) and verified by Microsoft Graph\.$/,
    (who) =>
      `அறிக்கை ${who} க்கு அனுப்பப்பட்டு Microsoft Graph மூலம் சரிபார்க்கப்பட்டது.`,
  ],

  [/^Excel computed (.+)$/, (what) => `Excel கணக்கிட்டது: ${what}`],
  [/^Workbook check: (.+)$/, (what) => `பணிப்புத்தக சரிபார்ப்பு: ${what}`],
  [
    /^Before and after \((\d+)(?: of ([\d,]+))? cells\)$/,
    (n, total) =>
      total
        ? `முன் மற்றும் பின் (${total} கலங்களில் ${n})`
        : `முன் மற்றும் பின் (${n} கலங்கள்)`,
  ],
  [
    /^Fill ('.+?'![A-Z]+\d+:[A-Z]+\d+) with: (.+)$/s,
    (range, rest) => `${range} நிரப்பு: ${rest}`,
  ],
  [
    /^Write in ('.+?'![A-Z]+\d+): (.+)$/s,
    (cell, rest) => `${cell} இல் எழுது: ${rest}`,
  ],
  [
    /^Write (\d+) x (\d+) values from ('.+?'![A-Z]+\d+)$/,
    (r, c, at) => `${at} இலிருந்து ${r} x ${c} மதிப்புகளை எழுது`,
  ],
  [/^Add a new sheet "(.+)"$/, (name) => `புதிய தாளைச் சேர்: "${name}"`],
  [
    /^Add a (\w[\w-]*) chart of (.+)$/,
    (type, what) => `${type} வரைபடத்தைச் சேர்: ${what}`,
  ],
  [
    /^Sort ('.+?'![A-Z]+\d+:[A-Z]+\d+) by (.+?) (ascending|descending) \(edits the data; undo restores it\)$/,
    (range, col, dir) =>
      `${range} ஐ ${col} படி ${dir === "ascending" ? "ஏறுவரிசையில்" : "இறங்குவரிசையில்"} வரிசைப்படுத்து (தரவு மாறும்; செயல்தவிர்த்தால் மீளும்)`,
  ],

  [
    /^Used about ([\d,]+) tokens \((\d+)% of the input from cache\)\.$/,
    (n, c) =>
      `சுமார் ${n} டோக்கன்கள் பயன்படுத்தப்பட்டன (உள்ளீட்டில் ${c}% cache இலிருந்து).`,
  ],
  [
    /^Planner \((\d+) steps?\), builder and (\d+) reviewer\(s\) (.+)$/,
    (a, b, rest) =>
      `திட்டமிடுபவர் (${a} படிகள்), உருவாக்குபவர் மற்றும் ${b} மதிப்பாய்வாளர்கள் ${tail(rest)}`,
  ],
  [/^(\d+) agents (.+)$/, (n, rest) => `${n} agents ${tail(rest)}`],
  [
    /^Sent to the AI: ([\d,]+) characters(?:; (\d+) personal value\(s\) replaced with tokens, and put back only here|(; no personal values found to replace))\.(.*)$/,
    (chars, n, none, rest) =>
      ((chars, how, rest) =>
        `AI க்கு அனுப்பியது: ${chars} எழுத்துகள்${how === "none" ? "; மாற்ற வேண்டிய தனிப்பட்ட மதிப்புகள் இல்லை" : `; ${how} தனிப்பட்ட மதிப்புகள் tokens ஆக மாற்றப்பட்டு, இங்கு மட்டுமே திரும்ப வைக்கப்படும்`}.${rest}`)(
        chars,
        none ? "none" : n,
        rest,
      ),
  ],

  [/^Team: (.+)$/, (what) => `குழு: ${localizeMessageTa(what)}`],
  [
    /^Applying (\d+) of (\d+): (.+)$/,
    (i, n, what) => `பயன்படுத்துகிறது ${i}/${n}: ${localizeMessageTa(what)}`,
  ],

  [/^(\d+) staged change\(s\)$/, (n) => `${n} தயார் செய்யப்பட்ட மாற்றங்கள்`],
  [/^(\d+) plan step\(s\)$/, (n) => `${n} திட்டப் படிகள்`],
  [/^(\d+) issue\(s\) found$/, (n) => `${n} சிக்கல்கள் கண்டறியப்பட்டன`],
  // Before the general "Reading ..." rule below, which would otherwise take this message.
  [
    /^Reading selected rows: (\d+)\/(\d+)\.\.\.$/,
    (done, total) => `தேர்ந்தெடுத்த வரிசைகளைப் படிக்கிறது: ${done}/${total}...`,
  ],
  [/^Reading (.+)$/, (what) => `வாசிக்கிறது: ${what}`],
  [/^Calculating (.+)$/, (what) => `கணக்கிடுகிறது: ${what}`],
  [
    /^Running analysis code on (.+) \(on this device, no network\)$/,
    (what) =>
      `பகுப்பாய்வு குறியீட்டை இயக்குகிறது: ${what} (இந்த சாதனத்தில், நெட்வொர்க் இல்லாமல்)`,
  ],
  [/^Checking a step: (.+)$/, (what) => `ஒரு படியைச் சரிபார்க்கிறது: ${what}`],
  [
    /^Preparing a change \((.+)\)$/,
    (what) => `மாற்றத்தைத் தயார் செய்கிறது (${what})`,
  ],

  [
    /^Removed (\d+) (?:older )?(?:VynorAI )?(?:result )?sheet\(s\)\.$/,
    (n) => `${n} தாள்கள் நீக்கப்பட்டன.`,
  ],
  [
    /^Removed (\d+) sheet\(s\), (\d+) named range\(s\), and converted (\d+) table\(s\) back to a range\.$/,
    (s, n, t) =>
      `${s} தாள்களும் ${n} பெயரிடப்பட்ட வரம்புகளும் நீக்கப்பட்டு, ${t} அட்டவணைகள் மீண்டும் சாதாரண வரம்பாக மாற்றப்பட்டன.`,
  ],
  [
    /^The message could not be written \((.*)\)\. Write it yourself or try again\.$/,
    (why) =>
      `செய்தியை எழுத முடியவில்லை (${why}). நீங்களே எழுதுங்கள், அல்லது மீண்டும் முயற்சிக்கவும்.`,
  ],
  [
    /^Added the "(.+)" sheet \((\d+) fixed-date holidays\)\. Add Poya days from the gazette; delete the sheet to undo\.$/,
    (name, n) =>
      `"${name}" தாள் சேர்க்கப்பட்டது (நிலையான தேதி கொண்ட ${n} விடுமுறைகள்). போயா நாட்களை வர்த்தமானியிலிருந்து சேர்க்கவும்; மீளமைக்க அந்தத் தாளை நீக்கவும்.`,
  ],
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
  // Explore tab: templates and questions built from the selection's own headers.
  [/^Summary by (.+)$/, (g) => `${g} வாரியாகச் சுருக்கம்`],
  [
    /^Total of (.+?) per (.+), as live formulas$/,
    (m, g) => `${g} வாரியாக ${m} மொத்தம், நேரடி சூத்திரங்களாக`,
  ],
  [
    /^(\d+(?:\.\d+)?)% VAT on (.+?)( \(check the rate\))?$/,
    (p, m, check) =>
      `${m} மீது ${p}% VAT${check ? " (விகிதத்தைச் சரிபார்க்கவும்)" : ""}`,
  ],
  [
    /^Month of (.+) as a new column$/,
    (d) => `${d} இன் மாதம் புதிய நெடுவரிசையாக`,
  ],
  [
    /^Which (.+?) has the (highest|lowest) (.+)\?$/,
    (g, which, m) =>
      `${which === "highest" ? "அதிக" : "குறைந்த"} ${m} உள்ள ${g} எது?`,
  ],
  [/^What is the total (.+)\?$/, (m) => `மொத்த ${m} எவ்வளவு?`],
  // Footer of the pane (timeSaved.ts): an estimate of time saved this month, and the day streak.
  [
    /^About (?:(\d+) h)? ?(?:(\d+) min)? saved this month \(estimate\)$/,
    (hours, minutes) =>
      `இந்த மாதம் சேமித்த நேரம்: ஏறக்குறைய ${[hours ? `${hours} மணி` : "", minutes ? `${minutes} நிமிடம்` : ""].filter(Boolean).join(" ")} (மதிப்பீடு)`,
  ],
  [/^(\d+) day streak$/, (n) => `${n} நாள் தொடர்ச்சி`],
];

export function localizeMessageTa(text: string): string {
  const trimmed = text.trim();
  if (EXACT[trimmed]) return EXACT[trimmed];
  for (const [pattern, build] of TEMPLATES) {
    const match = pattern.exec(trimmed);
    if (match) return build(...match.slice(1));
  }
  return localizeAction(text, "ta");
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
