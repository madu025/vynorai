import type { ExprNode } from "./expression.js";

type Value = number | string | boolean | null;

class Unsupported extends Error {}

/**
 * Computes one row of an expression so the preview can show the real new column. Only the common
 * functions are evaluated; anything else (dates, TEXT formats) returns null and the preview simply
 * says the value is calculated by Excel. This is a picture of the result, never the source of it:
 * Excel computes the real formulas.
 */
export function previewExpressionValue(
  node: ExprNode,
  row: unknown[],
): string | null {
  const num = (value: Value): number => {
    if (typeof value === "number") return value;
    if (typeof value === "boolean") return value ? 1 : 0;
    if (value === null || value === "") return 0;
    const parsed = Number(String(value).replace(/,/g, ""));
    if (!Number.isFinite(parsed)) throw new Unsupported("#VALUE!");
    return parsed;
  };
  const text = (value: Value): string =>
    value === null
      ? ""
      : typeof value === "boolean"
        ? value
          ? "TRUE"
          : "FALSE"
        : String(value);
  const truthy = (value: Value): boolean =>
    typeof value === "boolean" ? value : num(value) !== 0;
  const compare = (a: Value, b: Value): number => {
    if (typeof a === "number" && typeof b === "number") return a - b;
    return text(a)
      .toLocaleLowerCase()
      .localeCompare(text(b).toLocaleLowerCase());
  };
  const ev = (current: ExprNode): Value => {
    switch (current.t) {
      case "num":
      case "str":
      case "bool":
        return current.v;
      case "col": {
        const raw = row[current.i];
        return raw === undefined || raw === "" ? null : (raw as Value);
      }
      case "neg":
        return -num(ev(current.a));
      case "bin": {
        const a = num(ev(current.a));
        const b = num(ev(current.b));
        if (current.op === "/") {
          if (b === 0) throw new Unsupported("#DIV/0!");
          return a / b;
        }
        return current.op === "+" ? a + b : current.op === "-" ? a - b : a * b;
      }
      case "cat":
        return text(ev(current.a)) + text(ev(current.b));
      case "cmp": {
        const d = compare(ev(current.a), ev(current.b));
        return {
          "=": d === 0,
          "<>": d !== 0,
          "<": d < 0,
          ">": d > 0,
          "<=": d <= 0,
          ">=": d >= 0,
        }[current.op];
      }
      case "fn": {
        const a = current.args;
        const arg = (i: number) => ev(a[i]);
        switch (current.name) {
          case "IF":
            return truthy(arg(0)) ? arg(1) : a[2] ? arg(2) : false;
          case "IFS":
            for (let i = 0; i < a.length; i += 2)
              if (truthy(arg(i))) return arg(i + 1);
            throw new Unsupported("#N/A");
          case "AND":
            return a.every((_, i) => truthy(arg(i)));
          case "OR":
            return a.some((_, i) => truthy(arg(i)));
          case "NOT":
            return !truthy(arg(0));
          case "IFERROR":
          case "IFNA":
            try {
              return arg(0);
            } catch {
              return arg(1);
            }
          case "ISBLANK":
            return arg(0) === null;
          case "ISNUMBER":
            return typeof arg(0) === "number";
          case "ISTEXT":
            return typeof arg(0) === "string";
          case "ABS":
            return Math.abs(num(arg(0)));
          case "INT":
            return Math.floor(num(arg(0)));
          case "SQRT":
            return Math.sqrt(num(arg(0)));
          case "SIGN":
            return Math.sign(num(arg(0)));
          case "MOD":
            return num(arg(0)) % num(arg(1));
          case "POWER":
            return num(arg(0)) ** num(arg(1));
          case "MIN":
            return Math.min(...a.map((_, i) => num(arg(i))));
          case "MAX":
            return Math.max(...a.map((_, i) => num(arg(i))));
          case "SUM":
            return a.reduce((sum, _, i) => sum + num(arg(i)), 0);
          case "AVERAGE":
            return a.reduce((sum, _, i) => sum + num(arg(i)), 0) / a.length;
          case "ROUND":
          case "ROUNDUP":
          case "ROUNDDOWN": {
            const factor = 10 ** (a[1] ? num(arg(1)) : 0);
            const v = num(arg(0)) * factor;
            const r =
              current.name === "ROUND"
                ? Math.round(v)
                : current.name === "ROUNDUP"
                  ? Math.sign(v) * Math.ceil(Math.abs(v))
                  : Math.sign(v) * Math.floor(Math.abs(v));
            return r / factor;
          }
          case "LEN":
            return text(arg(0)).length;
          case "TRIM":
            return text(arg(0)).trim().replace(/\s+/g, " ");
          case "UPPER":
            return text(arg(0)).toLocaleUpperCase();
          case "LOWER":
            return text(arg(0)).toLocaleLowerCase();
          case "PROPER":
            return text(arg(0))
              .toLocaleLowerCase()
              .replace(
                /(^|[^\p{L}])(\p{L})/gu,
                (_m, p: string, c: string) => p + c.toLocaleUpperCase(),
              );
          case "LEFT":
            return text(arg(0)).slice(0, a[1] ? num(arg(1)) : 1);
          case "RIGHT": {
            const s = text(arg(0));
            const n = a[1] ? num(arg(1)) : 1;
            return n <= 0 ? "" : s.slice(Math.max(0, s.length - n));
          }
          case "MID": {
            const start = Math.max(0, num(arg(1)) - 1);
            return text(arg(0)).slice(start, start + num(arg(2)));
          }
          case "SUBSTITUTE":
            return text(arg(0))
              .split(text(arg(1)))
              .join(text(arg(2)));
          case "CONCAT":
            return a.map((_, i) => text(arg(i))).join("");
          case "TEXTJOIN": {
            const skip = truthy(arg(1));
            return a
              .slice(2)
              .map((_, i) => text(arg(i + 2)))
              .filter((value) => !skip || value !== "")
              .join(text(arg(0)));
          }
          case "EXACT":
            return text(arg(0)) === text(arg(1));
          case "VALUE":
            return num(arg(0));
          default:
            throw new Unsupported(current.name);
        }
      }
    }
  };
  try {
    const value = ev(node);
    if (value === null) return "";
    if (typeof value === "number") return String(Math.round(value * 1e6) / 1e6);
    return text(value);
  } catch (error) {
    if (error instanceof Unsupported)
      return /^#/.test(error.message) ? error.message : null;
    return null;
  }
}
