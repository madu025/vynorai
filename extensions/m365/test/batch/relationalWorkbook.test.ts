import assert from "node:assert/strict";
import { test } from "node:test";
import { mapRelationships } from "../../src/relationships.js";
import {
  RELATIONAL_ROW_COUNT,
  RELATIONAL_SHEET_NAMES,
  relationalWorkbookSheets,
  relationalWorkbookXlsx,
} from "./relationalWorkbook.js";

const tables = relationalWorkbookSheets();
const asRelationTable = (sheet: (typeof tables)[number]) => ({
  label: `${sheet.name}!A1:${String.fromCharCode(64 + sheet.headers.length)}${sheet.rows.length + 1}`,
  headers: sheet.headers,
  rows: sheet.rows.map((row) =>
    row.map((cell) =>
      cell !== null && typeof cell === "object" ? cell.date : cell,
    ),
  ),
});

test("relational fixture has ten real worksheets with at least 3,000 rows each", () => {
  assert.deepEqual(
    tables.map((sheet) => sheet.name),
    RELATIONAL_SHEET_NAMES,
  );
  assert.ok(tables.every((sheet) => sheet.rows.length >= RELATIONAL_ROW_COUNT));
  assert.equal(new Set(tables.map((sheet) => sheet.name)).size, 10);
  assert.ok(relationalWorkbookXlsx().subarray(0, 2).equals(Buffer.from("PK")));
});

test("the fixture exposes usable many-to-one relationships and deliberate unmatched keys", () => {
  const selected = tables
    .filter((sheet) =>
      ["Orders", "Customers", "Products", "SalesReps", "Payments"].includes(
        sheet.name,
      ),
    )
    .map(asRelationTable);
  const result = mapRelationships(selected);
  const byColumn = (column: string) =>
    result.links.find(
      (link) => link.from.column === column || link.to.column === column,
    );
  assert.equal(byColumn("Customer ID")?.cardinality, "many-to-one");
  assert.equal(byColumn("Product ID")?.cardinality, "many-to-one");
  assert.ok((byColumn("Customer ID")?.fromRowsWithoutPartner ?? 0) > 0);
  assert.ok((byColumn("Product ID")?.fromRowsWithoutPartner ?? 0) > 0);
});

test("feedback and order lines relate back to the transactional master data", () => {
  const orderLines = tables.find((sheet) => sheet.name === "OrderLines")!;
  const orders = tables.find((sheet) => sheet.name === "Orders")!;
  const customers = tables.find((sheet) => sheet.name === "Customers")!;
  const feedback = tables.find((sheet) => sheet.name === "CustomerFeedback")!;
  const result = mapRelationships(
    [orders, orderLines, customers, feedback].map(asRelationTable),
  );
  assert.ok(
    result.links.some(
      (link) =>
        link.from.column === "Order ID" && link.cardinality === "many-to-one",
    ),
  );
  assert.ok(
    result.links.some(
      (link) =>
        link.from.column === "Customer ID" &&
        link.cardinality === "many-to-one",
    ),
  );
});
