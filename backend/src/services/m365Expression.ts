/**
 * Safe column expressions for computed columns, e.g. `(Sales - Cost) / Sales` or `ROUND(Cost * 1.15, 2)`.
 *
 * The grammar is small and closed: numbers, column names, + - * /, parentheses, unary minus, a
 * trailing % on a number, and the functions ROUND, ABS, MIN, MAX. A column name that contains
 * spaces is written in square brackets. Nothing else is accepted, so an expression can never
 * become an arbitrary Excel formula. The backend carries an identical copy (`m365Expression.ts`);
 * a parity test keeps them equal.
 */

export const MAX_EXPRESSION_CHARS = 200;
export const MAX_EXPRESSION_REFS = 12;
export const MAX_EXPRESSION_DEPTH = 8;

export type ExprNode =
  | { t: "num"; v: number }
  | { t: "col"; i: number }
  | { t: "neg"; a: ExprNode }
  | { t: "bin"; op: "+" | "-" | "*" | "/"; a: ExprNode; b: ExprNode }
  | { t: "fn"; name: "ROUND" | "ABS" | "MIN" | "MAX"; args: ExprNode[] };

export class ExpressionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExpressionError";
  }
}

type Token =
  | { k: "num"; v: number }
  | { k: "id"; v: string }
  | { k: "op"; v: "+" | "-" | "*" | "/" | "(" | ")" | "," };

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
    } else if ("+-*/(),".includes(char)) {
      tokens.push({ k: "op", v: char as "+" });
      index += 1;
    } else if (char === "[") {
      const end = source.indexOf("]", index);
      if (end < 0) throw new ExpressionError("A [column name] is not closed.");
      const name = source.slice(index + 1, end).trim();
      if (!name) throw new ExpressionError("An empty [column name].");
      tokens.push({ k: "id", v: name });
      index = end + 1;
    } else if (/[\p{L}_]/u.test(char)) {
      const match = /^[\p{L}\p{N}_]+/u.exec(source.slice(index));
      tokens.push({ k: "id", v: match![0] });
      index += match![0].length;
    } else {
      throw new ExpressionError(`Unsupported character "${char}".`);
    }
  }
  return tokens;
}

const FUNCTIONS: Record<string, { min: number; max: number }> = {
  ROUND: { min: 1, max: 2 },
  ABS: { min: 1, max: 1 },
  MIN: { min: 2, max: 4 },
  MAX: { min: 2, max: 4 },
};

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

  function factor(): ExprNode {
    depth += 1;
    if (depth > MAX_EXPRESSION_DEPTH)
      throw new ExpressionError("The expression is nested too deeply.");
    try {
      const token = take();
      if (!token) throw new ExpressionError("The expression ends too early.");
      if (token.k === "num") return { t: "num", v: token.v };
      if (isOp(token, "-")) return { t: "neg", a: factor() };
      if (isOp(token, "(")) {
        const inner = sum();
        if (!isOp(take(), ")"))
          throw new ExpressionError("A parenthesis is not closed.");
        return inner;
      }
      if (token.k === "id") {
        if (isOp(peek(), "(")) {
          const name = token.v.toUpperCase();
          const rule = FUNCTIONS[name];
          if (!rule)
            throw new ExpressionError(
              `Function ${token.v} is not supported. Use ROUND, ABS, MIN or MAX.`,
            );
          take();
          const args: ExprNode[] = [];
          if (!isOp(peek(), ")")) {
            args.push(sum());
            while (isOp(peek(), ",")) {
              take();
              args.push(sum());
            }
          }
          if (!isOp(take(), ")"))
            throw new ExpressionError("A parenthesis is not closed.");
          if (args.length < rule.min || args.length > rule.max)
            throw new ExpressionError(
              `${name} has the wrong number of values.`,
            );
          if (name === "ROUND" && args[1] && args[1].t !== "num")
            throw new ExpressionError(
              "ROUND needs a fixed number of decimals.",
            );
          return { t: "fn", name: name as "ROUND", args };
        }
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
    let left = factor();
    while (isOp(peek(), "*") || isOp(peek(), "/")) {
      const op = (take() as { v: "*" | "/" }).v;
      left = { t: "bin", op, a: left, b: factor() };
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

  const ast = sum();
  if (position !== tokens.length)
    throw new ExpressionError("Unexpected text after the expression.");
  if (refs.size === 0)
    throw new ExpressionError("Use at least one column in the expression.");
  return { ast, refs: [...refs].sort((a, b) => a - b) };
}

/** Canonical text with column positions, so two parsers can be compared and a plan can be hashed. */
export function canonicalExpression(node: ExprNode): string {
  switch (node.t) {
    case "num":
      return String(node.v);
    case "col":
      return `#${node.i}`;
    case "neg":
      return `(-${canonicalExpression(node.a)})`;
    case "bin":
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
): string {
  let divides = false;
  const emit = (current: ExprNode): string => {
    switch (current.t) {
      case "num":
        return String(current.v);
      case "col":
        return cell(current.i);
      case "neg":
        return `(-${emit(current.a)})`;
      case "bin":
        if (current.op === "/") divides = true;
        return `(${emit(current.a)}${current.op}${emit(current.b)})`;
      case "fn":
        return `${current.name}(${current.args.map(emit).join(",")})`;
    }
  };
  const body = emit(node);
  // A division by zero or an empty cell leaves the cell blank instead of #DIV/0!.
  return divides ? `=IFERROR(${body},"")` : `=${body}`;
}

/** Name hints that mean the result is a ratio the person wants to see as a percentage. */
export function wantsPercentFormat(columnName: string): boolean {
  return /%|percent|\bpct\b/i.test(columnName);
}

export { columnLetter as expressionColumnLetter };
