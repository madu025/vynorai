/**
 * Formula steps (backlog #180). Office.js has no Evaluate Formula, and there is no formula evaluator in this
 * add-in, so this splits a formula into its nested function calls, innermost first, and says in plain words
 * what each call does and which cells it reads. It never calculates a result: when the caller passes the
 * values of the referenced cells they are listed next to each step as inputs only. Pure and deterministic;
 * bad input returns `{ ok: false }`, it never throws.
 */

export const MAX_FORMULA_STEPS_CHARS = 8192;
export const MAX_FORMULA_STEPS_DEPTH = 64;
export const MAX_FORMULA_STEPS = 100;

export interface FormulaStepInput {
  reference: string;
  value: string | number | boolean | null;
}

export interface FormulaStep {
  /** The text of this call (or of the whole formula for the last step), without the leading "=". */
  expression: string;
  meaning: string;
  /** Upper-case references this step reads, `$` removed, sheet name kept (for example `Data!A:A`). */
  references: string[];
  /** Given values for the references above, only for keys the caller passed. */
  inputs: FormulaStepInput[];
  /** Number of enclosing function calls; the whole formula is 0. */
  depth: number;
  /** Upper-case function name, or null for a step that is not one function call. */
  functionName: string | null;
}

export type FormulaStepsResult =
  | { ok: true; steps: FormulaStep[] }
  | { ok: false; error: string };

interface Frame {
  name: string | null;
  nameStart: number;
  args: string[];
  argStart: number;
  depth: number;
}

function shorten(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > 60 ? `${flat.slice(0, 57)}...` : flat;
}

function meaningOf(name: string | null, args: string[]): string {
  if (!name)
    return "Combines the results above with operators (+ - * / & or a comparison).";
  const a = args.map(shorten);
  const at = (i: number) => a[i] ?? "";
  switch (name) {
    case "IF":
      return `Tests ${at(0)}; gives ${at(1)} when true${a.length > 2 ? `, otherwise ${at(2)}` : ", otherwise FALSE"}.`;
    case "IFERROR":
      return `Gives ${at(0)}, unless it is an error, then gives ${at(1)}.`;
    case "IFNA":
      return `Gives ${at(0)}, unless it is #N/A, then gives ${at(1)}.`;
    case "VLOOKUP":
      return `Finds ${at(0)} in the first column of ${at(1)} and returns column ${at(2)} of that row${/^(0|FALSE)$/i.test(at(3)) ? " (exact match)" : ""}.`;
    case "XLOOKUP":
      return `Finds ${at(0)} in ${at(1)} and returns the matching item from ${at(2)}.`;
    case "INDEX":
      return `Returns the item of ${at(0)} at row ${at(1)}${a.length > 2 ? `, column ${at(2)}` : ""}.`;
    case "MATCH":
      return `Gives the position of ${at(0)} in ${at(1)}.`;
    case "SUMIFS":
      return `Adds ${at(0)} where every condition pair holds (${a.slice(1).join("; ")}).`;
    case "SUMIF":
      return `Adds the cells where ${at(0)} meets ${at(1)}${a.length > 2 ? ` (adding ${at(2)})` : ""}.`;
    case "COUNTIFS":
    case "COUNTIF":
      return `Counts the rows where every condition holds (${a.join("; ")}).`;
    case "AVERAGEIFS":
      return `Averages ${at(0)} where every condition pair holds (${a.slice(1).join("; ")}).`;
    case "SUM":
      return `Adds ${a.join("; ")}.`;
    case "AVERAGE":
      return `Averages ${a.join("; ")}.`;
    case "MIN":
    case "MAX":
      return `Gives the ${name === "MIN" ? "smallest" : "largest"} of ${a.join("; ")}.`;
    case "ROUND":
      return `Rounds ${at(0)} to ${at(1)} decimal places.`;
    case "AND":
    case "OR":
      return `${name === "AND" ? "TRUE only if all" : "TRUE if any"} of these hold: ${a.join("; ")}.`;
    case "CONCATENATE":
    case "CONCAT":
    case "TEXTJOIN":
      return `Joins text: ${a.join("; ")}.`;
    default:
      return `Runs ${name}${a.length ? ` on ${a.join("; ")}` : ""}.`;
  }
}

const REFERENCE_PATTERN =
  /(?<![\w.])((?:'(?:[^']|'')+'|[A-Za-z_][\w.]*)!)?(\$?[A-Za-z]{1,3}\$?\d+(?::\$?[A-Za-z]{1,3}\$?\d+)?|\$?[A-Za-z]{1,3}:\$?[A-Za-z]{1,3})(?![\w(.])/g;

/** Blank out string literals and bracketed names so their content is never read as references. */
function mask(text: string): string {
  return text
    .replace(/"(?:[^"]|"")*"/g, (m) => " ".repeat(m.length))
    .replace(/\[[^\]]*\]/g, (m) => " ".repeat(m.length));
}

function referencesIn(expression: string): string[] {
  const found = new Set<string>();
  for (const match of mask(expression).matchAll(REFERENCE_PATTERN)) {
    const sheet = match[1]
      ? match[1].slice(0, -1).replace(/^'|'$/g, "").replace(/''/g, "'")
      : "";
    const ref = match[2].replace(/\$/g, "").toUpperCase();
    found.add(sheet ? `${sheet}!${ref}` : ref);
  }
  return [...found];
}

function inputsFor(
  references: string[],
  values: Record<string, unknown> | undefined,
): FormulaStepInput[] {
  if (!values || typeof values !== "object") return [];
  const out: FormulaStepInput[] = [];
  for (const reference of references) {
    if (!Object.prototype.hasOwnProperty.call(values, reference)) continue;
    const value = values[reference];
    if (
      value === null ||
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    )
      out.push({ reference, value });
  }
  return out;
}

/** Index after the closing delimiter that matches the opener at `from`, or -1. */
function skipQuoted(text: string, from: number, close: string): number {
  for (let i = from + 1; i < text.length; i++) {
    if (text[i] !== close) continue;
    if (text[i + 1] === close) i++;
    else return i + 1;
  }
  return -1;
}

function skipBracketed(
  text: string,
  from: number,
  open: string,
  close: string,
) {
  let depth = 0;
  for (let i = from; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"' && open === "{") {
      const end = skipQuoted(text, i, '"');
      if (end < 0) return -1;
      i = end - 1;
    } else if (ch === open) depth++;
    else if (ch === close && --depth === 0) return i + 1;
  }
  return -1;
}

export function explainFormulaSteps(
  formula: string,
  values?: Record<string, unknown>,
): FormulaStepsResult {
  try {
    if (typeof formula !== "string") return fail("The formula must be text.");
    const body = formula.trim().replace(/^=/, "").trim();
    if (!body) return fail("The formula is empty.");
    if (body.length > MAX_FORMULA_STEPS_CHARS)
      return fail(
        `The formula is longer than ${MAX_FORMULA_STEPS_CHARS} characters.`,
      );

    const steps: FormulaStep[] = [];
    const frames: Frame[] = [];
    let functionDepth = 0;

    const emit = (
      expression: string,
      name: string | null,
      args: string[],
      depth: number,
    ) => {
      const references = referencesIn(expression);
      steps.push({
        expression,
        meaning: meaningOf(name, args),
        references,
        inputs: inputsFor(references, values),
        depth,
        functionName: name,
      });
    };

    for (let i = 0; i < body.length; i++) {
      const ch = body[i];
      let end = -1;
      if (ch === '"') {
        end = skipQuoted(body, i, '"');
        if (end < 0) return fail("A text value is missing its closing quote.");
        i = end - 1;
      } else if (ch === "'") {
        end = skipQuoted(body, i, "'");
        if (end < 0) return fail("A sheet name is missing its closing quote.");
        i = end - 1;
      } else if (ch === "{") {
        end = skipBracketed(body, i, "{", "}");
        if (end < 0)
          return fail("An array constant is missing its closing brace.");
        i = end - 1;
      } else if (ch === "[") {
        end = skipBracketed(body, i, "[", "]");
        if (end < 0)
          return fail("A bracketed name is missing its closing bracket.");
        i = end - 1;
      } else if (ch === "(") {
        const name = /[A-Za-z_][\w.]*$/.exec(body.slice(0, i))?.[0] ?? null;
        if (frames.length >= MAX_FORMULA_STEPS_DEPTH)
          return fail(
            `Parentheses are nested deeper than ${MAX_FORMULA_STEPS_DEPTH} levels.`,
          );
        frames.push({
          name: name ? name.toUpperCase() : null,
          nameStart: name ? i - name.length : i,
          args: [],
          argStart: i + 1,
          depth: functionDepth,
        });
        if (name) functionDepth++;
      } else if (ch === ",") {
        const top = frames[frames.length - 1];
        if (top) {
          top.args.push(body.slice(top.argStart, i));
          top.argStart = i + 1;
        }
      } else if (ch === ")") {
        const top = frames.pop();
        if (!top)
          return fail("A closing parenthesis has no matching opening one.");
        if (top.name) {
          functionDepth--;
          top.args.push(body.slice(top.argStart, i));
          if (steps.length >= MAX_FORMULA_STEPS)
            return fail(
              `The formula has more than ${MAX_FORMULA_STEPS} function calls.`,
            );
          const args =
            top.args.length === 1 && !top.args[0].trim() ? [] : top.args;
          emit(body.slice(top.nameStart, i + 1), top.name, args, top.depth);
        }
      }
    }
    if (frames.length)
      return fail("An opening parenthesis is missing its closing one.");

    const last = steps[steps.length - 1];
    if (!last || last.expression !== body) emit(body, null, [], 0);
    return { ok: true, steps };
  } catch {
    return fail("The formula could not be read.");
  }
}

function fail(error: string): FormulaStepsResult {
  return { ok: false, error };
}
