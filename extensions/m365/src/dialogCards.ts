/**
 * Confirmation cards built from what is really in the workbook and the request: sheet names,
 * counts, the request's own words and the columns that hold personal data. Pure: confirmDialog.ts
 * draws them. Each card is short (a title, up to three figures, a few tags) in place of a sentence.
 */
import type { PaneCard } from "./confirmDialog.js";
import type { Language } from "./i18n.js";
import { pick } from "./paneText.js";

const shorten = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;

/** Headers that usually hold personal data (the agent masks them before anything is sent). */
const PERSONAL =
  /\b(e-?mail|phone|mobile|tel(ephone)?|nic|passport|address|dob|birth|name|salary|bank|account)\b|දුරකථන|ලිපිනය|නම|தொலைபேசி|முகவரி|பெயர்/i;

export function personalColumns(headers: readonly string[]): string[] {
  return headers
    .map((header) => String(header ?? "").trim())
    .filter((header) => header && PERSONAL.test(header));
}

/** Before the agent reads anything: the request, how much it will read, and what is masked. */
export function agentConsentCard(
  facts: {
    request: string;
    rows?: number;
    columns?: number;
    sheet?: string;
    headers?: readonly string[];
  },
  language: Language,
): PaneCard {
  const masked = personalColumns(facts.headers ?? []);
  const tiles: PaneCard["tiles"] = [];
  if (facts.rows !== undefined)
    tiles.push({
      // The agent reads at most 50 rows at a time.
      label: pick(
        language,
        "Rows (50 at a time)",
        "පේළි (වරකට 50)",
        "வரிசைகள் (ஒரு முறைக்கு 50)",
      ),
      value: facts.rows.toLocaleString("en-US"),
    });
  if (facts.columns !== undefined)
    tiles.push({
      label: pick(language, "Columns", "තීරු", "நெடுவரிசைகள்"),
      value: String(facts.columns),
    });
  if (facts.sheet)
    tiles.push({
      label: pick(language, "Sheet", "පත්‍රිකාව", "தாள்"),
      value: shorten(facts.sheet, 14),
    });
  const tags: PaneCard["tags"] = [
    {
      text: pick(
        language,
        "Sent: request, column names, small samples",
        "යවන්නේ: ඉල්ලීම, තීරු නම්, කුඩා නිදර්ශක",
        "அனுப்புவது: கோரிக்கை, நெடுவரிசைப் பெயர்கள், சிறு மாதிரிகள்",
      ),
    },
  ];
  tags.push(
    masked.length
      ? {
          text: pick(
            language,
            `Masked first: ${masked.slice(0, 3).join(", ")}${masked.length > 3 ? ` +${masked.length - 3}` : ""}`,
            `මුලින් සඟවයි: ${masked.slice(0, 3).join(", ")}${masked.length > 3 ? ` +${masked.length - 3}` : ""}`,
            `முதலில் மறைக்கப்படும்: ${masked.slice(0, 3).join(", ")}${masked.length > 3 ? ` +${masked.length - 3}` : ""}`,
          ),
          warn: true,
        }
      : {
          text: pick(
            language,
            "No personal columns found",
            "පෞද්ගලික තීරු නැත",
            "தனிப்பட்ட நெடுவரிசைகள் இல்லை",
          ),
        },
    {
      text: pick(
        language,
        "Nothing changes until you approve",
        "ඔබ අනුමත කරන තුරු කිසිවක් වෙනස් නොවේ",
        "நீங்கள் ஒப்புக்கொள்ளும் வரை எதுவும் மாறாது",
      ),
    },
  );
  return {
    title: shorten(facts.request, 70),
    tiles,
    tags,
  };
}

/** Before result sheets are removed: the real sheet and table names and the count. */
export function removeResultsCard(
  items: { sheets: readonly string[]; tables?: readonly string[] },
  language: Language,
  keep?: string,
): PaneCard {
  const tables = items.tables ?? [];
  const names = items.sheets.slice(0, 3).map((name) => shorten(name, 26));
  const more = items.sheets.length - names.length;
  const tags: PaneCard["tags"] = names.map((name) => ({
    text: name,
    warn: true,
  }));
  if (more > 0) tags.push({ text: `+${more}`, warn: true });
  tags.push({
    text: keep
      ? pick(
          language,
          `Kept: ${shorten(keep, 26)}`,
          `තබා ගන්නා: ${shorten(keep, 26)}`,
          `வைத்திருப்பது: ${shorten(keep, 26)}`,
        )
      : pick(
          language,
          "Your data is not touched",
          "ඔබේ දත්ත ස්පර්ශ නොකෙරේ",
          "உங்கள் தரவு தொடப்படாது",
        ),
  });
  return {
    title: pick(
      language,
      "Remove results",
      "ප්‍රතිඵල ඉවත් කරන්න",
      "முடிவுகளை நீக்கு",
    ),
    tiles: [
      {
        label: pick(language, "Sheets", "පත්‍රිකා", "தாள்கள்"),
        value: String(items.sheets.length),
      },
      ...(tables.length
        ? [
            {
              label: pick(language, "Tables", "වගු", "அட்டவணைகள்"),
              value: String(tables.length),
            },
          ]
        : []),
    ],
    tags,
  };
}

/** Before the holidays sheet is added: the years and how many dates will be written. */
export function holidaysCard(
  years: readonly number[],
  count: number,
  language: Language,
): PaneCard {
  return {
    title: pick(
      language,
      "LK Holidays sheet",
      "LK Holidays පත්‍රිකාව",
      "LK Holidays தாள்",
    ),
    tiles: [
      {
        label: pick(language, "Dates", "දින", "தேதிகள்"),
        value: String(count),
      },
      {
        label: pick(language, "Years", "වසර", "ஆண்டுகள்"),
        value: years.join(", "),
      },
    ],
    tags: [
      {
        text: pick(
          language,
          "Fixed-date holidays",
          "ස්ථාවර දින නිවාඩු",
          "நிலையான தேதி விடுமுறைகள்",
        ),
      },
      {
        text: pick(
          language,
          "Add Poya days from the gazette",
          "ගැසට් පත්‍රයෙන් පෝය දින එක් කරන්න",
          "அரசிதழிலிருந்து பௌர்ணமி நாட்களைச் சேர்க்கவும்",
        ),
        warn: true,
      },
    ],
  };
}

/** Before a report is e-mailed: who gets it and that it leaves the workbook. */
export function emailSendCard(
  to: string,
  subject: string,
  language: Language,
): PaneCard {
  return {
    title: shorten(subject, 60),
    tiles: [
      {
        label: pick(language, "To", "ලබන්නා", "பெறுநர்"),
        value: shorten(to, 30),
      },
    ],
    tags: [
      {
        text: pick(
          language,
          "Workbook data leaves Excel",
          "වැඩපොතේ දත්ත Excel වලින් පිටතට යයි",
          "பணிப்புத்தகத் தரவு Excel-ஐ விட்டு வெளியேறும்",
        ),
        warn: true,
      },
      {
        text: pick(
          language,
          "You reviewed the report",
          "ඔබ වාර්තාව සමාලෝචනය කළා",
          "நீங்கள் அறிக்கையை மதிப்பாய்வு செய்தீர்கள்",
        ),
      },
    ],
  };
}
