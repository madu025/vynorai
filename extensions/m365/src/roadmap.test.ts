import assert from "node:assert/strict";
import { test } from "node:test";
import { buildSchemaSummary } from "./analysis.js";
import { createExcelPreviewPlan } from "./excel.js";
import {
  answerQuestion,
  interpretInstruction,
  looksLikeQuestion,
} from "./intent.js";
import { applyApprovedExcelPlan } from "./officeExcel.js";
import {
  cleanRows,
  columnLetter,
  computedColumnFormula,
  isSafeColumnName,
} from "./transform.js";

const headers = ["Month", "Region", "Sales", "Cost"];
const rows = [
  ["Jan", "North", 1200, 800],
  ["Feb", "South", 1500, 950],
  ["Mar", "North", 1800, 1100],
  ["Apr", "East", 1350, 900],
];
const input = {
  workbookId: "book",
  worksheetName: "Sheet1",
  address: "Sheet1!A1:D5",
  hasHeaders: true,
  values: [headers, ...rows],
};

// ---------------------------------------------------------------- R1 clean
test("clean trims, converts numbers stored as text and removes exact duplicates", () => {
  const { rows: cleaned, changes } = cleanRows(
    [
      [" North ", "1,200", "x"],
      ["North", "1200", "x"],
      ["South", "3", "y"],
      ["South", "3", "y"],
    ],
    ["trim", "text-to-number", "dedupe"],
  );
  assert.deepEqual(cleaned, [
    ["North", 1200, "x"],
    ["South", 3, "y"],
  ]);
  assert.deepEqual(changes, { trimmed: 1, converted: 4, duplicatesRemoved: 2 });
  assert.deepEqual(cleanRows([[" a "]], []).rows, [[" a "]]);
});

test("clean converts only unambiguous ISO text dates and records their columns", () => {
  const cleaned = cleanRows(
    [["2026-09-02"], ["03/04/2026"], ["2026-02-29"]],
    ["text-to-date"],
  );
  assert.deepEqual(cleaned.rows, [[46267], ["03/04/2026"], ["2026-02-29"]]);
  assert.deepEqual(cleaned.dateColumns, [0]);
  assert.equal(cleaned.changes.converted, 1);
});

test("clean fills only blank cells with an explicit safe value", () => {
  const cleaned = cleanRows(
    [
      ["North", null],
      ["", 10],
      ["South", "  "],
    ],
    ["fill-blanks"],
    "Unknown",
  );
  assert.deepEqual(cleaned.rows, [
    ["North", "Unknown"],
    ["Unknown", 10],
    ["South", "Unknown"],
  ]);
  assert.equal(cleaned.filledBlanks, 3);
});

test("clean can fill blanks in one named column without touching other columns", () => {
  const cleaned = cleanRows(
    [
      ["Asha", null, 10],
      ["Bimal", "Open", null],
      ["Chamara", "  ", 30],
    ],
    ["fill-blanks"],
    "Unknown",
    1,
  );
  assert.deepEqual(cleaned.rows, [
    ["Asha", "Unknown", 10],
    ["Bimal", "Open", null],
    ["Chamara", "Unknown", 30],
  ]);
  assert.equal(cleaned.filledBlanks, 2);
});

test("fuzzy dedupe removes only rows within one edit of an earlier row", () => {
  const result = cleanRows(
    [
      ["North", 10],
      ["Noth", 10],
      ["South", 20],
    ],
    ["fuzzy-dedupe"],
  );
  assert.deepEqual(result.rows, [
    ["North", 10],
    ["South", 20],
  ]);
  assert.equal(result.changes.duplicatesRemoved, 1);
});

// ---------------------------------------------------------------- R2 computed column
test("computed column formulas come from validated indexes and a fixed operator list", () => {
  assert.equal(columnLetter(0), "A");
  assert.equal(columnLetter(25), "Z");
  assert.equal(columnLetter(26), "AA");
  assert.equal(computedColumnFormula(2, 2, "-", 3), "=C2-D2");
  assert.equal(computedColumnFormula(7, 2, "/", 3), '=IF(D7=0,"",C7/D7)');
  assert.equal(isSafeColumnName("Profit"), true);
  for (const bad of ["=HYPERLINK()", "+cmd", "-1", "@SUM", "", "x".repeat(41)])
    assert.equal(isSafeColumnName(bad), false, bad);
});

test("instructions for a computed column and clean-up are read deterministically", () => {
  const profit = interpretInstruction(
    "Add column Profit = Sales - Cost",
    headers,
  );
  assert.deepEqual(profit.actions, ["add-column"]);
  assert.deepEqual(profit.specs.addColumn, {
    name: "Profit",
    left: 2,
    operator: "-",
    right: 3,
  });
  const words = interpretInstruction(
    "create a column Ratio as Sales divided by Cost",
    headers,
  );
  assert.equal(words.specs.addColumn?.operator, "/");
  const unknown = interpretInstruction(
    "Add column X = Revenue - Cost",
    headers,
  );
  assert.deepEqual(unknown.actions, []);
  assert.match(unknown.problems[0], /existing column names/);
  const clean = interpretInstruction(
    "Clean the data and remove duplicates",
    headers,
  );
  assert.deepEqual(clean.actions, ["clean"]);
  assert.deepEqual(clean.specs.clean?.operations, [
    "trim",
    "text-to-number",
    "dedupe",
  ]);
  assert.deepEqual(
    interpretInstruction("Convert text dates to dates", headers).specs.clean
      ?.operations,
    ["text-to-date"],
  );
  assert.deepEqual(
    interpretInstruction("Fill blank cells with Unknown", headers).specs.clean,
    { operations: ["fill-blanks"], fillBlanks: "Unknown" },
  );
  assert.match(
    interpretInstruction("Fill blank cells", headers).problems[0],
    /what value should replace/,
  );
  assert.deepEqual(
    interpretInstruction("Create a chart.", headers).actions,
    [],
  );
});

test("unpivot intent creates a safe long-format result plan", () => {
  const unpivot = interpretInstruction(
    "Unpivot Sales, Cost into Measure and Amount",
    headers,
  );
  assert.deepEqual(unpivot.actions, ["unpivot"]);
  assert.deepEqual(unpivot.specs.unpivot, {
    values: [2, 3],
    name: "Measure",
    value: "Amount",
  });
  const plan = createExcelPreviewPlan(
    input,
    unpivot.actions,
    500,
    unpivot.specs,
  );
  assert.deepEqual(
    plan.actions.map((action) => action.kind),
    ["unpivot"],
  );
  assert.deepEqual(plan.actions[0].spec, {
    unpivotValueColumns: ["Sales", "Cost"],
    unpivotValueIndexes: [2, 3],
    unpivotNameColumn: "Measure",
    unpivotValueColumn: "Amount",
  });
});

test("running total resolves one numeric source column without guessing", () => {
  const asked = interpretInstruction(
    "Add a running total column for Sales",
    headers,
  );
  assert.deepEqual(asked.actions, ["add-column"]);
  assert.deepEqual(asked.specs.addColumn, {
    name: "Running Total of Sales",
    derived: "running-total",
    source: 2,
  });
  const unknown = interpretInstruction(
    "Add a running total for Revenue",
    headers,
  );
  assert.deepEqual(unknown.actions, []);
  assert.match(unknown.problems[0], /not a column/);
  const noSource = interpretInstruction("Add a running total", headers);
  assert.deepEqual(noSource.actions, []);
  assert.match(noSource.problems[0], /numeric source column/);
});

test("rank resolves one numeric source column without guessing", () => {
  const asked = interpretInstruction("Create a rank column for Sales", headers);
  assert.deepEqual(asked.actions, ["add-column"]);
  assert.deepEqual(asked.specs.addColumn, {
    name: "Rank of Sales",
    derived: "rank",
    source: 2,
  });
  const unknown = interpretInstruction(
    "Create a rank column for Revenue",
    headers,
  );
  assert.deepEqual(unknown.actions, []);
  assert.match(unknown.problems[0], /not a column/);
});

test("percent change resolves one numeric source column without guessing", () => {
  const asked = interpretInstruction(
    "Add a percent change column for Sales",
    headers,
  );
  assert.deepEqual(asked.actions, ["add-column"]);
  assert.deepEqual(asked.specs.addColumn, {
    name: "% Change of Sales",
    derived: "percent-change",
    source: 2,
  });
  const unknown = interpretInstruction(
    "Add a percent change column for Revenue",
    headers,
  );
  assert.deepEqual(unknown.actions, []);
  assert.match(unknown.problems[0], /not a column/);
});

test("moving average resolves a bounded numeric window and source", () => {
  const asked = interpretInstruction(
    "Add a 3-month moving average for Sales",
    headers,
  );
  assert.deepEqual(asked.actions, ["add-column"]);
  assert.deepEqual(asked.specs.addColumn, {
    name: "3-Period Moving Average of Sales",
    derived: "moving-average",
    source: 2,
    window: 3,
  });
  const tooWide = interpretInstruction(
    "Add a 13-month moving average for Sales",
    headers,
  );
  assert.deepEqual(tooWide.actions, []);
  assert.match(tooWide.problems[0], /window from 2 to 12/);
});

test("YoY change resolves a numeric source with a fixed 12-period lag", () => {
  const asked = interpretInstruction("Add YoY change for Sales", headers);
  assert.deepEqual(asked.actions, ["add-column"]);
  assert.deepEqual(asked.specs.addColumn, {
    name: "YoY Change of Sales",
    derived: "yoy",
    source: 2,
    lag: 12,
  });
  const unknown = interpretInstruction("Add YoY change for Revenue", headers);
  assert.deepEqual(unknown.actions, []);
  assert.match(unknown.problems[0], /not a column/);
});

test("date grouping resolves month, quarter and year choices", () => {
  const dateHeaders = ["Date", "Sales"];
  for (const group of ["month", "quarter", "year"] as const) {
    const asked = interpretInstruction(`Group Date by ${group}`, dateHeaders);
    assert.deepEqual(asked.actions, ["add-column"]);
    assert.deepEqual(asked.specs.addColumn, {
      name: `${group[0].toUpperCase()}${group.slice(1)} of Date`,
      derived: "date-group",
      source: 0,
      group,
    });
  }
  const unknown = interpretInstruction(
    "Group Posted Date by month",
    dateHeaders,
  );
  assert.deepEqual(unknown.actions, []);
  assert.match(unknown.problems[0], /not a column/);
});

test("plans for clean and computed column carry validated specs and their own result sheets", () => {
  const plan = createExcelPreviewPlan(
    input as any,
    ["clean", "add-column"],
    undefined,
    {
      clean: { operations: ["trim", "dedupe"] },
      addColumn: { name: "Profit", left: 2, operator: "-", right: 3 },
    },
  );
  assert.deepEqual(
    plan.actions.map((action) => [action.kind, action.targetSheet]),
    [
      ["clean", "Sheet1_Vynor_Clean"],
      ["add-column", "Sheet1_Vynor_Calc"],
    ],
  );
  assert.deepEqual(plan.actions[0].spec, { operations: ["trim", "dedupe"] });
  assert.equal(plan.actions[1].spec?.leftColumn, "Sales");
  const bad = (specs: any, actions: any) =>
    createExcelPreviewPlan(input as any, actions, undefined, specs);
  assert.throws(
    () =>
      bad({ addColumn: { name: "=BAD", left: 2, operator: "-", right: 3 } }, [
        "add-column",
      ]),
    /not allowed/,
  );
  assert.throws(
    () =>
      bad({ addColumn: { name: "P", left: 1, operator: "-", right: 3 } }, [
        "add-column",
      ]),
    /must contain numbers/,
  );
  assert.throws(
    () =>
      bad({ addColumn: { name: "P", left: 2, operator: "^", right: 3 } }, [
        "add-column",
      ]),
    /Unsupported operator/,
  );
  assert.throws(
    () => bad({ clean: { operations: ["trim", "trim"] } }, ["clean"]),
    /valid, unique/,
  );
  assert.throws(
    () => bad({ clean: { operations: ["trim"] } }, ["chart"]),
    /need the clean action/,
  );
  assert.throws(
    () =>
      bad({ clean: { operations: ["fill-blanks"], fillBlanks: "=SUM(A1)" } }, [
        "clean",
      ]),
    /safe replacement value/,
  );
});

// ---------------------------------------------------------------- apply (fake Office.js)
function fakeWorkbook(sourceValues: any[][] = input.values as any[][]) {
  const written: Record<string, any> = {};
  const sheets = new Map<string, any>();
  const nullable = (exists: boolean) => ({ isNullObject: !exists, load() {} });
  const source = (values: any[][]) => ({
    rowCount: values.length,
    columnCount: values[0].length,
    load() {},
    getCell: (row: number) => ({
      getResizedRange: (count: number) => ({
        values: values.slice(row, row + count + 1),
        load() {},
      }),
    }),
  });
  const makeSheet = (name: string) => {
    const sheet: any = {
      getRange: () => source(sourceValues),
      getRangeByIndexes: (
        row: number,
        column: number,
        r: number,
        c: number,
      ) => {
        const key = `${name}!${row},${column},${r},${c}`;
        return new Proxy(
          {},
          {
            set(_t, prop, value) {
              written[`${key}.${String(prop)}`] = value;
              return true;
            },
          },
        );
      },
      charts: { getItemOrNullObject: () => nullable(false) },
    };
    sheets.set(name, sheet);
    return sheet;
  };
  makeSheet("Sheet1");
  const workbook = {
    worksheets: {
      getItem: (name: string) => sheets.get(name),
      getItemOrNullObject: (name: string) =>
        sheets.has(name)
          ? Object.assign(sheets.get(name), { isNullObject: false, load() {} })
          : nullable(false),
      add: (name: string) => makeSheet(name),
    },
    tables: { getItemOrNullObject: () => nullable(false) },
    pivotTables: { getItemOrNullObject: () => nullable(false) },
  };
  return {
    written,
    runtime: {
      run: <T>(callback: (context: any) => Promise<T>) =>
        callback({ workbook, sync: async () => undefined }),
    },
  };
}

test("apply writes the cleaned copy and the computed column to separate sheets only", async () => {
  const plan = createExcelPreviewPlan(
    input as any,
    ["clean", "add-column"],
    undefined,
    {
      clean: { operations: ["trim"] },
      addColumn: { name: "Profit", left: 2, operator: "-", right: 3 },
    },
  );
  const excel = fakeWorkbook();
  const report = await applyApprovedExcelPlan(
    excel.runtime,
    plan,
    true,
    "approval",
    {
      expectedSourceFingerprint: plan.sourceFingerprint,
    },
  );
  assert.deepEqual(
    report.results.map((result) => result.status),
    ["created", "created"],
  );
  assert.equal(report.sourceUnchangedAfterApply, true);
  const keys = Object.keys(excel.written);
  assert.ok(keys.every((key) => !key.startsWith("Sheet1!")));
  const cleanValues = excel.written["Cleaned Sheet1!0,0,5,4.values"];
  assert.deepEqual(cleanValues[0], headers);
  const calcValues = excel.written["Calc of Sheet1!0,0,5,5.values"];
  assert.deepEqual(calcValues[0], [...headers, "Profit"]);
  const formulas = excel.written["Calc of Sheet1!1,4,4,1.formulas"];
  assert.deepEqual(formulas, [["=C2-D2"], ["=C3-D3"], ["=C4-D4"], ["=C5-D5"]]);
});

test("apply writes running-total formulas to a new result sheet only", async () => {
  const plan = createExcelPreviewPlan(input as any, ["add-column"], undefined, {
    addColumn: {
      name: "Running Total of Sales",
      derived: "running-total",
      source: 2,
    },
  });
  const excel = fakeWorkbook();
  const report = await applyApprovedExcelPlan(
    excel.runtime,
    plan,
    true,
    "approval",
    { expectedSourceFingerprint: plan.sourceFingerprint },
  );
  assert.deepEqual(
    report.results.map((result) => result.status),
    ["created"],
  );
  assert.equal(report.sourceUnchangedAfterApply, true);
  assert.deepEqual(excel.written["Calc of Sheet1!0,0,5,5.values"][0], [
    ...headers,
    "Running Total of Sales",
  ]);
  assert.deepEqual(excel.written["Calc of Sheet1!1,4,4,1.formulas"], [
    ["=SUM($C$2:C2)"],
    ["=SUM($C$2:C3)"],
    ["=SUM($C$2:C4)"],
    ["=SUM($C$2:C5)"],
  ]);
  assert.ok(
    Object.keys(excel.written).every((key) => !key.startsWith("Sheet1!")),
  );
});

test("apply writes rank formulas to a new result sheet only", async () => {
  const plan = createExcelPreviewPlan(input as any, ["add-column"], undefined, {
    addColumn: { name: "Rank of Sales", derived: "rank", source: 2 },
  });
  const excel = fakeWorkbook();
  const report = await applyApprovedExcelPlan(
    excel.runtime,
    plan,
    true,
    "approval",
    { expectedSourceFingerprint: plan.sourceFingerprint },
  );
  assert.deepEqual(
    report.results.map((result) => result.status),
    ["created"],
  );
  assert.equal(report.sourceUnchangedAfterApply, true);
  assert.deepEqual(excel.written["Calc of Sheet1!1,4,4,1.formulas"], [
    ["=RANK.EQ(C2,$C$2:$C$5,0)"],
    ["=RANK.EQ(C3,$C$2:$C$5,0)"],
    ["=RANK.EQ(C4,$C$2:$C$5,0)"],
    ["=RANK.EQ(C5,$C$2:$C$5,0)"],
  ]);
  assert.ok(
    Object.keys(excel.written).every((key) => !key.startsWith("Sheet1!")),
  );
});

test("apply writes percent-change formulas and formatting to a new result sheet", async () => {
  const plan = createExcelPreviewPlan(input as any, ["add-column"], undefined, {
    addColumn: {
      name: "% Change of Sales",
      derived: "percent-change",
      source: 2,
    },
  });
  const excel = fakeWorkbook();
  const report = await applyApprovedExcelPlan(
    excel.runtime,
    plan,
    true,
    "approval",
    { expectedSourceFingerprint: plan.sourceFingerprint },
  );
  assert.deepEqual(
    report.results.map((result) => result.status),
    ["created"],
  );
  assert.deepEqual(excel.written["Calc of Sheet1!1,4,4,1.formulas"], [
    ['=""'],
    ['=IFERROR((C3-C2)/C2,"")'],
    ['=IFERROR((C4-C3)/C3,"")'],
    ['=IFERROR((C5-C4)/C4,"")'],
  ]);
  assert.deepEqual(excel.written["Calc of Sheet1!1,4,4,1.numberFormat"], [
    ["0.0%"],
    ["0.0%"],
    ["0.0%"],
    ["0.0%"],
  ]);
  assert.equal(report.sourceUnchangedAfterApply, true);
});

test("apply writes moving-average formulas to a new result sheet", async () => {
  const plan = createExcelPreviewPlan(input as any, ["add-column"], undefined, {
    addColumn: {
      name: "3-Period Moving Average of Sales",
      derived: "moving-average",
      source: 2,
      window: 3,
    },
  });
  const excel = fakeWorkbook();
  const report = await applyApprovedExcelPlan(
    excel.runtime,
    plan,
    true,
    "approval",
    { expectedSourceFingerprint: plan.sourceFingerprint },
  );
  assert.deepEqual(excel.written["Calc of Sheet1!1,4,4,1.formulas"], [
    ['=""'],
    ['=""'],
    ["=AVERAGE(C2:C4)"],
    ["=AVERAGE(C3:C5)"],
  ]);
  assert.equal(report.sourceUnchangedAfterApply, true);
});

test("apply writes YoY formulas and percent formatting to a new result sheet", async () => {
  const values = [
    headers,
    ...Array.from({ length: 13 }, (_, index) => [
      `M${index + 1}`,
      "North",
      100 + index * 10,
      50,
    ]),
  ];
  const yoyInput = {
    ...input,
    address: "Sheet1!A1:D14",
    values,
  };
  const plan = createExcelPreviewPlan(
    yoyInput as any,
    ["add-column"],
    undefined,
    {
      addColumn: {
        name: "YoY Change of Sales",
        derived: "yoy",
        source: 2,
        lag: 12,
      },
    },
  );
  const excel = fakeWorkbook(values);
  const report = await applyApprovedExcelPlan(
    excel.runtime,
    plan,
    true,
    "approval",
    { expectedSourceFingerprint: plan.sourceFingerprint },
  );
  assert.deepEqual(
    excel.written["Calc of Sheet1!1,4,13,1.formulas"].slice(0, 12),
    Array.from({ length: 12 }, () => ['=""']),
  );
  assert.deepEqual(excel.written["Calc of Sheet1!1,4,13,1.formulas"][12], [
    '=IFERROR((C14-C2)/C2,"")',
  ]);
  assert.deepEqual(
    excel.written["Calc of Sheet1!1,4,13,1.numberFormat"],
    Array.from({ length: 13 }, () => ["0.0%"]),
  );
  assert.equal(report.sourceUnchangedAfterApply, true);
});

test("apply writes date-group formulas to a new result sheet", async () => {
  const dateValues = [
    ["Date", "Sales"],
    [44927, 100],
    [44958, 110],
    [45017, 120],
  ];
  const dateInput = {
    ...input,
    address: "Sheet1!A1:B4",
    values: dateValues,
  };
  const plan = createExcelPreviewPlan(
    dateInput as any,
    ["add-column"],
    undefined,
    {
      addColumn: {
        name: "Month of Date",
        derived: "date-group",
        source: 0,
        group: "month",
      },
    },
  );
  const excel = fakeWorkbook(dateValues);
  const report = await applyApprovedExcelPlan(
    excel.runtime,
    plan,
    true,
    "approval",
    { expectedSourceFingerprint: plan.sourceFingerprint },
  );
  assert.deepEqual(excel.written["Calc of Sheet1!1,2,3,1.formulas"], [
    ['=TEXT(A2,"yyyy-mm")'],
    ['=TEXT(A3,"yyyy-mm")'],
    ['=TEXT(A4,"yyyy-mm")'],
  ]);
  assert.equal(report.sourceUnchangedAfterApply, true);
});

test("combine intent plans and applies a formula without changing the source", async () => {
  const combineInput = {
    ...input,
    values: [
      ["Region", "Status"],
      ["North", "Active"],
      ["South", "Paused"],
    ],
    address: "Sheet1!A1:B3",
  };
  const asked = interpretInstruction(
    "Combine Region and Status into one column",
    ["Region", "Status"],
    combineInput.values.slice(1),
  );
  assert.deepEqual(asked.actions, ["add-column"]);
  assert.equal(asked.specs.addColumn?.derived, "combine");
  const plan = createExcelPreviewPlan(
    combineInput as any,
    ["add-column"],
    undefined,
    asked.specs,
  );
  const excel = fakeWorkbook(combineInput.values as any[][]);
  const report = await applyApprovedExcelPlan(
    excel.runtime,
    plan,
    true,
    "approval",
    { expectedSourceFingerprint: plan.sourceFingerprint },
  );
  assert.deepEqual(excel.written["Calc of Sheet1!1,2,2,1.formulas"], [
    ['=A2&" - "&B2'],
    ['=A3&" - "&B3'],
  ]);
  assert.equal(report.sourceUnchangedAfterApply, true);
});

test("split intent plans and applies first/last formulas on a new sheet", async () => {
  const splitInput = {
    ...input,
    address: "Sheet1!A1:B3",
    values: [
      ["Customer", "Sales"],
      ["Prasad Dissanayake", 100],
      ["Nimal Perera", 200],
    ],
  };
  const asked = interpretInstruction(
    "Split Customer into first and last name columns",
    ["Customer", "Sales"],
    splitInput.values.slice(1),
  );
  assert.deepEqual(asked.actions, ["split-column"]);
  const plan = createExcelPreviewPlan(
    splitInput as any,
    ["split-column"],
    undefined,
    asked.specs,
  );
  const excel = fakeWorkbook(splitInput.values as any[][]);
  const report = await applyApprovedExcelPlan(
    excel.runtime,
    plan,
    true,
    "approval",
    {
      expectedSourceFingerprint: plan.sourceFingerprint,
    },
  );
  const formulaKey = Object.keys(excel.written).find((key) =>
    key.endsWith("!1,2,2,2.formulas"),
  );
  assert.ok(formulaKey);
  assert.deepEqual(excel.written[formulaKey], [
    [
      '=IFERROR(LEFT(A2,FIND(" ",A2&" ")-1),"")',
      '=IFERROR(TRIM(MID(A2,FIND(" ",A2&" ")+1,999)),"")',
    ],
    [
      '=IFERROR(LEFT(A3,FIND(" ",A3&" ")-1),"")',
      '=IFERROR(TRIM(MID(A3,FIND(" ",A3&" ")+1,999)),"")',
    ],
  ]);
  assert.equal(report.sourceUnchangedAfterApply, true);
});

test("apply writes converted ISO dates only to a formatted clean result sheet", async () => {
  const dateInput = {
    workbookId: "book",
    worksheetName: "Sheet1",
    address: "Sheet1!A1:B3",
    hasHeaders: true,
    values: [
      ["Date", "Sales"],
      ["2026-09-02", 1200],
      ["03/04/2026", 1500],
    ],
  };
  const plan = createExcelPreviewPlan(dateInput as any, ["clean"], undefined, {
    clean: { operations: ["text-to-date"] },
  });
  const excel = fakeWorkbook(dateInput.values as any[][]);
  await applyApprovedExcelPlan(excel.runtime, plan, true, "approval", {
    expectedSourceFingerprint: plan.sourceFingerprint,
  });

  assert.deepEqual(excel.written["Cleaned Sheet1!0,0,3,2.values"], [
    ["Date", "Sales"],
    [46267, 1200],
    // Ambiguous locale dates stay text: the apostrophe stops Excel from parsing them on write.
    ["'03/04/2026", 1500],
  ]);
  assert.deepEqual(excel.written["Cleaned Sheet1!1,0,2,1.numberFormat"], [
    ["yyyy-mm-dd"],
    ["yyyy-mm-dd"],
  ]);
  assert.ok(
    Object.keys(excel.written).every((key) => !key.startsWith("Sheet1!")),
  );
});

test("apply keeps identifier text with leading zeros as text in the clean result", async () => {
  const idInput = {
    workbookId: "book",
    worksheetName: "Sheet1",
    address: "Sheet1!A1:B4",
    hasHeaders: true,
    values: [
      ["Service ID", "Sales"],
      ["0112559962", 10],
      [" 007 ", 20],
      ["North", 30],
    ],
  };
  const plan = createExcelPreviewPlan(idInput as any, ["clean"], undefined, {
    clean: { operations: ["trim", "text-to-number"] },
  });
  const excel = fakeWorkbook(idInput.values as any[][]);
  await applyApprovedExcelPlan(excel.runtime, plan, true, "approval", {
    expectedSourceFingerprint: plan.sourceFingerprint,
  });
  assert.deepEqual(excel.written["Cleaned Sheet1!0,0,4,2.values"], [
    ["Service ID", "Sales"],
    ["'0112559962", 10],
    ["'007", 20],
    ["North", 30],
  ]);
});

test("apply fills blanks on a new result sheet and never the source sheet", async () => {
  const fillInput = {
    workbookId: "book",
    worksheetName: "Sheet1",
    address: "Sheet1!A1:B3",
    hasHeaders: true,
    values: [
      ["Region", "Sales"],
      ["North", null],
      ["South", 1500],
    ],
  };
  const plan = createExcelPreviewPlan(fillInput as any, ["clean"], undefined, {
    clean: { operations: ["fill-blanks"], fillBlanks: 0 },
  });
  const excel = fakeWorkbook(fillInput.values as any[][]);
  await applyApprovedExcelPlan(excel.runtime, plan, true, "approval", {
    expectedSourceFingerprint: plan.sourceFingerprint,
  });
  assert.deepEqual(excel.written["Cleaned Sheet1!0,0,3,2.values"], [
    ["Region", "Sales"],
    ["North", 0],
    ["South", 1500],
  ]);
  assert.ok(
    Object.keys(excel.written).every((key) => !key.startsWith("Sheet1!")),
  );
});

test("apply fills only the requested column on a new result sheet", async () => {
  const fillInput = {
    workbookId: "book",
    worksheetName: "Sheet1",
    address: "Sheet1!A1:C3",
    hasHeaders: true,
    values: [
      ["Customer", "Status", "Sales"],
      ["Asha", null, null],
      ["Bimal", "Open", 1500],
    ],
  };
  const plan = createExcelPreviewPlan(fillInput as any, ["clean"], undefined, {
    clean: {
      operations: ["fill-blanks"],
      fillBlanks: "Unknown",
      fillBlanksColumn: 1,
    },
  });
  const excel = fakeWorkbook(fillInput.values as any[][]);
  await applyApprovedExcelPlan(excel.runtime, plan, true, "approval", {
    expectedSourceFingerprint: plan.sourceFingerprint,
  });
  assert.deepEqual(excel.written["Cleaned Sheet1!0,0,3,3.values"], [
    ["Customer", "Status", "Sales"],
    ["Asha", "Unknown", null],
    ["Bimal", "Open", 1500],
  ]);
  assert.ok(
    Object.keys(excel.written).every((key) => !key.startsWith("Sheet1!")),
  );
});

// ---------------------------------------------------------------- R3 local questions
test("simple questions are answered locally from the selected rows", () => {
  const ask = (q: string) => answerQuestion(q, headers, rows)?.answer;
  assert.equal(looksLikeQuestion("Which region has the highest sales?"), true);
  assert.equal(looksLikeQuestion("Create a chart."), false);
  assert.match(
    ask("Which region has the highest sales?")!,
    /North has the highest Sales: 3,000/,
  );
  assert.match(
    ask("lowest Region by Sales")!,
    /East has the lowest Sales: 1,350/,
  );
  assert.match(ask("What is the total sales?")!, /Total Sales: 5,850/);
  assert.match(ask("average cost")!, /Average Cost: 937.5/);
  assert.match(ask("how many rows are there?")!, /4 data rows/);
  assert.equal(ask("what is the meaning of life?"), undefined);
});

// ---------------------------------------------------------------- R0 eval harness
const BANK = [
  {
    header: "Customer ID",
    values: ["CUST-1", "CUST-2", "CUST-3", "CUST-4", "CUST-5", "CUST-6"],
    role: "identifier",
  },
  {
    header: "Email",
    values: ["a@x.com", "b@x.com", "c@x.com", "d@x.com"],
    role: "identifier",
  },
  {
    header: "Month",
    values: ["Jan", "Feb", "Mar", "Apr", "May", "Jun"],
    role: "date",
  },
  {
    header: "Quarter",
    values: ["Q1", "Q1", "Q2", "Q2", "Q3", "Q3"],
    role: "date",
  },
  {
    header: "Order date",
    values: [
      "2026-01-02",
      "2026-01-09",
      "2026-02-01",
      "2026-02-11",
      "2026-03-05",
      "2026-03-30",
    ],
    role: "date",
  },
  {
    header: "Region",
    values: ["North", "South", "North", "East", "South", "East"],
    role: "category",
  },
  {
    header: "Status",
    values: ["Paid", "Open", "Paid", "Paid", "Open", "Paid"],
    role: "category",
  },
  {
    header: "Sales",
    values: [1200, 1500, 1800, 1350, 2100, 900],
    role: "measure",
  },
  {
    header: "Cost",
    values: [800, 950.5, 1100, 900, 1300, 700],
    role: "measure",
  },
  { header: "Quantity", values: [3, 5, 2, 8, 1, 4], role: "measure" },
];

test("eval: deterministic role detection meets the accuracy floor on the synthetic bank", () => {
  let correct = 0;
  for (const entry of BANK) {
    const summary = buildSchemaSummary({
      ...input,
      address: "A1:B7",
      values: [[entry.header], ...entry.values.map((value) => [value])],
    } as any);
    if (summary.columns[0].roleHint === entry.role) correct += 1;
    else
      console.log(
        `eval miss: ${entry.header} -> ${summary.columns[0].roleHint}`,
      );
  }
  assert.ok(correct / BANK.length >= 0.9, `accuracy ${correct}/${BANK.length}`);
});

test("a bare chart request is column-aware with a line chart over a time column", () => {
  const monthly = ["Month", "Region", "Sales", "Cost"];
  const rows = [
    ["Jan", "North", 1200, 800],
    ["Feb", "South", 1500, 950],
  ];
  const chart = interpretInstruction("Create a chart.", monthly, rows);
  assert.deepEqual(chart.actions, ["chart"]);
  assert.deepEqual(chart.specs.chart, {
    category: 0,
    value: 2,
    chartType: "line",
    extraValues: [3],
  });
});
