import assert from "node:assert/strict";
import { test } from "node:test";
import { planSheetPolish, polishCreatedSheets } from "./sheetPolish.js";

test("a summary gets its header and total rows found", () => {
  const plan = planSheetPolish([
    ["Segment", "Product", "Total Sales", "Margin %"],
    ["Corporate", "Laptop", 6000, 0.132],
    ["Retail", "Phone", 1200, 0.183],
    ["Grand Total", "", 7200, 0.14],
    ["", "", "", ""],
    ["Orders not in Customers", "", "", ""],
    ["OrderID", "CustomerID", "Product", "Sales"],
    ["O-10", "C-199", "Tablet", 900],
  ]);
  assert.deepEqual(plan.headerRows, [0, 6]);
  assert.deepEqual(plan.totalRows, [3]);
});

test("a one-cell title and a text-only list are not headers", () => {
  const plan = planSheetPolish([
    ["Sales by Region", "", ""],
    ["Note", "Text", "More"],
    ["a", "b", "c"],
  ]);
  assert.deepEqual(plan, { headerRows: [], totalRows: [] });
});

test("a PIVOTBY matrix with a blank corner still gets its header row", () => {
  const plan = planSheetPolish([
    ["", "Laptop", "Phone", "Total"],
    ["North", 600, 440, 1040],
    ["Total", 600, 440, 1040],
  ]);
  assert.deepEqual(plan.headerRows, [0]);
  assert.deepEqual(plan.totalRows, [2]);
});

test("polish styles header and total rows and fits the columns", async () => {
  const styled: string[] = [];
  const values = [
    ["Region", "Sales"],
    ["North", 10],
    ["Total", 10],
  ];
  const cellRange = (row: number) => ({
    getResizedRange: () => ({
      format: {
        fill: {
          set color(v: string) {
            styled.push(`fill ${row} ${v}`);
          },
        },
        font: {
          set bold(v: boolean) {
            styled.push(`bold ${row}`);
          },
          color: "",
        },
        borders: {
          getItem: () => ({
            set style(v: string) {
              styled.push(`line ${row} ${v}`);
            },
            color: "",
          }),
        },
      },
    }),
  });
  const used: any = {
    isNullObject: false,
    values,
    rowCount: 3,
    columnCount: 2,
    load() {},
    getCell: (row: number) => cellRange(row),
    format: { autofitColumns: () => styled.push("autofit") },
  };
  const runtime: any = {
    run: (callback: (context: any) => Promise<unknown>) =>
      callback({
        workbook: {
          worksheets: {
            getItem: () => ({ getUsedRangeOrNullObject: () => used }),
          },
        },
        sync: async () => {},
      }),
  };
  await polishCreatedSheets(runtime, ["Summary"]);
  assert.deepEqual(styled, [
    "fill 0 #1F4E78",
    "bold 0",
    "bold 2",
    "line 2 Continuous",
    "autofit",
  ]);
});
