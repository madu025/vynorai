/** Sinhala and Tamil text lives in separately loaded packs; a pack registers itself here when it loads. */
export type Dictionary = Record<string, string>;

export interface LanguagePack {
  strings: Dictionary;
  localize: (text: string) => string;
}

export type PackLanguage = "si" | "ta";

const packs: Partial<Record<PackLanguage, LanguagePack>> = {};

export function registerLanguagePack(
  language: PackLanguage,
  pack: LanguagePack,
): void {
  packs[language] = pack;
}

export function languagePack(language: PackLanguage): LanguagePack | undefined {
  return packs[language];
}
