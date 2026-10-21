/**
 * Sri Lanka payroll template: the cell plan of a "Payroll YYYY-MM" sheet with live formulas for
 * gross pay, EPF (employee and employer), ETF, APIT from a dated band table, net pay and employer
 * cost, plus a small VAT and SSCL invoice helper. Pure: officeSriLanka.ts places the blocks.
 *
 * Every formula reads a rate cell on the same sheet, so an accountant can check or change a rate
 * in one place. The rates come from lkTaxRates.ts for the payroll month.
 */
import type { Language } from "./i18n.js";
import {
  apitFor,
  needsReview,
  ratesCover,
  ratesOn,
  type LkRates,
} from "./lkTaxRates.js";

export type PayrollCell = string | number | { f: string };

export type PayrollStyle =
  | "title"
  | "note"
  | "section"
  | "header"
  | "body"
  | "total"
  | "label";

export interface PayrollBlock {
  /** 1-based sheet row and column of the block's top-left cell. */
  row: number;
  col: number;
  cells: PayrollCell[][];
  style: PayrollStyle;
  /** One number format per column of the block ("" leaves the cell as it is). */
  formats?: string[];
}

export interface PayrollEmployee {
  id: string;
  name: string;
  basic: number;
  epfAllowances: number;
  otherAllowances: number;
  otherDeductions: number;
}

export interface PayrollPlan {
  sheet: string;
  title: string;
  blocks: PayrollBlock[];
  rates: LkRates;
  /** Rows of the employee table (blank rows when no employee list was given). */
  employees: number;
  /** The same sums the sheet will show, for the confirmation message. */
  totals: {
    gross: number;
    epfEmployee: number;
    epfEmployer: number;
    etf: number;
    apit: number;
    net: number;
  };
  needsReview: boolean;
}

const MONEY = "#,##0.00";
const PERCENT = "0.0%";

type Words = {
  title: (month: string) => string;
  note: (from: string, review: boolean) => string;
  notCovered: string;
  columns: string[];
  total: string;
  rates: string;
  rateLabels: [string, string, string, string, string];
  rateHeader: [string, string, string, string];
  apit: string;
  apitHeader: [string, string, string];
  invoice: string;
  invoiceLabels: [string, string, string, string, string, string];
  portionNote: string;
  vatBaseNote: string;
};

const EN: Words = {
  title: (month) => `Payroll ${month}`,
  note: (from, review) =>
    `Live formulas. Rates in force on ${from} are in the cells on the right; change a rate there and every row follows.${review ? " These rates have not been checked by an accountant yet: check them before you pay." : ""}`,
  notCovered:
    " This month is earlier than the rates this sheet knows: type that month's rates before you use it.",
  columns: [
    "Employee ID",
    "Name",
    "Basic salary",
    "EPF-liable allowances",
    "Other allowances",
    "Gross pay",
    "EPF employee",
    "APIT",
    "Other deductions",
    "Net pay",
    "EPF employer",
    "ETF employer",
    "Employer cost",
  ],
  total: "Total",
  rates: "Rates",
  rateLabels: ["EPF employee", "EPF employer", "ETF employer", "VAT", "SSCL"],
  rateHeader: ["Rate", "Value", "From", "Source"],
  apit: "APIT table (monthly, resident employees)",
  apitHeader: ["Monthly pay over", "Rate", "Step"],
  invoice: "Invoice tax helper",
  invoiceLabels: [
    "Value before taxes",
    "SSCL liable portion",
    "SSCL",
    "VAT base",
    "VAT",
    "Invoice total",
  ],
  portionNote:
    "Services 100%, manufacturing 85%, wholesale and retail 50%, distributor of a local manufacturer 25%.",
  vatBaseNote:
    "VAT is worked out on the value plus SSCL. Check with your accountant.",
};

const SI: Words = {
  title: (month) => `වැටුප් ලේඛනය ${month}`,
  note: (from, review) =>
    `සජීවී සූත්‍ර. ${from} දිනට බලපවත්නා අනුපාත දකුණු පස කොටුවල ඇත; එහි අනුපාතයක් වෙනස් කළොත් සියලු පේළි එයට අනුව වෙනස් වේ.${review ? " මෙම අනුපාත තවම ගණකාධිකාරිවරයෙකු පරීක්ෂා කර නැත: වැටුප් ගෙවීමට පෙර පරීක්ෂා කරන්න." : ""}`,
  notCovered:
    " මෙම මාසය මෙම පත්‍රිකාව දන්නා අනුපාතවලට වඩා පැරණිය: භාවිතයට පෙර එම මාසයේ අනුපාත ටයිප් කරන්න.",
  columns: [
    "සේවක අංකය",
    "නම",
    "මූලික වැටුප",
    "EPF අදාළ දීමනා",
    "වෙනත් දීමනා",
    "දළ වැටුප",
    "EPF සේවක",
    "APIT",
    "වෙනත් අඩු කිරීම්",
    "ශුද්ධ වැටුප",
    "EPF සේවා යෝජක",
    "ETF සේවා යෝජක",
    "සේවා යෝජක පිරිවැය",
  ],
  total: "එකතුව",
  rates: "අනුපාත",
  rateLabels: ["EPF සේවක", "EPF සේවා යෝජක", "ETF සේවා යෝජක", "VAT", "SSCL"],
  rateHeader: ["අනුපාතය", "අගය", "සිට", "මූලාශ්‍රය"],
  apit: "APIT වගුව (මාසික, නේවාසික සේවකයින්)",
  apitHeader: ["මාසික වැටුප ඉක්මවන", "අනුපාතය", "අනුපාත වැඩිවීම"],
  invoice: "ඉන්වොයිස් බදු ගණනය",
  invoiceLabels: [
    "බදුවලට පෙර වටිනාකම",
    "SSCL අදාළ කොටස",
    "SSCL",
    "VAT පදනම",
    "VAT",
    "ඉන්වොයිස් එකතුව",
  ],
  portionNote:
    "සේවා 100%, නිෂ්පාදන 85%, තොග සහ සිල්ලර 50%, දේශීය නිෂ්පාදකයෙකුගේ බෙදාහරින්නා 25%.",
  vatBaseNote:
    "VAT ගණනය කරන්නේ වටිනාකමට SSCL එකතු කළ අගය මතය. ඔබේ ගණකාධිකාරිවරයා සමඟ තහවුරු කරන්න.",
};

const TA: Words = {
  title: (month) => `சம்பளப் பட்டியல் ${month}`,
  note: (from, review) =>
    `நேரடி சூத்திரங்கள். ${from} அன்று நடைமுறையில் உள்ள விகிதங்கள் வலப்புறக் கலங்களில் உள்ளன; அங்கே ஒரு விகிதத்தை மாற்றினால் எல்லா வரிசைகளும் அதைப் பின்பற்றும்.${review ? " இந்த விகிதங்கள் இன்னும் ஒரு கணக்காளரால் சரிபார்க்கப்படவில்லை: சம்பளம் செலுத்தும் முன் சரிபார்க்கவும்." : ""}`,
  notCovered:
    " இந்த மாதம் இந்தத் தாளுக்குத் தெரிந்த விகிதங்களுக்கு முந்தையது: பயன்படுத்தும் முன் அந்த மாதத்தின் விகிதங்களைத் தட்டச்சு செய்யுங்கள்.",
  columns: [
    "ஊழியர் எண்",
    "பெயர்",
    "அடிப்படைச் சம்பளம்",
    "EPF-க்கு உட்பட்ட கொடுப்பனவுகள்",
    "பிற கொடுப்பனவுகள்",
    "மொத்தச் சம்பளம்",
    "EPF ஊழியர்",
    "APIT",
    "பிற கழிவுகள்",
    "நிகரச் சம்பளம்",
    "EPF தொழில் தருநர்",
    "ETF தொழில் தருநர்",
    "தொழில் தருநர் செலவு",
  ],
  total: "மொத்தம்",
  rates: "விகிதங்கள்",
  rateLabels: [
    "EPF ஊழியர்",
    "EPF தொழில் தருநர்",
    "ETF தொழில் தருநர்",
    "VAT",
    "SSCL",
  ],
  rateHeader: ["விகிதம்", "மதிப்பு", "அமுலாகும் திகதி", "மூலம்"],
  apit: "APIT அட்டவணை (மாதாந்த, வதிவுள்ள ஊழியர்கள்)",
  apitHeader: ["மாதச் சம்பளம் இதற்கு மேல்", "விகிதம்", "அதிகரிப்பு"],
  invoice: "விலைப்பட்டியல் வரிக் கணிப்பீடு",
  invoiceLabels: [
    "வரிக்கு முந்தைய மதிப்பு",
    "SSCL-க்கு உட்பட்ட பங்கு",
    "SSCL",
    "VAT அடிப்படை",
    "VAT",
    "விலைப்பட்டியல் மொத்தம்",
  ],
  portionNote:
    "சேவைகள் 100%, உற்பத்தி 85%, மொத்த மற்றும் சில்லறை விற்பனை 50%, உள்நாட்டு உற்பத்தியாளரின் விநியோகஸ்தர் 25%.",
  vatBaseNote:
    "VAT மதிப்புடன் SSCL சேர்த்த தொகையில் கணக்கிடப்படுகிறது. உங்கள் கணக்காளரிடம் உறுதிப்படுத்தவும்.",
};

const WORDS: Record<Language, Words> = { en: EN, si: SI, ta: TA };

/** Excel column letters of a 1-based column number. */
export function columnName(index: number): string {
  let name = "";
  for (let n = index; n > 0; n = Math.floor((n - 1) / 26))
    name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
}

const round2 = (value: number) => Math.round(value * 100) / 100;

/** "2026-10" from a date. */
export function payrollMonth(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

const MONTH_WORD =
  /\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept?|oct|nov|dec)\b\.?(?:\s+(20\d\d))?/gi;

/**
 * The payroll month a request names ("October 2026", "2026-10", "for March"), else `today`'s.
 * Whole month words only, so "marketing" or "junior" is never a month; "may" counts only with a
 * year or after "for", "of" or "in".
 */
export function monthFromRequest(text: string, today: Date): Date {
  const iso = /\b(20\d\d)[-/.](0?[1-9]|1[0-2])\b/.exec(text);
  if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, 1);
  for (const match of text.matchAll(MONTH_WORD)) {
    const word = match[1].toLowerCase();
    if (
      word === "may" &&
      !match[2] &&
      !/\b(for|of|in)\s+$/i.test(text.slice(0, match.index))
    )
      continue;
    const month = MONTHS.findIndex((name) => name.startsWith(word.slice(0, 3)));
    return new Date(
      match[2] ? Number(match[2]) : today.getFullYear(),
      month,
      1,
    );
  }
  return new Date(today.getFullYear(), today.getMonth(), 1);
}

const PAYROLL_NOUN =
  /\bpay\s?roll\b|\bsalary\s+(sheet|register|slips?|template|schedule|calculation)\b|\bpay\s?sheet\b|\bpadi\s+(sheet|lekhanaya|ganan\w*)\b|වැටුප්\s*(ලේඛන|පත්‍ර|ගණන|සටහන)|சம்பள(ப்|ம்)?\s*(பட்டியல்|தாள்|கணக்கீடு|பதிவேடு)/i;
const STATUTORY = /\b(epf|etf|apit)\b/i;
const MAKE =
  /\b(make|create|build|prepare|set\s*up|add|new|template|calculate|compute|work\s*out|hadanna|hadala|ganna|ganan\w*)\b|හදන්න|සාදන්න|ගණනය|සකසන්න|உருவாக்கு|தயாரி|கணக்கிடு/i;
const ANALYSIS =
  /\b(chart|graph|pivot|dashboard|summary|summari[sz]e|trend|compare|by\s+(department|month|branch|region|location|grade))\b|ප්‍රස්තාර|සාරාංශ|வரைபட|சுருக்க/i;

/**
 * True when a request asks for a new payroll or salary sheet, in English, Sinhala, Singlish or
 * Tamil. A request to chart or summarise payroll data that is already there is not one.
 */
export function isPayrollRequest(text: string): boolean {
  if (ANALYSIS.test(text)) return false;
  if (PAYROLL_NOUN.test(text)) return true;
  return STATUTORY.test(text) && MAKE.test(text);
}

/** How the columns of a selected employee list map onto the payroll table. */
export interface PayrollColumnMap {
  id?: number;
  name?: number;
  basic: number;
  epfAllowances: number[];
  otherAllowances: number[];
  otherDeductions: number[];
}

/**
 * Finds the employee columns in a selection by header: ID, name, basic salary, allowances that
 * count for EPF (COLA, budgetary relief), other allowances (overtime, bonus, transport) and other
 * deductions (loans, advances). Null when there is no basic salary column. Overtime and bonuses
 * stay out of the EPF base, as the EPF Act's "total earnings" leaves them out.
 */
export function mapPayrollColumns(headers: string[]): PayrollColumnMap | null {
  const lower = headers.map((header) => String(header ?? "").trim());
  const find = (pattern: RegExp, used: Set<number>) =>
    lower.findIndex(
      (header, index) => !used.has(index) && pattern.test(header),
    );
  const used = new Set<number>();
  const take = (pattern: RegExp) => {
    const index = find(pattern, used);
    if (index >= 0) used.add(index);
    return index >= 0 ? index : undefined;
  };
  const takeAll = (pattern: RegExp) => {
    const found: number[] = [];
    for (
      let index = find(pattern, used);
      index >= 0;
      index = find(pattern, used)
    ) {
      used.add(index);
      found.push(index);
    }
    return found;
  };
  const id = take(
    /\b(emp(loyee)?|staff|epf)\s*(id|no\.?|number|code|#)|^id$|සේවක\s*අංක|ஊழியர்\s*(எண்|இலக்கம்)/i,
  );
  const basic =
    take(/\bbasic\b|මූලික|அடிப்படை/i) ??
    take(
      /^(monthly\s+|gross\s+)?(salary|wages?|pay)(\s*\([^)]*\))?$|^වැටුප$|^சம்பளம்$/i,
    );
  if (basic === undefined) return null;
  const name = take(
    /^(employee\s+|full\s+|staff\s+)?name$|\bemployee\s+name\b|^නම$|සේවක\s*නම|^பெயர்$|ஊழியர்\s*பெயர்/i,
  );
  const epfAllowances = takeAll(
    /\b(cola|cost\s+of\s+living|budgetary|special\s+living|epf[-\s]?(liable|allowance))\b|ජීවන\s*වියදම|வாழ்க்கைச்\s*செலவு/i,
  );
  const otherDeductions = takeAll(
    /\b(loans?|advances?|deductions?|welfare|stamp)\b|අඩු\s*කිරීම|ණය|கழிவு|கடன்/i,
  );
  const otherAllowances = takeAll(
    /^(?!.*\b(hours?|hrs|days|rate|%)\b)(?:.*\b(allowances?|overtime|ot|bonus|incentives?|transport|travel(ling)?|fuel|meal)\b|.*දීමනා|.*අතිකාල|.*கொடுப்பனவு|.*மேலதிக\s*நேர)/i,
  );
  return { id, name, basic, epfAllowances, otherAllowances, otherDeductions };
}

/** A cell as rupees: 45000, "45,000.00", "Rs. 45,000.00", "LKR 45000" and "45,000/-" are all 45000. */
export const amount = (value: unknown): number => {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const text = String(value ?? "")
    .trim()
    .replace(/\/-$/, "")
    .replace(/^(rs\.?|lkr|රු\.?|ரூ\.?)\s*/i, "")
    .replace(/[,\s]/g, "");
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : 0;
};

/** Employee rows read from a selected list with mapPayrollColumns; rows with no basic are skipped. */
export function employeesFromSelection(
  rows: unknown[][],
  map: PayrollColumnMap,
): PayrollEmployee[] {
  const sum = (row: unknown[], columns: number[]) =>
    round2(columns.reduce((total, column) => total + amount(row[column]), 0));
  return rows
    .filter((row) => String(row[map.basic] ?? "").trim() !== "")
    .map((row) => ({
      id: map.id === undefined ? "" : String(row[map.id] ?? ""),
      name: map.name === undefined ? "" : String(row[map.name] ?? ""),
      basic: amount(row[map.basic]),
      epfAllowances: sum(row, map.epfAllowances),
      otherAllowances: sum(row, map.otherAllowances),
      otherDeductions: sum(row, map.otherDeductions),
    }));
}

export interface PayrollInput {
  month: Date;
  employees?: PayrollEmployee[];
  /** Blank rows when no employees are given. */
  blankRows?: number;
  language?: Language;
}

/** Table columns (1-based) and the rate cells the formulas read. */
const TABLE_COL = 1;
const RATE_COL = 15; // O: labels, P: values, Q: from, R: source
const HEADER_ROW = 4;

export function buildPayrollPlan(input: PayrollInput): PayrollPlan {
  const words = WORDS[input.language ?? "en"];
  const month = payrollMonth(input.month);
  const rates = ratesOn(
    new Date(input.month.getFullYear(), input.month.getMonth(), 1),
  );
  const review = needsReview(rates);
  const employees = input.employees?.length
    ? input.employees
    : Array.from({ length: input.blankRows ?? 10 }, () => null);
  const first = HEADER_ROW + 1;
  const last = HEADER_ROW + employees.length;
  const totalRow = last + 1;

  const L = (offset: number) => columnName(RATE_COL + offset);
  const rateCell = (index: number) => `$${L(1)}$${HEADER_ROW + 1 + index}`;
  const [epfEmp, epfEr, etf, vat, sscl] = [0, 1, 2, 3, 4].map(rateCell);
  const bandFirst = HEADER_ROW + 9;
  const bandLast = bandFirst + rates.apitMonthly.value.length - 1;
  const overRange = `$${L(0)}$${bandFirst}:$${L(0)}$${bandLast}`;
  const stepRange = `$${L(2)}$${bandFirst}:$${L(2)}$${bandLast}`;

  const body = employees.map((employee, index): PayrollCell[] => {
    const r = first + index;
    const epfBase = `(C${r}+D${r})`;
    return [
      employee?.id ?? "",
      employee?.name ?? "",
      employee ? employee.basic : "",
      employee ? employee.epfAllowances : "",
      employee ? employee.otherAllowances : "",
      { f: `=SUM(C${r}:E${r})` },
      { f: `=ROUND(${epfBase}*${epfEmp},2)` },
      {
        f: `=ROUND(SUMPRODUCT(--(F${r}>${overRange}),F${r}-${overRange},${stepRange}),2)`,
      },
      employee ? employee.otherDeductions : "",
      { f: `=F${r}-G${r}-H${r}-I${r}` },
      { f: `=ROUND(${epfBase}*${epfEr},2)` },
      { f: `=ROUND(${epfBase}*${etf},2)` },
      { f: `=F${r}+K${r}+L${r}` },
    ];
  });
  const totals: PayrollCell[] = words.columns.map((_, index) => {
    if (index === 0) return words.total;
    if (index === 1) return "";
    const column = columnName(TABLE_COL + index);
    return { f: `=SUM(${column}${first}:${column}${last})` };
  });

  const rateRows = [
    rates.epfEmployee,
    rates.epfEmployer,
    rates.etfEmployer,
    rates.vat,
    rates.sscl,
  ].map((entry, index): PayrollCell[] => [
    words.rateLabels[index],
    entry.value,
    entry.from,
    entry.source,
  ]);
  const bandRows = rates.apitMonthly.value.map((band, index): PayrollCell[] => {
    const r = bandFirst + index;
    return [
      band.over,
      band.rate,
      index === 0
        ? { f: `=${L(1)}${r}` }
        : { f: `=${L(1)}${r}-${L(1)}${r - 1}` },
    ];
  });
  const invoiceFirst = bandLast + 3;
  const v = (offset: number) => `${L(1)}${invoiceFirst + offset}`;
  const invoiceRows: PayrollCell[][] = [
    [words.invoiceLabels[0], 100000, ""],
    [words.invoiceLabels[1], 1, words.portionNote],
    [words.invoiceLabels[2], { f: `=ROUND(${v(0)}*${v(1)}*${sscl},2)` }, ""],
    [words.invoiceLabels[3], { f: `=${v(0)}+${v(2)}` }, words.vatBaseNote],
    [words.invoiceLabels[4], { f: `=ROUND(${v(3)}*${vat},2)` }, ""],
    [words.invoiceLabels[5], { f: `=${v(0)}+${v(2)}+${v(4)}` }, ""],
  ];

  const blocks: PayrollBlock[] = [
    { row: 1, col: 1, cells: [[words.title(month)]], style: "title" },
    {
      row: 2,
      col: 1,
      cells: [
        [
          words.note(`${month}-01`, review) +
            (ratesCover(`${month}-01`) ? "" : words.notCovered),
        ],
      ],
      style: "note",
    },
    {
      row: HEADER_ROW,
      col: TABLE_COL,
      cells: [words.columns],
      style: "header",
    },
    {
      row: first,
      col: TABLE_COL,
      cells: body,
      style: "body",
      formats: ["@", "", ...Array(11).fill(MONEY)],
    },
    {
      row: totalRow,
      col: TABLE_COL,
      cells: [totals],
      style: "total",
      formats: ["", "", ...Array(11).fill(MONEY)],
    },
    {
      row: HEADER_ROW - 1,
      col: RATE_COL,
      cells: [[words.rates]],
      style: "section",
    },
    {
      row: HEADER_ROW,
      col: RATE_COL,
      cells: [words.rateHeader],
      style: "header",
    },
    {
      row: HEADER_ROW + 1,
      col: RATE_COL,
      cells: rateRows,
      style: "body",
      formats: ["", PERCENT, "", ""],
    },
    {
      row: bandFirst - 2,
      col: RATE_COL,
      cells: [[words.apit]],
      style: "section",
    },
    {
      row: bandFirst - 1,
      col: RATE_COL,
      cells: [words.apitHeader],
      style: "header",
    },
    {
      row: bandFirst,
      col: RATE_COL,
      cells: bandRows,
      style: "body",
      formats: [MONEY, PERCENT, PERCENT],
    },
    {
      row: invoiceFirst - 1,
      col: RATE_COL,
      cells: [[words.invoice]],
      style: "section",
    },
    {
      row: invoiceFirst,
      col: RATE_COL,
      cells: invoiceRows,
      style: "label",
      formats: ["", MONEY, ""],
    },
  ];
  // The portion is a share, not money.
  blocks.push({
    row: invoiceFirst + 1,
    col: RATE_COL + 1,
    cells: [[1]],
    style: "body",
    formats: ["0%"],
  });

  const sums = (input.employees ?? []).reduce(
    (acc, employee) => {
      const base = employee.basic + employee.epfAllowances;
      const gross = base + employee.otherAllowances;
      const epfEmployee = round2(base * rates.epfEmployee.value);
      const apit = apitFor(gross, rates.apitMonthly.value);
      acc.gross += gross;
      acc.epfEmployee += epfEmployee;
      acc.epfEmployer += round2(base * rates.epfEmployer.value);
      acc.etf += round2(base * rates.etfEmployer.value);
      acc.apit += apit;
      acc.net += gross - epfEmployee - apit - employee.otherDeductions;
      return acc;
    },
    { gross: 0, epfEmployee: 0, epfEmployer: 0, etf: 0, apit: 0, net: 0 },
  );
  for (const key of Object.keys(sums) as (keyof typeof sums)[])
    sums[key] = round2(sums[key]);

  return {
    sheet: `Payroll ${month}`,
    title: words.title(month),
    blocks,
    rates,
    employees: employees.length,
    totals: sums,
    needsReview: review,
  };
}
