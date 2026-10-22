/**
 * Sentences the task pane builds around a request (preview line, "will be created on", the done
 * line), in English, Sinhala or Tamil. Pure, so each language is tested without a browser.
 */
import type { PaneCard } from "./confirmDialog.js";
import type { Language } from "./i18n.js";
import { kindTitle } from "./outcome.js";

export const pick = (language: Language, en: string, si: string, ta: string) =>
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

const rupees = (value: number) =>
  `Rs ${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Whole rupees for a card tile, with no currency prefix so the figure fits. */
const tileRupees = (value: number) => Math.round(value).toLocaleString("en-US");

/** The question before a payroll sheet is added: what it holds and that the rates need a check. */
export function payrollQuestion(
  plan: {
    sheet: string;
    employees: number;
    totals: { gross: number; apit: number; net: number };
    needsReview: boolean;
  },
  copied: number,
  language: Language,
  /** Bonus or incentive headers that were not copied. */
  skipped: string[] = [],
): string {
  const { sheet, totals } = plan;
  const what = copied
    ? pick(
        language,
        `Add a "${sheet}" sheet for the ${copied} employees in the selection? Gross ${rupees(totals.gross)}, APIT ${rupees(totals.apit)}, net pay ${rupees(totals.net)}. Your list is copied, never changed.`,
        `තෝරාගත් සේවකයින් ${copied} දෙනා සඳහා "${sheet}" පත්‍රිකාවක් එක් කරන්නද? දළ වැටුප ${rupees(totals.gross)}, APIT ${rupees(totals.apit)}, ශුද්ධ වැටුප ${rupees(totals.net)}. ඔබේ ලැයිස්තුව පිටපත් කරනු ලැබේ; එය කිසිසේත් වෙනස් නොකෙරේ.`,
        `தேர்ந்தெடுத்த ${copied} ஊழியர்களுக்கு "${sheet}" தாளைச் சேர்க்கவா? மொத்தச் சம்பளம் ${rupees(totals.gross)}, APIT ${rupees(totals.apit)}, நிகரச் சம்பளம் ${rupees(totals.net)}. உங்கள் பட்டியல் நகலெடுக்கப்படும், மாற்றப்படாது.`,
      )
    : pick(
        language,
        `Add a "${sheet}" sheet with ${plan.employees} blank employee rows? Type each basic salary and allowances; EPF, ETF, APIT and net pay fill in by formula.`,
        `හිස් සේවක පේළි ${plan.employees}ක් සහිත "${sheet}" පත්‍රිකාවක් එක් කරන්නද? එක් එක් සේවකයාගේ මූලික වැටුප සහ දීමනා ටයිප් කරන්න; EPF, ETF, APIT සහ ශුද්ධ වැටුප සූත්‍ර මගින් පිරේ.`,
        `${plan.employees} வெற்று ஊழியர் வரிசைகளுடன் "${sheet}" தாளைச் சேர்க்கவா? ஒவ்வொரு ஊழியரின் அடிப்படைச் சம்பளத்தையும் கொடுப்பனவுகளையும் தட்டச்சு செய்யவும்; EPF, ETF, APIT, நிகரச் சம்பளம் சூத்திரங்களால் நிரம்பும்.`,
      );
  const review = plan.needsReview
    ? pick(
        language,
        " The EPF, ETF and APIT rates have not been checked by an accountant yet.",
        " EPF, ETF සහ APIT අනුපාත තවම ගණකාධිකාරිවරයෙකු පරීක්ෂා කර නැත.",
        " EPF, ETF, APIT விகிதங்கள் இன்னும் ஒரு கணக்காளரால் சரிபார்க்கப்படவில்லை.",
      )
    : "";
  const list = skipped.join(", ");
  const bonus = skipped.length
    ? pick(
        language,
        ` ${list} is not copied: a bonus is taxed with APIT Table 2, not the monthly table, so add it with your accountant.`,
        ` ${list} පිටපත් කළේ නැත: ප්‍රසාද දීමනාවකට APIT බදු ගණනය කරන්නේ මාසික වගුවෙන් නොව Table 2 මගිනි, එබැවින් ඔබේ ගණකාධිකාරිවරයා සමඟ එය එක් කරන්න.`,
        ` ${list} நகலெடுக்கப்படவில்லை: போனஸுக்கான APIT மாதாந்த அட்டவணையால் அல்ல, Table 2 மூலம் கணக்கிடப்படுகிறது; எனவே உங்கள் கணக்காளருடன் அதைச் சேர்க்கவும்.`,
      )
    : "";
  return `${what}${bonus}${review}`;
}

/** The payroll question as a card: three figures and short tags instead of a sentence. */
export function payrollCard(
  plan: {
    sheet: string;
    employees: number;
    totals: { gross: number; apit: number; net: number };
    needsReview: boolean;
  },
  copied: number,
  language: Language,
  skipped: string[] = [],
): PaneCard {
  const tags: PaneCard["tags"] = [
    {
      text: copied
        ? pick(
            language,
            `${copied} employees copied`,
            `සේවකයින් ${copied}ක් පිටපත් කළා`,
            `${copied} ஊழியர்கள் நகலெடுக்கப்பட்டனர்`,
          )
        : pick(
            language,
            `${plan.employees} blank rows`,
            `හිස් පේළි ${plan.employees}ක්`,
            `${plan.employees} வெற்று வரிசைகள்`,
          ),
    },
    {
      text: pick(
        language,
        "Live formulas",
        "සජීවී සූත්‍ර",
        "நேரடி சூத்திரங்கள்",
      ),
    },
  ];
  if (skipped.length)
    tags.push({
      text: pick(
        language,
        `${skipped.join(", ")} not copied (APIT Table 2)`,
        `${skipped.join(", ")} පිටපත් කළේ නැත (APIT Table 2)`,
        `${skipped.join(", ")} நகலெடுக்கப்படவில்லை (APIT Table 2)`,
      ),
      warn: true,
    });
  if (plan.needsReview)
    tags.push({
      text: pick(
        language,
        "Rates unchecked",
        "අනුපාත පරීක්ෂා කර නැත",
        "விகிதங்கள் சரிபார்க்கப்படவில்லை",
      ),
      warn: true,
    });
  return {
    title: plan.sheet,
    tiles: copied
      ? [
          {
            label: pick(language, "Gross", "දළ වැටුප", "மொத்தச் சம்பளம்"),
            value: tileRupees(plan.totals.gross),
          },
          { label: "APIT", value: tileRupees(plan.totals.apit), warn: true },
          {
            label: pick(language, "Net pay", "ශුද්ධ වැටුප", "நிகரச் சம்பளம்"),
            value: tileRupees(plan.totals.net),
          },
        ]
      : [],
    tags,
  };
}

/** The status line after the payroll sheet was added, or why it was not. */
export function payrollResult(
  outcome: "created" | "exists" | "failed",
  sheet: string,
  language: Language,
): string {
  if (outcome === "exists")
    return pick(
      language,
      `A "${sheet}" sheet already exists; nothing was changed.`,
      `"${sheet}" පත්‍රිකාවක් දැනටමත් ඇත; කිසිවක් වෙනස් කළේ නැත.`,
      `"${sheet}" தாள் ஏற்கனவே உள்ளது; எதுவும் மாற்றப்படவில்லை.`,
    );
  if (outcome === "failed")
    return pick(
      language,
      "The payroll sheet could not be added. See Diagnostics.",
      "වැටුප් පත්‍රිකාව එක් කළ නොහැකි විය. Diagnostics බලන්න.",
      "சம்பளத் தாளைச் சேர்க்க முடியவில்லை. Diagnostics-ஐப் பார்க்கவும்.",
    );
  return pick(
    language,
    `Added the "${sheet}" sheet. Check the rates on the right with your accountant before you pay; delete the sheet to undo.`,
    `"${sheet}" පත්‍රිකාව එක් කරන ලදී. ගෙවීමට පෙර දකුණු පස ඇති අනුපාත ඔබේ ගණකාධිකාරිවරයා සමඟ පරීක්ෂා කරන්න; අවලංගු කිරීමට පත්‍රිකාව මකන්න.`,
    `"${sheet}" தாள் சேர்க்கப்பட்டது. செலுத்தும் முன் வலப்புற விகிதங்களை உங்கள் கணக்காளரிடம் சரிபார்க்கவும்; செயல்தவிர்க்கத் தாளை நீக்கவும்.`,
  );
}
