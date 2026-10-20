import assert from "node:assert/strict";
import { test } from "node:test";
import {
  countDuplicateKeys,
  currencyFromHeader,
  currencyFromNumberFormat,
  currencyFromValues,
  describeBusinessKey,
  describeBusinessMeaning,
  describeRequestMeaning,
  detectBusinessKey,
  inferAudience,
  inferCurrency,
  isMoneyHeader,
  parseBusinessTarget,
  suggestDashboardColumns,
} from "./businessContext.js";

test("currency is read from Excel number formats", () => {
  assert.equal(currencyFromNumberFormat("[$LKR] #,##0.00")?.code, "LKR");
  assert.equal(currencyFromNumberFormat('"Rs "#,##0.00')?.code, "LKR");
  assert.equal(currencyFromNumberFormat('"Rs."#,##0')?.code, "LKR");
  assert.equal(currencyFromNumberFormat("$#,##0.00")?.code, "USD");
  assert.equal(currencyFromNumberFormat("[$€-x-euro2] #,##0")?.code, "EUR");
  assert.equal(currencyFromNumberFormat("£#,##0")?.code, "GBP");
  assert.equal(currencyFromNumberFormat("#,##0.00"), undefined);
  assert.equal(currencyFromNumberFormat("General"), undefined);
  assert.equal(currencyFromNumberFormat('0" pcs"'), undefined);
});

test("currency is read from headers, but a plain word is not taken for money", () => {
  assert.equal(currencyFromHeader("Amount (LKR)")?.code, "LKR");
  assert.equal(currencyFromHeader("Sales Rs")?.code, "LKR");
  assert.equal(currencyFromHeader("Price $")?.code, "USD");
  assert.equal(currencyFromHeader("USD Revenue")?.code, "USD");
  assert.equal(currencyFromHeader("Weight in pounds"), undefined);
  assert.equal(currencyFromHeader("Sales"), undefined);
  assert.equal(currencyFromHeader("Rs_Value")?.code, "LKR");
});

test("currency is read from written amounts only when most of them agree", () => {
  assert.equal(
    currencyFromValues(["Rs. 1,250.00", "Rs. 300", "Rs 40"])?.code,
    "LKR",
  );
  assert.equal(currencyFromValues(["$12.50", "$3"])?.code, "USD");
  assert.equal(currencyFromValues(["1,200 LKR", "500 LKR"])?.code, "LKR");
  assert.equal(currencyFromValues([10, 20, 30]), undefined);
  assert.equal(currencyFromValues(["North", "South", "Rs 10"]), undefined);
});

test("money headers are told apart from counts and codes", () => {
  for (const header of [
    "Sales",
    "Total Cost",
    "Net Profit",
    "Unit Price",
    "Amount (LKR)",
  ])
    assert.ok(isMoneyHeader(header), header);
  for (const header of [
    "Qty",
    "Order Count",
    "Units Sold",
    "Rate %",
    "Invoice No",
  ])
    assert.ok(!isMoneyHeader(header), header);
});

test("inferCurrency prefers the cells' own format and keeps it", () => {
  const guess = inferCurrency({
    headers: ["Region", "Sales", "Cost"],
    columns: [1, 2],
    numberFormats: ["General", "[$LKR] #,##0.00", "General"],
    request: "dashboard in dollars",
  });
  assert.equal(guess?.code, "LKR");
  assert.equal(guess?.source, "number-format");
  assert.equal(guess?.numberFormat, "[$LKR] #,##0.00");
});

test("inferCurrency falls back to the request only for money columns", () => {
  const money = inferCurrency({
    headers: ["Region", "Sales"],
    columns: [1],
    request: "sales dashboard in rupees for management",
  });
  assert.equal(money?.code, "LKR");
  assert.equal(money?.source, "request");
  assert.equal(money?.numberFormat, '"Rs "#,##0.00');
  const quantity = inferCurrency({
    headers: ["Region", "Qty"],
    columns: [1],
    request: "qty dashboard in rupees",
  });
  assert.equal(quantity, undefined);
});

test("two currencies in the money columns are reported as mixed and not formatted", () => {
  const guess = inferCurrency({
    headers: ["Region", "Sales (LKR)", "Sales (USD)"],
    columns: [1, 2],
  });
  assert.deepEqual(guess?.mixed, ["LKR", "USD"]);
  assert.equal(guess?.numberFormat, "#,##0.00");
});

test("the audience is read from the request in English and Sinhala", () => {
  assert.equal(
    inferAudience("Make a one-page sales summary for management"),
    "management",
  );
  assert.equal(
    inferAudience(
      "daily tracking sheet so the team can follow up each pending job",
    ),
    "operational",
  );
  assert.equal(inferAudience("කළමනාකරණයට සාරාංශ dashboard එකක්"), "management");
  assert.equal(inferAudience("දෛනික විස්තර වාර්තාවක්"), "operational");
  assert.equal(inferAudience("make a dashboard of Sales by Region"), "general");
});

test("targets are read with their multiplier and bound to the named column", () => {
  const headers = ["Region", "Sales", "Cost"];
  assert.deepEqual(
    parseBusinessTarget("dashboard, target 5M", headers, [1, 2]),
    {
      value: 5_000_000,
      label: "target",
    },
  );
  assert.deepEqual(
    parseBusinessTarget(
      "Cost budget is Rs 2,500,000 this year",
      headers,
      [1, 2],
    ),
    { value: 2_500_000, label: "budget", column: 2 },
  );
  assert.equal(
    parseBusinessTarget("sales target of 12.5 lakh", headers, [1, 2])?.value,
    1_250_000,
  );
  assert.equal(
    parseBusinessTarget("ඉලක්කය 500000", headers, [1])?.value,
    500_000,
  );
  assert.equal(
    parseBusinessTarget("top 10 regions by sales", headers, [1]),
    undefined,
  );
  assert.equal(
    parseBusinessTarget("target for 2026 by region", headers, [1]),
    undefined,
  );
});

test("the transaction ID is found as the business key and its repeats are counted", () => {
  const headers = ["Date", "Customer ID", "Transaction ID", "Amount"];
  const rows = [
    [45700, "C1", "T-1001", 100],
    [45700, "C1", "T-1002", 250],
    [45701, "C2", "T-1003", 80],
    [45701, "C3", "T-1003", 80],
    [45702, "C2", "T-1004", 120],
    [45702, "C1", "T-1005", 60],
  ];
  const key = detectBusinessKey(headers, rows);
  assert.deepEqual(key?.columns, [2]);
  assert.deepEqual(key?.names, ["Transaction ID"]);
  assert.equal(key?.duplicateKeys, 1);
  assert.equal(key?.duplicateRows, 1);
  assert.match(
    describeBusinessKey(key!),
    /Transaction ID value\(s\) appear on more than one row/,
  );
});

test("a key is found by its values when the header gives no hint", () => {
  const headers = ["Ref", "Region", "Sales"];
  const rows = Array.from({ length: 20 }, (_, index) => [
    `A${1000 + index}`,
    index % 2 ? "North" : "South",
    index * 10,
  ]);
  const key = detectBusinessKey(headers, rows);
  assert.deepEqual(key?.columns, [0]);
  assert.equal(key?.duplicateKeys, 0);
  assert.match(describeBusinessKey(key!), /No Ref value is repeated/);
});

test("a master list's own ID is its key, but names and phones never are", () => {
  // A customer list: every Customer ID is different, so it identifies the record.
  const master = detectBusinessKey(
    ["Customer ID", "Customer Name", "Phone", "City"],
    Array.from({ length: 10 }, (_, index) => [
      `C${index}`,
      `Person ${index}`,
      `07712345${index}`,
      index % 2 ? "Colombo" : "Kandy",
    ]),
  );
  assert.deepEqual(master?.names, ["Customer ID"]);
  // In a sales table the same Customer ID repeats on purpose and is not the key.
  const sales = detectBusinessKey(
    ["Customer ID", "Qty"],
    Array.from({ length: 10 }, (_, index) => [`C${index % 3}`, index + 1]),
  );
  assert.equal(sales, undefined);
  const people = detectBusinessKey(
    ["Full Name", "Phone"],
    Array.from({ length: 10 }, (_, index) => [
      `Person ${index}`,
      `07712345${index}`,
    ]),
  );
  assert.equal(people, undefined);
});

test("invoice lines use invoice number plus line number as the key", () => {
  const headers = ["Invoice No", "Line No", "Item", "Amount"];
  const rows = [
    ["INV-1", 1, "A", 10],
    ["INV-1", 2, "B", 20],
    ["INV-2", 1, "A", 10],
    ["INV-3", 1, "C", 5],
    ["INV-3", 2, "A", 10],
    ["INV-3", 2, "A", 10],
  ];
  const key = detectBusinessKey(headers, rows);
  assert.deepEqual(key?.names, ["Invoice No", "Line No"]);
  assert.equal(key?.duplicateRows, 1);
  assert.deepEqual(countDuplicateKeys(rows, [0]), {
    duplicateKeys: 2,
    duplicateRows: 3,
    blankKeys: 0,
  });
});

test("dates, amounts and free text are never keys", () => {
  const headers = ["Order Date", "Amount", "Description"];
  const rows = Array.from({ length: 10 }, (_, index) => [
    45700 + index,
    index + 0.5,
    `a long text number ${index}`,
  ]);
  assert.equal(detectBusinessKey(headers, rows), undefined);
});

test("a dashboard with no columns named groups by a business category and adds up money", () => {
  const headers = [
    "Order No",
    "Order Date",
    "Customer",
    "Region",
    "Qty",
    "Unit Price",
    "Discount %",
    "Net Amount",
  ];
  const regions = ["North", "South", "East", "West"];
  const rows = Array.from({ length: 40 }, (_, index) => [
    `ORD-${1000 + index}`,
    45700 + index,
    `Customer ${index}`,
    regions[index % 4],
    (index % 5) + 1,
    120.5,
    5,
    ((index % 5) + 1) * 120.5,
  ]);
  const picked = suggestDashboardColumns(headers, rows);
  assert.equal(picked.category, 3); // Region, not Order No or Customer
  // Net Amount first; the date, the unit price and the percentage are never added up.
  assert.deepEqual(picked.values, [7, 4]);
});

test("the agent is told the data's business meaning as derived facts, never cell values", () => {
  const headers = [
    "Voucher No",
    "Cost Centre",
    "Debit",
    "Currency",
    "Narration",
  ];
  const rows = Array.from({ length: 40 }, (_, i) => [
    `JV-${1000 + i}`,
    ["Colombo", "Kandy", "Galle"][i % 3],
    1000 + i * 10,
    i % 4 ? "LKR" : "USD",
    `Payment to supplier ${i}`,
  ]);
  const meaning = describeBusinessMeaning(headers, rows, [
    "General",
    "General",
    "#,##0.00",
  ]);
  assert.match(meaning.currency!, /^mixed: .*LKR.*USD.*\(see Currency\)/);
  assert.deepEqual(meaning.moneyColumns, ["Debit"]);
  assert.deepEqual(meaning.businessKey?.columns, ["Voucher No"]);
  assert.equal(meaning.groupBy, "Cost Centre");
  assert.deepEqual(meaning.measures, ["Debit"]);
  assert.ok(!JSON.stringify(meaning).includes("supplier"));
  const single = describeBusinessMeaning(
    ["Region", "Sales"],
    [
      ["North", 10],
      ["South", 20],
      ["North", 5],
    ],
    ["General", '"Rs "#,##0.00'],
  );
  assert.equal(single.currency, "LKR");
  assert.equal(single.currencyFormat, '"Rs "#,##0.00');
});

test("a target and the audience are read from the request for the agent", () => {
  assert.equal(
    describeRequestMeaning("management dashboard, target 5M"),
    "[From the add-in, read from the request] target 5000000; audience management.",
  );
  assert.equal(describeRequestMeaning("sort by date"), "");
});
