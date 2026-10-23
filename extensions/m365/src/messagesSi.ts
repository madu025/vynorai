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
  "I remember this request from before, so no AI call was needed.":
    "මට මෙම ඉල්ලීම කලින් සිට මතකයි, එබැවින් AI කැඳවීමක් අවශ්‍ය නොවීය.",
  "I could not read that directly. Agree below and the AI will interpret it; only column names and types are sent.":
    "මට මෙය සෘජුව තේරුම් ගත නොහැකි විය. පහත එකඟ වුවහොත් AI එක එය අර්ථකථනය කරයි; යවන්නේ තීරු නම් සහ වර්ග පමණි.",
  'I am not sure I read that correctly. Agree below and the AI will interpret it; only column names and types are sent. Turn on "AI reads every request" in the menu to skip this question.':
    "මම මෙය නිවැරදිව තේරුම් ගත්තාදැයි විශ්වාස නැත. පහත එකඟ වුවහොත් AI එක එය අර්ථකථනය කරයි; යවන්නේ තීරු නම් සහ වර්ග පමණි. මෙම ප්‍රශ්නය මඟහැරීමට මෙනුවේ “AI reads every request” සක්‍රිය කරන්න.",
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
  "Create a report first.": "මුලින්ම වාර්තාවක් සාදන්න.",
  "No numbers found there. Pick or paste cells with a header row and a number column.":
    "එහි අංක කිසිවක් හමු වුණේ නැත. ශීර්ෂ පේළියක් සහ අංක තීරුවක් සහිත කොටු තෝරන්න හෝ අලවන්න.",
  "Text copied.": "පෙළ පිටපත් කළා.",
  "Could not copy the text.": "පෙළ පිටපත් කළ නොහැකි විය.",
  "The card could not be made. See Diagnostics.":
    "කාඩ්පත සෑදිය නොහැකි විය. Diagnostics බලන්න.",
  "Make a report first.": "මුලින්ම වාර්තාවක් සාදන්න.",
  "Nothing was sent to AI.": "AI වෙත කිසිවක් යවා නැත.",
  "Writing the message...": "පණිවිඩය ලියමින්...",
  "The message was written by AI. Read and edit it before you send the report.":
    "පණිවිඩය AI විසින් ලියන ලදී. වාර්තාව යැවීමට පෙර එය කියවා සංස්කරණය කරන්න.",
  "Enter a recipient and subject first.":
    "මුලින්ම ලබන්නා සහ විෂය ඇතුළත් කරන්න.",
  "Preparing the approved report variants...":
    "අනුමත වාර්තා අනුවාද සූදානම් කරමින්...",
  "Microsoft did not give this add-in permission to send mail (your organization's administrator may need to approve it). Nothing was sent. Use the link below to open the report as a draft in Outlook on the web.":
    "ඊමේල් යැවීමට Microsoft මෙම add-in එකට අවසර දුන්නේ නැත (ඔබේ සංවිධානයේ පරිපාලකයා අනුමත කළ යුතු විය හැක). කිසිවක් යවා නැත. වාර්තාව Outlook web හි කෙටුම්පතක් ලෙස විවෘත කිරීමට පහත සබැඳිය භාවිතා කරන්න.",
  "Code is ready to copy. Nothing was run or changed.":
    "කේතය පිටපත් කිරීමට සූදානම්. කිසිවක් ධාවනය කර හෝ වෙනස් කර නැත.",
  "Nothing was changed.": "කිසිවක් වෙනස් කර නැත.",
  "Code copied.": "කේතය පිටපත් කරන ලදී.",
  "Select the code and copy it with Ctrl+C.":
    "කේතය තෝරා Ctrl+C මගින් පිටපත් කරන්න.",
  "Asking the AI to read your request (only column names and types are sent)...":
    "ඔබේ ඉල්ලීම කියවන ලෙස AI ගෙන් ඉල්ලමින් (යවන්නේ තීරු නම් සහ වර්ග පමණි)...",
  "Planning the steps...": "පියවර සැලසුම් කරමින්...",
  "The AI understood your request. Preparing the preview; nothing changes until you confirm.":
    "AI ඔබේ ඉල්ලීම තේරුම් ගත්තා. පෙරදසුන සූදානම් කරමින්; ඔබ තහවුරු කරන තුරු කිසිවක් වෙනස් නොවේ.",
  "Preview adjusted. Rechecking the plan...":
    "පෙරදසුන සකස් කළා. සැලසුම නැවත පරීක්ෂා කරමින්...",
  "No older VynorAI result sheets found.":
    "පැරණි VynorAI ප්‍රතිඵල පත්‍රිකා හමු නොවීය.",
  "There are no older VynorAI result sheets.":
    "පැරණි VynorAI ප්‍රතිඵල පත්‍රිකා නැත.",
  "Enter the request again before refreshing this result.":
    "මෙම ප්‍රතිඵලය නැවුම් කිරීමට පෙර ඉල්ලීම නැවත ඇතුළත් කරන්න.",
  "Refreshing the preview. Nothing changes until you confirm.":
    "පෙරදසුන නැවුම් කරමින්. ඔබ තහවුරු කරන තුරු කිසිවක් වෙනස් නොවේ.",
  "Planning the next step...": "ඊළඟ පියවර සැලසුම් කරමින්...",
  "Running the selected tool...": "තෝරාගත් මෙවලම ධාවනය කරමින්...",
  "Checking the tool result...": "මෙවලමේ ප්‍රතිඵලය පරීක්ෂා කරමින්...",
  "A planner agent is splitting the request into steps...":
    "සැලසුම්කරු agent ඉල්ලීම පියවර වලට බෙදමින්...",
  "Correcting the plan after the review...":
    "සමාලෝචනයෙන් පසු සැලසුම නිවැරදි කරමින්...",
  "Stopped. Nothing was changed.": "නවත්වන ලදී. කිසිවක් වෙනස් කර නැත.",
  "The agent could not finish. Nothing was changed.":
    "Agent එකට අවසන් කළ නොහැකි විය. කිසිවක් වෙනස් කර නැත.",
  "Describe what you want first.": "මුලින්ම ඔබට අවශ්‍ය දේ විස්තර කරන්න.",
  "Sign in first.": "මුලින්ම පිවිසෙන්න.",
  "The agent is working. Nothing changes until you approve.":
    "Agent වැඩ කරමින්. ඔබ අනුමත කරන තුරු කිසිවක් වෙනස් නොවේ.",
  "Discarded. Nothing was changed.": "ඉවත දමන ලදී. කිසිවක් වෙනස් කර නැත.",
  "Applying the approved changes...": "අනුමත වෙනස්කම් යොදමින්...",
  "Applying failed. See Diagnostics.":
    "යෙදීම අසාර්ථක විය. දෝෂ විමර්ශන තොරතුරු බලන්න.",
  "Verifying the applied result...": "යෙදූ ප්‍රතිඵලය තහවුරු කරමින්...",
  "Applied. Undo puts everything back.":
    "යොදන ලදී. ආපසු හැරවීමෙන් සියල්ල නැවත පෙර පරිදි වේ.",
  "Partly applied. Undo puts everything back.":
    "කොටසක් පමණක් යොදන ලදී. ආපසු හැරවීමෙන් සියල්ල නැවත පෙර පරිදි වේ.",
  "The agent stopped at its step limit. Try a smaller request.":
    "Agent පියවර සීමාවේදී නතර විය. කුඩා ඉල්ලීමක් උත්සාහ කරන්න.",
  "Something went wrong. See Diagnostics.":
    "යම් දෝෂයක් සිදු විය. දෝෂ විමර්ශන තොරතුරු බලන්න.",
  "I did not answer this time and nothing was changed. Please try again or ask in other words.":
    "මෙවර මම පිළිතුරු නොදුන්නෙමි; කිසිවක් වෙනස් කර නැත. නැවත උත්සාහ කරන්න හෝ වෙනත් වචන වලින් අසන්න.",
  "Undoing the agent's changes...": "Agent ගේ වෙනස්කම් ආපසු හරවමින්...",
  "Undone. The workbook is back as it was.":
    "ආපසු හැරවිණි. වැඩපොත කලින් පරිදිම ය.",
  "Undo did not finish. See Diagnostics.":
    "ආපසු හැරවීම අවසන් නොවීය. දෝෂ විමර්ශන තොරතුරු බලන්න.",
  "Forgot the saved choices for this workbook.":
    "මෙම වැඩපොතේ සුරකින ලද තේරීම් අමතක කරන ලදී.",
  "Copied. Paste it into WhatsApp; nothing was sent.":
    "පිටපත් කළා. WhatsApp වෙත paste කරන්න; කිසිවක් යවා නැත.",
  "The summary could not be made. See Diagnostics.":
    "සාරාංශය සෑදිය නොහැකි විය. දෝෂ විමර්ශන තොරතුරු බලන්න.",
  "Refreshing the preview for the current selection...":
    "වත්මන් තේරීම සඳහා පෙරදසුන යළි සාදමින්...",
  "A reviewer agent is checking ranges, formulas and totals...":
    "සමාලෝචන agent එකක් පරාස, සූත්‍ර සහ එකතු පරීක්ෂා කරමින්...",
  "A reviewer agent is checking that every part is covered and nothing is overwritten...":
    "සමාලෝචන agent එකක් සෑම කොටසක්ම ආවරණය වී ඇති බවත් කිසිවක් උඩින් ලියා නැති බවත් පරීක්ෂා කරමින්...",
  "Not sent yet · approval required": "තවම යවා නැත · අනුමැතිය අවශ්‍යයි",
  "Size calculated after approval": "ප්‍රමාණය අනුමැතියෙන් පසු ගණනය කෙරේ",
  pending: "පොරොත්තුවේ",
  active: "සිදුවෙමින්",
  done: "අවසන්",
  "key evidence found": "ප්‍රධාන සාක්ෂි හමු විය",
  "checking keys": "යතුරු පරීක්ෂා කරමින්",
  "building plan": "සැලසුම සාදමින්",
  "plan ready": "සැලසුම සූදානම්",
  "preview staged": "පෙරදසුන සූදානම්",
  "checking calculations": "ගණනය පරීක්ෂා කරමින්",
  "checks completed": "පරීක්ෂා අවසන්",
  "checking write safety": "ලිවීමේ ආරක්ෂාව පරීක්ෂා කරමින්",
  "checks passed": "පරීක්ෂා සමත් විය",
  skipped: "මග හැරියා",
  "no plan needed": "සැලසුමක් අවශ්‍ය නැත",
  "not needed for this request": "මෙම ඉල්ලීමට අවශ්‍ය නැත",
  "no join found between the ranges": "පරාස අතර සම්බන්ධයක් හමු නොවීය",
  "answer ready, nothing to change": "පිළිතුර සූදානම්, වෙනස් කිරීමට කිසිවක් නැත",
  "not needed, nothing was changed": "අවශ්‍ය නැත, කිසිවක් වෙනස් කළේ නැත",
  "did not finish": "අවසන් කළේ නැත",
  "not run, the builder corrected first": "ධාවනය නොකළා, පළමුව builder නිවැරදි කළා",
  stopped: "නවත්වා ඇත",
  applied: "යෙදුවා",
  failed: "අසාර්ථකයි",
  "waiting for apply": "යෙදීම බලාපොරොත්තුවෙන්",
  "reading results back": "ප්‍රතිඵල නැවත කියවමින්",
  "read-back completed": "නැවත කියවීම අවසන්",
  "Looking at the workbook": "වැඩපොත බලමින්",
  Working: "වැඩ කරමින්",
  Planning: "සැලසුම් කරමින්",
  Executing: "ක්‍රියාත්මක කරමින්",
  Verifying: "තහවුරු කරමින්",
  "Final answer": "අවසාන පිළිතුර",
  Reviewing: "සමාලෝචනය කරමින්",
  Correcting: "නිවැරදි කරමින්",
  Discarded: "ඉවත දමන ලදී",
  Applying: "යොදමින්",
  Undone: "ආපසු හරවන ලදී",
  Stopped: "නවත්වන ලදී",
  "Waiting for approval": "අනුමැතිය බලාපොරොත්තුවෙන්",
  "Inspecting the selected data and preparing a safe plan.":
    "තෝරාගත් දත්ත පරීක්ෂා කර ආරක්ෂිත සැලසුමක් සූදානම් කරමින්.",
  "AI reads every request: ON (click to turn off)":
    "AI සෑම ඉල්ලීමක්ම කියවයි: සක්‍රීයයි (අක්‍රීය කිරීමට ක්ලික් කරන්න)",
  "AI reads every request: OFF (click to turn on)":
    "AI සෑම ඉල්ලීමක්ම කියවයි: අක්‍රීයයි (සක්‍රීය කිරීමට ක්ලික් කරන්න)",
  "Agent (preview): ON (click to turn off)":
    "Agent (පෙරදසුන): සක්‍රීයයි (අක්‍රීය කිරීමට ක්ලික් කරන්න)",
  "Agent (preview): OFF (click to turn on)":
    "Agent (පෙරදසුන): අක්‍රීයයි (සක්‍රීය කිරීමට ක්ලික් කරන්න)",
  "Agent workflow is not available for this account. Use local preview.":
    "මෙම ගිණුම සඳහා Agent කාර්ය ප්‍රවාහය නොමැත. දේශීය පෙරදසුන භාවිතා කරන්න.",
  "Create a preview or report first.": "මුලින්ම පෙරදසුනක් හෝ වාර්තාවක් සාදන්න.",
  "Create and verify a report before sharing it.":
    "බෙදාගැනීමට පෙර වාර්තාවක් සාදා තහවුරු කරන්න.",
  "Creating and verifying the Outlook draft...":
    "Outlook කෙටුම්පත සාදා තහවුරු කරමින්...",
  "New chat. Select your data and describe what you want.":
    "අලුත් සංවාදය. ඔබේ දත්ත තෝරා ඔබට අවශ්‍ය දේ විස්තර කරන්න.",
  "Requesting Microsoft draft and large-attachment permission...":
    "Microsoft කෙටුම්පත් සහ විශාල ඇමුණුම් අවසරය ඉල්ලමින්...",
  "Requesting Microsoft email permission...":
    "Microsoft ඊමේල් අවසරය ඉල්ලමින්...",
  "Sending and verifying the approved report...":
    "අනුමත වාර්තාව යවා තහවුරු කරමින්...",
  "The agent answered. Nothing was changed.":
    "Agent පිළිතුරු දුන්නා. කිසිවක් වෙනස් කර නැත.",
  "The agent prepared changes. Nothing has changed yet: review them, then approve.":
    "Agent වෙනස්කම් සූදානම් කළා. තවමත් කිසිවක් වෙනස් වී නැත: ඒවා පරීක්ෂා කර අනුමත කරන්න.",
  "Excel computed": "Excel ගණනය කළා",
  "one-to-one": "එක-එක",
  "one-to-many": "එක-බොහෝ",
  "many-to-one": "බොහෝ-එක",
  "many-to-many": "බොහෝ-බොහෝ",
  "Clean keys first": "මුලින් යතුරු පිරිසිදු කරන්න",
  "Keys are consistent": "යතුරු ගැලපේ",
  "rows repeat another row exactly": "පේළි වෙනත් පේළියක් හා හරියටම සමාන",
  Fix: "හදන්න",
  Review: "බලන්න",
  Look: "බලන්න",
  // Key figures at the top of the preview card (previewKpis.ts).
  Total: "එකතුව",
  Average: "සාමාන්‍යය",
  Count: "ගණන",
  Smallest: "කුඩාම",
  Largest: "විශාලතම",
  "Top group": "ඉහළම කාණ්ඩය",
  "Lowest group": "පහළම කාණ්ඩය",
  "of total": "මුළුවෙන්",
  Rows: "පේළි",
  groups: "කාණ්ඩ",
  "(blank)": "(හිස්)",
  Checked: "පරීක්ෂා කළ",
  Clean: "පිරිසිදු",
  "To review": "සමාලෝචනයට",
  columns: "තීරු",
  findings: "සොයාගැනීම්",
  "Payroll sheet": "වැටුප් පත්‍රිකාව",
  "EPF, ETF and APIT for the employees in this list":
    "මෙම ලැයිස්තුවේ සේවකයින් සඳහා EPF, ETF සහ APIT",
  "VAT column": "VAT තීරුව",
  "Month column": "මාස තීරුව",
};

/** The second half of a team sentence from describeReview. */
function tail(rest: string): string {
  if (rest === "worked on this.") return "මේ සඳහා වැඩ කළා.";
  if (rest === "checked the plan: no problems found.")
    return "සැලසුම පරීක්ෂා කළා: ගැටලු නැත.";
  const corrected =
    /^checked the plan and found (\d+) problem\(s\); the plan was corrected\.$/.exec(
      rest,
    );
  if (corrected)
    return ((n) =>
      `සැලසුම පරීක්ෂා කර ගැටලු ${n}ක් හමු වී, සැලසුම නිවැරදි කළා.`)(
      corrected[1],
    );
  const found = /^checked the plan and found: (.+)$/.exec(rest);
  if (found) return ((what) => `සැලසුම පරීක්ෂා කර හමු වූයේ: ${what}`)(found[1]);
  return rest;
}

type Template = [RegExp, (...groups: string[]) => string];

const TEMPLATES: Template[] = [
  [/^dates in (.+) are stored as text$/, (c) => `${c} හි දින පෙළ ලෙස ඇත`],
  [/^unusual (.+) values?$/, (c) => `අසාමාන්‍ය ${c} අගය`],
  [/^blank cells? in (.+)$/, (c) => `${c} හි හිස් සෛල`],
  [
    /^of (.+) comes from one (.+) \((.+)\)$/,
    (m, g, v) => `${m} හි බොහෝ කොටසක් එක් ${g} එකකින් (${v})`,
  ],

  [
    /^checks passed · (\d+) calculation\(s\)$/,
    (n) => `පරීක්ෂා සමත් විය · ගණනය ${n}ක්`,
  ],
  [/^(\d+) issue\(s\): (.+)$/, (n, first) => `ගැටලු ${n}ක්: ${first}`],
  [
    /^(\d+) change\(s\) read back(?:, (\d+) failed)?$/,
    (n, failed) =>
      `නැවත කියවූ වෙනස්කම් ${n}ක්${failed ? `, අසාර්ථක ${failed}ක්` : ""}`,
  ],
  [
    /^(.+) → (.+) · (one-to-one|one-to-many|many-to-one|many-to-many) · ([\d,]+) unmatched rows · ([\d,]+) duplicate keys$/,
    (a, b, card, unmatched, dup) =>
      `${a} → ${b} · ${localizeMessageSi(card)} · ගැලපෙන්නේ නැති පේළි ${unmatched}ක් · පුනරාවර්තන යතුරු ${dup}ක්`,
  ],

  [/^([\d,]+) unmatched rows$/, (n) => `ගැලපෙන්නේ නැති පේළි ${n}ක්`],
  [/^([\d,]+) duplicate keys$/, (n) => `පුනරාවර්තන යතුරු ${n}ක්`],

  [
    /^Outlook draft created for (.+) and verified by Microsoft Graph\.$/,
    (who) =>
      `Outlook කෙටුම්පත ${who} සඳහා සාදා Microsoft Graph මගින් තහවුරු කළා.`,
  ],
  [
    /^Report sent to (.+) and verified by Microsoft Graph\.$/,
    (who) => `වාර්තාව ${who} වෙත යවා Microsoft Graph මගින් තහවුරු කළා.`,
  ],

  [/^Excel computed (.+)$/, (what) => `Excel ගණනය කළා: ${what}`],
  [/^Workbook check: (.+)$/, (what) => `වැඩපොත පරීක්ෂාව: ${what}`],
  [
    /^Before and after \((\d+)(?: of ([\d,]+))? cells\)$/,
    (n, total) =>
      total ? `පෙර සහ පසු (සෛල ${total}න් ${n}ක්)` : `පෙර සහ පසු (සෛල ${n}ක්)`,
  ],
  [
    /^Fill ('.+?'![A-Z]+\d+:[A-Z]+\d+) with: (.+)$/s,
    (range, rest) => `${range} පුරවන්න: ${rest}`,
  ],
  [
    /^Write in ('.+?'![A-Z]+\d+): (.+)$/s,
    (cell, rest) => `${cell} හි ලියන්න: ${rest}`,
  ],
  [
    /^Write (\d+) x (\d+) values from ('.+?'![A-Z]+\d+)$/,
    (r, c, at) => `${at} සිට අගයන් ${r} x ${c} ලියන්න`,
  ],
  [
    /^Add a new sheet "(.+)"$/,
    (name) => `අලුත් පත්‍රිකාවක් එක් කරන්න: "${name}"`,
  ],
  [
    /^Add a (\w[\w-]*) chart of (.+)$/,
    (type, what) => `${type} ප්‍රස්තාරයක් එක් කරන්න: ${what}`,
  ],
  [
    /^Sort ('.+?'![A-Z]+\d+:[A-Z]+\d+) by (.+?) (ascending|descending) \(edits the data; undo restores it\)$/,
    (range, col, dir) =>
      `${range} ${col} අනුව ${dir === "ascending" ? "ආරෝහණව" : "අවරෝහණව"} පෙළගස්වන්න (දත්ත වෙනස් වේ; ආපසු හැරවීමෙන් නැවත ලැබේ)`,
  ],

  [
    /^Used about ([\d,]+) tokens \((\d+)% of the input from cache\)\.$/,
    (n, c) =>
      `ටෝකන් ආසන්න වශයෙන් ${n}ක් භාවිතා විය (ආදානයෙන් ${c}% ක් cache එකෙන්).`,
  ],
  [
    /^Planner \((\d+) steps?\), builder and (\d+) reviewer\(s\) (.+)$/,
    (a, b, rest) =>
      `සැලසුම්කරු (පියවර ${a}), සාදන්නා සහ සමාලෝචකයන් ${b} දෙනා ${tail(rest)}`,
  ],
  [/^(\d+) agents (.+)$/, (n, rest) => `agents ${n} දෙනා ${tail(rest)}`],
  [
    /^Sent to the AI: ([\d,]+) characters(?:; (\d+) personal value\(s\) replaced with tokens, and put back only here|(; no personal values found to replace))\.(.*)$/,
    (chars, n, none, rest) =>
      ((chars, how, rest) =>
        `AI වෙත යැවූ: අක්ෂර ${chars}ක්${how === "none" ? "; ප්‍රතිස්ථාපනය කළ යුතු පෞද්ගලික අගයන් නොමැත" : `; පෞද්ගලික අගයන් ${how}ක් tokens වලින් ප්‍රතිස්ථාපනය කර, නැවත දමන්නේ මෙහි පමණි`}.${rest}`)(
        chars,
        none ? "none" : n,
        rest,
      ),
  ],

  [/^Team: (.+)$/, (what) => `කණ්ඩායම: ${localizeMessageSi(what)}`],

  [/^(\d+) staged change\(s\)$/, (n) => `සූදානම් කළ වෙනස්කම් ${n}ක්`],
  [/^(\d+) plan step\(s\)$/, (n) => `සැලසුම් පියවර ${n}ක්`],
  [/^(\d+) issue\(s\) found$/, (n) => `ගැටලු ${n}ක් හමු විය`],
  [/^Reading (.+)$/, (what) => `කියවමින්: ${what}`],
  [/^Calculating (.+)$/, (what) => `ගණනය කරමින්: ${what}`],
  [
    /^Running analysis code on (.+) \(on this device, no network\)$/,
    (what) => `විශ්ලේෂණ කේතය ධාවනය කරමින්: ${what} (මෙම උපාංගයේ, ජාලයක් නොමැතිව)`,
  ],
  [/^Checking a step: (.+)$/, (what) => `පියවරක් පරීක්ෂා කරමින්: ${what}`],
  [
    /^Preparing a change \((.+)\)$/,
    (what) => `වෙනසක් සූදානම් කරමින් (${what})`,
  ],

  [
    /^Removed (\d+) (?:older )?(?:VynorAI )?(?:result )?sheet\(s\)\.$/,
    (n) => `පත්‍රිකා ${n}ක් ඉවත් කරන ලදී.`,
  ],
  [
    /^Removed (\d+) sheet\(s\), (\d+) named range\(s\), and converted (\d+) table\(s\) back to a range\.$/,
    (s, n, t) =>
      `පත්‍රිකා ${s}ක්, නම් කළ පරාස ${n}ක් ඉවත් කර, වගු ${t}ක් නැවත සාමාන්‍ය පරාසයක් බවට හරවන ලදී.`,
  ],
  [
    /^The message could not be written \((.*)\)\. Write it yourself or try again\.$/,
    (why) =>
      `පණිවිඩය ලිවිය නොහැකි විය (${why}). ඔබම ලියන්න, නැතහොත් නැවත උත්සාහ කරන්න.`,
  ],
  [
    /^Added the "(.+)" sheet \((\d+) fixed-date holidays\)\. Add Poya days from the gazette; delete the sheet to undo\.$/,
    (name, n) =>
      `"${name}" පත්‍රිකාව එක් කරන ලදී (ස්ථාවර දිනයන් ඇති නිවාඩු ${n}ක්). පොහොය දින ගැසට් පත්‍රයෙන් එක් කරන්න; ආපසු හැරවීමට පත්‍රිකාව මකන්න.`,
  ],
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
  // Explore tab: templates and questions built from the selection's own headers.
  [/^Summary by (.+)$/, (g) => `${g} අනුව සාරාංශය`],
  [
    /^Total of (.+?) per (.+), as live formulas$/,
    (m, g) => `${g} අනුව ${m} එකතුව, සජීවී සූත්‍ර ලෙස`,
  ],
  [
    /^(\d+(?:\.\d+)?)% VAT on (.+?)( \(check the rate\))?$/,
    (p, m, check) => `${m} මත ${p}% VAT${check ? " (අනුපාතය පරීක්ෂා කරන්න)" : ""}`,
  ],
  [/^Month of (.+) as a new column$/, (d) => `${d} හි මාසය නව තීරුවක් ලෙස`],
  [
    /^Which (.+?) has the (highest|lowest) (.+)\?$/,
    (g, which, m) => `${m} ${which === "highest" ? "වැඩිම" : "අඩුම"} ${g} කුමක්ද?`,
  ],
  [/^What is the total (.+)\?$/, (m) => `මුළු ${m} කීයද?`],
  // Footer of the pane (timeSaved.ts): an estimate of time saved this month, and the day streak.
  [
    /^About (?:(\d+) h)? ?(?:(\d+) min)? saved this month \(estimate\)$/,
    (hours, minutes) =>
      `මෙම මාසයේ ඉතිරි කළ කාලය: ආසන්න වශයෙන් ${[hours ? `පැය ${hours}` : "", minutes ? `විනාඩි ${minutes}` : ""].filter(Boolean).join(" ")} (ඇස්තමේන්තුවක්)`,
  ],
  [/^(\d+) day streak$/, (n) => `දින ${n}ක් අඛණ්ඩව`],
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

export const SINHALA_MESSAGE_KEYS = Object.keys(EXACT);
