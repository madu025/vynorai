/**
 * Sri Lanka payroll and tax rates, each with the date it took effect and its source. The payroll
 * sheet writes these into rate cells, so every formula reads a cell the person can see and an
 * accountant can change. Rates change with budgets: add a new entry with its date, never edit an
 * old one, so a past month still computes with the rates of that month.
 *
 * `reviewed` stays false until an accountant has checked the entry; the sheet says so.
 */

/** One band of the monthly APIT table: income above `over` is taxed at `rate`, up to the next band. */
export interface ApitBand {
  over: number;
  rate: number;
}

export interface DatedRate<T> {
  /** First day the value applies, YYYY-MM-DD. */
  from: string;
  value: T;
  source: string;
  reviewed: boolean;
}

export interface LkRates {
  epfEmployee: DatedRate<number>;
  epfEmployer: DatedRate<number>;
  etfEmployer: DatedRate<number>;
  /** Monthly APIT table for resident employees on regular monthly pay (Tax Table 1). */
  apitMonthly: DatedRate<ApitBand[]>;
  vat: DatedRate<number>;
  sscl: DatedRate<number>;
}

const IRD = "https://www.ird.gov.lk";

export const EPF_EMPLOYEE: DatedRate<number>[] = [
  {
    from: "1958-06-01",
    value: 0.08,
    source: "Employees' Provident Fund Act No. 15 of 1958",
    reviewed: false,
  },
];

export const EPF_EMPLOYER: DatedRate<number>[] = [
  {
    from: "1958-06-01",
    value: 0.12,
    source: "Employees' Provident Fund Act No. 15 of 1958",
    reviewed: false,
  },
];

export const ETF_EMPLOYER: DatedRate<number>[] = [
  {
    from: "1980-03-01",
    value: 0.03,
    source: "Employees' Trust Fund Act No. 46 of 1980",
    reviewed: false,
  },
];

/** Bands from monthly relief and band widths (all monthly, rupees). */
function bands(relief: number, width: number, rates: number[]): ApitBand[] {
  return [
    { over: 0, rate: 0 },
    ...rates.map((rate, index) => ({
      over: Math.round((relief + width * index) * 100) / 100,
      rate,
    })),
  ];
}

export const APIT_MONTHLY: DatedRate<ApitBand[]>[] = [
  {
    from: "2023-01-01",
    // Relief Rs 1,200,000 a year; Rs 500,000 bands at 6% to 30%, then 36%.
    value: bands(100_000, 500_000 / 12, [0.06, 0.12, 0.18, 0.24, 0.3, 0.36]),
    source:
      "Inland Revenue (Amendment) Act No. 45 of 2022, APIT Tax Table 1 (https://documents.gov.lk/view/acts/2022/12/45-2022_E.pdf)",
    reviewed: false,
  },
  {
    from: "2025-04-01",
    // Relief Rs 1,800,000 a year; first Rs 1,000,000 at 6%, then Rs 500,000 bands at 18%, 24%,
    // 30%, then 36%.
    value: [
      { over: 0, rate: 0 },
      { over: 150_000, rate: 0.06 },
      { over: 233_333.33, rate: 0.18 },
      { over: 275_000, rate: 0.24 },
      { over: 316_666.67, rate: 0.3 },
      { over: 358_333.33, rate: 0.36 },
    ],
    source:
      "Inland Revenue (Amendment) Act 2025, APIT Tax Table 1 (KPMG Sri Lanka tax flash, March 2025)",
    reviewed: false,
  },
];

export const VAT_RATE: DatedRate<number>[] = [
  {
    from: "2022-06-01",
    value: 0.12,
    source: `${IRD} (VAT at 12% from 1 June 2022)`,
    reviewed: false,
  },
  {
    from: "2022-09-01",
    value: 0.15,
    source: `${IRD} (VAT at 15% from 1 September 2022)`,
    reviewed: false,
  },
  {
    from: "2024-01-01",
    value: 0.18,
    source: `${IRD} (VAT at 18% from 1 January 2024)`,
    reviewed: false,
  },
];

/** Share of turnover SSCL is charged on, by business type (SSCL Act No. 25 of 2022). */
export const SSCL_LIABLE_PORTION = {
  services: 1,
  manufacturing: 0.85,
  wholesaleRetail: 0.5,
  distributor: 0.25,
} as const;

export const SSCL_RATE: DatedRate<number>[] = [
  {
    from: "2022-10-01",
    value: 0.025,
    source:
      "Social Security Contribution Levy Act No. 25 of 2022 (https://documents.gov.lk/view/acts/2022/9/25-2022_E.pdf)",
    reviewed: false,
  },
];

const isoDate = (date: Date | string) =>
  typeof date === "string"
    ? date.slice(0, 10)
    : `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

/** The entry in force on a date: the latest one that started on or before it. */
export function rateOn<T>(
  list: DatedRate<T>[],
  date: Date | string,
): DatedRate<T> {
  const day = isoDate(date);
  const sorted = [...list].sort((a, b) => a.from.localeCompare(b.from));
  const found = sorted.filter((entry) => entry.from <= day).pop();
  return found ?? sorted[0];
}

/** True when every rate list has an entry that started on or before the date. */
export function ratesCover(date: Date | string): boolean {
  const day = isoDate(date);
  return [
    EPF_EMPLOYEE,
    EPF_EMPLOYER,
    ETF_EMPLOYER,
    APIT_MONTHLY,
    VAT_RATE,
    SSCL_RATE,
  ].every((list) => list.some((entry) => entry.from <= day));
}

/**
 * Every rate in force on a date (for a payroll month, its first day). Before the earliest entry
 * of a list, its earliest entry is given: check ratesCover first.
 */
export function ratesOn(date: Date | string): LkRates {
  return {
    epfEmployee: rateOn(EPF_EMPLOYEE, date),
    epfEmployer: rateOn(EPF_EMPLOYER, date),
    etfEmployer: rateOn(ETF_EMPLOYER, date),
    apitMonthly: rateOn(APIT_MONTHLY, date),
    vat: rateOn(VAT_RATE, date),
    sscl: rateOn(SSCL_RATE, date),
  };
}

/** Monthly APIT on a monthly taxable pay with a band table: the same sum the sheet formula makes. */
export function apitFor(pay: number, table: ApitBand[]): number {
  let tax = 0;
  table.forEach((band, index) => {
    const next = table[index + 1]?.over ?? Infinity;
    if (pay > band.over) tax += (Math.min(pay, next) - band.over) * band.rate;
  });
  return Math.round(tax * 100) / 100;
}

/** True when any rate in the set still waits for an accountant's check. */
export function needsReview(rates: LkRates): boolean {
  return Object.values(rates).some((entry) => !entry.reviewed);
}
