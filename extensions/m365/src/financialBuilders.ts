/**
 * Live-formula financial models behind the agent's `financial_model` tool: a loan amortization
 * schedule (PMT, IPMT, PPMT, FV), NPV and IRR of a cash-flow range (XNPV and XIRR with dates),
 * budget against actual by category (SUMIFS) and receivables ageing in 0-30, 31-60, 61-90 and
 * over-90-day buckets (GROUPBY). Pure: `officeAgentActions.ts` writes the cells after approval.
 * Inputs are written as labelled cells, so a person can change a rate and see the model update.
 */
import {
  AgentToolError,
  checkCell,
  checkRange,
  checkSheetName,
  columnLetters,
  parseA1,
} from "./agent.js";

export const FINANCIAL_KINDS = [
  "loan_schedule",
  "npv_irr",
  "budget_variance",
  "ageing",
] as const;
export type FinancialKind = (typeof FINANCIAL_KINDS)[number];

/** One cell to write, at an offset from the target cell: a formula ("=...") or a plain value. */
export interface ModelCell {
  row: number;
  column: number;
  value: string | number;
}

/** Normalises a sheet-qualified range ("'Sales Data'!B2:B500" or "Data!B2:B500"). */
export function qualifiedRange(value: unknown, what: string): string {
  const text = String(value ?? "").trim();
  const match = /^(?:'((?:[^']|'')+)'|([^'!]+))!(\$?[A-Z]{1,3}\$?\d{1,7}(?::\$?[A-Z]{1,3}\$?\d{1,7})?)$/i.exec(
    text,
  );
  if (!match)
    throw new AgentToolError(
      `${what} must be a sheet-qualified range like 'Sales'!B2:B500.`,
    );
  const sheet = checkSheetName((match[1] ?? match[2]).replace(/''/g, "'"));
  return `'${sheet.replace(/'/g, "''")}'!${checkRange(match[3].replace(/\$/g, ""))}`;
}

const rows = (range: string) => {
  const box = parseA1(range.split("!").pop()!);
  return box.lastRow - box.row + 1;
};
const positive = (value: unknown, what: string, max: number) => {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0 || number > max)
    throw new AgentToolError(`${what} must be a number above 0 and at most ${max}.`);
  return number;
};

export interface FinancialSpec {
  kind: FinancialKind;
  /** Top-left cell of the model, for absolute references to its own input cells. */
  cell: string;
  principal?: number;
  annual_rate?: number;
  years?: number;
  payments_per_year?: number;
  cash_flows?: string;
  dates?: string;
  rate?: number;
  categories?: string;
  actual?: string;
  budget?: string;
  due_dates?: string;
  amounts?: string;
  customers?: string;
  as_of?: string;
}

/** The cells of one model, placed relative to `spec.cell`. */
export function financialCells(spec: FinancialSpec): ModelCell[] {
  const anchor = parseA1(checkCell(spec.cell));
  // Absolute address of a cell inside the model, for formulas that read its own inputs.
  const at = (row: number, column: number) =>
    `$${columnLetters(anchor.column + column)}$${anchor.row + row}`;
  switch (spec.kind) {
    case "loan_schedule": {
      const principal = positive(spec.principal, "principal", 1e13);
      const rate = Number(spec.annual_rate);
      if (!Number.isFinite(rate) || rate < 0 || rate > 1)
        throw new AgentToolError(
          "annual_rate is a fraction from 0 to 1, e.g. 0.12 for 12%.",
        );
      const years = positive(spec.years, "years", 50);
      const perYear = positive(spec.payments_per_year ?? 12, "payments_per_year", 365);
      const [P, R, Y, N, PAY] = [at(0, 1), at(1, 1), at(2, 1), at(3, 1), at(4, 1)];
      return [
        { row: 0, column: 0, value: "Principal" },
        { row: 0, column: 1, value: principal },
        { row: 1, column: 0, value: "Annual rate" },
        { row: 1, column: 1, value: rate },
        { row: 2, column: 0, value: "Years" },
        { row: 2, column: 1, value: years },
        { row: 3, column: 0, value: "Payments per year" },
        { row: 3, column: 1, value: perYear },
        { row: 4, column: 0, value: "Payment" },
        { row: 4, column: 1, value: `=PMT(${R}/${N},${Y}*${N},-${P})` },
        { row: 5, column: 0, value: "Total interest" },
        { row: 5, column: 1, value: `=${PAY}*${Y}*${N}-${P}` },
        ...["Period", "Payment", "Interest", "Principal", "Balance"].map(
          (text, column) => ({ row: 7, column, value: text }),
        ),
        {
          row: 8,
          column: 0,
          value: `=LET(r,${R}/${N},n,${Y}*${N},p,SEQUENCE(n),HSTACK(p,p*0+${PAY},IPMT(r,p,n,-${P}),PPMT(r,p,n,-${P}),FV(r,p,${PAY},-${P})))`,
        },
      ];
    }
    case "npv_irr": {
      const flows = qualifiedRange(spec.cash_flows, "cash_flows");
      const rate = Number(spec.rate);
      if (!Number.isFinite(rate) || rate <= -1 || rate > 10)
        throw new AgentToolError("rate is the discount rate as a fraction, e.g. 0.1.");
      const cells: ModelCell[] = [
        { row: 0, column: 0, value: "Discount rate" },
        { row: 0, column: 1, value: rate },
      ];
      if (spec.dates) {
        const dates = qualifiedRange(spec.dates, "dates");
        if (rows(dates) !== rows(flows))
          throw new AgentToolError("dates and cash_flows must have the same number of rows.");
        cells.push(
          { row: 1, column: 0, value: "XNPV" },
          { row: 1, column: 1, value: `=XNPV(${at(0, 1)},${flows},${dates})` },
          { row: 2, column: 0, value: "XIRR" },
          { row: 2, column: 1, value: `=XIRR(${flows},${dates})` },
        );
      } else {
        const box = parseA1(flows.split("!").pop()!);
        const sheet = flows.slice(0, flows.lastIndexOf("!"));
        const first = `${sheet}!${columnLetters(box.column)}${box.row}`;
        if (box.lastRow === box.row && box.lastColumn === box.column)
          throw new AgentToolError("cash_flows needs the first (investment) flow and at least one more.");
        const rest =
          box.lastColumn > box.column
            ? `${sheet}!${columnLetters(box.column + 1)}${box.row}:${columnLetters(box.lastColumn)}${box.lastRow}`
            : `${sheet}!${columnLetters(box.column)}${box.row + 1}:${columnLetters(box.lastColumn)}${box.lastRow}`;
        cells.push(
          { row: 1, column: 0, value: "NPV (first flow at time 0)" },
          { row: 1, column: 1, value: `=${first}+NPV(${at(0, 1)},${rest})` },
          { row: 2, column: 0, value: "IRR" },
          { row: 2, column: 1, value: `=IRR(${flows})` },
        );
      }
      cells.push(
        { row: 3, column: 0, value: "Payback (periods)" },
        {
          row: 3,
          column: 1,
          value: `=LET(c,SCAN(0,${flows},LAMBDA(a,b,a+b)),IFERROR(XMATCH(TRUE,c>=0)-1,"Not paid back"))`,
        },
      );
      return cells;
    }
    case "budget_variance": {
      const categories = qualifiedRange(spec.categories, "categories");
      const actual = qualifiedRange(spec.actual, "actual");
      const budget = qualifiedRange(spec.budget, "budget");
      if (new Set([rows(categories), rows(actual), rows(budget)]).size !== 1)
        throw new AgentToolError("categories, actual and budget must have the same number of rows.");
      return [
        ...["Category", "Actual", "Budget", "Variance", "Variance %"].map(
          (text, column) => ({ row: 0, column, value: text }),
        ),
        {
          row: 1,
          column: 0,
          value: `=LET(c,UNIQUE(FILTER(${categories},${categories}<>"")),a,SUMIFS(${actual},${categories},c),b,SUMIFS(${budget},${categories},c),v,a-b,SORTBY(HSTACK(c,a,b,v,IFERROR(v/ABS(b),"")),ABS(v),-1))`,
        },
        { row: 0, column: 6, value: "Total actual" },
        { row: 0, column: 7, value: `=SUM(${actual})` },
        { row: 1, column: 6, value: "Total budget" },
        { row: 1, column: 7, value: `=SUM(${budget})` },
        { row: 2, column: 6, value: "Total variance" },
        { row: 2, column: 7, value: `=${at(0, 7)}-${at(1, 7)}` },
      ];
    }
    case "ageing": {
      const due = qualifiedRange(spec.due_dates, "due_dates");
      const amounts = qualifiedRange(spec.amounts, "amounts");
      if (rows(due) !== rows(amounts))
        throw new AgentToolError("due_dates and amounts must have the same number of rows.");
      let asOf = "TODAY()";
      if (spec.as_of) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(spec.as_of))
          throw new AgentToolError("as_of is a date like 2026-03-31.");
        const [y, m, d] = spec.as_of.split("-").map(Number);
        asOf = `DATE(${y},${m},${d})`;
      }
      const buckets = `a*(g<=30),a*(g>30)*(g<=60),a*(g>60)*(g<=90),a*(g>90)`;
      const headers = ["0-30 days", "31-60 days", "61-90 days", "Over 90 days"];
      const cells: ModelCell[] = [
        { row: 0, column: 0, value: "As of" },
        { row: 0, column: 1, value: `=${asOf}` },
      ];
      if (spec.customers) {
        const customers = qualifiedRange(spec.customers, "customers");
        if (rows(customers) !== rows(due))
          throw new AgentToolError("customers must have the same number of rows as due_dates.");
        cells.push(
          ...["Customer", ...headers].map((text, column) => ({
            row: 2,
            column,
            value: text,
          })),
          {
            row: 3,
            column: 0,
            value: `=LET(g,${at(0, 1)}-${due},a,${amounts},GROUPBY(${customers},HSTACK(${buckets}),SUM,0,1))`,
          },
        );
      } else
        cells.push(
          ...headers.map((text, column) => ({ row: 2, column, value: text })),
          {
            row: 3,
            column: 0,
            value: `=LET(g,${at(0, 1)}-${due},a,${amounts},HSTACK(SUM(${buckets.split(",").join("),SUM(")})))`,
          },
        );
      return cells;
    }
  }
}
