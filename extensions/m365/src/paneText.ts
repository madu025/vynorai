/**
 * Sentences the task pane builds around a request (preview line, "will be created on", the done
 * line), in English, Sinhala or Tamil. Pure, so each language is tested without a browser.
 */
import type { Language } from "./i18n.js";
import { kindTitle } from "./outcome.js";

const pick = (language: Language, en: string, si: string, ta: string) =>
  language === "si" ? si : language === "ta" ? ta : en;

/** " Did you mean "Region"?" after a column the reader could not find. */
export function didYouMean(headers: string[], language: Language): string {
  const quoted = (open: string, close: string) =>
    headers.map((header) => `${open}${header}${close}`).join(", ");
  return pick(
    language,
    ` Did you mean ${quoted('"', '"')} ?`,
    ` ඔබ අදහස් කළේ ${quoted("“", "”")} ද?`,
    ` நீங்கள் குறிப்பிட்டது ${quoted("“", "”")} ஆ?`,
  );
}

/** The preview summary: what the result reads, and that the source stays as it is. */
export function usingRowsSummary(
  parts: { rows: number; columns: number; from: string; warnings: string[] },
  language: Language,
): string {
  const { rows, columns, from } = parts;
  const warnings = parts.warnings.length ? ` ${parts.warnings.join(" ")}` : "";
  return (
    pick(
      language,
      `Using ${rows} rows and ${columns} columns${from}. Your source data stays unchanged.`,
      `පේළි ${rows}ක් සහ තීරු ${columns}ක් භාවිතා කරයි${from}. ඔබේ මූලාශ්‍ර දත්ත වෙනස් නොවේ.`,
      `${rows} வரிசைகளும் ${columns} நெடுவரிசைகளும் பயன்படுத்தப்படுகின்றன${from}. உங்கள் மூலத் தரவு மாறாது.`,
    ) + warnings
  );
}

export function willBeCreatedOn(sheet: string, language: Language): string {
  return pick(
    language,
    `Will be created on sheet ${sheet}`,
    `${sheet} පත්‍රිකාවේ සාදනු ඇත`,
    `${sheet} தாளில் உருவாக்கப்படும்`,
  );
}

/** Under a preview table built from a sample of a large range. */
export function samplePreviewNote(
  sampled: number,
  total: number,
  language: Language,
): string {
  const shown = sampled.toLocaleString("en-US");
  const all = total.toLocaleString("en-US");
  return pick(
    language,
    `Sample preview (${shown} of ${all} rows). Excel calculates the real totals over every row.`,
    `නියැදි පෙරදසුනකි (පේළි ${shown} / ${all}). සැබෑ එකතු Excel විසින් සියලු පේළි මත ගණනය කරයි.`,
    `மாதிரி முன்னோட்டம் (${all} வரிசைகளில் ${shown}). உண்மையான மொத்தங்களை Excel ஒவ்வொரு வரிசையின் மீதும் கணக்கிடுகிறது.`,
  );
}

/** A plain-language result line: what now exists and where, without internal object names. */
export function doneSentence(
  results: Array<{ kind: string; targetSheet: string; status: string }>,
  sourceUnchanged: boolean,
  language: Language,
): string {
  const created = results.filter((entry) => entry.status === "created");
  const exists = results.filter((entry) => entry.status === "exists");
  const sheets = [...new Set(created.map((entry) => entry.targetSheet))].join(
    ", ",
  );
  const kinds = [
    ...new Set(
      created.map((entry) => kindTitle(entry.kind, language).toLowerCase()),
    ),
  ].join(", ");
  const base = created.length
    ? pick(
        language,
        `Done. ${kinds[0].toUpperCase()}${kinds.slice(1)} created on sheet ${sheets}.`,
        `සම්පූර්ණයි. ${kinds} ${sheets} පත්‍රිකාවේ සාදන ලදී.`,
        `முடிந்தது. ${kinds} ${sheets} தாளில் உருவாக்கப்பட்டது.`,
      )
    : pick(
        language,
        "Nothing new was created.",
        "අලුතින් කිසිවක් සාදා නැත.",
        "புதிதாக எதுவும் உருவாக்கப்படவில்லை.",
      );
  const already = exists.length
    ? pick(
        language,
        " Some items already existed.",
        " සමහර අයිතම දැනටමත් තිබුණි.",
        " சில உருப்படிகள் ஏற்கனவே இருந்தன.",
      )
    : "";
  const source = sourceUnchanged
    ? pick(
        language,
        "Your original data was not changed.",
        "ඔබේ මූලාශ්‍ර දත්ත වෙනස් වී නැත.",
        "உங்கள் மூலத் தரவு மாற்றப்படவில்லை.",
      )
    : pick(
        language,
        "Please check your source data.",
        "මූලාශ්‍ර දත්ත පරීක්ෂා කරන්න.",
        "உங்கள் மூலத் தரவைச் சரிபார்க்கவும்.",
      );
  return `${base}${already} ${source}`;
}
