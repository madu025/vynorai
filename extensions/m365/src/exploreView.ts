/**
 * The Explore tab: templates and questions made for the selected columns. Pure. It reads only
 * header names and the role hints of the local schema (never a cell value), and every item carries
 * the request sentence that a tap puts in the request box. The sentences are the ones the built-in
 * reader already understands, so nothing is offered that the pane cannot do; the tests check that
 * against the reader itself. Nothing here changes the workbook.
 */
import { isMoneyHeader } from "./businessContext.js";
import { rankCategories, rankMeasures, type ExploreStats } from "./exploreIdeas.js";
import { mapPayrollColumns } from "./payroll.js";

export interface ExploreColumn {
  name: string;
  /** The schema's role hint: "category", "measure", "date", "identifier", "text", "unknown". */
  role: string;
}

export interface ExploreItem {
  id: "summary" | "vat" | "month" | "payroll" | "highest" | "lowest" | "item" | "total" | "ai";
  /** English title; run-time text, localized by the pane. */
  title: string;
  /** One line under the title; empty for a question. */
  detail: string;
  /** The sentence put in the request box. Always English: the reader understands it. */
  request: string;
}

export interface ExploreView {
  templates: ExploreItem[];
  questions: ExploreItem[];
  /** The selection is an employee list with a basic salary column: a payroll sheet can be made. */
  payroll: boolean;
}

export const EXPLORE_MAX_QUESTIONS = 4;

export interface ExploreOptions {
  /** The VAT rate in force as a fraction (0.18). Without it no VAT template is offered. */
  vatRate?: number;
  /** The rate has not been checked by an accountant yet (lkTaxRates `reviewed`): the card says so. */
  vatUnchecked?: boolean;
  /** Counts from a sample of the selection (exploreIdeas.ts): choose the measure and the groups. */
  stats?: ExploreStats;
}

/** A name safe to put inside a request sentence: no brackets (formula column syntax) or line breaks. */
const plain = (name: string) => name !== "" && !/[[\]\r\n]/.test(name);
/** Measures VAT must not be added on: tax columns, totals that already hold tax, balances and discounts. */
const NOT_VAT_BASE = /vat|tax|gross|total|balance|discount/i;
/** A date column that is really a year, month or quarter label cannot give "month of". */
const NOT_A_DAY = /year|month|quarter|week/i;
/** Added to the VAT line while the rate is still unchecked. */
export const CHECK_RATE = " (check the rate)";
const percent = (fraction: number) => String(Math.round(fraction * 10000) / 100);

export function exploreFor(
  columns: ExploreColumn[] | undefined,
  options: ExploreOptions = {},
): ExploreView {
  const empty: ExploreView = { templates: [], questions: [], payroll: false };
  if (!columns?.length) return empty;
  const named = columns
    .map((column) => ({ name: String(column.name ?? "").trim(), role: column.role }))
    .filter((column) => plain(column.name));
  const names = (role: string) =>
    named.filter((column) => column.role === role).map((column) => column.name);
  const categories = rankCategories(names("category"), options.stats);
  const measures = rankMeasures(names("measure"), options.stats);
  const dates = names("date");
  const payroll = mapPayrollColumns(columns.map((column) => String(column.name ?? ""))) !== null;

  const group = categories[0];
  const item = categories[1];
  // The first money-looking measure wins ("Net Amount" over "Qty"); else the first number column.
  const measure = measures.find((name) => isMoneyHeader(name)) ?? measures[0];

  const templates: ExploreItem[] = [];
  if (group && measure)
    templates.push({
      id: "summary",
      title: `Summary by ${group}`,
      detail: `Total of ${measure} per ${group}, as live formulas`,
      request: `Create a summary of ${measure} by ${group}`,
    });
  const vatBase = measures.find((name) => isMoneyHeader(name) && !NOT_VAT_BASE.test(name));
  const rate = options.vatRate;
  if (
    !payroll &&
    vatBase &&
    rate !== undefined &&
    Number.isFinite(rate) &&
    rate > 0 &&
    rate < 1 &&
    !named.some((column) => /^vat\b/i.test(column.name))
  )
    templates.push({
      id: "vat",
      title: "VAT column",
      detail: `${percent(rate)}% VAT on ${vatBase}${options.vatUnchecked ? CHECK_RATE : ""}`,
      request: `Add a column VAT that is [${vatBase}] * ${Math.round(rate * 10000) / 10000}`,
    });
  const day = dates.find((name) => !NOT_A_DAY.test(name));
  if (day && !named.some((column) => /^month$/i.test(column.name)))
    templates.push({
      id: "month",
      title: "Month column",
      detail: `Month of ${day} as a new column`,
      request: `Add a column Month that is month of ${day}`,
    });
  if (payroll)
    templates.push({
      id: "payroll",
      title: "Payroll sheet",
      detail: "EPF, ETF and APIT for the employees in this list",
      request: "Add a payroll sheet",
    });

  // Questions the reader answers on the device from the selected cells (answerQuestion).
  const questions: ExploreItem[] = [];
  if (measure) {
    if (group) {
      questions.push({
        id: "highest",
        title: `Which ${group} has the highest ${measure}?`,
        detail: "",
        request: `Which ${group} has the highest ${measure}?`,
      });
      questions.push({
        id: "lowest",
        title: `Which ${group} has the lowest ${measure}?`,
        detail: "",
        request: `Which ${group} has the lowest ${measure}?`,
      });
    }
    if (item)
      questions.push({
        id: "item",
        title: `Which ${item} has the highest ${measure}?`,
        detail: "",
        request: `Which ${item} has the highest ${measure}?`,
      });
    questions.push({
      id: "total",
      title: `What is the total ${measure}?`,
      detail: "",
      request: `What is the total ${measure}?`,
    });
  }
  return { templates, questions: questions.slice(0, EXPLORE_MAX_QUESTIONS), payroll };
}
