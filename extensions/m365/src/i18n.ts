import { languagePack } from "./languageRegistry.js";

export type Language = "en" | "si" | "ta";

export const LANGUAGE_ORDER: Language[] = ["en", "si", "ta"];
export const LANGUAGE_NAMES: Record<Language, string> = {
  en: "English",
  si: "සිංහල",
  ta: "தமிழ்",
};

// v2: the pane starts in English again; an older saved Sinhala or Tamil choice is not carried over.
const STORAGE_KEY = "vynorai.m365.language.v2";

const loading: Partial<Record<Language, Promise<void>>> = {};

/**
 * Sinhala and Tamil text is a separate download (about a quarter of the pane). English never needs it;
 * until a pack has loaded, translate and localizeMessage return the English text. A failed download is
 * tried once more, then reported so the caller can stay in English.
 */
export function ensureLanguagePack(language: Language): Promise<void> {
  if (language === "en" || languagePack(language)) return Promise.resolve();
  const open = () =>
    language === "si" ? import("./packSi.js") : import("./packTa.js");
  loading[language] ??= open()
    .catch(() => new Promise((resolve) => setTimeout(resolve, 800)).then(open))
    .then(() => undefined)
    .catch((error) => {
      delete loading[language];
      throw error;
    });
  return loading[language]!;
}

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
  return languagePack(language)?.strings[key] ?? fallback;
}

/** Run-time messages are built in English; this renders them in the chosen language. */
export function localizeMessage(language: Language, text: string): string {
  if (language === "en") return text;
  return languagePack(language)?.localize(text) ?? text;
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
