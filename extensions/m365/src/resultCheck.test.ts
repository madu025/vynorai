import assert from "node:assert/strict";
import test from "node:test";
import type { AgentHost, StagedChange } from "./agent.js";
import { evaluateJoins, evaluateLookups, lookupProbe } from "./resultCheck.js";

const change: { change: StagedChange } = {
  change: {
    kind: "excel_action",
    tool: "combine_tables",
    args: {
      mode: "join",
      left_sheet: "Orders",
      left_address: "A1:C4",
      right_sheet: "Customers",
      right_address: "A1:B3",
      key: "Customer",
      columns: ["Region"],
      sheet: "Result",
      cell: "A1",
    },
  } as StagedChange,
};

const hostWith = (errors: number, missing: number, rows: number) =>
  ({
    readRange: async (sheet: string) => ({
      address: "A1",
      values: [
        sheet === "Orders"
          ? ["Order", "Customer", "Amount"]
          : ["Customer", "Region"],
      ],
    }),
    calculate: async (formula: string) => [
      [
        formula.includes("ISERROR")
          ? errors
          : formula.includes("ROWS(")
            ? rows
            : missing,
      ],
    ],
  }) as unknown as AgentHost;

test("a join that errors on the real cells is reported", async () => {
  const issues = await evaluateJoins([change], hostWith(3, 0, 10));
  assert.equal(issues.length, 1);
  assert.match(issues[0], /3 error value/);
});

test("a join where most rows say Not found is reported", async () => {
  const issues = await evaluateJoins([change], hostWith(0, 8, 10));
  assert.match(issues[0], /Not found/);
});

test("a clean join, other changes and a failing calculate give no issue", async () => {
  assert.deepEqual(await evaluateJoins([change], hostWith(0, 1, 10)), []);
  assert.deepEqual(
    await evaluateJoins(
      [
        {
          change: {
            kind: "write_values",
            sheet: "S",
            cell: "A1",
            values: [[1]],
          } as StagedChange,
        },
      ],
      hostWith(5, 5, 1),
    ),
    [],
  );
  const broken = {
    ...hostWith(0, 0, 1),
    calculate: async () => {
      throw new Error("x");
    },
  } as AgentHost;
  assert.deepEqual(await evaluateJoins([change], broken), []);
});

test("an append or reconcile that errors on the real cells is reported", async () => {
  for (const mode of ["append", "reconcile"]) {
    const staged = {
      change: {
        ...change.change,
        args: { ...(change.change as any).args, mode, amount: undefined },
      } as StagedChange,
    };
    // Both ranges share one header row, as an append and a reconcile on the same key need.
    const base = hostWith(2, 0, 10);
    const host = {
      ...base,
      readRange: async () => ({
        address: "A1",
        values: [["Order", "Customer", "Amount"]],
      }),
    } as unknown as AgentHost;
    const issues = await evaluateJoins([staged], host);
    assert.equal(issues.length, 1, mode);
    assert.match(issues[0], /error value/);
  }
});

const lookup = (formula: string, extra: Record<string, unknown> = {}) => ({
  change: {
    kind: "write_formula",
    sheet: "Orders",
    cell: "E2",
    formula,
    ...extra,
  } as StagedChange,
});

const XLOOKUP_FORMULA =
  '=XLOOKUP(A2:A40,Customers!A2:A20,Customers!B2:B20,"Not found")';

const lookupHost = (result: unknown) => {
  const formulas: string[] = [];
  const host = {
    readRange: async () => ({ address: "A1", values: [[]] }),
    calculate: async (formula: string) => {
      formulas.push(formula);
      return result;
    },
  } as unknown as AgentHost;
  return { host, formulas };
};

test("a spilled lookup that says Not found on the real cells is caught before apply", async () => {
  const { host, formulas } = lookupHost(
    Array.from({ length: 39 }, () => ["Not found"]),
  );
  const issues = await evaluateLookups([lookup(XLOOKUP_FORMULA)], host);
  assert.equal(issues.length, 1);
  assert.match(issues[0], /'Orders'!E2/);
  assert.match(issues[0], /39 of 39 result cell\(s\) \(100%\) are "not found"/);
  assert.match(issues[0], /map_relationships/);
  // Unqualified references get the sheet the formula is written on; the rest stays as written.
  assert.equal(formulas.length, 1);
  assert.match(
    formulas[0],
    /^=LET\(vynR,XLOOKUP\('Orders'!A2:A40,Customers!A2:A20,Customers!B2:B20,"Not found"\),/,
  );
  // evaluateJoins runs it too, so reviewAndRevise needs no new call.
  assert.equal(
    (await evaluateJoins([lookup(XLOOKUP_FORMULA)], host)).length,
    1,
  );
});

test("a lookup whose result holds errors is caught; a scalar #N/A too", async () => {
  const spilled = lookupHost([["A"], ["#N/A"], ["B"], ["#N/A"], ["C"]]);
  const issues = await evaluateLookups(
    [lookup("=INDEX(Customers!B:B,MATCH(A2:A6,Customers!A:A,0))")],
    spilled.host,
  );
  assert.match(
    issues[0],
    /2 of 5 result cell\(s\) are errors \(first: #N\/A\)/,
  );
  const scalar = lookupHost([["#N/A"]]);
  const one = await evaluateLookups(
    [lookup("=VLOOKUP(A2,Customers!A:B,2,FALSE)")],
    scalar.host,
  );
  assert.equal(one.length, 1);
});

test("a clean lookup, a non-lookup, a fill_range formula and a failing calculate give no issue", async () => {
  const clean = lookupHost([
    ["North"],
    ["South"],
    ["Not found"],
    ["East"],
    ["West"],
    ["North"],
  ]);
  assert.deepEqual(
    await evaluateLookups([lookup(XLOOKUP_FORMULA)], clean.host),
    [],
  );
  const other = lookupHost([["Not found"]]);
  assert.deepEqual(
    await evaluateLookups(
      [
        lookup("=SUM(A2:A40)"),
        lookup('=XLOOKUP(A2,Customers!A:A,Customers!B:B,"Not found")', {
          fillRange: "E2:E40",
        }),
        lookup('=IF(A2="","",XLOOKUP(@A:A,Customers!A:A,Customers!B:B))'),
      ],
      other.host,
    ),
    [],
  );
  assert.deepEqual(other.formulas, []);
  const broken = {
    calculate: async () => {
      throw new Error("x");
    },
  } as unknown as AgentHost;
  assert.deepEqual(
    await evaluateLookups([lookup(XLOOKUP_FORMULA)], broken),
    [],
  );
});

test("a lookup that reads cells another staged change writes is not calculated before apply", async () => {
  const { host, formulas } = lookupHost([["Not found"]]);
  const plans: { change: StagedChange }[][] = [
    [
      {
        change: {
          kind: "write_values",
          sheet: "Customers",
          cell: "A2",
          values: [["C1", "North"]],
        },
      },
      lookup(XLOOKUP_FORMULA),
    ],
    [
      { change: { kind: "create_sheet", name: "customers" } },
      lookup(XLOOKUP_FORMULA),
    ],
    [
      lookup(XLOOKUP_FORMULA),
      { change: { kind: "vynor_step", instruction: "x", understood: "x" } },
    ],
    // Reads its own output column.
    [lookup('=XLOOKUP(E2:E40,Customers!A:A,Customers!B:B,"Not found")')],
  ];
  for (const plan of plans)
    assert.deepEqual(await evaluateLookups(plan, host), []);
  assert.deepEqual(formulas, []);
  // A header write above the result and a format do not block the check.
  const ok = lookupHost([["Not found"]]);
  const issues = await evaluateLookups(
    [
      {
        change: {
          kind: "write_values",
          sheet: "Orders",
          cell: "E1",
          values: [["Region"]],
        },
      },
      {
        change: {
          kind: "format_range",
          sheet: "Orders",
          address: "E1:E40",
          bold: true,
        },
      },
      lookup(XLOOKUP_FORMULA),
    ],
    ok.host,
  );
  assert.equal(issues.length, 1);
});

test("lookupProbe qualifies only real references", () => {
  const probe = lookupProbe(
    `=LET(key,$A$2:$A$9,XLOOKUP(key,'Sales Q1'!A:A,Rates[Code],LOG10(B2)&"A1:B2"&C3#))`,
    "It's",
  );
  assert.ok(probe);
  assert.equal(
    probe.formula,
    `LET(key,'It''s'!$A$2:$A$9,XLOOKUP(key,'Sales Q1'!A:A,Rates[Code],LOG10('It''s'!B2)&"A1:B2"&'It''s'!C3#))`,
  );
  assert.deepEqual(
    probe.reads.map((read) => read.sheet),
    ["It's", "It's", "It's", "Sales Q1"],
  );
  assert.equal(lookupProbe("=SUM(A1:A9)", "S"), undefined);
  assert.equal(lookupProbe('=XLOOKUP(INDIRECT("A2"),B:B,C:C)', "S"), undefined);
});
