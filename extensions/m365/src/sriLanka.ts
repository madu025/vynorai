/**
 * Sri Lanka business pack (pure): lakh/crore grouping for Excel and for text, the April-March
 * financial year, and the holiday table that NETWORKDAYS and WORKDAY use. Copilot in Excel has
 * none of these built in. The Office writer for the holiday sheet is in officeSriLanka.ts.
 */

export type NumberStyle = "lakh" | "million" | "plain";

/** Excel's format sections allow two conditions, so lakh grouping covers up to 99,99,99,99,999. */
export function lakhNumberFormat(symbol = "", decimals = 0): string {
  const prefix = symbol ? `"${symbol.replace(/"/g, "")} "` : "";
  const tail = decimals > 0 ? `.${"0".repeat(Math.min(decimals, 4))}` : "";
  return `[>=10000000]${prefix}##\\,##\\,##\\,##0${tail};[>=100000]${prefix}##\\,##\\,##0${tail};${prefix}#,##0${tail}`;
}

/** True when a number format already uses lakh grouping. */
export function isLakhFormat(format: unknown): boolean {
  return /##\\,##\\,##0/.test(String(format ?? ""));
}

/**
 * The currency format of a dashboard in the chosen style. Lakh grouping keeps the symbol; a mixed
 * or unknown currency is left as it is. Negative amounts fall in the last section and keep their
 * minus sign, but never get lakh grouping (Excel allows only two conditions).
 */
export function styledMoneyFormat(
  format: string,
  symbol: string | undefined,
  style: NumberStyle | undefined,
): string {
  if (style !== "lakh" || isLakhFormat(format)) return format;
  const decimals = /0\.(0+)/.exec(format)?.[1].length ?? 0;
  return lakhNumberFormat(symbol ?? "", decimals);
}

/** 12345678.9 -> "1,23,45,679" (lakh grouping, rounded to whole units). */
export function formatLakh(value: number, decimals = 0): string {
  if (!Number.isFinite(value)) return String(value);
  const negative = value < 0;
  const fixed = Math.abs(value).toFixed(decimals);
  const [whole, fraction] = fixed.split(".");
  const last3 = whole.slice(-3);
  const rest = whole.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",");
  const grouped = rest ? `${rest},${last3}` : last3;
  return `${negative ? "-" : ""}${grouped}${fraction ? `.${fraction}` : ""}`;
}

/** A short amount for a chat message: "12.35 lakhs", "1.25 Mn", or a plain grouped number. */
export function shortAmount(value: number, style: NumberStyle = "plain"): string {
  if (!Number.isFinite(value)) return String(value);
  const size = Math.abs(value);
  const round = (n: number) =>
    n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (style === "lakh") {
    if (size >= 10_000_000) return `${round(value / 10_000_000)} crore`;
    if (size >= 100_000) return `${round(value / 100_000)} lakhs`;
    return formatLakh(value, Number.isInteger(value) ? 0 : 2);
  }
  if (style === "million") {
    if (size >= 1_000_000_000) return `${round(value / 1_000_000_000)} Bn`;
    if (size >= 1_000_000) return `${round(value / 1_000_000)} Mn`;
  }
  return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

/** Financial year label of a date: April start gives "2026/27" for 2026-05-01 and "2025/26" for 2026-03-31. */
export function fiscalYearLabel(date: Date, startMonth = 4): string {
  const month = date.getUTCMonth() + 1;
  const first = month >= startMonth ? date.getUTCFullYear() : date.getUTCFullYear() - 1;
  if (startMonth === 1) return String(first);
  return `${first}/${String((first + 1) % 100).padStart(2, "0")}`;
}

/** Excel formula for the same label from a date cell (for example A2). */
export function fiscalYearFormula(dateRef: string, startMonth = 4): string {
  if (startMonth === 1) return `=YEAR(${dateRef})`;
  const shift = startMonth - 1;
  const year = `YEAR(EDATE(${dateRef},-${shift}))`;
  return `=${year}&"/"&TEXT(MOD(${year}+1,100),"00")`;
}

/** Excel formula for the financial quarter (Q1 = the first three months of the financial year). */
export function fiscalQuarterFormula(dateRef: string, startMonth = 4): string {
  const shift = (startMonth - 1) % 12;
  return `="Q"&ROUNDUP(MONTH(EDATE(${dateRef},-${shift}))/3,0)`;
}

export const HOLIDAY_SHEET = "LK Holidays";
export const HOLIDAY_TABLE = "LK_Holidays_Table";
export const HOLIDAY_NAME = "LK_Holidays";

export interface Holiday {
  date: string; // YYYY-MM-DD
  name: string;
}

/**
 * Holidays on the same date every year (Holidays Act No. 29 of 1971). Poya days and the religious
 * festivals move with the moon: they are not guessed here, the person adds them from the year's
 * gazette, and the sheet says so.
 */
export function fixedHolidays(year: number): Holiday[] {
  return [
    { date: `${year}-02-04`, name: "National Day (Independence Day)" },
    { date: `${year}-04-13`, name: "Day prior to Sinhala and Tamil New Year" },
    { date: `${year}-04-14`, name: "Sinhala and Tamil New Year" },
    { date: `${year}-05-01`, name: "May Day" },
    { date: `${year}-12-25`, name: "Christmas Day" },
  ];
}

/** Rows of the holiday sheet: a note, the header and the fixed holidays of the given years. */
export function holidaySheetRows(years: number[]): {
  note: string;
  header: [string, string, string];
  rows: Array<[string, string, string]>;
} {
  const rows = [...new Set(years)]
    .sort()
    .flatMap((year) => fixedHolidays(year))
    .map((holiday): [string, string, string] => [
      holiday.date,
      holiday.name,
      "Fixed date",
    ]);
  return {
    note: "Add each Poya day and religious festival from this year's gazette (Holidays Act No. 29 of 1971). NETWORKDAYS(start, end, LK_Holidays) skips every date in this table.",
    header: ["Date", "Holiday", "Source"],
    rows,
  };
}

/** Excel's date serial of a YYYY-MM-DD date (1900 date system). */
export function excelDateSerial(isoDate: string): number {
  const [year, month, day] = isoDate.split("-").map(Number);
  return Math.round(
    (Date.UTC(year, month - 1, day) - Date.UTC(1899, 11, 30)) / 86_400_000,
  );
}

/** NETWORKDAYS that skips the Sri Lanka holiday table. */
export function networkdaysFormula(startRef: string, endRef: string): string {
  return `=NETWORKDAYS(${startRef},${endRef},${HOLIDAY_NAME})`;
}
