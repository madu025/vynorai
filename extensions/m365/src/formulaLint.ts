/**
 * Offline checks on formulas the agent staged, run before the reviewers. A reviewer model can miss
 * a mistake that is plain from the text, so the known ones are caught here and sent to the builder as
 * a problem to fix. Pure: it reads only the formula text.
 */
import type { StagedChange } from "./agent.js";

/** Splits the arguments of the call that starts at `open` (the index of its "("), or undefined if it never closes. */
function callArguments(text: string, open: number): string[] | undefined {
  const args: string[] = [];
  let depth = 0;
  let quoted = false;
  let current = "";
  for (let index = open + 1; index < text.length; index++) {
    const char = text[index];
    if (char === '"') quoted = !quoted;
    if (!quoted) {
      if (char === "(" || char === "{") depth++;
      else if (char === ")" || char === "}") {
        if (depth === 0) {
          args.push(current);
          return args;
        }
        depth--;
      } else if (char === "," && depth === 0) {
        args.push(current);
        current = "";
        continue;
      }
    }
    current += char;
  }
  return undefined;
}

/** First row of every A1 range in the text, for example 2 in 'Orders'!J2:J301. */
function rangeStartRows(text: string): number[] {
  return [
    ...text.matchAll(/\$?[A-Z]{1,3}\$?(\d+)\s*:\s*\$?[A-Z]{1,3}\$?\d+/g),
  ].map((match) => Number(match[1]));
}

/**
 * GROUPBY and PIVOTBY take "field_headers" (1 or 3 = the first row of the ranges is a header). A
 * range that starts at row 2 or lower skips the header row already, so 1 or 3 would silently drop its
 * first data row and every total comes out short.
 */
export function lintFormula(formula: string): string[] {
  const issues: string[] = [];
  const pattern = /\b(GROUPBY|PIVOTBY)\s*\(/gi;
  for (
    let match = pattern.exec(formula);
    match;
    match = pattern.exec(formula)
  ) {
    const name = match[1].toUpperCase();
    const args = callArguments(formula, match.index + match[0].length - 1);
    if (!args) continue;
    const headersIndex = name === "GROUPBY" ? 3 : 4;
    const headers = args[headersIndex]?.trim();
    if (headers !== "1" && headers !== "3") continue;
    const dataArgs = args
      .slice(0, headersIndex)
      .filter((arg) => !/^\s*\w+\s*$/.test(arg));
    const starts = rangeStartRows(dataArgs.join(","));
    if (starts.length && Math.min(...starts) >= 2)
      issues.push(
        `${name} says its ranges start with a header row (field_headers ${headers}), but they start at row ${Math.min(...starts)}, below the header, so the first data row is dropped and the totals come out short. Use 0, or include the header row in every range.`,
      );
  }
  return issues;
}

/** Problems found in the staged formulas, each with the cell it is in. */
export function lintChanges(
  changes: readonly { change: StagedChange }[],
): string[] {
  const issues: string[] = [];
  for (const { change } of changes) {
    if (change.kind !== "write_formula") continue;
    for (const issue of lintFormula(change.formula))
      issues.push(`'${change.sheet}'!${change.cell}: ${issue}`);
  }
  return issues.slice(0, 5);
}
