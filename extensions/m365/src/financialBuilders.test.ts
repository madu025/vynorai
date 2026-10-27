import assert from "node:assert/strict";
import { test } from "node:test";
import { financialCells, qualifiedRange } from "./financialBuilders.js";

const value = (
  cells: ReturnType<typeof financialCells>,
  row: number,
  column: number,
) => cells.find((cell) => cell.row === row && cell.column === column)?.value;

test("sheet-qualified ranges are normalised and anything else is refused", () => {
  assert.equal(
    qualifiedRange("'Sales Data'!$B$2:$B$50", "x"),
    "'Sales Data'!B2:B50",
  );
  assert.equal(qualifiedRange("Data!C2:C9", "x"), "'Data'!C2:C9");
  assert.throws(
    () => qualifiedRange("B2:B9", "cash_flows"),
    /cash_flows must be a sheet-qualified range/,
  );
  assert.throws(() => qualifiedRange("[Book2.xlsx]Data!B2", "x"));
});

test("a loan schedule keeps its inputs in cells and spills every period from them", () => {
  const cells = financialCells({
    kind: "loan_schedule",
    cell: "B2",
    principal: 1_000_000,
    annual_rate: 0.12,
    years: 5,
  });
  assert.equal(value(cells, 0, 1), 1_000_000);
  assert.equal(value(cells, 3, 1), 12);
  assert.equal(value(cells, 4, 1), "=PMT($C$3/$C$5,$C$4*$C$5,-$C$2)");
  assert.equal(
    value(cells, 8, 0),
    "=LET(r,$C$3/$C$5,n,$C$4*$C$5,p,SEQUENCE(n),HSTACK(p,p*0+$C$6,IPMT(r,p,n,-$C$2),PPMT(r,p,n,-$C$2),FV(r,p,$C$6,-$C$2)))",
  );
  assert.throws(
    () =>
      financialCells({
        kind: "loan_schedule",
        cell: "A1",
        principal: 5,
        annual_rate: 12,
        years: 5,
      }),
    /fraction from 0 to 1/,
  );
  assert.throws(
    () =>
      financialCells({
        kind: "loan_schedule",
        cell: "A1",
        principal: 5,
        annual_rate: 0.1,
        years: 2.5,
      }),
    /years must be a whole number/,
  );
  assert.throws(
    () =>
      financialCells({
        kind: "loan_schedule",
        cell: "A1",
        principal: 5,
        annual_rate: 0.1,
        years: 2,
        payments_per_year: 12.5,
      }),
    /payments_per_year must be a whole number/,
  );
});

test("NPV treats the first flow as time 0, and dates switch to XNPV and XIRR", () => {
  const plain = financialCells({
    kind: "npv_irr",
    cell: "A1",
    cash_flows: "'Plan'!B2:B7",
    rate: 0.1,
  });
  assert.equal(value(plain, 1, 1), "='Plan'!B2+NPV($B$1,'Plan'!B3:B7)");
  assert.equal(value(plain, 2, 1), "=IRR('Plan'!B2:B7)");
  const dated = financialCells({
    kind: "npv_irr",
    cell: "A1",
    cash_flows: "Plan!B2:B7",
    dates: "Plan!A2:A7",
    rate: 0.1,
  });
  assert.equal(value(dated, 1, 1), "=XNPV($B$1,'Plan'!B2:B7,'Plan'!A2:A7)");
  assert.equal(value(dated, 2, 1), "=XIRR('Plan'!B2:B7,'Plan'!A2:A7)");
  assert.throws(
    () =>
      financialCells({
        kind: "npv_irr",
        cell: "A1",
        cash_flows: "Plan!B2:B7",
        dates: "Plan!A2:A5",
        rate: 0.1,
      }),
    /same number of rows/,
  );
});

test("budget against actual groups by category and sorts the largest variance first", () => {
  const cells = financialCells({
    kind: "budget_variance",
    cell: "A1",
    categories: "Data!C2:C900",
    actual: "Data!F2:F900",
    budget: "Budget!D2:D900",
  });
  assert.deepEqual(
    [0, 1, 2, 3, 4].map((column) => value(cells, 0, column)),
    ["Category", "Actual", "Budget", "Variance", "Variance %"],
  );
  assert.match(
    String(value(cells, 1, 0)),
    /SUMIFS\('Data'!F2:F900,'Data'!C2:C900,c\)/,
  );
  assert.match(String(value(cells, 1, 0)), /SORTBY\(.*ABS\(v\),-1\)\)$/);
  assert.equal(value(cells, 2, 7), "=$H$1-$H$2");
});

test("ageing puts amounts in 30-day buckets, by customer when given", () => {
  const byCustomer = financialCells({
    kind: "ageing",
    cell: "A1",
    due_dates: "AR!D2:D500",
    amounts: "AR!E2:E500",
    customers: "AR!B2:B500",
    as_of: "2026-03-31",
  });
  assert.equal(value(byCustomer, 0, 1), "=DATE(2026,3,31)");
  assert.equal(
    value(byCustomer, 3, 0),
    "=LET(g,$B$1-'AR'!D2:D500,a,'AR'!E2:E500,GROUPBY('AR'!B2:B500,HSTACK(a*(g<0),a*(g>=0)*(g<=30),a*(g>30)*(g<=60),a*(g>60)*(g<=90),a*(g>90)),SUM,0,1))",
  );
  const totals = financialCells({
    kind: "ageing",
    cell: "A1",
    due_dates: "AR!D2:D500",
    amounts: "AR!E2:E500",
  });
  assert.equal(value(totals, 0, 1), "=TODAY()");
  assert.equal(
    value(totals, 3, 0),
    "=LET(g,$B$1-'AR'!D2:D500,a,'AR'!E2:E500,HSTACK(SUM(a*(g<0)),SUM(a*(g>=0)*(g<=30)),SUM(a*(g>30)*(g<=60)),SUM(a*(g>60)*(g<=90)),SUM(a*(g>90))))",
  );
  assert.deepEqual(
    [0, 1, 2, 3, 4].map((column) => value(totals, 2, column)),
    ["Not due", "0-30 days", "31-60 days", "61-90 days", "Over 90 days"],
  );
});
