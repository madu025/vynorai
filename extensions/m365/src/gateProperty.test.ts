/**
 * Seeded adversarial simulation of the agent-team gate and the staging guards: random sheets and
 * random staged plans that are WRONG or RIGHT by construction, checked against a fake host.
 * Invariants:
 *  1. A wrong plan is never "low risk with no issue" (the reviewers are never skipped unflagged).
 *  2. A right plain aggregate produces no rule issue (no false alarm), and a clean one is fast-pathed.
 *  3. Nothing throws on odd input.
 *  4. Row parsing of addresses with $ and sheet-qualified forms.
 *  5. readRank / parseIdeas never throw and never return a rank outside 1..100.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { AgentToolError, clampReadAddress, type AgentHost, type StagedChange } from "./agent.js";
import { guardCombine } from "./combineGuard.js";
import { columnStats, ideasRequest, parseIdeas, rankCategories, rankMeasures } from "./exploreIdeas.js";
import { lintChanges } from "./formulaLint.js";
import { readRank } from "./intent.js";
import { evaluateJoins } from "./resultCheck.js";
import { reviewRisk, rowsOf } from "./reviewRisk.js";
import { checkSimpleFormulas, isSimpleAggregate, overwritesExisting } from "./simpleChecks.js";

// ---------- seeded random ----------
function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1));
  const pick = <T>(items: readonly T[]): T => items[int(0, items.length - 1)];
  const chance = (p: number) => next() < p;
  return { next, int, pick, chance };
}
type Rng = ReturnType<typeof rng>;

// ---------- A1 helpers ----------
const colNum = (letters: string) => [...letters.toUpperCase()].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
const colLetters = (n: number) => {
  let out = "";
  for (let v = n; v > 0; v = Math.floor((v - 1) / 26)) out = String.fromCharCode(65 + ((v - 1) % 26)) + out;
  return out;
};

// ---------- fake host ----------
class Book {
  sheets = new Set<string>();
  values = new Map<string, unknown>();
  formulas = new Map<string, string>();
  key = (sheet: string, col: string, row: number) => `${sheet}|${col.toUpperCase()}${row}`;
  set(sheet: string, col: string, row: number, value: unknown, formula?: string) {
    this.sheets.add(sheet);
    this.values.set(this.key(sheet, col, row), value);
    if (formula) this.formulas.set(this.key(sheet, col, row), formula);
  }
  get(sheet: string, col: string, row: number) {
    return this.values.get(this.key(sheet, col, row));
  }
  filled(sheet: string, col: string, row: number) {
    const v = this.get(sheet, col, row);
    return v !== undefined && v !== null && String(v).trim() !== "";
  }
  host(): AgentHost {
    return {
      getWorkbook: async () => ({}),
      calculate: async () => 0,
      checkStep: async () => ({ ok: true, understood: "" }),
      readRange: async (sheet: string, address: string, withFormulas: boolean) => {
        if (!this.sheets.has(sheet)) throw new Error("no such sheet");
        const m = /^\$?([A-Za-z]{1,3})\$?(\d+)(?::\$?([A-Za-z]{1,3})\$?(\d+))?$/.exec(address.trim());
        if (!m) throw new Error(`bad address ${address}`);
        const c1 = colNum(m[1]);
        const r1 = Number(m[2]);
        const c2 = m[3] ? colNum(m[3]) : c1;
        const r2 = m[4] ? Number(m[4]) : r1;
        const [ca, cb] = [Math.min(c1, c2), Math.max(c1, c2)];
        const [ra, rb] = [Math.min(r1, r2), Math.max(r1, r2)];
        if (cb > 16384 || rb > 1048576 || ra < 1) throw new Error("out of the sheet");
        if ((cb - ca + 1) * (rb - ra + 1) > 400_000) throw new Error("too big");
        const values: unknown[][] = [];
        const formulas: unknown[][] = [];
        for (let r = ra; r <= rb; r++) {
          const vr: unknown[] = [];
          const fr: unknown[] = [];
          for (let c = ca; c <= cb; c++) {
            const k = this.key(sheet, colLetters(c), r);
            const v = this.values.get(k);
            vr.push(v === undefined ? "" : v);
            fr.push(this.formulas.get(k) ?? (v === undefined ? "" : v));
          }
          values.push(vr);
          formulas.push(fr);
        }
        return { address, values, ...(withFormulas ? { formulas } : {}) };
      },
    } as AgentHost;
  }
}

// ---------- random sheet ----------
interface World {
  book: Book;
  sheet: string;
  col: string;
  /** Header row, first/last numeric row of the data span. */
  h: number;
  first: number;
  last: number;
  blankGap: boolean;
  textGap: boolean;
  /** Row of an existing total below the data (a formula), if any. */
  totalRow?: number;
  /** Row of a year above the header, if any. */
  yearRow?: number;
  numericRows: number[];
}

const SHEETS = ["Data", "Sales 2024", "O'Brien", "Données", "売上", "A B", "Q1-Q2", "x"];
const DATA_COLS = ["B", "C", "D", "Z", "AA", "AB", "ABC"];

function makeWorld(r: Rng): World {
  const book = new Book();
  const sheet = r.pick(SHEETS);
  const col = r.pick(DATA_COLS);
  const h = r.int(1, 4);
  const n = r.int(4, 40);
  const first = h + 1;
  let last = first + n - 1;
  book.set(sheet, "A", h, "Region");
  book.set(sheet, col, h, "Amount");
  const sibling = colLetters(colNum(col) + 1);
  book.set(sheet, sibling, h, "Cost");
  let yearRow: number | undefined;
  if (h > 1 && r.chance(0.4)) {
    yearRow = h - 1;
    book.set(sheet, col, yearRow, 2024);
  }
  let blankGap = false;
  let textGap = false;
  const gapAt = n >= 8 && r.chance(0.35) ? r.int(first + 2, last - 3) : -1;
  const gapLen = gapAt > 0 ? r.int(1, 2) : 0;
  const numericRows: number[] = [];
  for (let row = first; row <= last; row++) {
    book.set(sheet, "A", row, `Name ${row}`);
    if (gapAt > 0 && row >= gapAt && row < gapAt + gapLen) {
      if (r.chance(0.5)) {
        blankGap = true;
        if (r.chance(0.5)) book.set(sheet, col, row, "");
      } else {
        textGap = true;
        book.set(sheet, col, row, "n/a");
      }
    } else {
      const value = r.chance(0.3) ? r.int(1, 99) + r.int(0, 99) / 100 : r.int(-50, 5000);
      book.set(sheet, col, row, value);
      numericRows.push(row);
    }
    book.set(sheet, sibling, row, r.int(1, 900));
  }
  let totalRow: number | undefined;
  if (r.chance(0.2)) {
    totalRow = last + 1;
    book.set(sheet, "A", totalRow, "Total");
    book.set(sheet, col, totalRow, 12345, `=SUM(${col}${first}:${col}${last})`);
  }
  if (r.chance(0.15)) book.set(sheet, "A", last + 6, "Prepared by Ann");
  last = numericRows[numericRows.length - 1];
  return { book, sheet, col, h, first: numericRows[0], last, blankGap, textGap, totalRow, yearRow, numericRows };
}

// ---------- plan building ----------
type Wrapped = { change: StagedChange };
const wrap = (change: StagedChange): Wrapped => ({ change });
const FNS = ["SUM", "AVERAGE", "COUNT", "MAX", "MIN", "MEDIAN"];

function ref(r: Rng, col: string, row: number, mode: number) {
  const c = mode & 1 ? `$${col}` : col;
  const w = mode & 2 ? `$${row}` : `${row}`;
  return `${c}${w}`;
}

/** Aggregate formula text over col rows a..b, with style variations that stay a plain aggregate. */
function aggText(r: Rng, fn: string, col: string, a: number, b: number) {
  const mode = r.int(0, 3);
  let text = `${r.pick(FNS.includes(fn) ? [fn] : [fn])}(${ref(r, col, a, mode)}${r.chance(0.2) ? " : " : ":"}${ref(r, col, b, mode)})`;
  if (r.chance(0.2)) text = text.replace("(", "( ").replace(/\)$/, " )");
  if (r.chance(0.25)) text = text.toLowerCase();
  return `${r.chance(0.1) ? "= " : "="}${text}`;
}

const noise = (r: Rng, w: World): Wrapped[] => {
  const out: Wrapped[] = [];
  const kinds = r.int(0, 2);
  const created = `Summary ${r.int(1, 9)}`;
  if (kinds >= 1 && r.chance(0.5)) {
    out.push(wrap({ kind: "create_sheet", name: created }));
    if (r.chance(0.5))
      out.push(wrap({ kind: "write_values", sheet: created, cell: "A1", values: [["Region", "Amount"]] }));
  } else if (kinds >= 1) {
    out.push(wrap({ kind: "format_range", sheet: w.sheet, address: `${w.col}${w.h}:${w.col}${w.h}`, bold: true }));
  }
  return out;
};

type Expect = "wrong" | "right";
interface Plan {
  changes: Wrapped[];
  expect: Expect;
  kind: string;
  /** For a right plan: no gap or hidden hazard, so it must also be fast-pathed. */
  clean: boolean;
}

function emptyCell(w: World, col: string, row: number) {
  return row >= 1 && !w.book.filled(w.sheet, col, row);
}

function formulaChange(w: World, cell: string, formula: string): Wrapped {
  return wrap({ kind: "write_formula", sheet: w.sheet, cell, formula });
}

function makePlan(r: Rng, w: World): Plan | undefined {
  const fn = r.pick(FNS);
  const { sheet, col, first, last, h } = w;
  const kind = r.pick([
    "right-under", "right-above", "right-far", "right-reversed",
    "short", "late", "wrong-col", "typed-total", "overwrite-values", "overwrite-formula",
    "circular", "includes-total", "right-with-noise",
  ] as const);
  const underRow = w.totalRow === last + 1 || w.totalRow !== undefined ? last + 3 : last + 1;
  const side = colLetters(colNum(col) + 1);
  const base = (cell: string, text: string, expect: Expect, clean = true): Plan => ({
    changes: [formulaChange(w, cell, text)],
    expect,
    kind,
    clean: clean && !w.blankGap && !w.textGap,
  });
  switch (kind) {
    case "right-under":
      if (!emptyCell(w, col, underRow)) return undefined;
      return base(`${col}${underRow}`, aggText(r, fn, col, first, last), "right");
    case "right-above": {
      if (!(h >= 3) || !emptyCell(w, col, 1)) return undefined;
      return base(`${col}1`, aggText(r, fn, col, first, last), "right");
    }
    case "right-far": {
      const far = colLetters(colNum(col) + 4);
      const row = r.chance(0.5) ? last + 3 : 1;
      if (!emptyCell(w, far, row)) return undefined;
      return base(`${far}${row}`, aggText(r, fn, col, first, last), "right");
    }
    case "right-reversed": {
      if (!emptyCell(w, col, underRow)) return undefined;
      return base(`${col}${underRow}`, aggText(r, fn, col, last, first), "right");
    }
    case "right-with-noise": {
      if (!emptyCell(w, col, underRow)) return undefined;
      const p = base(`${col}${underRow}`, aggText(r, fn, col, first, last), "right");
      p.changes.push(...noise(r, w));
      return p;
    }
    case "short": {
      // One row short of the data; the result sits under the data (or beside the sheet).
      if (w.blankGap || w.textGap) return undefined; // gaps make "short" ambiguous
      const end = last - 1;
      if (end <= first) return undefined;
      const cell = r.chance(0.5) ? `${col}${last + 1}` : `${colLetters(colNum(col) + 4)}1`;
      const row = Number(/\d+/.exec(cell)![0]);
      if (!emptyCell(w, cell.replace(/\d+$/, ""), row) || w.totalRow === last + 1) return undefined;
      return base(cell, aggText(r, fn, col, first, end), "wrong");
    }
    case "late": {
      if (w.blankGap || w.textGap) return undefined;
      const start = first + 1;
      if (start >= last) return undefined;
      const cell = r.chance(0.5) ? `${col}${last + 1}` : `${colLetters(colNum(col) + 4)}1`;
      const row = Number(/\d+/.exec(cell)![0]);
      if (!emptyCell(w, cell.replace(/\d+$/, ""), row) || w.totalRow === last + 1) return undefined;
      return base(cell, aggText(r, fn, col, start, last), "wrong");
    }
    case "wrong-col": {
      // Under the data, in a column the range is not about (beside the data).
      if (w.totalRow !== undefined) return undefined;
      const other = r.pick([side, colLetters(colNum(col) + 2), "A"]);
      return base(`${other}${last + 1}`, aggText(r, fn, col, first, last), "wrong");
    }
    case "typed-total": {
      const label = r.pick([
        "Total", "TOTAL", "Grand Total", "Subtotal", "Total:", "Sum", "Average", "Balance",
        "Totals", "Total sales", "Sub-total", "Grand total:", "Total Amount",
      ]);
      const number = r.pick<string | number>([1120, 4500.5, "1,120", "12.5%", 0, -300, "1120", "$1,120", "Rs. 1,120", "(1,120)"]);
      const row = r.chance(0.5) ? [label, number] : [number, label];
      const createdSheet = r.chance(0.15);
      const target = createdSheet ? "Totals" : sheet;
      const p: Plan = {
        changes: [
          ...(createdSheet ? [wrap({ kind: "create_sheet", name: target })] : []),
          wrap({ kind: "write_values", sheet: target, cell: createdSheet ? "A1" : `A${last + 8}`, values: [row] }),
        ],
        expect: "wrong",
        kind,
        clean: false,
      };
      return p;
    }
    case "overwrite-values": {
      const rows = r.int(1, 3);
      const row = r.pick(w.numericRows);
      const c = r.pick(["A", col]);
      return {
        changes: [wrap({ kind: "write_values", sheet, cell: `${c}${row}`, values: Array.from({ length: rows }, () => ["x"]) })],
        expect: "wrong",
        kind,
        clean: false,
      };
    }
    case "overwrite-formula": {
      // A plain total written over a filled label cell.
      const row = r.pick(w.numericRows);
      return base(`A${row}`, aggText(r, fn, col, first, last), "wrong", false);
    }
    case "circular": {
      // The result sits inside its own range (on a blank row of the data, or just past its end).
      const inside = r.int(first, last + 1);
      if (w.book.filled(sheet, col, inside)) return undefined;
      return base(`${col}${inside}`, aggText(r, fn, col, first, Math.max(inside, last)), "wrong", false);
    }
    case "includes-total": {
      // The range runs over an existing total (counted twice).
      if (w.totalRow === undefined) return undefined;
      const far = colLetters(colNum(col) + 4);
      if (!emptyCell(w, far, 1)) return undefined;
      return base(`${far}1`, aggText(r, "SUM", col, first, w.totalRow), "wrong", false);
    }
  }
}

// ---------- the gate, as runTeam + reviewAndRevise compute it ----------
async function gate(changes: Wrapped[], host: AgentHost) {
  const risk = reviewRisk(changes);
  const over = await overwritesExisting(changes, host).catch(() => true);
  const simple = await checkSimpleFormulas(changes, host);
  const issues = [...lintChanges(changes), ...(await evaluateJoins(changes, host)), ...simple.issues];
  const lowRisk = !risk.high && !over && !simple.unverified;
  return { risk, over, simple, issues, lowRisk, skippedUnflagged: lowRisk && issues.length === 0 };
}

const describe = (seed: number, plan: Plan, w: World) =>
  `seed ${seed} kind ${plan.kind} col ${w.col} h ${w.h} data ${w.first}-${w.last} gaps ${w.blankGap}/${w.textGap} total ${w.totalRow}\n` +
  plan.changes.map((c) => JSON.stringify(c.change)).join("\n");

test("random plans: a wrong plan never skips the reviewers unflagged; a right plan raises no rule issue", async () => {
  const failures: string[] = [];
  const stats: Record<string, { n: number; skipped: number }> = {};
  let plans = 0;
  for (let seed = 1; seed <= 2500 && failures.length < 12; seed++) {
    const r = rng(seed);
    const w = makeWorld(r);
    const plan = makePlan(r, w);
    if (!plan) continue;
    plans++;
    const host = w.book.host();
    const g = await gate(plan.changes, host);
    const s = (stats[plan.kind] ??= { n: 0, skipped: 0 });
    s.n++;
    if (g.skippedUnflagged) s.skipped++;
    if (plan.expect === "wrong" && g.skippedUnflagged)
      failures.push(`WRONG PLAN SKIPPED UNFLAGGED: ${describe(seed, plan, w)}`);
    if (plan.expect === "right") {
      if (g.issues.length) failures.push(`FALSE ALARM ${JSON.stringify(g.issues)}: ${describe(seed, plan, w)}`);
      if (plan.clean && !g.skippedUnflagged && plan.changes.length <= 3)
        failures.push(`CLEAN RIGHT PLAN NOT FAST-PATHED (risk ${g.risk.reason} over ${g.over} unverified ${g.simple.unverified}): ${describe(seed, plan, w)}`);
    }
  }
  if (process.env.GATE_STATS) console.log(plans, JSON.stringify(stats));
  assert.ok(plans >= 500, `only ${plans} plans generated`);
  assert.deepEqual(failures, [], failures.join("\n---\n"));
});

// ---------- (3) odd input never throws ----------
test("odd cells, columns, rows, sheet names and long formulas never throw", async () => {
  const book = new Book();
  const names = ["Data", "it's", "A B", "Données", "売上", "x'y", "Sheet ''1", "😀"];
  for (const name of names) {
    book.set(name, "B", 1, "H");
    for (let row = 2; row <= 6; row++) book.set(name, "B", row, row);
  }
  const host = book.host();
  const cells = [
    "B7", "b7", "$B$7", "AA7", "ABC7", "XFD1048576", "ZZZ1", "A1000000", "B0", "", "B", "7", "Data!B7", "B7:B8", "  B7 ", "$$B7",
  ];
  const formulas = [
    "=SUM(B2:B6)", "=sum(b2:b6)", "=SUM($B$2:$B$6)", "=SUM(B2:C6)", "=SUM(B6:B2)", "=SUM(AA2:AA6)", "=SUM(ABC2:ABC1000000)",
    "=SUM(B2:B6", "SUM(B2:B6)", "=", "", "=SUM()", "=SUM(B:B)", "=SUM(Data!B2:B6)", "=SUM(B2:B6)+1", "=SUM(B2:B6,B8)", "=AVERAGE( B2 : B6 )",
    "=SUM(B2:B6)".repeat(2000), "=" + "(".repeat(20000), "=GROUPBY(" .repeat(900), "=SUM(" + "B2:B6,".repeat(5000) + ")", "=" + " ".repeat(100000) + "SUM(B2:B6)",
    "=SUM(B2:B6)" + " ".repeat(100000) + "x", '=SUM("B2:B6")', "=SUM(B2:B6)\n", "=SUM( B2:B6)", "=SUM(B2:B6)​",
  ];
  const t0 = Date.now();
  for (const sheet of ["it's", "Données", "😀"])
    for (const cell of cells)
      for (const formula of formulas) {
        const changes: Wrapped[] = [
          wrap({ kind: "write_formula", sheet, cell, formula }),
          wrap({ kind: "write_formula", sheet, cell, formula, fillRange: cell + ":" + cell }),
        ];
        isSimpleAggregate(changes[0].change as never);
        reviewRisk(changes);
        lintChanges(changes);
        await checkSimpleFormulas(changes, host);
        await overwritesExisting(changes, host);
        await evaluateJoins(changes, host);
      }
  const valueSets: (string | number | boolean | null)[][][] = [
    [[null]], [[null, null], [null, null]], [[]], [[], []], [["Total", null]], [[1e308, "Total"]], [[NaN, "Sum"]], [[Infinity, "total"]],
    [["x".repeat(40000)]], Array.from({ length: 200 }, () => [1]), [[true, "Total", false]], [["\u0000", "Total", "5"]],
  ];
  for (const sheet of names)
    for (const cell of cells)
      for (const values of valueSets) {
        const changes = [wrap({ kind: "write_values", sheet, cell, values })];
        reviewRisk(changes);
        await overwritesExisting(changes, host);
        await checkSimpleFormulas(changes, host);
      }
  assert.ok(Date.now() - t0 < 20000, "odd inputs took too long (possible regex or loop blow-up)");
  // A host that returns junk or fails: the change is unverified or goes to the reviewers, never a throw.
  const junk: unknown[] = [undefined, null, {}, { values: null }, { values: [null] }, { values: [[{}]] }, { values: "x" }, { values: [[1, 2]] }, { values: [[[1]]] }];
  for (const result of junk) {
    const bad = { readRange: async () => result, calculate: async () => result } as unknown as AgentHost;
    const change = [wrap({ kind: "write_formula", sheet: "Data", cell: "B7", formula: "=SUM(B2:B6)" })];
    const simple = await checkSimpleFormulas(change, bad);
    const over = await overwritesExisting(change, bad);
    assert.ok(simple.unverified || simple.issues.length, `junk ${JSON.stringify(result)} was trusted by checkSimpleFormulas`);
    assert.equal(typeof over, "boolean");
  }
  const failing = { readRange: async () => { throw new Error("boom"); }, calculate: async () => { throw new Error("boom"); } } as unknown as AgentHost;
  const one = [wrap({ kind: "write_formula", sheet: "Data", cell: "B7", formula: "=SUM(B2:B6)" })];
  assert.equal((await checkSimpleFormulas(one, failing)).unverified, true);
  assert.equal(await overwritesExisting(one, failing), true);
});

test("evaluateJoins and guardCombine only ever throw AgentToolError, on any args", async () => {
  const r = rng(77);
  const weird: unknown[] = [undefined, null, "", "Data", "A1:C5", "A:A", "$A$1:$C$9", "Z9:A1", 5, {}, [], "X".repeat(5000), "join", "append", "reconcile", "Sheet!A1"];
  const book = new Book();
  book.set("Data", "A", 1, "Key");
  book.set("Data", "B", 1, "Amount");
  for (let row = 2; row < 20; row++) {
    book.set("Data", "A", row, `k${row % 5}`);
    book.set("Data", "B", row, row);
  }
  const host = book.host();
  for (let i = 0; i < 600; i++) {
    const args: Record<string, unknown> = {};
    for (const k of ["mode", "sheet", "cell", "left_sheet", "left_address", "right_sheet", "right_address", "key", "right_key", "amount", "right_amount", "columns"])
      args[k] = r.chance(0.2) ? undefined : r.pick(weird);
    if (r.chance(0.4)) {
      args.left_sheet = args.right_sheet = "Data";
      args.left_address = args.right_address = r.pick(["A1:B19", "A:B", "$A$1:$B$19", "A1:B999999"]);
      args.key = r.pick(["Key", "key ", "Amount", "nope"]);
    }
    await evaluateJoins([wrap({ kind: "excel_action", tool: "combine_tables", args } as StagedChange)], host);
    try {
      await guardCombine(args, host, clampReadAddress);
    } catch (error) {
      if (error instanceof AgentToolError) continue;
      // clampReadAddress throws AgentToolError for a bad address; anything else is a bug.
      assert.fail(`guardCombine threw ${(error as Error)?.constructor?.name}: ${(error as Error)?.message} for ${JSON.stringify(args)}`);
    }
  }
});

// ---------- (4) row parsing ----------
test("rowsOf reads the row count of plain, absolute and sheet-qualified ranges", () => {
  const cases: [string, number][] = [
    ["A2:A100", 99], ["a2:a100", 99], ["$A$2:$A$100", 99], ["A$2:A$100", 99], ["$A2:$A100", 99],
    ["Sheet1!A2:A100", 99], ["Sheet1!$A$2:$A$100", 99], ["'My Sheet'!$A$2:$A$100", 99], ["'it''s 2'!A2:A11", 10],
    ["AA5:AB5", 1], ["ABC1:ABC1000000", 1000000], ["A5", 1], ["$A$5", 1], ["Sheet2!B7", 1], ["'Q1 2024'!$B$7", 1], ["A100:A2", 99],
  ];
  for (const [address, rows] of cases) assert.equal(rowsOf(address), rows, address);
  for (const address of ["A:A", "", "garbage", "Sheet1!A:A"]) assert.equal(rowsOf(address), Number.POSITIVE_INFINITY, address);
});

test("a total whose cell is written with $ or lowercase letters is still checked on the right cell", async () => {
  const book = new Book();
  book.set("Data", "B", 1, "Amount");
  for (let row = 2; row <= 11; row++) book.set("Data", "B", row, row);
  const host = book.host();
  for (const cell of ["B12", "$B$12", "b12", "$b12"]) {
    const ok = await checkSimpleFormulas([formula(cell, "=SUM(B2:B11)")], host);
    assert.deepEqual(ok.issues, [], cell);
    const short = await checkSimpleFormulas([formula(cell, "=SUM(B2:B10)")], host);
    assert.match(short.issues[0] ?? "", /stops at row 10/, cell);
    const wrongColumn = await checkSimpleFormulas([formula(cell.replace(/b/i, "C"), "=SUM(B2:B11)")], host);
    assert.match(wrongColumn.issues[0] ?? "", /result sits under column C/, cell);
  }
});

const formula = (cell: string, text: string, sheet = "Data"): Wrapped =>
  wrap({ kind: "write_formula", sheet, cell, formula: text });

// ---------- regression tests for bugs this simulation found ----------
test("regression: a total above its data in the same column is not 'no numbers'", async () => {
  const book = new Book();
  book.set("Data", "B", 2, "Amount");
  for (let row = 3; row <= 8; row++) book.set("Data", "B", row, row);
  const host = book.host();
  assert.deepEqual((await checkSimpleFormulas([formula("B1", "=SUM(B3:B8)")], host)).issues, []);
  assert.match((await checkSimpleFormulas([formula("B1", "=SUM(B3:B7)")], host)).issues[0] ?? "", /stops at row 7/);
});

test("regression: a total inside its own range is a circular reference", async () => {
  const book = new Book();
  book.set("Data", "B", 1, "Amount");
  for (let row = 2; row <= 6; row++) book.set("Data", "B", row, row);
  const host = book.host();
  const past = await gate([formula("B7", "=SUM(B2:B7)")], host);
  assert.equal(past.skippedUnflagged, false);
  assert.match(past.issues.join(" "), /own cell|circular/i);
  const gap = await gate([formula("B4", "=SUM(B2:B6)")], host);
  assert.equal(gap.skippedUnflagged, false);
});

test("regression: a reversed range is the same range", async () => {
  const book = new Book();
  book.set("Data", "B", 1, "Amount");
  for (let row = 2; row <= 6; row++) book.set("Data", "B", row, row);
  assert.deepEqual((await checkSimpleFormulas([formula("B7", "=SUM(B6:B2)")], book.host())).issues, []);
});

test("regression: an existing total (formula) is not data, and a range that includes it is flagged", async () => {
  const book = new Book();
  book.set("Data", "B", 1, "Amount");
  for (let row = 2; row <= 6; row++) book.set("Data", "B", row, row);
  book.set("Data", "B", 7, 20, "=SUM(B2:B6)");
  const host = book.host();
  assert.deepEqual((await checkSimpleFormulas([formula("D1", "=AVERAGE(B2:B6)")], host)).issues, []);
  const twice = await checkSimpleFormulas([formula("D1", "=SUM(B2:B7)")], host);
  assert.match(twice.issues[0] ?? "", /row 7/);
});

test("regression: data past the rows the check reads is never 'verified'", async () => {
  const book = new Book();
  book.set("Data", "B", 1, "Amount");
  for (let row = 2; row <= 5000; row++) book.set("Data", "B", row, 1);
  const out = await gate([formula("D1", "=SUM(B2:B5000)")], book.host());
  assert.equal(out.skippedUnflagged, false);
});

test("regression: numbers after a short blank gap send the total to the reviewers", async () => {
  const book = new Book();
  book.set("Data", "B", 1, "Amount");
  for (const row of [2, 3, 4, 5, 8, 9, 10]) book.set("Data", "B", row, row);
  const host = book.host();
  assert.equal((await gate([formula("D1", "=SUM(B2:B5)")], host)).skippedUnflagged, false);
  assert.equal((await gate([formula("D1", "=SUM(B8:B10)")], host)).skippedUnflagged, false);
  assert.deepEqual((await gate([formula("D1", "=SUM(B2:B10)")], host)).issues, []);
});

test("regression: a year above the header does not block the fast path or raise an alarm", async () => {
  const book = new Book();
  book.set("Data", "B", 1, 2024);
  book.set("Data", "B", 2, "Amount");
  for (let row = 3; row <= 8; row++) book.set("Data", "B", row, row);
  const out = await gate([formula("B9", "=SUM(B3:B8)")], book.host());
  assert.deepEqual(out.issues, []);
  assert.equal(out.skippedUnflagged, true);
});

test("regression: typed-in totals with a plural label or a currency sign are caught", () => {
  for (const row of [["Totals", 1120], ["Total", "$1,120"], ["Total", "Rs. 1,120"], ["Total", "(1,120)"], ["Grand total:", "1 120"], ["Sub-total", 5]]) {
    assert.equal(
      reviewRisk([wrap({ kind: "write_values", sheet: "Data", cell: "A12", values: [row] })]).high,
      true,
      JSON.stringify(row),
    );
  }
  // A plain label with a word that only starts like a total word stays quick.
  assert.equal(reviewRisk([wrap({ kind: "write_values", sheet: "Data", cell: "A12", values: [["Totally new", "x"]] })]).high, false);
});

// ---------- (5) parsers ----------
const WORDS = [
  "top", "bottom", "best", "worst", "lowest", "highest", "least", "at least", "at", "5", "five", "05", "100", "101", "0", "00", "007", "1000", "999999999999999999999",
  "%", "percent", "5%", "10 %", "regions", "products", "customers", "by", "of", "the", "sales", "show", "me", "and", "then", "ten", "one", "1e2", "3.5", "-4", "NaN",
  "constructor", "toString", "__proto__", "ශ්‍රී", "ලංකා", "😀", "\n", "\t", ",", ".", ";", "(", ")", "'", '"', "Q4", "2024", "10th", "x".repeat(300),
];

test("readRank never throws and never returns a rank outside 1..100", () => {
  const r = rng(5);
  for (let i = 0; i < 4000; i++) {
    const text = Array.from({ length: r.int(0, 14) }, () => r.pick(WORDS)).join(r.chance(0.8) ? " " : r.pick(["", "  ", "\n", "-"]));
    const got = readRank(text);
    if (!got) continue;
    assert.ok(Number.isInteger(got.topN) && got.topN >= 1 && got.topN <= 100, `${JSON.stringify(text)} -> ${got.topN}`);
    assert.equal(typeof got.lowest, "boolean");
    assert.ok(got.end > 0 && got.end <= text.length, `${JSON.stringify(text)} end ${got.end}`);
  }
  assert.equal(readRank("top 5%"), undefined);
  assert.equal(readRank("top 5 percent of sales"), undefined);
  assert.equal(readRank("top 1000 customers"), undefined);
  assert.equal(readRank("top 0 customers"), undefined);
  assert.equal(readRank("at least 5 customers"), undefined);
  assert.equal(readRank("top 100 customers")?.topN, 100);
  assert.equal(readRank("Five Best regions")?.topN, 5);
  assert.equal(readRank(String(undefined)), undefined);
});

test("parseIdeas, columnStats, rankMeasures, rankCategories and ideasRequest survive random input", () => {
  const r = rng(9);
  for (let i = 0; i < 1500; i++) {
    const lines = Array.from({ length: r.int(0, 8) }, () =>
      `${r.pick(["- ", "* ", "• ", "1. ", "2) ", "", "  - ", "-", "- =", "-+", "- @"])}${Array.from({ length: r.int(0, 12) }, () => r.pick(WORDS)).join(" ")}`,
    );
    const ideas = parseIdeas(lines.join(r.pick(["\n", "\r\n", "\n\n"])));
    assert.ok(ideas.length <= 4);
    for (const idea of ideas) {
      assert.ok(idea.length >= 8 && idea.length <= 160);
      assert.ok(!/^[=+@]/.test(idea), idea);
    }
  }
  for (const odd of [undefined, null, 5, {}, [], "x".repeat(100000)]) assert.doesNotThrow(() => parseIdeas(odd as never));
  const headers = ["constructor", "__proto__", "toString", "hasOwnProperty", "valueOf", "Amount", "", "  ", "amount", null, undefined, "AMOUNT "] as unknown as string[];
  const rows = [[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], [NaN, Infinity, "x", null, undefined, {}, [], 1.5, "", " ", true, 0], []];
  const stats = columnStats(headers, rows);
  for (const name of ["constructor", "__proto__", "toString", "hasOwnProperty", "valueOf", "Amount"]) {
    const stat = (stats as Record<string, any>)[name];
    assert.ok(stat && typeof stat.rows === "number" && Object.prototype.hasOwnProperty.call(stats, name), `no own stats for header "${name}"`);
  }
  const names = headers.map((h) => String(h ?? ""));
  assert.equal(rankMeasures(names, stats).length, names.length);
  assert.ok(Array.isArray(rankCategories(names, stats)));
  const request = ideasRequest(names.map((name) => ({ name, role: "text" })), stats);
  assert.ok(!/undefined|NaN/.test(request), request);
});
