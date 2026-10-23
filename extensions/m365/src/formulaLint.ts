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
  return scan(formula).issues;
}

/**
 * The same mistake, repaired: field_headers 1 becomes 0 and 3 becomes 2 (no header row in the
 * ranges; 2 still shows generated headers). A model that was told once and repeated it does not
 * keep the person's first data row out of the totals.
 */
export function repairFormula(formula: string): string {
  return scan(formula).repaired;
}

function scan(formula: string): { issues: string[]; repaired: string } {
  const issues: string[] = [];
  let repaired = formula;
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
    if (starts.length && Math.min(...starts) >= 2) {
      const open = match.index + match[0].length - 1;
      const fixed = args.map((arg, index) =>
        index === headersIndex
          ? arg.replace(/[13]/, headers === "1" ? "0" : "2")
          : arg,
      );
      repaired =
        repaired.slice(0, open + 1) +
        fixed.join(",") +
        repaired.slice(open + 1 + args.join(",").length);
      issues.push(
        `${name} says its ranges start with a header row (field_headers ${headers}), but they start at row ${Math.min(...starts)}, below the header, so the first data row is dropped and the totals come out short. Use 0, or include the header row in every range.`,
      );
    }
  }
  return { issues, repaired };
}

/** Repairs the staged formulas in place; returns how many changed. */
export function repairChanges(
  changes: readonly { change: StagedChange }[],
): number {
  let count = 0;
  for (const { change } of changes) {
    if (change.kind !== "write_formula") continue;
    const fixed = repairFormula(change.formula);
    if (fixed !== change.formula) {
      change.formula = fixed;
      count += 1;
    }
  }
  return count;
}

function columnNumber(letters: string): number {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + ch.charCodeAt(0) - 64;
  return n;
}

function splitCell(cell: string): { col: number; row: number } | undefined {
  const m = /^\$?([A-Z]{1,3})\$?(\d+)$/i.exec(cell.trim());
  return m ? { col: columnNumber(m[1]), row: Number(m[2]) } : undefined;
}

/** Columns a VSTACK/HSTACK table formula spills across, read from its first HSTACK row; undefined if unknown. */
function spillWidth(formula: string): number | undefined {
  const match = /^=\s*(?:VSTACK\s*\(\s*)?HSTACK\s*\(/i.exec(formula);
  if (!match) return undefined;
  const args = callArguments(formula, match[0].length - 1);
  if (!args) return undefined;
  let width = 0;
  for (const arg of args) {
    const range =
      /^\s*(?:'[^']+'|\w+)?!?\$?([A-Z]{1,3})\$?\d+\s*:\s*\$?([A-Z]{1,3})\$?\d+\s*$/i.exec(
        arg,
      );
    if (range) width += columnNumber(range[2]) - columnNumber(range[1]) + 1;
    else if (/[A-Z]{1,3}\$?\d+\s*:/i.test(arg)) return undefined;
    else width += 1;
  }
  return width;
}

/**
 * A table formula (VSTACK/HSTACK) fills a rectangle by itself. A later step that writes a header or
 * value into that rectangle blocks the spill (#SPILL!) and every lookup next to it reads "Not found".
 */
function spillArea(
  change: StagedChange,
): { sheet: string; cell: string; width: number } | undefined {
  if (change.kind === "write_formula" && !change.fillRange) {
    const width = spillWidth(change.formula);
    return width
      ? { sheet: change.sheet, cell: change.cell, width }
      : undefined;
  }
  if (change.kind === "excel_action" && change.tool === "combine_tables") {
    const args = change.args as Record<string, any>;
    if (args.mode !== "join" && args.mode !== "append") return undefined;
    const box = /^\$?([A-Z]{1,3})\$?\d+\s*:\s*\$?([A-Z]{1,3})\$?\d+$/i.exec(
      String(args.left_address ?? "").trim(),
    );
    if (!box || !args.sheet || !args.cell) return undefined;
    const left = columnNumber(box[2]) - columnNumber(box[1]) + 1;
    const brought =
      args.mode === "join"
        ? Array.isArray(args.columns) && args.columns.length
          ? args.columns.length
          : 1
        : 0;
    return {
      sheet: String(args.sheet),
      cell: String(args.cell),
      width: left + brought,
    };
  }
  return undefined;
}

function spillOverlaps(changes: readonly { change: StagedChange }[]): string[] {
  const issues: string[] = [];
  changes.forEach(({ change: first }, index) => {
    const change = spillArea(first);
    if (!change) return;
    const anchor = splitCell(change.cell);
    const width = change.width;
    if (!anchor) return;
    for (const { change: later } of changes.slice(index + 1)) {
      if (
        (later.kind !== "write_values" && later.kind !== "write_formula") ||
        later.sheet !== change.sheet
      )
        continue;
      const target = splitCell(later.cell);
      if (!target || target.row < anchor.row) continue;
      if (target.col < anchor.col || target.col >= anchor.col + width) continue;
      if (target.col === anchor.col && target.row === anchor.row) continue;
      issues.push(
        `'${later.sheet}'!${later.cell}: ${change.cell} is a table formula that spills across ${width} columns and rows below it, so writing into ${later.cell} blocks it (#SPILL!). Put the extra column inside the spilled formula (for example another HSTACK argument and a header in its first row) or write outside the spill area.`,
      );
    }
  });
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
  issues.push(...spillOverlaps(changes));
  return issues.slice(0, 5);
}
