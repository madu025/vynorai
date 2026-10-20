/**
 * Workbook preferences (pure): what a business always wants, remembered in the workbook itself
 * (Office document settings travel with the file), so the same thing is never asked twice.
 * Only choices are stored, never cell values. The pane reads and writes them in taskpane.ts.
 */
import {
  currencyFromRequest,
  currencyGuessFor,
  inferAudience,
  type Audience,
  type CurrencyGuess,
} from "./businessContext.js";
import { styledMoneyFormat, type NumberStyle } from "./sriLanka.js";

export interface WorkbookPreferences {
  /** ISO code, for example "LKR". Used when a money column says no currency itself. */
  currency?: string;
  numberStyle?: NumberStyle;
  /** First month of the financial year, 1-12 (Sri Lanka: 4). */
  fiscalYearStart?: number;
  audience?: Audience;
  /** Write a line to the "VynorAI Log" sheet for every applied change (default on). */
  changeLog?: boolean;
  /** The LK_Holidays table was added to this workbook. */
  holidays?: boolean;
}

export const PREFERENCES_KEY = "vynorai.preferences";

const STYLES: NumberStyle[] = ["lakh", "million", "plain"];
const AUDIENCES: Audience[] = ["management", "operational", "general"];

/** Keeps only known, valid fields; anything else (a corrupt or older setting) is dropped. */
export function parsePreferences(raw: unknown): WorkbookPreferences {
  let value = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return {};
    }
  }
  if (!value || typeof value !== "object") return {};
  const input = value as Record<string, unknown>;
  const out: WorkbookPreferences = {};
  if (typeof input.currency === "string" && /^[A-Z]{3}$/.test(input.currency))
    out.currency = input.currency;
  if (STYLES.includes(input.numberStyle as NumberStyle))
    out.numberStyle = input.numberStyle as NumberStyle;
  const start = Number(input.fiscalYearStart);
  if (Number.isInteger(start) && start >= 1 && start <= 12)
    out.fiscalYearStart = start;
  if (AUDIENCES.includes(input.audience as Audience))
    out.audience = input.audience as Audience;
  if (typeof input.changeLog === "boolean") out.changeLog = input.changeLog;
  if (typeof input.holidays === "boolean") out.holidays = input.holidays;
  return out;
}

/**
 * What a request teaches: a currency it names, "in lakhs" or "in millions", a financial year
 * that starts in April. Returns only the fields that change, so nothing is learnt by accident.
 * The audience is never learnt (one management report does not make every later one).
 */
export function learnFromRequest(
  prefs: WorkbookPreferences,
  request: string,
): Partial<WorkbookPreferences> {
  const text = String(request ?? "");
  const learnt: Partial<WorkbookPreferences> = {};
  const currency = currencyFromRequest(text)?.code;
  if (currency && currency !== prefs.currency) learnt.currency = currency;
  const style = /\b(in\s+)?(lakhs?|lacs?|crores?)\b|ලක්ෂ/i.test(text)
    ? "lakh"
    : /\bin\s+(millions?|mn)\b/i.test(text)
      ? "million"
      : undefined;
  if (style && style !== prefs.numberStyle) learnt.numberStyle = style;
  if (
    /\b(financial|fiscal)\s+year\b.*\bapril\b|\bapril\b.*\bto\b.*\bmarch\b|මුදල්\s*වර්ෂ/i.test(
      text,
    ) &&
    prefs.fiscalYearStart !== 4
  )
    learnt.fiscalYearStart = 4;
  return learnt;
}

/**
 * The data's own currency always wins. A saved currency fills in only when a money column names
 * none; mixed currencies are never formatted. Lakh grouping is applied to the chosen format.
 */
export function withPreferredCurrency(
  guess: CurrencyGuess | undefined,
  prefs: WorkbookPreferences,
  hasMoneyColumn: boolean,
): CurrencyGuess | undefined {
  const chosen =
    guess ??
    (prefs.currency && hasMoneyColumn
      ? currencyGuessFor(prefs.currency, "preference")
      : undefined);
  if (!chosen || chosen.mixed) return chosen;
  return {
    ...chosen,
    numberFormat: styledMoneyFormat(
      chosen.numberFormat,
      chosen.symbol,
      prefs.numberStyle,
    ),
  };
}

/** The audience to use: the request's own words win, then the saved choice. */
export function audienceWithPreference(
  request: string,
  prefs: WorkbookPreferences,
): Audience {
  const fromRequest = inferAudience(request);
  return fromRequest !== "general"
    ? fromRequest
    : (prefs.audience ?? "general");
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/**
 * Per-request facts for the agent (they go after the request, never into the fixed prompt
 * prefix). Empty when nothing is saved, so the message is unchanged for most workbooks.
 */
export function preferenceFacts(prefs: WorkbookPreferences): string {
  const facts: string[] = [];
  if (prefs.currency)
    facts.push(
      `money columns with no currency of their own are in ${prefs.currency}`,
    );
  if (prefs.numberStyle === "lakh")
    facts.push(
      "show amounts with lakh grouping: number format [>=10000000]##\\,##\\,##\\,##0;[>=100000]##\\,##\\,##0;#,##0",
    );
  else if (prefs.numberStyle === "million")
    facts.push("show large amounts in millions (Mn)");
  if (prefs.fiscalYearStart && prefs.fiscalYearStart !== 1) {
    const shift = prefs.fiscalYearStart - 1;
    facts.push(
      `the financial year starts in ${MONTHS[shift]}: financial year of a date d is YEAR(EDATE(d,-${shift})), its quarter is ROUNDUP(MONTH(EDATE(d,-${shift}))/3,0)`,
    );
  }
  if (prefs.holidays)
    facts.push(
      "the workbook has a holiday table named LK_Holidays: pass it as the holidays argument of NETWORKDAYS and WORKDAY",
    );
  return facts.length
    ? `[Saved preferences of this workbook] ${facts.join("; ")}.`
    : "";
}

/** A short line for the pane: what is remembered for this workbook. */
export function describePreferences(prefs: WorkbookPreferences): string {
  const parts: string[] = [];
  if (prefs.currency) parts.push(prefs.currency);
  if (prefs.numberStyle === "lakh") parts.push("lakh grouping");
  if (prefs.numberStyle === "million") parts.push("millions");
  if (prefs.fiscalYearStart && prefs.fiscalYearStart !== 1)
    parts.push(`financial year from ${MONTHS[prefs.fiscalYearStart - 1]}`);
  if (prefs.audience && prefs.audience !== "general")
    parts.push(`${prefs.audience} view`);
  if (prefs.holidays) parts.push("Sri Lanka holidays");
  if (prefs.changeLog === false) parts.push("change log off");
  return parts.length
    ? `Remembered for this workbook: ${parts.join(", ")}.`
    : "Nothing remembered for this workbook yet.";
}
