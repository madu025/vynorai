/**
 * Safe column expressions for computed columns, e.g. `(Sales - Cost) / Sales`,
 * `IF(Sales > 1500, "High", "Low")` or `DATEDIF([Start], TODAY(), "m")`.
 *
 * The grammar is small and closed: numbers, "text", TRUE/FALSE, column names (a name with spaces
 * goes in square brackets), + - * / & and the comparisons = <> < > <= >=, parentheses, and a fixed
 * list of functions (math, logic, text, date). A function outside the list, a cell address or
 * another sheet is rejected, so an expression can never become an arbitrary Excel formula. The
 * backend carries an identical copy (`m365Expression.ts`); a parity test keeps them equal.
 */

export const MAX_EXPRESSION_CHARS = 240;
export const MAX_EXPRESSION_REFS = 12;
export const MAX_EXPRESSION_DEPTH = 8;
export const MAX_STRING_LITERAL = 80;

export type ExprNode =
  | { t: "num"; v: number }
  | { t: "str"; v: string }
  | { t: "bool"; v: boolean }
  | { t: "col"; i: number }
  | { t: "neg"; a: ExprNode }
  | { t: "bin"; op: "+" | "-" | "*" | "/"; a: ExprNode; b: ExprNode }
  | { t: "cat"; a: ExprNode; b: ExprNode }
  | {
      t: "cmp";
      op: "=" | "<>" | "<" | ">" | "<=" | ">=";
      a: ExprNode;
      b: ExprNode;
    }
  | { t: "fn"; name: string; args: ExprNode[] };

export class ExpressionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExpressionError";
  }
}

type Token =
  | { k: "num"; v: number }
  | { k: "str"; v: string }
  | { k: "id"; v: string }
  | { k: "op"; v: string };

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  while (index < source.length) {
    const char = source[index];
    if (/\s/.test(char)) {
      index += 1;
    } else if (/[0-9.]/.test(char)) {
      const match = /^(\d+(?:\.\d+)?|\.\d+)(%?)/.exec(source.slice(index));
      if (!match) throw new ExpressionError("Invalid number.");
      let value = Number(match[1]);
      if (match[2] === "%") value /= 100;
      if (!Number.isFinite(value)) throw new ExpressionError("Invalid number.");
      tokens.push({ k: "num", v: value });
      index += match[0].length;
    } else if (char === '"' || char === "“" || char === "”") {
      let close = -1;
      for (let at = index + 1; at < source.length; at += 1) {
        if (source[at] === '"' || source[at] === "”" || source[at] === "“") {
          close = at;
          break;
        }
      }
      if (close < 0) throw new ExpressionError("A text value is not closed.");
      const value = source.slice(index + 1, close);
      if (value.length > MAX_STRING_LITERAL)
        throw new ExpressionError(
          `Text values are limited to ${MAX_STRING_LITERAL} characters.`,
        );
      if (/[\u0000-\u001F\u007F]/.test(value))
        throw new ExpressionError("A text value contains a control character.");
      tokens.push({ k: "str", v: value });
      index = close + 1;
    } else if (
      source.startsWith("<>", index) ||
      source.startsWith("<=", index) ||
      source.startsWith(">=", index)
    ) {
      tokens.push({ k: "op", v: source.slice(index, index + 2) });
      index += 2;
    } else if ("+-*/(),&=<>".includes(char)) {
      tokens.push({ k: "op", v: char });
      index += 1;
    } else if (char === "[") {
      const end = source.indexOf("]", index);
      if (end < 0) throw new ExpressionError("A [column name] is not closed.");
      const name = source.slice(index + 1, end).trim();
      if (!name) throw new ExpressionError("An empty [column name].");
      tokens.push({ k: "id", v: name });
      index = end + 1;
    } else if (/[\p{L}_]/u.test(char)) {
      const match = /^[\p{L}\p{N}_.]+/u.exec(source.slice(index));
      tokens.push({ k: "id", v: match![0] });
      index += match![0].length;
    } else {
      throw new ExpressionError(`Unsupported character "${char}".`);
    }
  }
  return tokens;
}

interface FunctionRule {
  min: number;
  max: number;
  /** "math": every column argument must hold numbers. */
  kind: "math" | "logic" | "text" | "date";
}

const FN = (
  min: number,
  max: number,
  kind: FunctionRule["kind"],
): FunctionRule => ({
  min,
  max,
  kind,
});

export const EXPRESSION_FUNCTIONS: Record<string, FunctionRule> = {
  // math
  ROUND: FN(1, 2, "math"),
  ROUNDUP: FN(1, 2, "math"),
  ROUNDDOWN: FN(1, 2, "math"),
  ABS: FN(1, 1, "math"),
  INT: FN(1, 1, "math"),
  MOD: FN(2, 2, "math"),
  POWER: FN(2, 2, "math"),
  SQRT: FN(1, 1, "math"),
  SIGN: FN(1, 1, "math"),
  MIN: FN(2, 8, "math"),
  MAX: FN(2, 8, "math"),
  SUM: FN(1, 8, "math"),
  AVERAGE: FN(1, 8, "math"),
  // whole-column figures: the total, average, largest, smallest, count or spread of one column
  COLSUM: FN(1, 1, "math"),
  COLAVG: FN(1, 1, "math"),
  COLMAX: FN(1, 1, "math"),
  COLMIN: FN(1, 1, "math"),
  COLCOUNT: FN(1, 1, "math"),
  COLSTDEV: FN(1, 1, "math"),
  // whole-column figures with a condition (like SUMIFS / COUNTIFS) and the number of distinct values
  COLSUMIF: FN(3, 3, "math"),
  COLAVGIF: FN(3, 3, "math"),
  COLCOUNTIF: FN(2, 2, "logic"),
  COLDISTINCT: FN(1, 1, "logic"),
  // per-group figures: the total, average, largest, smallest or row count of each row's own group
  GROUPSUM: FN(2, 2, "math"),
  GROUPAVG: FN(2, 2, "math"),
  GROUPMAX: FN(2, 2, "math"),
  GROUPMIN: FN(2, 2, "math"),
  GROUPCOUNT: FN(1, 1, "logic"),
  // logic
  IF: FN(2, 3, "logic"),
  IFS: FN(2, 12, "logic"),
  AND: FN(2, 6, "logic"),
  OR: FN(2, 6, "logic"),
  NOT: FN(1, 1, "logic"),
  IFERROR: FN(2, 2, "logic"),
  IFNA: FN(2, 2, "logic"),
  ISBLANK: FN(1, 1, "logic"),
  ISNUMBER: FN(1, 1, "logic"),
  ISTEXT: FN(1, 1, "logic"),
  // text
  LEFT: FN(1, 2, "text"),
  RIGHT: FN(1, 2, "text"),
  MID: FN(3, 3, "text"),
  LEN: FN(1, 1, "text"),
  TRIM: FN(1, 1, "text"),
  CLEAN: FN(1, 1, "text"),
  UPPER: FN(1, 1, "text"),
  LOWER: FN(1, 1, "text"),
  PROPER: FN(1, 1, "text"),
  SUBSTITUTE: FN(3, 4, "text"),
  REPLACE: FN(4, 4, "text"),
  FIND: FN(2, 3, "text"),
  SEARCH: FN(2, 3, "text"),
  CONCAT: FN(2, 8, "text"),
  TEXTJOIN: FN(3, 10, "text"),
  VALUE: FN(1, 1, "text"),
  TEXT: FN(2, 2, "text"),
  EXACT: FN(2, 2, "text"),
  // date
  DATE: FN(3, 3, "date"),
  YEAR: FN(1, 1, "date"),
  MONTH: FN(1, 1, "date"),
  DAY: FN(1, 1, "date"),
  WEEKDAY: FN(1, 2, "date"),
  WEEKNUM: FN(1, 2, "date"),
  EOMONTH: FN(2, 2, "date"),
  EDATE: FN(2, 2, "date"),
  DATEDIF: FN(3, 3, "date"),
  DAYS: FN(2, 2, "date"),
  NETWORKDAYS: FN(2, 2, "date"),
  WORKDAY: FN(2, 2, "date"),
  TODAY: FN(0, 0, "date"),
  DATEVALUE: FN(1, 1, "date"),
};

/** Functions whose first argument is a measure and whose other column arguments may hold text. */
const MEASURE_FIRST = /^(?:COLSUMIF|COLAVGIF|GROUP(?:SUM|AVG|MAX|MIN))$/;
/** Functions that take whole columns: [column] names only, and (for the IF forms) a fixed value. */
const COLUMN_ARGS: Record<string, { columns: number; example: string }> = {
  COLSUMIF: { columns: 2, example: 'COLSUMIF([Quantity], [Status], "S")' },
  COLAVGIF: { columns: 2, example: 'COLAVGIF([Quantity], [Status], "S")' },
  COLCOUNTIF: { columns: 1, example: 'COLCOUNTIF([Status], "S")' },
  COLDISTINCT: { columns: 1, example: "COLDISTINCT([Item Code])" },
  GROUPSUM: { columns: 2, example: "GROUPSUM([Quantity], [Region])" },
  GROUPAVG: { columns: 2, example: "GROUPAVG([Quantity], [Region])" },
  GROUPMAX: { columns: 2, example: "GROUPMAX([Quantity], [Region])" },
  GROUPMIN: { columns: 2, example: "GROUPMIN([Quantity], [Region])" },
  GROUPCOUNT: { columns: 1, example: "GROUPCOUNT([Region])" },
};

/** The units DATEDIF accepts, and the characters a TEXT format may contain. */
const DATEDIF_UNITS = ["d", "m", "y", "ym", "md", "yd"];
const TEXT_FORMAT = /^[0#,.%\-/: dDmMyYhHsSaApP]{1,24}$/;

/** Parses an expression against the sheet's headers; unknown or ambiguous names are rejected. */
export function parseExpression(
  source: string,
  headers: string[],
): { ast: ExprNode; refs: number[] } {
  const text = source.trim();
  if (!text) throw new ExpressionError("Write an expression.");
  if (text.length > MAX_EXPRESSION_CHARS)
    throw new ExpressionError(
      `Expressions are limited to ${MAX_EXPRESSION_CHARS} characters.`,
    );
  const tokens = tokenize(text);
  const lower = headers.map((header) => header.trim().toLocaleLowerCase());
  const refs = new Set<number>();
  let position = 0;
  let depth = 0;

  const peek = () => tokens[position];
  const take = () => tokens[position++];
  const isOp = (token: Token | undefined, value: string) =>
    token?.k === "op" && token.v === value;

  function lookup(name: string): number {
    const matches: number[] = [];
    const wanted = name.toLocaleLowerCase();
    lower.forEach((header, column) => {
      if (header === wanted) matches.push(column);
    });
    if (matches.length === 1) return matches[0];
    if (matches.length > 1)
      throw new ExpressionError(`"${name}" matches more than one column.`);
    throw new ExpressionError(
      `"${name}" is not a column. Available: ${headers.join(", ")}.`,
    );
  }

  function checkCall(name: string, args: ExprNode[]) {
    const rule = EXPRESSION_FUNCTIONS[name];
    if (args.length < rule.min || args.length > rule.max)
      throw new ExpressionError(`${name} has the wrong number of values.`);
    const literal = (index: number) => args[index];
    if (/^ROUND(UP|DOWN)?$/.test(name) && args[1] && args[1].t !== "num")
      throw new ExpressionError(`${name} needs a fixed number of decimals.`);
    if (/^COL(SUM|AVG|MAX|MIN|COUNT|STDEV)$/.test(name) && args[0].t !== "col")
      throw new ExpressionError(
        `${name} needs one column, for example ${name}([Sales]).`,
      );
    const columnArgs = COLUMN_ARGS[name];
    if (columnArgs) {
      for (let index = 0; index < columnArgs.columns; index += 1)
        if (args[index].t !== "col")
          throw new ExpressionError(
            `${name} needs column names in brackets, for example ${columnArgs.example}.`,
          );
      const value = args[columnArgs.columns];
      if (value && value.t !== "str" && value.t !== "num")
        throw new ExpressionError(
          `${name} needs the value to match written as a number or in quotes, for example ${columnArgs.example}.`,
        );
    }
    if (name === "IFS" && args.length % 2 !== 0)
      throw new ExpressionError("IFS needs pairs of a test and a result.");
    if (name === "TEXT") {
      const format = literal(1);
      if (format.t !== "str" || !TEXT_FORMAT.test(format.v))
        throw new ExpressionError(
          'TEXT needs a simple format in quotes such as "0.0", "#,##0" or "yyyy-mm-dd".',
        );
    }
    if (name === "DATEDIF") {
      const unit = literal(2);
      if (unit.t !== "str" || !DATEDIF_UNITS.includes(unit.v.toLowerCase()))
        throw new ExpressionError(
          'DATEDIF needs a unit in quotes: "d", "m", "y", "ym", "md" or "yd".',
        );
    }
    if (name === "TEXTJOIN" && literal(0).t !== "str")
      throw new ExpressionError(
        "TEXTJOIN needs its separator written in quotes.",
      );
  }

  function atom(): ExprNode {
    depth += 1;
    if (depth > MAX_EXPRESSION_DEPTH)
      throw new ExpressionError("The expression is nested too deeply.");
    try {
      const token = take();
      if (!token) throw new ExpressionError("The expression ends too early.");
      if (token.k === "num") return { t: "num", v: token.v };
      if (token.k === "str") return { t: "str", v: token.v };
      if (isOp(token, "-")) return { t: "neg", a: atom() };
      if (isOp(token, "(")) {
        const inner = comparison();
        if (!isOp(take(), ")"))
          throw new ExpressionError("A parenthesis is not closed.");
        return inner;
      }
      if (token.k === "id") {
        if (isOp(peek(), "(")) {
          const name = token.v.toUpperCase();
          if (!EXPRESSION_FUNCTIONS[name])
            throw new ExpressionError(
              `Function ${token.v} is not supported here.`,
            );
          take();
          const args: ExprNode[] = [];
          if (!isOp(peek(), ")")) {
            args.push(comparison());
            while (isOp(peek(), ",")) {
              take();
              args.push(comparison());
            }
          }
          if (!isOp(take(), ")"))
            throw new ExpressionError("A parenthesis is not closed.");
          checkCall(name, args);
          return { t: "fn", name, args };
        }
        const upper = token.v.toUpperCase();
        if (upper === "TRUE" || upper === "FALSE")
          return { t: "bool", v: upper === "TRUE" };
        const column = lookup(token.v);
        refs.add(column);
        if (refs.size > MAX_EXPRESSION_REFS)
          throw new ExpressionError("Too many columns in one expression.");
        return { t: "col", i: column };
      }
      throw new ExpressionError("Unexpected symbol in the expression.");
    } finally {
      depth -= 1;
    }
  }

  function product(): ExprNode {
    let left = atom();
    while (isOp(peek(), "*") || isOp(peek(), "/")) {
      const op = (take() as { v: "*" | "/" }).v;
      left = { t: "bin", op, a: left, b: atom() };
    }
    return left;
  }

  function sum(): ExprNode {
    let left = product();
    while (isOp(peek(), "+") || isOp(peek(), "-")) {
      const op = (take() as { v: "+" | "-" }).v;
      left = { t: "bin", op, a: left, b: product() };
    }
    return left;
  }

  function concat(): ExprNode {
    let left = sum();
    while (isOp(peek(), "&")) {
      take();
      left = { t: "cat", a: left, b: sum() };
    }
    return left;
  }

  function comparison(): ExprNode {
    const left = concat();
    const next = peek();
    if (
      next?.k === "op" &&
      ["=", "<>", "<", ">", "<=", ">="].includes(next.v)
    ) {
      take();
      return {
        t: "cmp",
        op: next.v as "=",
        a: left,
        b: concat(),
      };
    }
    return left;
  }

  const ast = comparison();
  if (position !== tokens.length)
    throw new ExpressionError("Unexpected text after the expression.");
  if (refs.size === 0 && !/\bTODAY\s*\(/i.test(text))
    throw new ExpressionError("Use at least one column in the expression.");
  return { ast, refs: [...refs].sort((a, b) => a - b) };
}

/** Columns that must hold numbers: operands of + - * / and arguments of the math functions. */
export function numericColumnRefs(node: ExprNode): number[] {
  const found = new Set<number>();
  const visit = (current: ExprNode, needsNumber: boolean): void => {
    switch (current.t) {
      case "col":
        if (needsNumber) found.add(current.i);
        return;
      case "neg":
        visit(current.a, true);
        return;
      case "bin":
        visit(current.a, true);
        visit(current.b, true);
        return;
      case "cat":
      case "cmp":
        visit(current.a, false);
        visit(current.b, false);
        return;
      case "fn": {
        if (MEASURE_FIRST.test(current.name)) {
          current.args.forEach((arg, index) => visit(arg, index === 0));
          return;
        }
        const math = EXPRESSION_FUNCTIONS[current.name]?.kind === "math";
        for (const arg of current.args) visit(arg, math);
        return;
      }
      default:
        return;
    }
  };
  visit(node, false);
  return [...found].sort((a, b) => a - b);
}

/** Canonical text with column positions, so two parsers can be compared and a plan can be hashed. */
export function canonicalExpression(node: ExprNode): string {
  switch (node.t) {
    case "num":
      return String(node.v);
    case "str":
      return JSON.stringify(node.v);
    case "bool":
      return node.v ? "TRUE" : "FALSE";
    case "col":
      return `#${node.i}`;
    case "neg":
      return `(-${canonicalExpression(node.a)})`;
    case "bin":
      return `(${canonicalExpression(node.a)}${node.op}${canonicalExpression(node.b)})`;
    case "cat":
      return `(${canonicalExpression(node.a)}&${canonicalExpression(node.b)})`;
    case "cmp":
      return `(${canonicalExpression(node.a)}${node.op}${canonicalExpression(node.b)})`;
    case "fn":
      return `${node.name}(${node.args.map(canonicalExpression).join(",")})`;
  }
}

function columnLetter(index: number): string {
  let value = index;
  let letters = "";
  do {
    letters = String.fromCharCode(65 + (value % 26)) + letters;
    value = Math.floor(value / 26) - 1;
  } while (value >= 0);
  return letters;
}

/** Excel formula for one row. `cell(i)` returns the A1 reference of column `i` on that row. */
export function expressionToFormula(
  node: ExprNode,
  cell: (columnIndex: number) => string,
  whole?: (columnIndex: number) => string,
  /** Very large data: a whole-column figure is worked out once, outside the per-row formula. */
  hoist?: (call: string) => string,
  /**
   * Very large data: a per-group figure is worked out once as a whole column (one value per row);
   * the returned name is that row's value. Without it each row runs its own SUMIFS.
   */
  vector?: (call: string) => string,
): string {
  let divides = false;
  const emit = (current: ExprNode): string => {
    switch (current.t) {
      case "num":
        return String(current.v);
      case "str":
        return `"${current.v.replace(/"/g, '""')}"`;
      case "bool":
        return current.v ? "TRUE" : "FALSE";
      case "col":
        return cell(current.i);
      case "neg":
        return `(-${emit(current.a)})`;
      case "bin":
        if (current.op === "/") divides = true;
        return `(${emit(current.a)}${current.op}${emit(current.b)})`;
      case "cat":
        return `(${emit(current.a)}&${emit(current.b)})`;
      case "cmp":
        return `(${emit(current.a)}${current.op}${emit(current.b)})`;
      case "fn": {
        const column = /^COL(SUM|AVG|MAX|MIN|COUNT|STDEV)$/.exec(current.name);
        if (column) {
          const target = current.args[0];
          if (!whole || target.t !== "col")
            throw new Error("A whole-column figure needs the column range");
          const excel = {
            SUM: "SUM",
            AVG: "AVERAGE",
            MAX: "MAX",
            MIN: "MIN",
            COUNT: "COUNT",
            STDEV: "STDEV.S",
          }[column[1] as "SUM"];
          const call = `${excel}(${whole(target.i)})`;
          return hoist ? hoist(call) : call;
        }
        if (COLUMN_ARGS[current.name]) {
          if (!whole)
            throw new Error("A whole-column figure needs the column range");
          const col = (index: number) => {
            const target = current.args[index];
            if (target.t !== "col")
              throw new Error(`${current.name} needs a column`);
            return target.i;
          };
          const group = /^GROUP(SUM|AVG|MAX|MIN|COUNT)$/.exec(current.name);
          if (group) {
            const key = col(group[1] === "COUNT" ? 0 : 1);
            const measure = col(0);
            if (vector) {
              // GROUPBY totals every group once (sorted), then each row finds its group by binary search.
              const fn = {
                SUM: "SUM",
                AVG: "AVERAGE",
                MAX: "MAX",
                MIN: "MIN",
                COUNT: "COUNTA",
              }[group[1] as "SUM"];
              return vector(
                `LET(_t,GROUPBY(${whole(key)},${whole(measure)},${fn},0,0),XLOOKUP(${whole(key)},TAKE(_t,,1),TAKE(_t,,-1),"",0,2))`,
              );
            }
            if (group[1] === "COUNT")
              return `COUNTIFS(${whole(key)},${cell(key)})`;
            const fn = {
              SUM: "SUMIFS",
              AVG: "AVERAGEIFS",
              MAX: "MAXIFS",
              MIN: "MINIFS",
            }[group[1] as "SUM"];
            return `${fn}(${whole(measure)},${whole(key)},${cell(key)})`;
          }
          let call: string;
          if (current.name === "COLDISTINCT") {
            const range = whole(col(0));
            call = `IFERROR(ROWS(UNIQUE(FILTER(${range},${range}<>""))),0)`;
          } else if (current.name === "COLCOUNTIF") {
            call = `COUNTIFS(${whole(col(0))},${emit(current.args[1])})`;
          } else {
            const fn = current.name === "COLSUMIF" ? "SUMIFS" : "AVERAGEIFS";
            call = `${fn}(${whole(col(0))},${whole(col(1))},${emit(current.args[2])})`;
            // No matching row: blank, not #DIV/0!.
            if (fn === "AVERAGEIFS") call = `IFERROR(${call},"")`;
          }
          return hoist ? hoist(call) : call;
        }
        return `${current.name}(${current.args.map(emit).join(",")})`;
      }
    }
  };
  const body = emit(node);
  // A division by zero or an empty cell leaves the cell blank instead of #DIV/0!.
  const guarded =
    node.t === "fn" && (node.name === "IFERROR" || node.name === "IFNA");
  return divides && !guarded ? `=IFERROR(${body},"")` : `=${body}`;
}

/** Name hints that mean the result is a ratio the person wants to see as a percentage. */
export function wantsPercentFormat(columnName: string): boolean {
  return /%|percent|\bpct\b/i.test(columnName);
}

export { columnLetter as expressionColumnLetter };
