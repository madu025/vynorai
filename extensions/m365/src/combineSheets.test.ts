import assert from "node:assert/strict";
import { test } from "node:test";
import {
  combineCells,
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
    `LET(v,'Orders'!B2:B101,IF(TRIM(v)="","",IFERROR(TEXT(VALUE(v),"0"),LOWER(TRIM(v)))))`,
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
  assert.equal((cell.formula.match(/TEXT\(VALUE\(/g) ?? []).length, 4);
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
  assert.match(String(at(2, 1)), /TEXT\(VALUE\(/);
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
  assert.match(String(differs?.formula), /TEXT\(VALUE\(/);
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
