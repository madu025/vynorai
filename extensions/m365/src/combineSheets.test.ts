import assert from "node:assert/strict";
import { test } from "node:test";
import {
  combineCells,
  combineKey,
  dataColumn,
  normalizedKeyFormula,
} from "./combineSheets.js";

const orders = {
  sheet: "Orders",
  address: "A1:C101",
  headers: ["Order ID", "Customer ID", "Amount"],
};
const customers = {
  sheet: "Customer List",
  address: "B3:E53",
  headers: ["Customer ID", "Name", "Region", "Segment"],
};
const bank = {
  sheet: "Bank",
  address: "A1:B201",
  headers: ["Ref", "Value"],
};

test("data columns skip the header and quote the sheet", () => {
  assert.equal(dataColumn(orders, 2), "'Orders'!C2:C101");
  assert.equal(dataColumn(customers, 0), "'Customer List'!B4:B53");
});

test("normalized key formulas use the guard's trim, case and numeric policy", () => {
  assert.equal(
    normalizedKeyFormula("'Orders'!B2:B101"),
    `LET(v,'Orders'!B2:B101,t,LOWER(TRIM(v)),IF(t="","",IFERROR(IF(INT(--v)=--v,TEXT(--v,"0"),t),t)))`,
  );
});

test("join brings the named columns by key with XLOOKUP and keeps the headers", () => {
  const [cell] = combineCells({
    mode: "join",
    left: orders,
    right: customers,
    key: "customer id",
    columns: ["Region", "Name"],
  });
  assert.equal(cell.row, 0);
  assert.equal(cell.row, 0);
  assert.match(
    cell.formula,
    /^=VSTACK\(HSTACK\('Orders'!A1:C1,"Region","Name"\)/,
  );
  assert.equal((cell.formula.match(/XLOOKUP/g) ?? []).length, 2);
  assert.equal((cell.formula.match(/TEXT\(--v/g) ?? []).length, 4);
});

test("join with no columns named brings every column except the key", () => {
  const [cell] = combineCells({
    mode: "join",
    left: orders,
    right: customers,
    key: "Customer ID",
  });
  assert.match(cell.formula, /"Name","Region","Segment"/);
  assert.equal((cell.formula.match(/XLOOKUP/g) ?? []).length, 3);
  assert.match(cell.formula, /LOWER\(TRIM\(/);
});

test("append matches the second table's columns to the first by header", () => {
  const [cell] = combineCells({
    mode: "append",
    left: { sheet: "Jan", address: "A1:C10", headers: ["Date", "Item", "Qty"] },
    right: {
      sheet: "Feb",
      address: "A1:C20",
      headers: ["Qty", "Date", "Item"],
    },
  });
  assert.equal(
    cell.formula,
    "=VSTACK('Jan'!A1:C1,'Jan'!A2:C10,CHOOSECOLS('Feb'!A2:C20,2,3,1))",
  );
});

test("reconcile lists both, only-first and only-second keys with counts", () => {
  const cells = combineCells({
    mode: "reconcile",
    left: orders,
    right: bank,
    key: "Order ID",
    rightKey: "Ref",
  });
  const at = (row: number, column: number) =>
    cells.find((cell) => cell.row === row && cell.column === column)?.formula;
  assert.equal(at(0, 0), '="In both"');
  assert.equal(at(0, 1), '="Only in Orders"');
  assert.equal(at(0, 2), '="Only in Bank"');
  assert.match(
    String(at(2, 1)),
    /^=FILTER\('Orders'!A2:A101,NOT\(ISNUMBER\(XMATCH\(/,
  );
  assert.match(String(at(1, 2)), /^=SUM\(--NOT\(ISNUMBER\(XMATCH\(/);
  assert.match(String(at(2, 1)), /TEXT\(--v/);
  assert.equal(at(2, 4), undefined);
});

test("reconcile with amounts lists matched keys whose amounts differ", () => {
  const cells = combineCells({
    mode: "reconcile",
    left: orders,
    right: bank,
    key: "Order ID",
    rightKey: "Ref",
    amount: "Amount",
    rightAmount: "Value",
  });
  const differs = cells.find((cell) => cell.row === 2 && cell.column === 4);
  assert.match(String(differs?.formula), /^=LET\(k,'Orders'!A2:A101,nk,LET\(/);
  assert.match(String(differs?.formula), /XLOOKUP\(nk,LET\(/);
  assert.match(String(differs?.formula), /TEXT\(--v/);
});

test("unknown headers and header-only ranges are refused with the real headers named", () => {
  assert.throws(
    () =>
      combineCells({
        mode: "join",
        left: orders,
        right: customers,
        key: "Client",
      }),
    /key "Client" is not a header of 'Orders'!A1:C101\. Headers: Order ID, Customer ID, Amount/,
  );
  assert.throws(
    () =>
      combineCells({
        mode: "append",
        left: { sheet: "A", address: "A1:B1", headers: ["x", "y"] },
        right: { sheet: "B", address: "A1:B5", headers: ["x", "y"] },
      }),
    /needs a header row and at least one data row/,
  );
  assert.throws(
    () =>
      combineCells({
        mode: "reconcile",
        left: orders,
        right: bank,
      }),
    /reconcile needs key/,
  );
});

/**
 * Evaluates the key formula for one cell value with the Excel semantics of the functions it uses
 * (LET, IF, IFERROR, ISNUMBER, INT, TEXT with "0", VALUE, LOWER, TRIM, unary minus, *, =), so the
 * test checks what Excel computes, not only the formula text.
 */
class XlError extends Error {}
type Xl = string | number | boolean | XlError;
type XlNode = (env: Map<string, Xl>) => Xl;
function evaluateKey(formula: string, cell: string | number): Xl {
  const tokens =
    formula.match(
      /"(?:[^"]|"")*"|'[^']*'![A-Z]+\d+:[A-Z]+\d+|\d+(?:\.\d+)?|[A-Za-z_]\w*|[(),=*-]/g,
    ) ?? [];
  let at = 0;
  const next = () => tokens[at++];
  const num = (value: Xl): number | XlError => {
    if (value instanceof XlError || typeof value === "number") return value;
    if (typeof value === "boolean") return value ? 1 : 0;
    const t = value.trim();
    return /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(t)
      ? Number(t)
      : new XlError("#VALUE!");
  };
  const str = (value: Xl) =>
    typeof value === "boolean" ? (value ? "TRUE" : "FALSE") : String(value);
  const call = (name: string, args: XlNode[], env: Map<string, Xl>): Xl => {
    if (name === "IF") {
      const condition = num(args[0](env));
      if (condition instanceof XlError) return condition;
      return condition !== 0 ? args[1](env) : args[2](env);
    }
    if (name === "IFERROR") {
      const value = args[0](env);
      return value instanceof XlError ? args[1](env) : value;
    }
    const values = args.map((arg) => arg(env));
    if (name === "ISNUMBER") return typeof values[0] === "number";
    const error = values.find((value) => value instanceof XlError);
    if (error) return error;
    if (name === "LOWER") return str(values[0]).toLowerCase();
    if (name === "TRIM") return str(values[0]).trim().replace(/ +/g, " ");
    const n = num(values[0]);
    if (n instanceof XlError || name === "VALUE") return n;
    if (name === "INT") return Math.floor(n);
    assert.equal(name, "TEXT");
    assert.equal(values[1], "0");
    return String(Math.sign(n) * Math.round(Math.abs(n)) || 0);
  };
  const primary = (): XlNode => {
    const token = next();
    if (token === "-") {
      const inner = primary();
      return (env) => {
        const n = num(inner(env));
        return n instanceof XlError ? n : -n;
      };
    }
    if (token === "(") {
      const inner = expression();
      next();
      return inner;
    }
    if (token.startsWith('"')) return () => token.slice(1, -1);
    if (/^\d/.test(token)) return () => Number(token);
    if (token.startsWith("'")) return () => cell;
    if (tokens[at] !== "(") return (env) => env.get(token)!;
    next();
    const name = token.toUpperCase();
    const bound: string[] = [];
    const args: XlNode[] = [];
    while (tokens[at] !== ")") {
      if (name === "LET" && tokens[at + 1] === ",") {
        bound.push(next());
        next();
      }
      args.push(expression());
      if (tokens[at] === ",") next();
    }
    next();
    if (name !== "LET") return (env) => call(name, args, env);
    return (env) => {
      const scope = new Map(env);
      bound.forEach((key, i) => scope.set(key, args[i](scope)));
      return args[args.length - 1](scope);
    };
  };
  const term = (): XlNode => {
    let left = primary();
    while (tokens[at] === "*") {
      next();
      const [l, r] = [left, primary()];
      left = (env) => {
        const a = num(l(env));
        const b = num(r(env));
        return a instanceof XlError ? a : b instanceof XlError ? b : a * b;
      };
    }
    return left;
  };
  const expression = (): XlNode => {
    let left = term();
    while (tokens[at] === "=") {
      next();
      const [l, r] = [left, term()];
      left = (env) => {
        const a = l(env);
        const b = r(env);
        if (a instanceof XlError) return a;
        if (b instanceof XlError) return b;
        return typeof a === "string" && typeof b === "string"
          ? a.toLowerCase() === b.toLowerCase()
          : a === b;
      };
    }
    return left;
  };
  return expression()(new Map());
}

test("key formula keeps decimal keys distinct and matches integer keys with leading zeros", () => {
  const formula = normalizedKeyFormula("'Orders'!B2:B101");
  const keys = ["4.1", "4.2", "004", "4", 4, 4.1, " Ab  C ", "4.5", "-07"];
  const keys2 = ["x1", "", "4.0", "C-1"];
  assert.deepEqual(
    [...keys, ...keys2].map((key) => evaluateKey(formula, key)),
    ["4.1", "4.2", "4", "4", "4", "4.1", "ab c", "4.5", "-7"].concat([
      "x1",
      "",
      "4",
      "c-1",
    ]),
  );
  for (const key of [...keys, ...keys2, true, "007abc", "1e3", "0x10"])
    assert.equal(
      evaluateKey(formula, key as string),
      combineKey(key),
      String(key),
    );
});
