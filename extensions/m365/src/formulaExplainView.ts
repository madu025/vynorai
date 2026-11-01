import {
  MAX_FORMULA_STEPS_CHARS,
  explainFormulaSteps,
  type FormulaStep,
} from "./formulaSteps.js";

/**
 * View model for the pane's "Explain this formula" action (backlog #180). Pure: it takes what the host
 * layer read from the selected cell and returns what to show. It never calls Office.js and never
 * calculates a result; the values are only listed next to the steps as inputs.
 */

/** Most steps drawn at once; the rest are summarised as "N more". */
export const EXPLAIN_MAX_VISIBLE_STEPS = 8;
/** Most directly referenced single cells whose value is read next to the formula. */
export const EXPLAIN_MAX_REFERENCE_CELLS = 20;
/** Longest value text shown for one input. */
export const EXPLAIN_MAX_VALUE_CHARS = 40;

export interface FormulaExplainRead {
  address: string;
  /** Number of cells in the selection. */
  cellCount: number;
  /** The formula of the single selected cell, or null when it holds no formula. */
  formula: string | null;
  /** Values of directly referenced single cells, keyed like the explainer's references. */
  values: Record<string, unknown>;
}

export interface FormulaExplainRow {
  /** Position in the full list, starting at 1. */
  number: number;
  expression: string;
  meaning: string;
  inputs: { reference: string; text: string | null }[];
  isWhole: boolean;
}

export type FormulaExplainView =
  | { kind: "many_cells"; address: string }
  | { kind: "no_formula"; address: string }
  | { kind: "too_long"; address: string; limit: number }
  | { kind: "error"; address: string; detail: string }
  | {
      kind: "steps";
      address: string;
      rows: FormulaExplainRow[];
      totalSteps: number;
      hiddenCount: number;
    };

const SINGLE_CELL = /^(?:.+!)?[A-Z]{1,3}\d+$/;

/** Single-cell references of a formula (no ranges), unique, at most EXPLAIN_MAX_REFERENCE_CELLS. */
export function singleCellReferences(formula: string): string[] {
  if (typeof formula !== "string" || formula.length > MAX_FORMULA_STEPS_CHARS)
    return [];
  const result = explainFormulaSteps(formula);
  if (!result.ok) return [];
  const found = new Set<string>();
  for (const step of result.steps)
    for (const reference of step.references)
      if (SINGLE_CELL.test(reference)) found.add(reference);
  return [...found].slice(0, EXPLAIN_MAX_REFERENCE_CELLS);
}

function clip(value: string): string {
  const flat = value.replace(/\s+/g, " ");
  return flat.length > EXPLAIN_MAX_VALUE_CHARS
    ? `${flat.slice(0, EXPLAIN_MAX_VALUE_CHARS)}…`
    : flat;
}

function row(step: FormulaStep, number: number, isWhole: boolean) {
  return {
    number,
    expression: step.expression,
    meaning: step.meaning,
    isWhole,
    inputs: step.inputs.map((input) => ({
      reference: input.reference,
      text:
        input.value === null || input.value === ""
          ? null
          : clip(String(input.value)),
    })),
  } satisfies FormulaExplainRow;
}

export function buildFormulaExplainView(
  read: FormulaExplainRead,
): FormulaExplainView {
  const { address } = read;
  if (read.cellCount !== 1) return { kind: "many_cells", address };
  if (typeof read.formula !== "string" || !read.formula.startsWith("="))
    return { kind: "no_formula", address };
  if (read.formula.length > MAX_FORMULA_STEPS_CHARS)
    return { kind: "too_long", address, limit: MAX_FORMULA_STEPS_CHARS };
  const result = explainFormulaSteps(read.formula, read.values);
  if (!result.ok) return { kind: "error", address, detail: result.error };
  const steps = result.steps;
  const total = steps.length;
  const lastIndex = total - 1;
  const rows: FormulaExplainRow[] = [];
  if (total <= EXPLAIN_MAX_VISIBLE_STEPS) {
    steps.forEach((step, i) => rows.push(row(step, i + 1, i === lastIndex)));
  } else {
    for (let i = 0; i < EXPLAIN_MAX_VISIBLE_STEPS - 1; i++)
      rows.push(row(steps[i], i + 1, false));
    rows.push(row(steps[lastIndex], total, true));
  }
  return {
    kind: "steps",
    address,
    rows,
    totalSteps: total,
    hiddenCount: total - rows.length,
  };
}
