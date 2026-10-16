import { localizeMessageSi } from "./messagesSi.js";

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
    hero: "ඔබේ දත්ත සමඟ කුමක් කිරීමට අවශ්‍යද?",
    hero_hint:
      "VynorAI ඔබේ වගුව ස්වයංක්‍රීයව සොයා, වෙනස්කම් කිරීමට පෙර නව ප්‍රතිඵල පත්‍රිකාවක පෙරදසුනක් පෙන්වයි.",
    instruction_label: "සෑදිය යුතු දේ විස්තර කරන්න",
    conversation_label: "VynorAI සංවාදය",
    suggestions_label: "යෝජනා",
    outcomes_label: "සාදනු ලබන දෑ",
    adjust_preview: "පෙරදසුන සකසන්න",
    steps_aria: "පියවර",
    request_change: "වැඩපොතේ වෙනසක් ඉල්ලන්න",
    conversation_you: "ඔබ",
    conversation_attention: "අවධානය අවශ්‍යයි",
    edit_request: "අවසන් ඉල්ලීම සංස්කරණය කරන්න",
    edit_ready: "අවසන් ඉල්ලීම සංස්කරණයට සූදානම්.",
    placeholder: "තෝරාගත් දත්ත භාවිතයෙන් සෑදිය යුතු දේ විස්තර කරන්න",
    analyze: "AI මගින් විශ්ලේෂණය කරන්න",
    inspect: "පරීක්ෂා කර පෙරදසුන බලන්න",
    apply: "තහවුරු කර යොදන්න",
    undo: "සාදන ලද දෑ ඉවත් කරන්න",
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
    menu_language: "භාෂාව",
    preview_title: "පෙරදසුන",
    nothing_changed: "ඔබේ වැඩපොතේ තවමත් කිසිදු වෙනසක් සිදු කර නැත.",
    insights_title: "අවබෝධතා",
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
  },
  ta: {
    hero: "உங்கள் தரவுடன் என்ன செய்ய விரும்புகிறீர்கள்?",
    hero_hint:
      "VynorAI உங்கள் அட்டவணையை தானாகக் கண்டுபிடித்து, மாற்றம் செய்வதற்கு முன் புதிய முடிவுத் தாளின் முன்னோட்டத்தைக் காட்டும்.",
    instruction_label: "உருவாக்க வேண்டியதை விவரிக்கவும்",
    conversation_label: "VynorAI உரையாடல்",
    suggestions_label: "பரிந்துரைகள்",
    outcomes_label: "உருவாக்கப்படுபவை",
    adjust_preview: "முன்னோட்டத்தைச் சரிசெய்",
    steps_aria: "படிகள்",
    request_change: "பணிப்புத்தக மாற்றத்தைக் கோரு",
    conversation_you: "நீங்கள்",
    conversation_attention: "கவனம் தேவை",
    edit_request: "கடைசி கோரிக்கையைத் திருத்து",
    edit_ready: "கடைசி கோரிக்கையைத் திருத்தத் தயாராக உள்ளது.",
    placeholder:
      "தேர்ந்தெடுத்த தரவிலிருந்து எதை உருவாக்க வேண்டும் என்று விவரிக்கவும்",
    analyze: "AI மூலம் பகுப்பாய்வு",
    inspect: "சரிபார்த்து முன்னோட்டம்",
    apply: "உறுதிசெய்து பயன்படுத்து",
    undo: "உருவாக்கியவற்றை நீக்கு",
    pill_chart: "விளக்கப்படம் உருவாக்கு",
    pill_pivot: "PivotTable உருவாக்கு",
    pill_table: "அட்டவணையாக வடிவமை",
    pill_sheet: "முடிவு தாள் உருவாக்கு",
    pill_clean: "தரவைச் சுத்தம் செய்",
    more_suggestions: "மேலும்…",
    review_toggle: "ஒவ்வொரு படியையும் மதிப்பாய்வு செய்",
    replace_toggle: "பயன்படுத்திய பின் பழைய VynorAI முடிவுத் தாள்களை மாற்று",
    preview_safe: "இன்னும் மாற்றங்கள் இல்லை",
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
    menu_language: "மொழி",
    preview_title: "முன்னோட்டம்",
    nothing_changed: "உங்கள் பணிப்புத்தகத்தில் இன்னும் எதுவும் மாறவில்லை.",
    insights_title: "நுண்ணறிவுகள்",
    show_result: "முடிவைக் காட்டு",
    tech_details: "தொழில்நுட்ப விவரங்கள்",
  },
};

const STORAGE_KEY = "vynorai.m365.language";

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
  return language === "si" ? localizeMessageSi(text) : text;
}

/**
 * The language an AI answer should be written in: the script the person typed in wins, then the
 * language chosen in the pane, then English.
 */
export function responseLanguage(typed: string, pane: Language): Language {
  if (/[඀-෿]/.test(typed)) return "si";
  if (/[஀-௿]/.test(typed)) return "ta";
  return pane;
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
