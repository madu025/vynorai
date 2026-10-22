import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ExpressionError,
  expressionToFormula,
  numericColumnRefs,
  parseExpression,
} from "./expression.js";

const headers = ["Name", "Dept", "Sales", "Cost", "Joined", "Note"];
const cell = (index: number) => `${String.fromCharCode(65 + index)}2`;
const formula = (text: string) =>
  expressionToFormula(parseExpression(text, headers).ast, cell);

test("group B: logic functions and comparisons", () => {
  assert.equal(
    formula('IF(Sales > 1500, "High", "Low")'),
    '=IF((C2>1500),"High","Low")',
  );
  assert.equal(
    formula('IFS(Sales>=2000,"A",Sales>=1000,"B",TRUE,"C")'),
    '=IFS((C2>=2000),"A",(C2>=1000),"B",TRUE,"C")',
  );
  assert.equal(
    formula('IF(AND(Sales>1000,Cost<500),"Good","Check")'),
    '=IF(AND((C2>1000),(D2<500)),"Good","Check")',
  );
  assert.equal(formula("IFERROR(Sales/Cost,0)"), "=IFERROR((C2/D2),0)");
});

test("group C: text functions", () => {
  assert.equal(formula("TRIM(Name)"), "=TRIM(A2)");
  assert.equal(formula("UPPER(LEFT(Name, 3))"), "=UPPER(LEFT(A2,3))");
  assert.equal(formula('Name & " - " & Dept'), '=((A2&" - ")&B2)');
  assert.equal(
    formula('SUBSTITUTE(Note, "-", " ")'),
    '=SUBSTITUTE(F2,"-"," ")',
  );
  assert.equal(
    formula('TEXTJOIN(", ", TRUE, Name, Dept)'),
    '=TEXTJOIN(", ",TRUE,A2,B2)',
  );
  assert.equal(formula('TEXT(Sales, "#,##0.0")'), '=TEXT(C2,"#,##0.0")');
  assert.equal(formula("MID(Name, 2, 3)"), "=MID(A2,2,3)");
});

test("group D: date functions", () => {
  assert.equal(formula("YEAR(Joined)"), "=YEAR(E2)");
  assert.equal(
    formula('DATEDIF(Joined, TODAY(), "m")'),
    '=DATEDIF(E2,TODAY(),"m")',
  );
  assert.equal(formula("EOMONTH(Joined, 1)"), "=EOMONTH(E2,1)");
  assert.equal(
    formula("NETWORKDAYS(Joined, TODAY())"),
    "=NETWORKDAYS(E2,TODAY())",
  );
  assert.equal(formula('TEXT(Joined, "yyyy-mm")'), '=TEXT(E2,"yyyy-mm")');
});

test("only math operands must hold numbers; text and date functions accept text columns", () => {
  const numberRefs = (text: string) =>
    numericColumnRefs(parseExpression(text, headers).ast);
  assert.deepEqual(numberRefs('IF(Sales > 1500, "High", "Low")'), []);
  assert.deepEqual(numberRefs("UPPER(Name)"), []);
  assert.deepEqual(numberRefs("Sales - Cost"), [2, 3]);
  assert.deepEqual(numberRefs("ROUND(Sales, 1)"), [2]);
  assert.deepEqual(numberRefs("YEAR(Joined)"), []);
});

test("anything unsafe is still rejected", () => {
  const bad = (text: string, pattern: RegExp) =>
    assert.throws(
      () => parseExpression(text, headers),
      (error) => {
        assert.ok(error instanceof ExpressionError);
        assert.match((error as Error).message, pattern);
        return true;
      },
    );
  bad('INDIRECT("A1")', /not supported/);
  bad('HYPERLINK("http://x", Name)', /not supported/);
  bad("Sheet2!A1 + Sales", /Unsupported character/);
  bad('TEXT(Sales, "<script>")', /simple format/);
  bad('DATEDIF(Joined, TODAY(), "x")', /unit/);
  bad('IFS(Sales>1,"a",Sales)', /pairs/);
  bad("IF(Sales>1)", /wrong number/);
  bad('"unclosed', /not closed/);
  bad(`"${"x".repeat(81)}"`, /limited/);
  bad("Name & ", /ends too early/);
});

import { interpretInstruction } from "./intent.js";
import { createExcelPreviewPlan } from "./excel.js";
import { buildLookupFormula } from "./officeExcel.js";

test("group A: a lookup request names the sheet, the column and the key", () => {
  const staffHeaders = ["Name", "Dept", "Sales"];
  const rows = [["Amal", "IT", 10]];
  const found = interpretInstruction(
    "Add column Manager from Staff by Name",
    staffHeaders,
    rows,
  );
  assert.deepEqual(found.actions, ["add-column"]);
  assert.deepEqual(found.specs.lookup, {
    sheet: "Staff",
    returnHeader: "Manager",
    keyHeader: "Name",
  });
  const quoted = interpretInstruction(
    "lookup Manager from 'Staff list' using name",
    staffHeaders,
    rows,
  );
  assert.equal(quoted.specs.lookup?.sheet, "Staff list");
  const unknownKey = interpretInstruction(
    "Add column Manager from Staff by Employee",
    staffHeaders,
    rows,
  );
  assert.deepEqual(unknownKey.actions, []);
  assert.match(unknownKey.problems[0], /not a column/);
});

test("group A: a lookup column plan is explicit and rejects unusable choices", () => {
  const input = {
    workbookId: "w",
    worksheetName: "Sheet1",
    address: "Sheet1!A1:C3",
    hasHeaders: true,
    values: [
      ["Name", "Dept", "Sales"],
      ["Amal", "IT", 10],
      ["Nimali", "HR", 20],
    ],
  } as any;
  const plan = createExcelPreviewPlan(input, ["add-column"], 500, {
    addColumn: {
      name: "Manager",
      lookup: {
        sheet: "Staff",
        sourceKey: 0,
        keyIndex: 0,
        keyHeader: "Name",
        returnIndex: 2,
        returnHeader: "Manager",
        rows: 40,
      },
    },
  });
  const spec = plan.actions.find((a) => a.kind === "add-column")!.spec!;
  assert.equal(spec.lookupSheet, "Staff");
  assert.equal(spec.lookupRows, 40);
  assert.equal(spec.sourceKeyColumn, "Name");
  const bad = (lookup: Record<string, unknown>) =>
    createExcelPreviewPlan(input, ["add-column"], 500, {
      addColumn: { name: "X", lookup: { ...(lookup as any) } },
    } as any);
  const good = {
    sheet: "Staff",
    sourceKey: 0,
    keyIndex: 0,
    keyHeader: "Name",
    returnIndex: 2,
    returnHeader: "Manager",
    rows: 5,
  };
  assert.throws(() => bad({ ...good, sheet: "A:B" }), /not valid/);
  assert.throws(() => bad({ ...good, sourceKey: 9 }), /not valid/);
  assert.throws(() => bad({ ...good, returnIndex: 0 }), /not valid/);
  assert.throws(() => bad({ ...good, rows: 0 }), /not valid/);
});

test("group A: a lookup can match two key columns", () => {
  const found = interpretInstruction(
    "Add column Manager from Staff by Name and Customer",
    ["Name", "Customer", "Sales"],
    [["Amal", "A-1", 10]],
  );
  assert.deepEqual(found.specs.lookup, {
    sheet: "Staff",
    returnHeader: "Manager",
    keyHeader: "Name",
    keyHeaders: ["Name", "Customer"],
  });
  const input = {
    workbookId: "w",
    worksheetName: "Sheet1",
    address: "Sheet1!A1:D3",
    hasHeaders: true,
    values: [
      ["Name", "Customer", "Region", "Sales"],
      ["Amal", "A-1", "North", 10],
      ["Nimali", "N-2", "South", 20],
    ],
  } as any;
  const plan = createExcelPreviewPlan(input, ["add-column"], 500, {
    addColumn: {
      name: "Manager",
      lookup: {
        sheet: "Staff",
        sourceKey: 0,
        keyIndex: 0,
        keyHeader: "Name",
        returnIndex: 3,
        returnHeader: "Manager",
        rows: 40,
        sourceKeys: [0, 1],
        keyIndexes: [0, 1],
        keyHeaders: ["Name", "Customer"],
      },
    },
  });
  assert.deepEqual(plan.actions[0].spec?.sourceKeyIndexes, [0, 1]);
  assert.deepEqual(plan.actions[0].spec?.lookupKeyIndexes, [0, 1]);
  assert.equal(
    buildLookupFormula("Staff", 2, [0, 1], [0, 1], 3, 40),
    `=IFERROR(INDEX('Staff'!D$2:D41,MATCH(1,INDEX(('Staff'!A$2:A41=A2)*('Staff'!B$2:B41=B2),0),0)),"")`,
  );
});

test("group A: a lookup can return multiple columns on one result sheet", () => {
  const found = interpretInstruction(
    "Add columns Manager and Department from Staff by Name",
    ["Name", "Sales"],
    [["Amal", 10]],
  );
  assert.deepEqual(found.actions, ["lookup-columns"]);
  assert.deepEqual(found.specs.lookupColumns, {
    sheet: "Staff",
    returnHeaders: ["Manager", "Department"],
    keyHeader: "Name",
  });
  const input = {
    workbookId: "w",
    worksheetName: "Sheet1",
    address: "Sheet1!A1:B3",
    hasHeaders: true,
    values: [
      ["Name", "Sales"],
      ["Amal", 10],
      ["Nimali", 20],
    ],
  } as any;
  const plan = createExcelPreviewPlan(input, ["lookup-columns"], 500, {
    lookupColumns: {
      names: ["Manager", "Department"],
      lookup: {
        sheet: "Staff",
        sourceKey: 0,
        keyIndex: 0,
        keyHeader: "Name",
        returnIndexes: [1, 2],
        returnHeaders: ["Manager", "Department"],
        rows: 40,
      },
    },
  });
  assert.equal(plan.actions[0].targetSheet, "Sheet1_Vynor_Lookup");
  assert.deepEqual(plan.actions[0].spec?.lookupReturnIndexes, [1, 2]);
  assert.deepEqual(plan.actions[0].spec?.lookupReturnHeaders, [
    "Manager",
    "Department",
  ]);
});

test("group A: lookup method choice is explicit and deterministic", () => {
  const xlookup = interpretInstruction(
    "Add column Manager from Staff by Name using XLOOKUP",
    ["Name", "Sales"],
    [["Amal", 10]],
  );
  assert.equal(xlookup.specs.lookup?.method, "xlookup");
  const leadingXlookup = interpretInstruction(
    "XLOOKUP Manager from Staff by Name",
    ["Name", "Sales"],
    [["Amal", 10]],
  );
  assert.equal(leadingXlookup.specs.lookup?.method, "xlookup");
  const indexMatch = interpretInstruction(
    "Add column Manager from Staff by Name using INDEX/MATCH",
    ["Name", "Sales"],
    [["Amal", 10]],
  );
  assert.equal(indexMatch.specs.lookup?.method, "index-match");
  const plan = createExcelPreviewPlan(
    {
      workbookId: "w",
      worksheetName: "Sheet1",
      address: "Sheet1!A1:B2",
      hasHeaders: true,
      values: [
        ["Name", "Sales"],
        ["Amal", 10],
      ],
    } as any,
    ["add-column"],
    500,
    {
      addColumn: {
        name: "Manager",
        lookup: {
          sheet: "Staff",
          sourceKey: 0,
          keyIndex: 0,
          keyHeader: "Name",
          returnIndex: 1,
          returnHeader: "Manager",
          rows: 20,
          method: "xlookup",
        },
      },
    },
  );
  assert.equal(plan.actions[0].spec?.lookupMethod, "xlookup");
  assert.equal(
    buildLookupFormula("Staff", 2, [0], [0], 1, 20, "exact", "xlookup"),
    `=IFERROR(XLOOKUP(A2,'Staff'!A$2:A21,'Staff'!B$2:B21,""),"")`,
  );
  assert.throws(
    () =>
      createExcelPreviewPlan(
        {
          workbookId: "w",
          worksheetName: "Sheet1",
          address: "Sheet1!A1:B2",
          hasHeaders: true,
          values: [
            ["Sales", "Rate"],
            [100, 0.1],
          ],
        } as any,
        ["add-column"],
        500,
        {
          addColumn: {
            name: "Rate",
            lookup: {
              sheet: "Rates",
              sourceKey: 0,
              keyIndex: 0,
              keyHeader: "Sales",
              returnIndex: 1,
              returnHeader: "Rate",
              rows: 20,
              method: "xlookup",
              matchMode: "approximate",
            },
          },
        } as any,
      ),
    /not valid/,
  );
});

test("group A: approximate lookup is explicit and remains single-key", () => {
  const found = interpretInstruction(
    "Add column Tax Rate from Rates by Sales approximate",
    ["Sales", "Region"],
    [[100, "North"]],
  );
  assert.equal(found.specs.lookup?.matchMode, "approximate");
  const plan = createExcelPreviewPlan(
    {
      workbookId: "w",
      worksheetName: "Sheet1",
      address: "Sheet1!A1:B2",
      hasHeaders: true,
      values: [
        ["Sales", "Region"],
        [100, "North"],
      ],
    } as any,
    ["add-column"],
    500,
    {
      addColumn: {
        name: "Tax Rate",
        lookup: {
          sheet: "Rates",
          sourceKey: 0,
          keyIndex: 0,
          keyHeader: "Sales",
          returnIndex: 1,
          returnHeader: "Tax Rate",
          rows: 20,
          matchMode: "approximate",
        },
      },
    },
  );
  assert.equal(plan.actions[0].spec?.lookupMatchMode, "approximate");
  assert.throws(
    () =>
      createExcelPreviewPlan(
        {
          workbookId: "w",
          worksheetName: "Sheet1",
          address: "Sheet1!A1:C2",
          hasHeaders: true,
          values: [
            ["Sales", "Region", "Cost"],
            [100, "North", 50],
          ],
        } as any,
        ["add-column"],
        500,
        {
          addColumn: {
            name: "Tax Rate",
            lookup: {
              sheet: "Rates",
              sourceKey: 0,
              keyIndex: 0,
              keyHeader: "Sales",
              returnIndex: 2,
              returnHeader: "Tax Rate",
              rows: 20,
              sourceKeys: [0, 1],
              keyIndexes: [0, 1],
              keyHeaders: ["Sales", "Region"],
              matchMode: "approximate",
            },
          },
        } as any,
      ),
    /not valid/,
  );
  assert.equal(
    buildLookupFormula("Rates", 2, [0], [0], 1, 20, "approximate"),
    `=IFERROR(INDEX('Rates'!B$2:B21,MATCH(A2,'Rates'!A$2:A21,1)),"")`,
  );
});
