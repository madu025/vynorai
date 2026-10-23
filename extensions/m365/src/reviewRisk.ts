/**
 * Decides whether the staged changes need the two reviewer models. A small, plain change (a few
 * cells, one simple formula, a format, a chart) is checked by the rules that always run
 * (`lintChanges`, `evaluateJoins`) and skips the reviewers, which cost about as much as the
 * builder again. Anything that reaches other sheets, edits data in place, uses a lookup or an
 * array formula, or is large goes to the reviewers. When in doubt it is high risk. Pure.
 */
import type { StagedChange } from "./agent.js";
import { isSimpleAggregate } from "./simpleChecks.js";

/** At most this many staged changes can be low risk. */
export const LOW_RISK_MAX_CHANGES = 3;
/** At most this many cells a low-risk write can carry. */
export const LOW_RISK_MAX_CELLS = 200;
/** A fill or write over more rows than this is not a quick change. */
export const LOW_RISK_MAX_ROWS = 5000;

/** Formulas whose result is easy to get wrong (lookups, arrays, grouping, volatile references). */
const RISKY_FORMULA =
  /\b(XLOOKUP|VLOOKUP|HLOOKUP|LOOKUP|INDEX|MATCH|XMATCH|GROUPBY|PIVOTBY|LET|LAMBDA|MAP|BYROW|BYCOL|REDUCE|SCAN|FILTER|SORT|SORTBY|UNIQUE|HSTACK|VSTACK|TAKE|DROP|CHOOSECOLS|TEXTSPLIT|INDIRECT|OFFSET|SUMPRODUCT|FORECAST|LINEST|TREND|GROWTH|IRR|NPV|XIRR|XNPV|PMT)\b/i;

/** A label that says the number beside it is calculated. */
const COMPUTED_LABEL = /^\s*(grand\s+)?(sub)?(total|sum|average|avg|count|balance)\b/i;

const cellCount = (values: unknown[][]) =>
  values.reduce((sum, row) => sum + row.length, 0);

const rowsOf = (address: string): number => {
  const match = /(\d+)(?::[A-Za-z]+(\d+))?$/.exec(address);
  if (!match) return Number.POSITIVE_INFINITY;
  return match[2] ? Math.abs(Number(match[2]) - Number(match[1])) + 1 : 1;
};

export interface Risk {
  high: boolean;
  /** Why the reviewers run, or "" for a low-risk change. */
  reason: string;
}

export function reviewRisk(
  changes: readonly { change: StagedChange }[],
): Risk {
  if (!changes.length) return { high: false, reason: "" };
  if (changes.length > LOW_RISK_MAX_CHANGES)
    return { high: true, reason: "many changes" };
  for (const { change } of changes) {
    switch (change.kind) {
      case "create_sheet":
      case "create_chart":
      case "format_range":
        break;
      case "write_values":
        if (cellCount(change.values) > LOW_RISK_MAX_CELLS)
          return { high: true, reason: "a large write" };
        // "Total", 1120: a computed figure typed in as a number, not a formula.
        if (
          change.values.some(
            (row) =>
              row.some((cell) => typeof cell === "string" && COMPUTED_LABEL.test(cell)) &&
              row.some(
                (cell) =>
                  typeof cell === "number" ||
                  (typeof cell === "string" && /^\s*-?[\d,]+(\.\d+)?\s*%?\s*$/.test(cell)),
              ),
          )
        )
          return { high: true, reason: "a typed-in total" };
        break;
      case "write_formula": {
        if (change.formula.includes("!"))
          return { high: true, reason: "a formula that reaches another sheet" };
        if (RISKY_FORMULA.test(change.formula))
          return { high: true, reason: "a lookup or array formula" };
        // Only the plain total/average/count over one column is verified by rules.
        if (!isSimpleAggregate(change))
          return { high: true, reason: "a formula the rules cannot verify" };
        if (change.fillRange && rowsOf(change.fillRange) > LOW_RISK_MAX_ROWS)
          return { high: true, reason: "a formula over many rows" };
        break;
      }
      default:
        // sort_range, vynor_step and every excel_action edit data or objects in place.
        return { high: true, reason: "an in-place or workbook-object change" };
    }
  }
  return { high: false, reason: "" };
}
