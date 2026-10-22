import assert from "node:assert/strict";
import { test } from "node:test";
import {
  APIT_MONTHLY,
  apitFor,
  needsReview,
  rateOn,
  ratesCover,
  ratesOn,
  type ApitBand,
} from "./lkTaxRates.js";
import {
  amount,
  buildPayrollPlan,
  columnName,
  employeesFromSelection,
  isPayrollRequest,
  mapPayrollColumns,
  monthFromRequest,
  payrollMonth,
  type PayrollCell,
  type PayrollEmployee,
  type PayrollPlan,
} from "./payroll.js";

// ---------------------------------------------------------------------------------------------
// A small spreadsheet evaluator for exactly the formula forms buildPayrollPlan writes:
// refs (A1, $P$5), ranges, + - * >, parentheses, numbers, SUM, ROUND, SUMPRODUCT.
// It follows Excel: empty cells are 0, text in arithmetic is #VALUE!, comparisons give booleans
// that SUMPRODUCT ignores unless "--" turns them into numbers, ROUND is half away from zero.
// ---------------------------------------------------------------------------------------------

type Scalar = number | string | boolean;
type Value = Scalar | Scalar[];

class Grid {
  private cells = new Map<string, PayrollCell>();
  private cache = new Map<string, Scalar>();
  private busy = new Set<string>();

  static of(plan: PayrollPlan): Grid {
    const grid = new Grid();
    for (const block of plan.blocks)
      block.cells.forEach((cells, dr) =>
        cells.forEach((cell, dc) =>
          grid.set(block.row + dr, block.col + dc, cell),
        ),
      );
    return grid;
  }

  set(row: number, col: number, cell: PayrollCell): void {
    this.cells.set(`${row},${col}`, cell);
    this.cache.clear();
  }

  raw(row: number, col: number): PayrollCell | undefined {
    return this.cells.get(`${row},${col}`);
  }

  /** The cell's value; an empty cell (or "" written to it) is "". */
  value(row: number, col: number): Scalar {
    const key = `${row},${col}`;
    const cached = this.cache.get(key);
    if (cached !== undefined) return cached;
    const cell = this.cells.get(key);
    let result: Scalar;
    if (cell === undefined) result = "";
    else if (typeof cell === "object") {
      if (this.busy.has(key)) throw new Error(`circular reference at ${key}`);
      this.busy.add(key);
      try {
        const v = evaluate(cell.f, this);
        if (Array.isArray(v)) throw new Error(`#VALUE! array result at ${key}`);
        result = v;
      } finally {
        this.busy.delete(key);
      }
    } else result = cell;
    this.cache.set(key, result);
    return result;
  }

  /** Numeric value of a cell named like "F5"; throws when it is not a number. */
  num(ref: string): number {
    const { row, col } = parseRef(ref);
    const v = this.value(row, col);
    if (typeof v !== "number" || !Number.isFinite(v))
      throw new Error(`${ref} is not a number: ${String(v)}`);
    return v;
  }
}

function colNumber(letters: string): number {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

function parseRef(ref: string): { row: number; col: number } {
  const m = /^\$?([A-Z]+)\$?(\d+)$/.exec(ref);
  if (!m) throw new Error(`bad ref ${ref}`);
  return { row: Number(m[2]), col: colNumber(m[1]) };
}

type Token =
  | { t: "num"; v: number }
  | { t: "ref"; v: string }
  | { t: "fn"; v: string }
  | { t: "op"; v: string };

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  const re =
    /\s*(?:(\d+(?:\.\d+)?)|(\$?[A-Z]+\$?\d+)|([A-Z]+)(?=\()|([-+*>(),:]))/y;
  let pos = 0;
  while (pos < src.length) {
    re.lastIndex = pos;
    const m = re.exec(src);
    if (!m) throw new Error(`cannot tokenize at ${pos}: ${src.slice(pos)}`);
    if (m[1] !== undefined) tokens.push({ t: "num", v: Number(m[1]) });
    else if (m[2] !== undefined) tokens.push({ t: "ref", v: m[2] });
    else if (m[3] !== undefined) tokens.push({ t: "fn", v: m[3] });
    else tokens.push({ t: "op", v: m[4] });
    pos = re.lastIndex;
  }
  return tokens;
}

/** Excel's ROUND: on the 15-significant-digit value, half away from zero. */
function excelRound(x: number, digits: number): number {
  const scale = 10 ** digits;
  const scaled = Number((Math.abs(x) * scale).toPrecision(15));
  return (Math.sign(x) * Math.round(scaled)) / scale;
}

function toNumber(v: Scalar): number {
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (v === "") return 0;
  throw new Error(`#VALUE! text in arithmetic: ${v}`);
}

function elementwise(
  a: Value,
  b: Value,
  f: (x: Scalar, y: Scalar) => Scalar,
): Value {
  if (Array.isArray(a) || Array.isArray(b)) {
    const n = Array.isArray(a) ? a.length : (b as Scalar[]).length;
    if (Array.isArray(a) && Array.isArray(b) && a.length !== b.length)
      throw new Error("#N/A array sizes differ");
    return Array.from({ length: n }, (_, i) =>
      f(Array.isArray(a) ? a[i] : a, Array.isArray(b) ? b[i] : b),
    );
  }
  return f(a, b);
}

function evaluate(formula: string, grid: Grid): Value {
  assert.ok(formula.startsWith("="), `formula must start with "=": ${formula}`);
  const tokens = tokenize(formula.slice(1));
  let i = 0;
  const peek = () => tokens[i];
  const isOp = (v: string) => peek()?.t === "op" && peek()!.v === v;
  const expect = (v: string) => {
    if (!isOp(v)) throw new Error(`expected ${v} in ${formula}`);
    i++;
  };

  const comparison = (): Value => {
    let left = additive();
    while (isOp(">")) {
      i++;
      const right = additive();
      left = elementwise(left, right, (x, y) => toNumber(x) > toNumber(y));
    }
    return left;
  };
  const additive = (): Value => {
    let left = term();
    while (isOp("+") || isOp("-")) {
      const op = tokens[i++].v;
      const right = term();
      left = elementwise(left, right, (x, y) =>
        op === "+" ? toNumber(x) + toNumber(y) : toNumber(x) - toNumber(y),
      );
    }
    return left;
  };
  const term = (): Value => {
    let left = unary();
    while (isOp("*")) {
      i++;
      const right = unary();
      left = elementwise(left, right, (x, y) => toNumber(x) * toNumber(y));
    }
    return left;
  };
  const unary = (): Value => {
    if (isOp("-")) {
      i++;
      return elementwise(unary(), 0, (x) => -toNumber(x));
    }
    if (isOp("+")) {
      i++;
      return unary();
    }
    return primary();
  };
  const primary = (): Value => {
    const token = tokens[i++];
    if (!token) throw new Error(`unexpected end of ${formula}`);
    if (token.t === "num") return token.v;
    if (token.t === "ref") {
      const start = parseRef(token.v);
      if (isOp(":")) {
        i++;
        const endToken = tokens[i++];
        if (endToken?.t !== "ref") throw new Error(`bad range in ${formula}`);
        const end = parseRef(endToken.v);
        const out: Scalar[] = [];
        for (let r = start.row; r <= end.row; r++)
          for (let c = start.col; c <= end.col; c++) out.push(grid.value(r, c));
        return out;
      }
      return grid.value(start.row, start.col);
    }
    if (token.t === "fn") {
      expect("(");
      const args: Value[] = [];
      if (!isOp(")")) {
        args.push(comparison());
        while (isOp(",")) {
          i++;
          args.push(comparison());
        }
      }
      expect(")");
      return call(token.v, args);
    }
    if (token.v === "(") {
      const inner = comparison();
      expect(")");
      return inner;
    }
    throw new Error(`unexpected ${token.v} in ${formula}`);
  };

  const result = comparison();
  if (i !== tokens.length) throw new Error(`trailing tokens in ${formula}`);
  return result;
}

function call(name: string, args: Value[]): Value {
  switch (name) {
    case "SUM":
      // SUM skips text and empty cells in ranges.
      return args
        .flatMap((a) => (Array.isArray(a) ? a : [a]))
        .reduce<number>(
          (total, v) => total + (typeof v === "number" ? v : 0),
          0,
        );
    case "ROUND": {
      assert.equal(args.length, 2, "ROUND takes two arguments");
      const [x, d] = args;
      if (Array.isArray(x) || Array.isArray(d))
        throw new Error("#VALUE! ROUND of array");
      return excelRound(toNumber(x), toNumber(d));
    }
    case "SUMPRODUCT": {
      const arrays = args.map((a) => {
        if (!Array.isArray(a))
          throw new Error("#VALUE! SUMPRODUCT needs arrays");
        return a;
      });
      const n = arrays[0].length;
      if (arrays.some((a) => a.length !== n))
        throw new Error("#VALUE! array sizes differ");
      let total = 0;
      for (let k = 0; k < n; k++)
        // Non-numbers (booleans, text) count as 0, as in Excel.
        total += arrays.reduce(
          (p, a) => p * (typeof a[k] === "number" ? (a[k] as number) : 0),
          1,
        );
      return total;
    }
    default:
      throw new Error(`unsupported function ${name}`);
  }
}

// ---------------------------------------------------------------------------------------------
// Helpers for the plan's layout.
// ---------------------------------------------------------------------------------------------

const FIRST_ROW = 5; // employee rows start under the header on row 4
const COL = {
  id: "A",
  name: "B",
  basic: "C",
  epfAllow: "D",
  otherAllow: "E",
  gross: "F",
  epfEmp: "G",
  apit: "H",
  ded: "I",
  net: "J",
  epfEr: "K",
  etf: "L",
  cost: "M",
} as const;

const OCT_2026 = new Date(2026, 9, 1);

function employee(
  basic: number,
  epfAllowances = 0,
  otherAllowances = 0,
  otherDeductions = 0,
  id = "E1",
): PayrollEmployee {
  return {
    id,
    name: `Name ${id}`,
    basic,
    epfAllowances,
    otherAllowances,
    otherDeductions,
  };
}

/** Row (1-based) in column O whose label is `label`. */
function labelRow(grid: Grid, label: string): number {
  for (let row = 1; row < 200; row++)
    if (grid.raw(row, 15) === label) return row;
  throw new Error(`no label ${label}`);
}

function formulas(plan: PayrollPlan): { at: string; f: string }[] {
  const out: { at: string; f: string }[] = [];
  for (const block of plan.blocks)
    block.cells.forEach((cells, dr) =>
      cells.forEach((cell, dc) => {
        if (typeof cell === "object")
          out.push({
            at: `${columnName(block.col + dc)}${block.row + dr}`,
            f: cell.f,
          });
      }),
    );
  return out;
}

/** APIT the sheet computes for a monthly gross pay, via the evaluated H column. */
function sheetApit(pay: number, month: Date): number {
  const plan = buildPayrollPlan({ month, employees: [employee(pay)] });
  return Grid.of(plan).num(`H${FIRST_ROW}`);
}

const close = (actual: number, expected: number, message?: string) =>
  assert.ok(
    Math.abs(actual - expected) < 0.005,
    `${message ?? ""} ${actual} != ${expected}`,
  );

// ---------------------------------------------------------------------------------------------
// 1-2. APIT tables.
// ---------------------------------------------------------------------------------------------

const APIT_2025: [number, number][] = [
  [0, 0],
  [99_999, 0],
  [150_000, 0],
  [150_001, 0.06],
  [200_000, 3_000],
  [233_333.33, 5_000], // 83,333.33 x 6% = 4,999.9998
  [250_000, 8_000], // 4,999.9998 + 16,666.67 x 18% = 8,000.0004
  [275_000, 12_500],
  [316_666.67, 22_500],
  [358_333.33, 35_000],
  [400_000, 50_000],
  [500_000, 86_000],
  [1_000_000, 266_000],
];

test("the 2025-04-01 APIT table has the 150,000 relief and the published band edges", () => {
  const table = ratesOn("2025-04-01").apitMonthly;
  assert.equal(table.from, "2025-04-01");
  assert.deepEqual(table.value, [
    { over: 0, rate: 0 },
    { over: 150_000, rate: 0.06 },
    { over: 233_333.33, rate: 0.18 },
    { over: 275_000, rate: 0.24 },
    { over: 316_666.67, rate: 0.3 },
    { over: 358_333.33, rate: 0.36 },
  ]);
});

test("apitFor matches hand-computed 2025 APIT to the cent", () => {
  const bands = ratesOn("2026-10-01").apitMonthly.value;
  for (const [pay, expected] of APIT_2025)
    assert.equal(apitFor(pay, bands), expected, `pay ${pay}`);
  // 400,000 is the sum of each band's tax.
  const byBand =
    (233_333.33 - 150_000) * 0.06 +
    (275_000 - 233_333.33) * 0.18 +
    (316_666.67 - 275_000) * 0.24 +
    (358_333.33 - 316_666.67) * 0.3 +
    (400_000 - 358_333.33) * 0.36;
  assert.equal(apitFor(400_000, bands), Math.round(byBand * 100) / 100);
});

test("the sheet's SUMPRODUCT APIT formula gives the same answers as apitFor", () => {
  const bands = ratesOn(OCT_2026).apitMonthly.value;
  for (const [pay, expected] of APIT_2025) {
    const sheet = sheetApit(pay, OCT_2026);
    assert.equal(sheet, expected, `sheet APIT for pay ${pay}`);
    assert.equal(sheet, apitFor(pay, bands), `sheet vs apitFor for pay ${pay}`);
  }
});

test("the 2023 table has band edges 100,000 / 141,666.67 / ... / 308,333.33", () => {
  const table = rateOn(APIT_MONTHLY, "2025-03-31");
  assert.equal(table.from, "2023-01-01");
  assert.deepEqual(
    table.value.map((b) => b.over),
    [0, 100_000, 141_666.67, 183_333.33, 225_000, 266_666.67, 308_333.33],
  );
  assert.deepEqual(
    table.value.map((b) => b.rate),
    [0, 0.06, 0.12, 0.18, 0.24, 0.3, 0.36],
  );
});

test("March 2025 uses the 2023 table and April 2025 the 2025 table, on the sheet too", () => {
  const march = new Date(2025, 2, 1);
  const april = new Date(2025, 3, 1);
  assert.equal(
    buildPayrollPlan({ month: march }).rates.apitMonthly.from,
    "2023-01-01",
  );
  assert.equal(
    buildPayrollPlan({ month: april }).rates.apitMonthly.from,
    "2025-04-01",
  );

  const b: ApitBand[] = rateOn(APIT_MONTHLY, "2025-03-01").value;
  const expected2023 =
    Math.round(
      ((b[2].over - b[1].over) * 0.06 +
        (b[3].over - b[2].over) * 0.12 +
        (200_000 - b[3].over) * 0.18) *
        100,
    ) / 100;
  assert.equal(expected2023, 10_500); // 2,500.0002 + 4,999.9992 + 3,000.0006
  assert.equal(apitFor(200_000, b), expected2023);
  assert.equal(sheetApit(200_000, march), expected2023);
  assert.equal(sheetApit(200_000, april), 3_000);
  // The 2023 table has one more band, so the rate blocks shift; the sheet still reads them all.
  for (const pay of [0, 100_000, 141_666.67, 250_000, 308_333.33, 750_000])
    assert.equal(
      sheetApit(pay, march),
      apitFor(pay, b),
      `March 2025 pay ${pay}`,
    );
});

// ---------------------------------------------------------------------------------------------
// 3-4. EPF, ETF, gross, net, employer cost.
// ---------------------------------------------------------------------------------------------

const STAFF = [
  employee(45_000, 5_000, 10_000, 2_000, "001"),
  employee(180_000, 0, 40_000, 5_000, "002"),
  employee(300_000, 12_500, 37_500, 0, "003"),
];
// [gross, epfEmp, apit, net, epfEr, etf, cost], by hand (Oct 2026, 8% / 12% / 3%, 2025 APIT).
const EXPECTED = [
  [60_000, 4_000, 0, 54_000, 6_000, 1_500, 67_500],
  [220_000, 14_400, 4_200, 196_400, 21_600, 5_400, 247_000],
  [350_000, 25_000, 32_500, 292_500, 37_500, 9_375, 396_875],
];

test("EPF and ETF are on basic + EPF-liable allowances; gross, net and employer cost add up", () => {
  const plan = buildPayrollPlan({ month: OCT_2026, employees: STAFF });
  const grid = Grid.of(plan);
  STAFF.forEach((e, index) => {
    const r = FIRST_ROW + index;
    const [gross, epfEmp, apit, net, epfEr, etf, cost] = EXPECTED[index];
    const got = (c: string) => grid.num(`${c}${r}`);
    assert.equal(got(COL.gross), gross, `gross row ${r}`);
    assert.equal(got(COL.gross), e.basic + e.epfAllowances + e.otherAllowances);
    assert.equal(got(COL.epfEmp), epfEmp, `EPF employee row ${r}`);
    assert.equal(got(COL.epfEmp), (e.basic + e.epfAllowances) * 0.08);
    assert.equal(got(COL.apit), apit, `APIT row ${r}`);
    assert.equal(got(COL.net), net, `net row ${r}`);
    assert.equal(got(COL.net), gross - epfEmp - apit - e.otherDeductions);
    assert.equal(got(COL.epfEr), epfEr, `EPF employer row ${r}`);
    assert.equal(got(COL.etf), etf, `ETF row ${r}`);
    assert.equal(got(COL.etf), (e.basic + e.epfAllowances) * 0.03);
    assert.equal(got(COL.cost), cost, `employer cost row ${r}`);
    assert.equal(grid.value(r, 1), e.id);
  });

  assert.deepEqual(plan.totals, {
    gross: 630_000,
    epfEmployee: 43_400,
    epfEmployer: 65_100,
    etf: 16_275,
    apit: 36_700,
    net: 542_900,
  });

  // Totals row: label, then SUMs that equal the per-row sums and plan.totals.
  const totalRow = FIRST_ROW + STAFF.length;
  assert.equal(grid.value(totalRow, 1), "Total");
  for (let c = 3; c <= 13; c++) {
    const letter = columnName(c);
    let rowSum = 0;
    for (let r = FIRST_ROW; r < totalRow; r++)
      rowSum += grid.num(`${letter}${r}`);
    close(grid.num(`${letter}${totalRow}`), rowSum, `total of ${letter}`);
  }
  const t = (c: string) => grid.num(`${c}${totalRow}`);
  assert.equal(t(COL.gross), plan.totals.gross);
  assert.equal(t(COL.epfEmp), plan.totals.epfEmployee);
  assert.equal(t(COL.epfEr), plan.totals.epfEmployer);
  assert.equal(t(COL.etf), plan.totals.etf);
  assert.equal(t(COL.apit), plan.totals.apit);
  assert.equal(t(COL.net), plan.totals.net);
  assert.equal(t(COL.cost), 67_500 + 247_000 + 396_875);
  assert.equal(plan.employees, 3);
});

test("plan.totals equals the evaluated sheet for pays with cents", () => {
  const staff = [
    employee(123_456.78, 1_234.56, 7_890.12, 345.67, "a"),
    employee(250_001.01, 0, 0, 0, "b"),
    employee(87_654.32, 2_500.5, 15_000.25, 1_000, "c"),
  ];
  const plan = buildPayrollPlan({ month: OCT_2026, employees: staff });
  const grid = Grid.of(plan);
  const totalRow = FIRST_ROW + staff.length;
  const t = (c: string) => grid.num(`${c}${totalRow}`);
  close(t(COL.gross), plan.totals.gross, "gross");
  close(t(COL.epfEmp), plan.totals.epfEmployee, "EPF employee");
  close(t(COL.epfEr), plan.totals.epfEmployer, "EPF employer");
  close(t(COL.etf), plan.totals.etf, "ETF");
  close(t(COL.apit), plan.totals.apit, "APIT");
  close(t(COL.net), plan.totals.net, "net");
});

test("formulas read the rate cells: changing EPF employee to 10% changes the EPF column", () => {
  const plan = buildPayrollPlan({ month: OCT_2026, employees: STAFF });
  const grid = Grid.of(plan);
  const rateRow = labelRow(grid, "EPF employee");
  assert.equal(grid.value(rateRow, 16), 0.08);
  grid.set(rateRow, 16, 0.1);
  STAFF.forEach((e, index) => {
    const r = FIRST_ROW + index;
    assert.equal(grid.num(`G${r}`), (e.basic + e.epfAllowances) * 0.1);
    // Net follows; employer EPF does not.
    assert.equal(
      grid.num(`J${r}`),
      EXPECTED[index][3] - (e.basic + e.epfAllowances) * 0.02,
    );
    assert.equal(grid.num(`K${r}`), EXPECTED[index][4]);
  });
  // ETF and the APIT table are also read from cells.
  grid.set(labelRow(grid, "ETF employer"), 16, 0);
  assert.equal(grid.num(`L${FIRST_ROW}`), 0);
  const bandRow = labelRow(grid, "Monthly pay over") + 2; // the 6% band
  grid.set(bandRow, 16, 0.1);
  assert.equal(grid.num(`H${FIRST_ROW + 1}`), 7_000); // (220,000 - 150,000) x 10%
});

// ---------------------------------------------------------------------------------------------
// 5. Invoice helper.
// ---------------------------------------------------------------------------------------------

test("invoice helper: SSCL 2.5% on the liable portion, VAT 18% on value + SSCL", () => {
  const plan = buildPayrollPlan({ month: OCT_2026 });
  const grid = Grid.of(plan);
  const row = labelRow(grid, "Value before taxes");
  const at = (offset: number) => grid.num(`P${row + offset}`);
  assert.equal(at(0), 100_000);
  assert.equal(at(1), 1);
  assert.equal(at(2), 2_500);
  assert.equal(at(3), 102_500);
  assert.equal(at(4), 18_450);
  assert.equal(at(5), 120_950);
  assert.equal(grid.raw(row + 5, 15), "Invoice total");

  grid.set(row + 1, 16, 0.5);
  assert.equal(at(2), 1_250);
  assert.equal(at(3), 101_250);
  assert.equal(at(4), 18_225);
  assert.equal(at(5), 119_475);
});

// ---------------------------------------------------------------------------------------------
// 6. Blank template.
// ---------------------------------------------------------------------------------------------

test("blank template: 10 body rows whose formulas all evaluate to 0", () => {
  const plan = buildPayrollPlan({ month: OCT_2026 });
  assert.equal(plan.employees, 10);
  assert.deepEqual(plan.totals, {
    gross: 0,
    epfEmployee: 0,
    epfEmployer: 0,
    etf: 0,
    apit: 0,
    net: 0,
  });
  const body = plan.blocks.find((b) => b.style === "body" && b.col === 1)!;
  assert.equal(body.row, FIRST_ROW);
  assert.equal(body.cells.length, 10);
  const grid = Grid.of(plan);
  for (let r = FIRST_ROW; r <= FIRST_ROW + 10; r++)
    for (let c = 3; c <= 13; c++) {
      const cell = grid.raw(r, c);
      if (typeof cell === "object")
        assert.equal(grid.num(`${columnName(c)}${r}`), 0);
    }
  // Every formula on the sheet is a finite number (no #VALUE!, NaN or circular reference).
  for (const { at } of formulas(plan)) {
    const v = grid.num(at);
    assert.ok(!String(v).includes("#"));
  }
  assert.equal(
    buildPayrollPlan({ month: OCT_2026, blankRows: 3 }).employees,
    3,
  );
  assert.equal(
    buildPayrollPlan({ month: OCT_2026, employees: [] }).employees,
    10,
  );
});

// ---------------------------------------------------------------------------------------------
// 7. Languages.
// ---------------------------------------------------------------------------------------------

test("Sinhala and Tamil plans have native headers and byte-identical formulas", () => {
  const en = buildPayrollPlan({ month: OCT_2026, employees: STAFF });
  const enFormulas = formulas(en);
  const scripts = { si: /[඀-෿]/, ta: /[஀-௿]/ } as const;
  for (const language of ["si", "ta"] as const) {
    const plan = buildPayrollPlan({
      month: OCT_2026,
      employees: STAFF,
      language,
    });
    assert.match(plan.title, scripts[language]);
    const header = plan.blocks.find(
      (b) => b.style === "header" && b.col === 1,
    )!;
    const enHeader = en.blocks.find(
      (b) => b.style === "header" && b.col === 1,
    )!;
    header.cells[0].forEach((cell, index) => {
      if (cell === "APIT") return; // an acronym, the same in every language
      assert.equal(typeof cell, "string");
      assert.match(
        cell as string,
        scripts[language],
        `${language} header ${index}`,
      );
      assert.notEqual(cell, enHeader.cells[0][index]);
    });
    assert.deepEqual(formulas(plan), enFormulas, `${language} formulas`);
    // Same layout: every block sits where the English one does.
    assert.deepEqual(
      plan.blocks.map((b) => [b.row, b.col, b.cells.length, b.style]),
      en.blocks.map((b) => [b.row, b.col, b.cells.length, b.style]),
    );
    assert.deepEqual(plan.totals, en.totals);
  }
});

// ---------------------------------------------------------------------------------------------
// 8-9. Request detection and the month.
// ---------------------------------------------------------------------------------------------

test("isPayrollRequest: new payroll sheets in English, Singlish, Sinhala and Tamil", () => {
  for (const text of [
    "make a payroll for October",
    "salary sheet for 2026-10",
    "EPF ETF calculate karanna",
    "වැටුප් ලේඛනයක් හදන්න",
    "சம்பளப் பட்டியல் தயாரி",
    "create APIT and EPF template",
  ])
    assert.equal(isPayrollRequest(text), true, text);
});

test("isPayrollRequest: charts and summaries of existing data are not payroll requests", () => {
  for (const text of [
    "chart of salary by department",
    "total EPF by department",
    "sum of Net Amount by Region",
    "payroll cost by department chart",
    "find duplicate transactions",
  ])
    assert.equal(isPayrollRequest(text), false, text);
});

test("monthFromRequest reads named and ISO months, else today's month", () => {
  const today = new Date(2026, 9, 21);
  const month = (text: string) => payrollMonth(monthFromRequest(text, today));
  assert.equal(month("payroll for October 2026"), "2026-10");
  assert.equal(month("October 2026"), "2026-10");
  assert.equal(month("salary sheet 2026-03"), "2026-03");
  assert.equal(month("for march"), "2026-03");
  assert.equal(month("Dec. 2025 payroll"), "2025-12");
  assert.equal(month("make a payroll"), "2026-10");
  assert.equal(monthFromRequest("make a payroll", today).getDate(), 1);
});

test("monthFromRequest does not read a month out of ordinary words", () => {
  const today = new Date(2026, 9, 21);
  const month = (text: string) => payrollMonth(monthFromRequest(text, today));
  assert.equal(month("make a payroll for the marketing team"), "2026-10");
  assert.equal(month("salary sheet for junior staff"), "2026-10");
  assert.equal(month("payroll with a separate EPF column"), "2026-10");
  assert.equal(month("you may add the payroll"), "2026-10");
  assert.equal(month("payroll for May"), "2026-05");
  assert.equal(month("payroll for Sept 2025"), "2025-09");
});

// ---------------------------------------------------------------------------------------------
// 10. Reading a selected employee list.
// ---------------------------------------------------------------------------------------------

const HEADERS = [
  "Emp No",
  "Employee Name",
  "Basic Salary",
  "COLA",
  "Overtime",
  "Transport Allowance",
  "OT Hours",
  "Salary Advance",
  "Loan",
];

test("mapPayrollColumns sorts columns into EPF allowances, other allowances and deductions", () => {
  const map = mapPayrollColumns(HEADERS);
  assert.deepEqual(map, {
    id: 0,
    name: 1,
    basic: 2,
    epfAllowances: [3],
    otherAllowances: [4, 5],
    otherDeductions: [7, 8],
    skipped: [],
  });
  // OT Hours (6) is in no list.
  const all = [
    map!.basic,
    ...map!.epfAllowances,
    ...map!.otherAllowances,
    ...map!.otherDeductions,
  ];
  assert.ok(!all.includes(6));
  assert.equal(
    mapPayrollColumns(["Name", "Department", "Region", "Amount"]),
    null,
  );
  assert.equal(mapPayrollColumns(["Salary", "Name"])?.basic, 0);
});

test("employeesFromSelection keeps text IDs, skips rows with no basic, parses amount text", () => {
  const map = mapPayrollColumns(HEADERS)!;
  const rows: unknown[][] = [
    [
      "007",
      "Nimal Perera",
      "Rs 45,000.00",
      5_000,
      2_500,
      "1,500",
      12,
      1_000,
      "2,000.50",
    ],
    ["008", "Empty Basic", "", 1, 1, 1, 1, 1, 1],
    ["009", "Kamala", 60_000, "", "", "", "", "", ""],
  ];
  const employees = employeesFromSelection(rows, map);
  assert.equal(employees.length, 2);
  assert.deepEqual(employees[0], {
    id: "007",
    name: "Nimal Perera",
    basic: 45_000,
    epfAllowances: 5_000,
    otherAllowances: 4_000,
    otherDeductions: 3_000.5,
  });
  assert.deepEqual(employees[1], {
    id: "009",
    name: "Kamala",
    basic: 60_000,
    epfAllowances: 0,
    otherAllowances: 0,
    otherDeductions: 0,
  });
  // The text ID stays text on the sheet, in a column formatted as text.
  const plan = buildPayrollPlan({ month: OCT_2026, employees });
  assert.equal(Grid.of(plan).value(FIRST_ROW, 1), "007");
  assert.equal(
    plan.blocks.find((b) => b.style === "body" && b.col === 1)!.formats![0],
    "@",
  );
});

test("employeesFromSelection parses Sri Lankan amount styles 'Rs. 45,000.00' and '45,000/-'", () => {
  const map = {
    id: 0,
    name: 1,
    basic: 2,
    epfAllowances: [],
    otherAllowances: [],
    otherDeductions: [],
    skipped: [],
  };
  const employees = employeesFromSelection(
    [
      ["1", "a", "Rs. 45,000.00"],
      ["2", "b", "45,000/-"],
    ],
    map,
  );
  assert.deepEqual(
    employees.map((e) => e.basic),
    [45_000, 45_000],
  );
});

// ---------------------------------------------------------------------------------------------
// 11. Formula hygiene and layout.
// ---------------------------------------------------------------------------------------------

test("formula hygiene: '=' first, balanced parentheses, no ';' separators", () => {
  for (const month of [OCT_2026, new Date(2025, 2, 1)]) {
    const all = formulas(buildPayrollPlan({ month, employees: STAFF }));
    assert.ok(all.length > 40);
    for (const { at, f } of all) {
      assert.ok(f.startsWith("="), `${at}: ${f}`);
      assert.ok(!f.includes(";"), `${at}: ${f}`);
      let depth = 0;
      for (const ch of f) {
        if (ch === "(") depth++;
        if (ch === ")") depth--;
        assert.ok(depth >= 0, `${at}: ${f}`);
      }
      assert.equal(depth, 0, `${at}: ${f}`);
      assert.doesNotThrow(() => tokenize(f.slice(1)), `${at}: ${f}`);
    }
  }
});

test("blocks never write two different values into one cell", () => {
  for (const month of [OCT_2026, new Date(2025, 2, 1)]) {
    const plan = buildPayrollPlan({ month, employees: STAFF });
    const seen = new Map<string, string>();
    for (const block of plan.blocks) {
      if (block.formats)
        assert.equal(block.formats.length, block.cells[0].length);
      block.cells.forEach((cells, dr) =>
        cells.forEach((cell, dc) => {
          const key = `${columnName(block.col + dc)}${block.row + dr}`;
          const text = JSON.stringify(cell);
          const before = seen.get(key);
          if (before !== undefined)
            assert.equal(text, before, `overlap at ${key}`);
          seen.set(key, text);
        }),
      );
    }
  }
});

test("columnName and payrollMonth", () => {
  assert.deepEqual([1, 13, 26, 27, 52, 703].map(columnName), [
    "A",
    "M",
    "Z",
    "AA",
    "AZ",
    "AAA",
  ]);
  assert.equal(payrollMonth(new Date(2026, 0, 31)), "2026-01");
  const plan = buildPayrollPlan({ month: OCT_2026 });
  assert.equal(plan.sheet, "Payroll 2026-10");
  assert.equal(plan.needsReview, needsReview(plan.rates));
});

test("ratesOn for a month before 2024 gives the VAT of that month (15%)", () => {
  assert.equal(ratesOn("2023-06-01").vat.value, 0.15);
  assert.equal(ratesCover("2022-06-01"), false);
  assert.equal(ratesCover("2023-01-01"), true);
});

// ---------------------------------------------------------------------------------------------
// 11. Code-review fixes: requests, months, amounts, columns and total rows.
// ---------------------------------------------------------------------------------------------

test("isPayrollRequest leaves work on an existing payroll to the agent", () => {
  for (const text of [
    "sort the payroll by name",
    "what is the total payroll cost?",
    "fix the formula in my payroll sheet",
    "add an EPF column",
    "highlight payroll rows over 100,000",
    "how much EPF did we pay?",
  ])
    assert.equal(isPayrollRequest(text), false, text);
  for (const text of [
    "make a payroll for October",
    "payroll",
    "October payroll",
    "prepare payslips for the staff",
    "calculate salaries for this month",
    "can you create a salary sheet?",
    "වැටුප් ලේඛනයක් හදන්න",
    "சம்பளப் பட்டியல் உருவாக்கு",
  ])
    assert.equal(isPayrollRequest(text), true, text);
});

test("monthFromRequest reads May at the start, month/year, Sinhala and Tamil months, and the year end", () => {
  const october = new Date(2026, 9, 21);
  const month = (text: string, today = october) =>
    payrollMonth(monthFromRequest(text, today));
  assert.equal(month("May payroll"), "2026-05");
  assert.equal(month("payroll 10/2026"), "2026-10");
  assert.equal(month("ඔක්තෝබර් මාසයේ වැටුප් ලේඛනය"), "2026-10");
  assert.equal(month("மார்ச் சம்பளப் பட்டியல்"), "2026-03");
  assert.equal(month("மே 2027 சம்பளப் பட்டியல்"), "2027-05");
  // Tamil "மே" inside a longer word is not May.
  assert.equal(month("மேலதிக நேரம்"), "2026-10");
  assert.equal(month("payroll for January", new Date(2026, 11, 5)), "2027-01");
  assert.equal(month("payroll for December", new Date(2027, 0, 5)), "2026-12");
  assert.equal(month("payroll for March"), "2026-03");
});

test("amount reads /=, a trailing currency and brackets as minus", () => {
  assert.equal(amount("45,000/="), 45_000);
  assert.equal(amount("45,000 LKR"), 45_000);
  assert.equal(amount("45,000.50 Rs."), 45_000.5);
  assert.equal(amount("(5,000)"), -5_000);
  assert.equal(amount("n/a"), 0);
  assert.equal(amount(""), 0);
});

test("mapPayrollColumns: no gross as basic, no totals, bonus left out, the sheet's own headers", () => {
  assert.equal(mapPayrollColumns(["Name", "Gross Salary"]), null);
  const map = mapPayrollColumns([
    "EPF No",
    "Employee No",
    "Name with initials",
    "Basic Salary",
    "Transport Allowance",
    "Meal Allowance",
    "Total Allowances",
    "Bonus",
    "EPF Deduction",
    "Total Deductions",
    "Loan",
  ])!;
  assert.equal(map.id, 1);
  assert.equal(map.name, 2);
  assert.deepEqual(map.otherAllowances, [4, 5]);
  assert.deepEqual(map.skipped, [7]);
  assert.deepEqual(map.otherDeductions, [10]);
  // "Employee notes" is not an employee number.
  assert.equal(mapPayrollColumns(["Employee Notes", "Basic"])?.id, undefined);
  // A sheet this add-in made reads back with its EPF-liable allowances in place.
  for (const language of ["si", "ta"] as const) {
    const plan = buildPayrollPlan({ month: new Date(2026, 9, 1), language });
    const headers = plan.blocks.find((block) => block.style === "header")!
      .cells[0] as string[];
    const again = mapPayrollColumns(headers)!;
    assert.equal(again.basic, 2, language);
    assert.deepEqual(again.epfAllowances, [3], language);
    assert.ok(again.otherAllowances.includes(4), language);
  }
});

test("employeesFromSelection skips total rows and rows with no ID or name", () => {
  const map = mapPayrollColumns(["Emp No", "Name", "Basic"])!;
  const employees = employeesFromSelection(
    [
      ["E1", "Nimal", 50_000],
      ["", "", 20_000],
      ["Total", "", 70_000],
      ["", "Grand total", 70_000],
      ["", "Kamala", 40_000],
    ],
    map,
  );
  assert.deepEqual(
    employees.map((employee) => employee.name),
    ["Nimal", "Kamala"],
  );
});

test("the SSCL row explains the 2.5/97.5 pass-on", () => {
  for (const language of ["en", "si", "ta"] as const) {
    const plan = buildPayrollPlan({ month: new Date(2026, 9, 1), language });
    const text = JSON.stringify(plan.blocks);
    assert.match(text, /2\.5\/97\.5/, language);
  }
});

test("a payroll write that fails leaves no half-made sheet", async () => {
  const { gridWorkbook } = await import("../test/batch/gridWorkbook.js");
  const { writePayrollSheet } = await import("./officeSriLanka.js");
  const book = gridWorkbook("Staff", [["Name"], ["a"]]);
  let syncs = 0;
  const failing = {
    run: <T>(callback: (context: any) => Promise<T>) =>
      book.runtime.run((context: any) =>
        callback({
          ...context,
          sync: async () => {
            syncs += 1;
            // The first sync checks for the sheet; the second writes it and fails.
            if (syncs === 2) throw new Error("GeneralException");
            await context.sync();
          },
        }),
      ),
  };
  const plan = buildPayrollPlan({ month: new Date(2026, 9, 1) });
  const result = await writePayrollSheet(failing, plan);
  assert.deepEqual(result, { ok: false, error: "GeneralException" });
  assert.equal(book.sheets.has(plan.sheet), false);
  // The same plan writes cleanly afterwards.
  assert.equal((await writePayrollSheet(book.runtime, plan)).ok, true);
});
