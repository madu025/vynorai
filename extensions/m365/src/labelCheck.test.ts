import assert from "node:assert/strict";
import { test } from "node:test";
import { checkLabelGrouping } from "./labelCheck.js";

const grid: Record<string, string[]> = {
  Orders: ["Order ID", "Customer ID", "Region ID", "Net Amount"],
  Regions: ["Region ID", "Region Name", "Country"],
  Customers: ["Customer ID", "Name"],
};
const host: any = {
  getWorkbook: async () => ({
    sheets: Object.keys(grid).map((name) => ({ name })),
  }),
  readRange: async (sheet: string, address: string) => {
    const heads = grid[sheet];
    const column = address.charCodeAt(0) - 65;
    return {
      address,
      values: address.endsWith("1:Z1") ? [heads] : [[heads[column] ?? ""]],
    };
  },
};
const change = (formula: string, fillRange?: string): any => ({
  change: {
    kind: "write_formula",
    sheet: "Sales Summary",
    cell: "A7",
    formula,
    fillRange,
  },
});
const byId = "=GROUPBY('Orders'!C2:C3001,'Orders'!D2:D3001,SUM,0,0)";

test("grouping by an ID column when the request says the entity is sent back with the readable name", async () => {
  const issues = await checkLabelGrouping(
    "total Net Amount by Region",
    [change(byId)],
    host,
  );
  assert.equal(issues.length, 1);
  assert.match(issues[0], /"Region Name" from sheet 'Regions'/);
});

test("naming the ID in the request, grouping by a computed name, or another column is left alone", async () => {
  assert.deepEqual(
    await checkLabelGrouping(
      "total Net Amount by Region ID",
      [change(byId)],
      host,
    ),
    [],
  );
  assert.deepEqual(
    await checkLabelGrouping(
      "total by Region",
      [
        change(
          "=GROUPBY(XLOOKUP('Orders'!C2:C3001,'Regions'!A2:A3001,'Regions'!B2:B3001),'Orders'!D2:D3001,SUM,0,0)",
        ),
      ],
      host,
    ),
    [],
  );
  assert.deepEqual(
    await checkLabelGrouping(
      "total by Order",
      [change("=GROUPBY('Orders'!A2:A3001,'Orders'!D2:D3001,SUM,0,0)")],
      host,
    ),
    [],
  );
});

test("an ID with no name column elsewhere is not flagged, and a failing read never blocks", async () => {
  assert.deepEqual(
    await checkLabelGrouping(
      "total by Customer",
      [change("=GROUPBY('Orders'!B2:B3001,'Orders'!D2:D3001,SUM,0,0)")],
      host,
    ),
    [],
  );
  const broken: any = {
    ...host,
    readRange: async () => {
      throw new Error("x");
    },
  };
  assert.deepEqual(
    await checkLabelGrouping("by Region", [change(byId)], broken),
    [],
  );
});
