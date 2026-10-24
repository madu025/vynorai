import { localizeMessageSi } from "./messagesSi.js";
import { localizeMessageTa } from "./messagesTa.js";

export type Language = "en" | "si" | "ta";

export const LANGUAGE_ORDER: Language[] = ["en", "si", "ta"];
export const LANGUAGE_NAMES: Record<Language, string> = {
  en: "English",
  si: "සිංහල",
  ta: "தமிழ்",
};

type Dictionary = Record<string, string>;

const STRINGS: Record<Exclude<Language, "en">, Dictionary> = {
  si: {
    noticed_title: "ඔබේ දත්තවල දුටු දේ",
    noticed_note: "මෙම උපාංගයේම පරීක්ෂා කළා. කිසිවක් යවා නැත.",
    product_title: "VynorAI Excel",
    product_subtitle: "ආරක්ෂිතව විශ්ලේෂණය, සැලසුම් සහ යෙදීම",
    hero: "ඔබේ දත්ත සමඟ කුමක් කිරීමට අවශ්‍යද?",
    hero_hint:
      "VynorAI ඔබේ වගුව ස්වයංක්‍රීයව සොයා, වෙනස්කම් කිරීමට පෙර නව ප්‍රතිඵල පත්‍රිකාවක පෙරදසුනක් පෙන්වයි.",
    instruction_label: "සෑදිය යුතු දේ විස්තර කරන්න",
    conversation_label: "VynorAI සංවාදය",
    suggestions_label: "යෝජනා",
    workbook_context: "වැඩපොත් පසුබිම",
    refresh_context: "නැවත බලන්න",
    contextual_suggestions: "මෙම තේරීමට ගැළපෙන යෝජනා",
    run_mode: "ධාවන ආකාරය",
    smart_mode: "ස්මාර්ට්",
    local_mode: "දේශීය පෙරදසුන",
    agent_mode: "නියෝජිත ක්‍රියාවලිය",
    run: "ධාවනය කරන්න",
    more_tools: "තවත් මෙවලම්",
    preview_impact: "පෙරදසුනේ බලපෑම",
    rows_label: "පේළි",
    row_label: "පේළිය",
    columns_label: "තීරු",
    column_label: "තීරුව",
    cell_label: "කොටුව",
    large_range: "විශාල පරාසය",
    local_preview: "දේශීය පෙරදසුන",
    changes_label: "වෙනස්කම්",
    warnings_label: "අවවාද",
    agent_timeline: "නියෝජිතයාගේ ප්‍රගතිය",
    timeline_inspect: "පරීක්ෂාව",
    timeline_plan: "සැලසුම",
    timeline_review: "පරීක්ෂාව",
    timeline_approval: "අනුමැතිය",
    timeline_apply: "යෙදීම",
    timeline_verify: "තහවුරුව",
    suggestion_quality: "දත්ත තත්ත්වය පරීක්ෂා කරන්න",
    suggestion_chart: "හොඳම ප්‍රස්තාරය සාදන්න",
    suggestion_pivot: "විශාල දත්ත සාරාංශ කරන්න",
    suggestion_dashboard: "උපකරණ පුවරුවක් සාදන්න",
    suggestion_formulas: "සූත්‍ර පරීක්ෂා කරන්න",
    suggestion_forecast: "ප්‍රවණතා අනාවැකියක් සාදන්න",
    suggestion_clean: "පෙළ අගයන් පිරිසිදු කරන්න",
    suggestion_reason_quality:
      "වාර්තාවක් සෑදීමට පෙර හිස් අගයන්, අනුපිටපත් සහ නොගැළපෙන අගයන් සොයන්න.",
    suggestion_reason_chart:
      "කාණ්ඩයක් සහ මිනුමක් සංසන්දනය කිරීමට ප්‍රමාණවත් තීරු ඇත.",
    suggestion_reason_pivot:
      "Excel තුළම සම්පූර්ණ පරාසය කාර්යක්ෂමව සාරාංශ කරයි.",
    suggestion_reason_dashboard:
      "KPI, සාරාංශ සහ ප්‍රස්තාරයක් එක් ප්‍රතිඵල පත්‍රයක පෙන්විය හැක.",
    suggestion_reason_formulas:
      "සක්‍රිය කොටුව සහ අවට සූත්‍ර රටාව පරීක්ෂා කරන්න.",
    suggestion_reason_forecast:
      "දින සහ සංඛ්‍යාත්මක මිනුමක් ඇති බව මෙම උපාංගයේ sample එකෙන් හඳුනා ගන්නා ලදී.",
    suggestion_reason_clean:
      "ප්‍රස්තාරයකට හෝ අනාවැකියකට සංඛ්‍යාත්මක මිනුමක් නැති පෙළ තීරු හඳුනා ගන්නා ලදී.",
    agent_unavailable:
      "මෙම ගිණුමට Agent workflow ලබා ගත නොහැක. Local preview භාවිතා කරන්න.",
    outcomes_label: "සාදනු ලබන දෑ",
    adjust_preview: "පෙරදසුන සකසන්න",
    preview_kpis: "ප්‍රධාන සංඛ්‍යා",
    steps_aria: "පියවර",
    agent_plan: "සැලසුම",
    selection_using: "භාවිතා කරන්නේ:",
    skip_to_request: "ඉල්ලීමට පිවිසෙන්න",
    email_report: "වාර්තාව ඊමේල් කරන්න",
    reviewed: "පරීක්ෂා කළා",
    fmt_auto: "ස්වයංක්‍රීය විකල්පය",
    fmt_xlsx: "Excel වැඩපොත (.xlsx)",
    fmt_pdf: "PDF වාර්තාව (.pdf)",
    fmt_csv: "CSV වාර්තාව (.csv)",
    fmt_xlsx_pdf: "Excel වැඩපොත + PDF",
    fmt_summary: "ඊමේලයේ සාරාංශය පමණි",
    body_html: "විස්තර සහිත HTML",
    body_text: "සරල පෙළ",
    send_now: "දැන් යවන්න",
    save_draft: "Outlook කෙටුම්පත සුරකින්න",
    ai_message: "AI සමඟ පණිවිඩය ලියන්න",
    include_charts: "වාර්තාවේ ප්‍රස්ථාර ඊමේල් අන්තර්ගතයට ඇතුළත් කරන්න",
    review_send: "වාර්තාව පරීක්ෂා කර යවන්න",
    open_draft: "Outlook වෙබයේ කෙටුම්පත විවෘත කරන්න",
    agent_title: "නියෝජිතයා",
    agent_note: "තවම කිසිවක් වෙනස් වී නැත. වෙනස්කම් පරීක්ෂා කර අනුමත කරන්න.",
    approve_apply: "අනුමත කර යොදන්න",
    discard: "ඉවත දමන්න",
    stop: "නවත්වන්න",
    workbook_settings: "වැඩපොත් සැකසුම්",
    prefs_note:
      "මෙම වැඩපොතේම සුරැකේ, එය විවෘත කරන සියල්ලන්ටම එකම අගයන් ලැබේ. තෝරාගැනීම් පමණක් ගබඩා වේ, කොටු අගයන් කිසිවිටෙක නොවේ.",
    not_set: "සකසා නැත",
    as_in_data: "දත්තවල ඇති පරිදි",
    style_lakhs: "ලක්ෂ (12,34,567)",
    style_millions: "මිලියන (Mn)",
    style_plain: "සාමාන්‍ය (1,234,567)",
    fy_april: "අප්‍රේල් (ශ්‍රී ලංකාව)",
    fy_january: "ජනවාරි",
    fy_july: "ජූලි",
    audience_auto: "ඉල්ලීම අනුව තීරණය කරන්න",
    audience_mgmt: "කළමනාකරණය (එක් පිටුවක්)",
    audience_ops: "මෙහෙයුම් (සම්පූර්ණ විස්තර)",
    log_changes: 'සෑම වෙනසක්ම "VynorAI Log" පත්‍රයේ සටහන් කරන්න',
    add_holidays: "ශ්‍රී ලංකා නිවාඩු වගුව එක් කරන්න",
    add_payroll: "වැටුප් පත්‍රිකාව එක් කරන්න (EPF, ETF, APIT)",
    forget_choices: "මෙම තෝරාගැනීම් අමතක කරන්න",
    clean_first: "මුලින් පිරිසිදු කර, පසුව මෙය ක්‍රියාත්මක කරන්න",
    plan_with_ai: "AI සමඟ පියවර සැලසුම් කරන්න",
    ask_agent: "නියෝජිතයාගෙන් ඇසීම",
    diagnostics_title: "රෝග විනිශ්චය",
    agent_sources: "මූලාශ්‍ර",
    request_change: "වැඩපොතේ වෙනසක් ඉල්ලන්න",
    new_chat: "+ නව කතාබහ",
    chat_history: "කතාබහ ඉතිහාසය",
    delete_chat: "මකන්න",
    new_chat_option: "නව කතාබහ",
    new_chat_ready: "නව කතාබහ. දත්ත තෝරා ඔබට අවශ්‍ය දේ විස්තර කරන්න.",
    delete_chat_confirm: "මෙම කතාබහ ඉතිහාසයෙන් මකන්නද? ඔබේ වැඩපොත වෙනස් නොවේ.",
    conversation_you: "ඔබ",
    conversation_attention: "අවධානය අවශ්‍යයි",
    edit_request: "අවසන් ඉල්ලීම සංස්කරණය කරන්න",
    edit_ready: "අවසන් ඉල්ලීම සංස්කරණයට සූදානම්.",
    placeholder: "තෝරාගත් දත්ත භාවිතයෙන් සෑදිය යුතු දේ විස්තර කරන්න",
    analyze: "AI මගින් විශ්ලේෂණය කරන්න",
    inspect: "පරීක්ෂා කර පෙරදසුන බලන්න",
    cancel_preview: "අවලංගු කරන්න",
    apply: "තහවුරු කර යොදන්න",
    undo: "සාදන ලද දෑ ඉවත් කරන්න",
    quick_organize: "මෙම වැඩපොතේ දත්ත සංවිධානය කරන්න",
    quick_summary: "මෙම වැඩපොතේ සාරාංශයක් සාදන්න",
    quick_insights: "මෙම වැඩපොත විශ්ලේෂණය කර දත්ත අවබෝධ ලබාගන්න",
    pill_chart: "ප්‍රස්තාරයක් සාදන්න",
    pill_pivot: "PivotTable එකක් සාදන්න",
    pill_table: "වගුවක් ලෙස හැඩසව්වන්න",
    pill_sheet: "ප්‍රතිඵල පත්‍රිකාවක් සාදන්න",
    pill_clean: "දත්ත පිරිසිදු කරන්න",
    more_suggestions: "තවත්…",
    review_toggle: "පියවරෙන් පියවර පරීක්ෂා කරන්න",
    replace_toggle:
      "යෙදීමෙන් පසු පැරණි VynorAI ප්‍රතිඵල පත්‍රිකා ප්‍රතිස්ථාපනය කරන්න",
    preview_safe: "තවම වෙනස්කම් නැත",
    preview_applied: "යොදන ලදී",
    tweak_chart: "ප්‍රස්තාර වර්ගය",
    tweak_aggregation: "සාරාංශ කරන ආකාරය",
    tweak_category: "කාණ්ඩය",
    tweak_value: "අගය",
    reasoned: "පියවර",
    steps_label: "කින් විශ්ලේෂණය කළා",
    cleanup: "පැරණි ප්‍රතිඵල ඉවත් කරන්න",
    menu_language_button: "භාෂාව: English",
    welcome_title: "VynorAI වෙත සාදරයෙන් පිළිගනිමු",
    welcome_body:
      "තෝරාගත් දත්ත විශ්ලේෂණය කිරීම සඳහා ඔබේ කාර්යාල ගිණුමෙන් පිවිසෙන්න.",
    signin: "Microsoft ගිණුමෙන් පිවිසෙන්න",
    menu_show_diag: "දෝෂ විමර්ශන තොරතුරු පෙන්වන්න",
    menu_hide_diag: "දෝෂ විමර්ශන තොරතුරු සඟවන්න",
    menu_selftest: "ස්වයං පරීක්ෂාව ධාවනය කරන්න",
    menu_copy: "දෝෂ විමර්ශන තොරතුරු පිටපත් කරන්න",
    menu_clear: "දෝෂ විමර්ශන තොරතුරු මකන්න",
    menu_signout: "ඉවත් වන්න",
    menu_overview: "වැඩපොතේ සාරාංශය",
    menu_advanced_workbook_options: "උසස් වැඩපොත් විකල්ප",
    menu_language: "භාෂාව",
    preview_title: "පෙරදසුන",
    nothing_changed: "ඔබේ වැඩපොතේ තවමත් කිසිදු වෙනසක් සිදු කර නැත.",
    insights_title: "අවබෝධතා",
    refresh_result: "නැවත පෙරදසුන බලන්න",
    show_result: "ප්‍රතිඵලය පෙන්වන්න",
    pill_formulas: "සූත්‍ර සහ දෝෂ පරීක්ෂා කරන්න",
    consent_title: "AI විශ්ලේෂණයට පෙර",
    consent_body:
      "මෙම වැඩපොතෙන් පිටතට යන්නේ පහත සාරාංශය පමණි: තීරු නාම, දත්ත වර්ග, පේළි සහ හිස් කොටු ගණන, සංඛ්‍යා සහ දින පරාස සහ පුනරාවර්තන අගයන්ගේ අනුපාතය. කොටු අගයන්, පේළි, නම්, ඊමේල් ලිපිනයන් හෝ හඳුනාගැනීමේ අංක නොයැවේ. වැඩපොතේ කිසිවක් වෙනස් නොවේ.",
    consent_show: "යවනු ලබන දත්ත හරියටම පෙන්වන්න",
    consent_agree: "මෙම සාරාංශය VynorAI විශ්ලේෂණ සේවාවට යැවීමට මම එකඟ වෙමි.",
    consent_send: "AI විශ්ලේෂණයට යවන්න",
    consent_cancel: "අවලංගු කරන්න",
    insights_note: "මෙහිම ගණනය කරන ලදී. කිසිවක් පිටතට නොයැවේ.",
    tech_details: "තාක්ෂණික විස්තර",
    brand_tagline: "විශ්ලේෂණය කර, සැලසුම් කර, ආරක්ෂිතව යොදන්න",
    selection_changed_preview: "පෙරදසුනෙන් පසු තේරීම වෙනස් විය.",
    refresh_preview: "පෙරදසුන යළි සාදන්න",
    all_items: "සියලු අයිතම",
    largest_first: "විශාලතම ඒවා මුලින්",
    smallest_first: "කුඩාම ඒවා මුලින්",
    safety_approval: "ආරක්ෂාව සහ අනුමැතිය",
    trust_privacy: "✓ පෞද්ගලිකත්වය ආරක්ෂිතයි",
    trust_original: "✓ මුල් දත්ත නොවෙනස්ව පවතී",
    trust_review: "✓ යෙදීමට පෙර වෙනස්කම් බලන්න",
    verified_unchanged: "තහවුරු කළා. මුල් දත්ත වෙනස් වී නැත.",
    results_hub: "ප්‍රතිඵල මධ්‍යස්ථානය",
    share_centre: "බෙදාගැනීමේ මධ්‍යස්ථානය",
    share_card_title: "රූපයක් ලෙස බෙදාගන්න",
    on_device: "මෙම උපාංගයේ",
    share_card_note:
      "කාඩ්පත සෑදෙන්නේ ඔබේ අලුත්ම ප්‍රතිඵලය, තෝරාගත් කොටු හෝ ඔබ අලවන කොටුවලින්. බෙදාගන්න ඔබන තෙක් මෙම උපාංගයෙන් කිසිවක් පිටතට නොයයි.",
    share_use_result: "අලුත්ම ප්‍රතිඵලය",
    share_use_selection: "තෝරාගත් කොටු",
    share_paste_label: "නැතහොත් Excel වලින් පිටපත් කළ කොටු අලවන්න",
    share_button: "බෙදාගන්න",
    share_message_label: "WhatsApp සාරාංශය (ඔබට සංස්කරණය කළ හැක)",
    share_message_hint: "WhatsApp සඳහා සකසා ඇත. මෙතැනින් කිසිවක් නොයැවේ.",
    share_copy_text: "පෙළ පිටපත් කරන්න",
    share_style_label: "කාඩ්පතේ ආකාරය",
    more_options: "තවත් විකල්ප",
    chat_controls: "සංවාද පාලන",
    workspace_label: "වැඩබිම",
    share_style_summary: "සාරාංශය",
    share_style_chart: "ප්‍රස්තාරය",
    share_style_insight: "අවබෝධය",
    timeline_preview: "පෙරදසුන",
    role_planner: "සැලසුම්කරු",
    role_relationships: "වගු සම්බන්ධතා සොයන්නා",
    role_builder: "සාදන්නා",
    role_accuracy: "නිරවද්‍යතා පරීක්ෂක",
    role_safety: "ආරක්ෂණ පරීක්ෂක",
    role_verification: "තහවුරු කිරීම",
    workbook_map: "වැඩපොත් සිතියම",
    tab_work: "වැඩ",
    tab_results: "ප්‍රතිඵල",
    tab_share: "බෙදාගන්න",
    tab_explore: "සොයන්න",
    explore_empty: "ඔබේ දත්ත තෝරන්න; ඒවාට ගැළපෙන සැකිලි සහ ප්‍රශ්න මෙතැන පෙනේ.",
    results_empty: "තවම කිසිවක් යෙදවී නැත",
    results_empty_note: "වෙනසක් අනුමත කළ පසු එහි ප්‍රතිඵල මෙතැන පෙනේ.",
    share_empty: "ඔබේ දත්ත තෝරන්න",
    share_empty_note: "බෙදාගැනීමට පෙර වැඩපත්‍රයේ දත්ත තෝරන්න.",
    noticed_toggle: "දුටු දේ පෙන්වන්න හෝ සඟවන්න",
    dock_actions: "ප්‍රතිඵල ක්‍රියා",
    explore_close: "මාසාන්ත වසා දැමීම",
    explore_close_note:
      "තේරූ සේවකයින් සඳහා EPF, ETF සහ APIT සහිත වැටුප් පත්‍රිකාවක්. කිසිවක් එක් කිරීමට පෙර ඔබ සංඛ්‍යා බලා අනුමත කරයි.",
    explore_close_go: "වැටුප් සූදානම් කරන්න",
    explore_templates: "සැකිලි",
    explore_templates_note:
      "එකක් ඔබන්න; ඉල්ලීම පෙට්ටියට පිවිසේ. ඔබ අනුමත කරන තුරු කිසිවක් වෙනස් නොවේ.",
    explore_ask: "ඔබේ පත්‍රිකාවෙන් අසන්න",
    explore_ask_note:
      "ප්‍රශ්නයක් ඔබන්න; එය පෙට්ටියට පිවිසේ. සරල ප්‍රශ්නවලට පිළිතුරු මෙම උපාංගයේම ලැබේ.",
    explore_ai: "තවත් අදහස්",
    explore_ai_note:
      "AI තවත් කළ හැකි දේ යෝජනා කරයි. එයට ලැබෙන්නේ තීරු නම් සහ ගණන් පමණි, ඔබේ කොටු කිසිවක් නොවේ. ඔබ අනුමත කරන තුරු කිසිවක් වෙනස් නොවේ.",
    explore_ai_go: "අදහස් ගන්න",
  },
  ta: {
    noticed_title: "உங்கள் தரவில் கவனித்தவை",
    noticed_note:
      "இந்தச் சாதனத்திலேயே சரிபார்க்கப்பட்டது. எதுவும் அனுப்பப்படவில்லை.",
    add_payroll: "சம்பளத் தாளைச் சேர் (EPF, ETF, APIT)",
    product_title: "VynorAI Excel",
    product_subtitle: "பாதுகாப்பாக பகுப்பாய்வு, திட்டம் மற்றும் பயன்படுத்து",
    hero: "உங்கள் தரவுடன் என்ன செய்ய விரும்புகிறீர்கள்?",
    hero_hint:
      "VynorAI உங்கள் அட்டவணையை தானாகக் கண்டுபிடித்து, மாற்றம் செய்வதற்கு முன் புதிய முடிவுத் தாளின் முன்னோட்டத்தைக் காட்டும்.",
    instruction_label: "உருவாக்க வேண்டியதை விவரிக்கவும்",
    conversation_label: "VynorAI உரையாடல்",
    suggestions_label: "பரிந்துரைகள்",
    workbook_context: "பணிப்புத்தகச் சூழல்",
    refresh_context: "புதுப்பி",
    contextual_suggestions: "இந்தத் தேர்வுக்கான பரிந்துரைகள்",
    run_mode: "இயக்க முறை",
    smart_mode: "ஸ்மார்ட்",
    local_mode: "உள்ளக முன்னோட்டம்",
    agent_mode: "முகவர் செயல்முறை",
    run: "இயக்கு",
    more_tools: "மேலும் கருவிகள்",
    preview_impact: "முன்னோட்டத் தாக்கம்",
    rows_label: "வரிசைகள்",
    row_label: "வரிசை",
    columns_label: "நெடுவரிசைகள்",
    column_label: "நெடுவரிசை",
    cell_label: "கலம்",
    large_range: "பெரிய வரம்பு",
    local_preview: "உள்ளக முன்னோட்டம்",
    changes_label: "மாற்றங்கள்",
    warnings_label: "எச்சரிக்கைகள்",
    agent_timeline: "முகவர் முன்னேற்றம்",
    timeline_inspect: "ஆய்வு",
    timeline_plan: "திட்டம்",
    timeline_review: "மதிப்பாய்வு",
    timeline_approval: "ஒப்புதல்",
    timeline_apply: "பயன்படுத்து",
    timeline_verify: "சரிபார்",
    suggestion_quality: "தரவுத் தரத்தைச் சரிபார்",
    suggestion_chart: "சிறந்த விளக்கப்படத்தை உருவாக்கு",
    suggestion_pivot: "பெரிய தரவைச் சுருக்கு",
    suggestion_dashboard: "முகப்புப் பலகை உருவாக்கு",
    suggestion_formulas: "சூத்திரங்களைச் சரிபார்",
    suggestion_forecast: "போக்கு முன்னறிவிப்பை உருவாக்கு",
    suggestion_clean: "உரை மதிப்புகளைச் சுத்தப்படுத்து",
    suggestion_reason_quality:
      "அறிக்கைக்கு முன் வெற்றிடங்கள், நகல்கள் மற்றும் முரண்பாடுகளை கண்டறியும்.",
    suggestion_reason_chart:
      "வகையையும் அளவையும் ஒப்பிட போதுமான நெடுவரிசைகள் உள்ளன.",
    suggestion_reason_pivot: "முழு வரம்பையும் Excel திறமையாகச் சுருக்குகிறது.",
    suggestion_reason_dashboard:
      "KPI, சுருக்கம் மற்றும் விளக்கப்படத்தை ஒரே முடிவுத் தாளில் காட்டலாம்.",
    suggestion_reason_formulas:
      "செயலில் உள்ள கலத்தையும் அருகிலுள்ள சூத்திர முறையையும் சரிபார்க்கும்.",
    suggestion_reason_forecast:
      "இந்தச் சாதனத்தில் உள்ள மாதிரியில் தேதி மற்றும் எண்ணியல் அளவு கண்டறியப்பட்டது.",
    suggestion_reason_clean:
      "விளக்கப்படம் அல்லது முன்னறிவிப்புக்கான எண்ணியல் அளவு இல்லாத உரை நெடுவரிசைகள் கண்டறியப்பட்டன.",
    agent_unavailable:
      "இந்தக் கணக்கிற்கு Agent செயல்முறை கிடைக்கவில்லை. உள்ளக முன்னோட்டத்தைப் பயன்படுத்தவும்.",
    outcomes_label: "உருவாக்கப்படுபவை",
    adjust_preview: "முன்னோட்டத்தைச் சரிசெய்",
    preview_kpis: "முக்கிய எண்கள்",
    steps_aria: "படிகள்",
    agent_plan: "திட்டம்",
    selection_using: "பயன்படுத்துவது:",
    skip_to_request: "கோரிக்கைக்குச் செல்",
    email_report: "அறிக்கையை email செய்",
    reviewed: "மதிப்பாய்வு செய்யப்பட்டது",
    fmt_auto: "தானியங்கி தேர்வு",
    fmt_xlsx: "Excel பணிப்புத்தகம் (.xlsx)",
    fmt_pdf: "PDF அறிக்கை (.pdf)",
    fmt_csv: "CSV அறிக்கை (.csv)",
    fmt_xlsx_pdf: "Excel பணிப்புத்தகம் + PDF",
    fmt_summary: "email-இல் சுருக்கம் மட்டும்",
    body_html: "விரிவான HTML",
    body_text: "எளிய உரை",
    send_now: "இப்போது அனுப்பு",
    save_draft: "Outlook வரைவைச் சேமி",
    ai_message: "AI மூலம் செய்தியை எழுது",
    include_charts: "அறிக்கையின் விளக்கப்படங்களை email உள்ளடக்கத்தில் சேர்",
    review_send: "அறிக்கையைச் சரிபார்த்து அனுப்பு",
    open_draft: "Outlook web-இல் வரைவைத் திற",
    agent_title: "முகவர்",
    agent_note:
      "இன்னும் எதுவும் மாறவில்லை. மாற்றங்களைச் சரிபார்த்து ஒப்புதல் அளிக்கவும்.",
    approve_apply: "ஒப்புதல் அளித்துப் பயன்படுத்து",
    discard: "நிராகரி",
    stop: "நிறுத்து",
    workbook_settings: "பணிப்புத்தக அமைப்புகள்",
    prefs_note:
      "இந்தப் பணிப்புத்தகத்திலேயே சேமிக்கப்படும்; இதைத் திறக்கும் அனைவருக்கும் அதே மதிப்புகள் கிடைக்கும். தேர்வுகள் மட்டுமே சேமிக்கப்படும், கல மதிப்புகள் ஒருபோதும் இல்லை.",
    not_set: "அமைக்கப்படவில்லை",
    as_in_data: "தரவில் உள்ளபடி",
    style_lakhs: "இலட்சம் (12,34,567)",
    style_millions: "மில்லியன் (Mn)",
    style_plain: "சாதாரணம் (1,234,567)",
    fy_april: "ஏப்ரல் (இலங்கை)",
    fy_january: "ஜனவரி",
    fy_july: "ஜூலை",
    audience_auto: "கோரிக்கைக்கு ஏற்பத் தீர்மானி",
    audience_mgmt: "முகாமைத்துவம் (ஒரு பக்கம்)",
    audience_ops: "செயற்பாடுகள் (முழு விவரங்கள்)",
    log_changes: 'ஒவ்வொரு மாற்றத்தையும் "VynorAI Log" தாளில் பதிவு செய்',
    add_holidays: "இலங்கை விடுமுறை அட்டவணையைச் சேர்",
    forget_choices: "இந்தத் தேர்வுகளை மற",
    clean_first: "முதலில் சுத்தம் செய்து, பின்னர் இதை இயக்கு",
    plan_with_ai: "AI மூலம் படிகளைத் திட்டமிடு",
    ask_agent: "முகவரிடம் கேள்",
    diagnostics_title: "கண்டறிதல்",
    agent_sources: "மூலங்கள்",
    request_change: "பணிப்புத்தக மாற்றத்தைக் கோரு",
    new_chat: "+ புதிய அரட்டை",
    chat_history: "அரட்டை வரலாறு",
    delete_chat: "நீக்கு",
    new_chat_option: "புதிய அரட்டை",
    new_chat_ready:
      "புதிய அரட்டை. தரவைத் தேர்ந்தெடுத்து உங்களுக்கு என்ன வேண்டும் என்று விவரிக்கவும்.",
    delete_chat_confirm:
      "இந்த அரட்டையை வரலாற்றிலிருந்து நீக்கவா? உங்கள் பணிப்புத்தகம் மாறாது.",
    conversation_you: "நீங்கள்",
    conversation_attention: "கவனம் தேவை",
    edit_request: "கடைசி கோரிக்கையைத் திருத்து",
    edit_ready: "கடைசி கோரிக்கையைத் திருத்தத் தயாராக உள்ளது.",
    placeholder:
      "தேர்ந்தெடுத்த தரவிலிருந்து எதை உருவாக்க வேண்டும் என்று விவரிக்கவும்",
    analyze: "AI மூலம் பகுப்பாய்வு",
    inspect: "சரிபார்த்து முன்னோட்டம்",
    cancel_preview: "ரத்து செய்",
    apply: "உறுதிசெய்து பயன்படுத்து",
    undo: "உருவாக்கியவற்றை நீக்கு",
    quick_organize: "இந்தப் பணிப்புத்தகத் தரவை ஒழுங்குபடுத்து",
    quick_summary: "இந்தப் பணிப்புத்தகத்தின் சுருக்கத்தை உருவாக்கு",
    quick_insights:
      "இந்தப் பணிப்புத்தகத்தைப் பகுப்பாய்வு செய்து நுண்ணறிவுகளைப் பெறு",
    pill_chart: "விளக்கப்படம் உருவாக்கு",
    pill_pivot: "PivotTable உருவாக்கு",
    pill_table: "அட்டவணையாக வடிவமை",
    pill_sheet: "முடிவு தாள் உருவாக்கு",
    pill_clean: "தரவைச் சுத்தம் செய்",
    more_suggestions: "மேலும்…",
    review_toggle: "ஒவ்வொரு படியையும் மதிப்பாய்வு செய்",
    replace_toggle: "பயன்படுத்திய பின் பழைய VynorAI முடிவுத் தாள்களை மாற்று",
    preview_safe: "இன்னும் மாற்றங்கள் இல்லை",
    preview_applied: "பயன்படுத்தப்பட்டது",
    tweak_chart: "விளக்கப்பட வகை",
    tweak_aggregation: "சுருக்கம்",
    tweak_category: "வகை",
    tweak_value: "மதிப்பு",
    reasoned: "இதில்",
    steps_label: "படிகள் பரிசீலிக்கப்பட்டன",
    cleanup: "பழைய முடிவுகளை அகற்று",
    menu_language_button: "மொழி: English",
    welcome_title: "VynorAI-க்கு வரவேற்கிறோம்",
    welcome_body:
      "தேர்ந்தெடுத்த தரவை பகுப்பாய்வு செய்ய உங்கள் பணிக் கணக்கில் உள்நுழையவும்.",
    signin: "Microsoft மூலம் உள்நுழை",
    menu_show_diag: "கண்டறிதலைக் காட்டு",
    menu_hide_diag: "கண்டறிதலை மறை",
    menu_selftest: "சுய பரிசோதனையை இயக்கு",
    menu_copy: "கண்டறிதலை நகலெடு",
    menu_clear: "கண்டறிதலை அழி",
    menu_signout: "வெளியேறு",
    menu_overview: "பணிப்புத்தக மேலோட்டம்",
    menu_advanced_workbook_options: "மேம்பட்ட பணிப்புத்தக விருப்பங்கள்",
    menu_language: "மொழி",
    preview_title: "முன்னோட்டம்",
    nothing_changed: "உங்கள் பணிப்புத்தகத்தில் இன்னும் எதுவும் மாறவில்லை.",
    insights_title: "நுண்ணறிவுகள்",
    refresh_result: "மீண்டும் முன்னோட்டம்",
    show_result: "முடிவைக் காட்டு",
    pill_formulas: "சூத்திரங்களையும் பிழைகளையும் சரிபார்",
    consent_title: "AI பகுப்பாய்வுக்கு முன்",
    consent_body:
      "இந்தப் பணிப்புத்தகத்திலிருந்து கீழே உள்ள சுருக்கம் மட்டுமே வெளியே செல்லும்: நெடுவரிசைப் பெயர்கள், தரவு வகைகள், வரிசைகள் மற்றும் வெற்றுக் கலங்களின் எண்ணிக்கை, எண் மற்றும் தேதி வரம்புகள், மீண்டும் வரும் மதிப்புகளின் விகிதம். கல மதிப்புகள், வரிசைகள், பெயர்கள், email முகவரிகள் அல்லது அடையாள எண்கள் அனுப்பப்படாது. பணிப்புத்தகத்தில் எதுவும் மாறாது.",
    consent_show: "அனுப்பப்படும் தரவைச் சரியாகக் காட்டு",
    consent_agree:
      "இந்தச் சுருக்கத்தை VynorAI பகுப்பாய்வுச் சேவைக்கு அனுப்ப நான் ஒப்புக்கொள்கிறேன்.",
    consent_send: "AI பகுப்பாய்வுக்கு அனுப்பு",
    consent_cancel: "ரத்து செய்",
    insights_note: "இங்கேயே கணக்கிடப்பட்டது. எதுவும் வெளியே அனுப்பப்படாது.",
    tech_details: "தொழில்நுட்ப விவரங்கள்",
    brand_tagline:
      "பகுப்பாய்வு செய்து, திட்டமிட்டு, பாதுகாப்பாகப் பயன்படுத்துங்கள்",
    selection_changed_preview: "முன்னோட்டத்திற்குப் பிறகு தேர்வு மாறியது.",
    refresh_preview: "முன்னோட்டத்தைப் புதுப்பி",
    all_items: "அனைத்து உருப்படிகளும்",
    largest_first: "பெரியவை முதலில்",
    smallest_first: "சிறியவை முதலில்",
    safety_approval: "பாதுகாப்பு மற்றும் ஒப்புதல்",
    trust_privacy: "✓ தனியுரிமை பாதுகாக்கப்படுகிறது",
    trust_original: "✓ அசல் தரவு மாறாமல் இருக்கும்",
    trust_review: "✓ பயன்படுத்தும் முன் மாற்றங்களைப் பாருங்கள்",
    verified_unchanged: "சரிபார்க்கப்பட்டது. அசல் தரவு மாறவில்லை.",
    results_hub: "முடிவுகள் மையம்",
    share_centre: "பகிர்வு மையம்",
    share_card_title: "படமாகப் பகிர்",
    on_device: "இந்தச் சாதனத்தில்",
    share_card_note:
      "அட்டை உங்கள் சமீபத்திய முடிவு, தேர்ந்தெடுத்த கலங்கள் அல்லது நீங்கள் ஒட்டும் கலங்களிலிருந்து உருவாகிறது. பகிர் அழுத்தும் வரை இந்தச் சாதனத்திலிருந்து எதுவும் வெளியே செல்லாது.",
    share_use_result: "சமீபத்திய முடிவு",
    share_use_selection: "தேர்ந்தெடுத்த கலங்கள்",
    share_paste_label: "அல்லது Excel-இல் நகலெடுத்த கலங்களை ஒட்டுங்கள்",
    share_button: "பகிர்",
    share_message_label: "WhatsApp சுருக்கம் (திருத்தலாம்)",
    share_message_hint:
      "WhatsApp-க்கு வடிவமைக்கப்பட்டது. இங்கிருந்து எதுவும் அனுப்பப்படாது.",
    share_copy_text: "உரையை நகலெடு",
    share_style_label: "அட்டை பாணி",
    more_options: "மேலும் விருப்பங்கள்",
    chat_controls: "உரையாடல் கட்டுப்பாடுகள்",
    workspace_label: "பணியிடம்",
    share_style_summary: "சுருக்கம்",
    share_style_chart: "வரைபடம்",
    share_style_insight: "நுண்ணறிவு",
    timeline_preview: "முன்னோட்டம்",
    role_planner: "திட்டமிடுபவர்",
    role_relationships: "அட்டவணைத் தொடர்புகளைக் கண்டறிபவர்",
    role_builder: "உருவாக்குபவர்",
    role_accuracy: "துல்லியச் சரிபார்ப்பாளர்",
    role_safety: "பாதுகாப்புச் சரிபார்ப்பாளர்",
    role_verification: "சரிபார்ப்பு",
    workbook_map: "பணிப்புத்தக வரைபடம்",
    tab_work: "வேலை",
    tab_results: "முடிவுகள்",
    tab_share: "பகிர்",
    tab_explore: "ஆராய்",
    explore_empty:
      "உங்கள் தரவைத் தேர்ந்தெடுங்கள்; அதற்கேற்ற வார்ப்புருக்களும் கேள்விகளும் இங்கே தோன்றும்.",
    results_empty: "இன்னும் எதுவும் பயன்படுத்தப்படவில்லை",
    results_empty_note:
      "மாற்றத்தை அங்கீகரித்த பிறகு அதன் முடிவுகள் இங்கே தோன்றும்.",
    share_empty: "உங்கள் தரவைத் தேர்ந்தெடுங்கள்",
    share_empty_note: "பகிர்வதற்கு முன் தாளில் உள்ள தரவைத் தேர்ந்தெடுங்கள்.",
    noticed_toggle: "கவனித்தவற்றைக் காட்டு அல்லது மறை",
    dock_actions: "முடிவு செயல்கள்",
    explore_close: "மாத இறுதி முடிவு",
    explore_close_note:
      "தேர்ந்தெடுத்த ஊழியர்களுக்கு EPF, ETF, APIT உடன் ஒரு சம்பளத் தாள். எதையும் சேர்ப்பதற்கு முன் எண்களைப் பார்த்து நீங்கள் ஒப்புதல் அளிப்பீர்கள்.",
    explore_close_go: "சம்பளத்தைத் தயார்செய்",
    explore_templates: "வார்ப்புருக்கள்",
    explore_templates_note:
      "ஒன்றைத் தட்டுங்கள்; கோரிக்கை பெட்டியில் வரும். நீங்கள் ஒப்புதல் அளிக்கும் வரை எதுவும் மாறாது.",
    explore_ask: "உங்கள் தாளிடம் கேளுங்கள்",
    explore_ask_note:
      "ஒரு கேள்வியைத் தட்டுங்கள்; அது பெட்டியில் வரும். எளிய கேள்விகளுக்குப் பதில் இந்தச் சாதனத்திலேயே கிடைக்கும்.",
    explore_ai: "மேலும் யோசனைகள்",
    explore_ai_note:
      "AI மேலும் செய்யக்கூடியவற்றை பரிந்துரைக்கும். அதற்கு நெடுவரிசை பெயர்களும் எண்ணிக்கைகளும் மட்டுமே கிடைக்கும், உங்கள் கலங்கள் அல்ல. நீங்கள் ஒப்புதல் அளிக்கும் வரை எதுவும் மாறாது.",
    explore_ai_go: "யோசனைகளைப் பெறுங்கள்",
  },
};

// v2: the pane starts in English again; an older saved Sinhala or Tamil choice is not carried over.
const STORAGE_KEY = "vynorai.m365.language.v2";

export function isLanguage(value: unknown): value is Language {
  return value === "en" || value === "si" || value === "ta";
}

export function nextLanguage(current: Language): Language {
  return LANGUAGE_ORDER[
    (LANGUAGE_ORDER.indexOf(current) + 1) % LANGUAGE_ORDER.length
  ];
}

/** English is the text already in the page; other languages replace it by key. */
export function translate(
  language: Language,
  key: string,
  fallback: string,
): string {
  if (language === "en") return fallback;
  return STRINGS[language][key] ?? fallback;
}

/** Run-time messages are built in English; this renders them in the chosen language. */
export function localizeMessage(language: Language, text: string): string {
  if (language === "si") return localizeMessageSi(text);
  if (language === "ta") return localizeMessageTa(text);
  return text;
}

const ASKS_SINHALA =
  /\b(sinhalen|sinhala\s*(walin|wlin|valin|eken|ta)|(in|into|to)\s+sinhala|sinhala\s+(explain|reply|answer))\b/i;
const ASKS_TAMIL =
  /\b(tamilil|(in|into|to)\s+tamil|tamil\s+(explain|reply|answer))\b/i;

/**
 * The language an AI answer should be written in. English, Singlish and mixed requests get English
 * answers; Sinhala or Tamil only when the person typed in that script or asked for it ("explain
 * in Sinhala", "sinhalen pahadili karanna"). The pane language does not decide it.
 */
export function responseLanguage(typed: string, _pane?: Language): Language {
  if (/[඀-෿]/.test(typed) || ASKS_SINHALA.test(typed)) return "si";
  if (/[஀-௿]/.test(typed) || ASKS_TAMIL.test(typed)) return "ta";
  return "en";
}

export function loadLanguage(
  storage: Pick<Storage, "getItem"> | undefined = safeStorage(),
): Language {
  try {
    const saved = storage?.getItem(STORAGE_KEY);
    return isLanguage(saved) ? saved : "en";
  } catch {
    return "en";
  }
}

export function saveLanguage(
  language: Language,
  storage: Pick<Storage, "setItem"> | undefined = safeStorage(),
): void {
  try {
    storage?.setItem(STORAGE_KEY, language);
  } catch {
    // Language choice is a convenience; the pane works without storing it.
  }
}

function safeStorage(): Storage | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

/** Applies a language to every element marked with data-i18n or data-i18n-placeholder. */
export function applyLanguage(root: ParentNode, language: Language): void {
  for (const element of root.querySelectorAll<HTMLElement>("[data-i18n]")) {
    if (element.dataset.i18nDefault === undefined)
      element.dataset.i18nDefault = element.textContent ?? "";
    element.textContent = translate(
      language,
      element.dataset.i18n ?? "",
      element.dataset.i18nDefault,
    );
  }
  for (const element of root.querySelectorAll<HTMLElement>(
    "[data-i18n-placeholder]",
  )) {
    if (element.dataset.i18nDefault === undefined)
      element.dataset.i18nDefault = element.getAttribute("placeholder") ?? "";
    element.setAttribute(
      "placeholder",
      translate(
        language,
        element.dataset.i18nPlaceholder ?? "",
        element.dataset.i18nDefault,
      ),
    );
  }
  for (const element of root.querySelectorAll<HTMLElement>(
    "[data-i18n-aria-label]",
  )) {
    if (element.dataset.i18nAriaLabelDefault === undefined)
      element.dataset.i18nAriaLabelDefault =
        element.getAttribute("aria-label") ?? "";
    element.setAttribute(
      "aria-label",
      translate(
        language,
        element.dataset.i18nAriaLabel ?? "",
        element.dataset.i18nAriaLabelDefault,
      ),
    );
  }
}
