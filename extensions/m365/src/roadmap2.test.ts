import assert from "node:assert/strict";
import { test } from "node:test";
import { createExcelPreviewPlan } from "./excel.js";
import {
  LANGUAGE_NAMES,
  loadLanguage,
  nextLanguage,
  translate,
} from "./i18n.js";
import { interpretInstruction, normalizeInstruction } from "./intent.js";
import {
  applyApprovedExcelPlan,
  inspectWorkbookOverview,
  rollbackCreatedItems,
} from "./officeExcel.js";
import {
  MAX_TEXT_CHARS,
  TextConsentError,
  TextTooLongError,
  buildAssistRequest,
  validateAssistResult,
} from "./textAssist.js";
import { applyView } from "./transform.js";

const headers = ["Month", "Region", "Sales", "Cost"];
const rows: any[][] = [
  ["Jan", "North", 1200, 800],
  ["Feb", "South", 1500, 950],
  ["Mar", "North", 1800, 1100],
  ["Apr", "East", 1350, 900],
  ["May", "South", 2100, 1300],
];
const input: any = {
  workbookId: "book",
  worksheetName: "Sheet1",
  address: "Sheet1!A1:D6",
  hasHeaders: true,
  values: [headers, ...rows],
};

// ------------------------------------------------------------------ view engine
test("a view sorts, filters and highlights a copy without touching the rows", () => {
  const original = JSON.stringify(rows);
  const sorted = applyView(rows, { sort: { index: 2, direction: "desc" } });
  assert.deepEqual(
    sorted.rows.map((row) => row[2]),
    [2100, 1800, 1500, 1350, 1200],
  );
  const filtered = applyView(rows, {
    filter: { index: 1, operator: "=", value: "north" },
  });
  assert.equal(filtered.rows.length, 2);
  const greater = applyView(rows, {
    filter: { index: 2, operator: ">", value: 1400 },
    sort: { index: 3, direction: "asc" },
  });
  assert.deepEqual(
    greater.rows.map((row) => row[0]),
    ["Feb", "Mar", "May"],
  );
  const top = applyView(rows, {
    sort: { index: 2, direction: "desc" },
    highlight: { index: 2, rule: "top-n", n: 2 },
  });
  assert.deepEqual(top.highlighted, [0, 1]);
  const above = applyView(rows, {
    highlight: { index: 2, rule: "above-average" },
  });
  assert.deepEqual(above.highlighted, [2, 4]);
  const duplicates = applyView(rows, {
    highlight: { index: 1, rule: "duplicates" },
  });
  assert.deepEqual(duplicates.highlighted, [0, 1, 2, 4]);
  assert.equal(JSON.stringify(rows), original);
});

// ------------------------------------------------------------------ plans (chart v2, pivot v2, view)
test("chart v2, pivot v2 and view specs resolve to header names and validate", () => {
  const plan = createExcelPreviewPlan(
    input,
    ["chart", "pivot-table", "view"],
    undefined,
    {
      chart: {
        category: 1,
        value: 2,
        chartType: "stacked-column",
        extraValues: [3],
      },
      pivot: { rows: 1, values: 2, aggregation: "average", columns: 0 },
      view: {
        sort: { column: 2, direction: "desc" },
        highlight: { column: 2, rule: "top-n", n: 3 },
      },
    },
  );
  const byKind = Object.fromEntries(plan.actions.map((a) => [a.kind, a]));
  assert.equal(byKind.chart.spec?.extraValueColumns?.[0], "Cost");
  assert.equal(byKind["pivot-table"].spec?.aggregation, "average");
  assert.equal(byKind["pivot-table"].spec?.columnsColumn, "Month");
  assert.equal(byKind.view.targetSheet, "Sheet1_Vynor_View");
  assert.equal(byKind.view.spec?.sort?.column, "Sales");

  const bad = (specs: any, actions: any) =>
    createExcelPreviewPlan(input, actions, undefined, specs);
  assert.throws(
    () =>
      bad({ chart: { category: 1, value: 2, chartType: "radar" } }, ["chart"]),
    /Unsupported chart type/,
  );
  assert.throws(
    () =>
      bad(
        {
          chart: {
            category: 1,
            value: 2,
            chartType: "column",
            extraValues: [2],
          },
        },
        ["chart"],
      ),
    /other columns/,
  );
  assert.throws(
    () =>
      bad({ pivot: { rows: 1, values: 2, aggregation: "median" } }, [
        "pivot-table",
      ]),
    /aggregation/,
  );
  assert.throws(() => bad({ view: {} }, ["view"]), /sort, filter or highlight/);
  assert.throws(
    () =>
      bad({ view: { filter: { column: 1, operator: ">", value: 5 } } }, [
        "view",
      ]),
    /numeric column/,
  );
  assert.throws(
    () =>
      bad({ view: { highlight: { column: 2, rule: "top-n", n: 0 } } }, [
        "view",
      ]),
    /1-100/,
  );
});

// ------------------------------------------------------------------ apply (fake Office.js)
function fakeWorkbook() {
  const calls: string[] = [];
  const written: Record<string, any> = {};
  const sheets = new Map<string, any>();
  const nullable = (exists: boolean) => ({ isNullObject: !exists, load() {} });
  const source = () => ({
    rowCount: input.values.length,
    columnCount: headers.length,
    load() {},
    getCell: (row: number) => ({
      getResizedRange: (count: number) => ({
        values: input.values.slice(row, row + count + 1),
        load() {},
      }),
    }),
    getColumn: (index: number) => ({
      label: `col${index}`,
      getOffsetRange: () => ({
        getResizedRange: () => ({ label: `data${index}` }),
      }),
    }),
  });
  const makeSheet = (name: string) => {
    const sheet: any = {
      name,
      delete: () => {
        calls.push(`delete ${name}`);
        sheets.delete(name);
      },
      getRange: () => source(),
      getRangeByIndexes: (r: number, c: number, h: number, w: number) => {
        const key = `${name}!${r},${c},${h},${w}`;
        return new Proxy(
          {},
          {
            get(_t, prop) {
              if (prop === "format")
                return {
                  fill: new Proxy(
                    {},
                    {
                      set(_o, p, value) {
                        written[`${key}.fill.${String(p)}`] = value;
                        return true;
                      },
                    },
                  ),
                };
              return undefined;
            },
            set(_t, prop, value) {
              written[`${key}.${String(prop)}`] = value;
              return true;
            },
          },
        );
      },
      charts: {
        getItemOrNullObject: () => nullable(false),
        add(type: string, _range: any, by: string) {
          calls.push(`chart.add ${type} ${by}`);
          const series = (label: string) => ({
            setValues: () => calls.push(`series.values ${label}`),
            setXAxisValues: () => calls.push(`series.x ${label}`),
          });
          const chart: any = {
            title: {},
            setPosition() {},
            series: {
              getItemAt: () => series("first"),
              add: (name: string) => {
                calls.push(`series.add ${name}`);
                return series(name);
              },
            },
          };
          return chart;
        },
      },
      pivotTables: {
        add() {
          return {
            hierarchies: { getItem: (h: string) => ({ h }) },
            rowHierarchies: { add: (x: any) => calls.push(`rows ${x.h}`) },
            columnHierarchies: {
              add: (x: any) => calls.push(`columns ${x.h}`),
            },
            dataHierarchies: {
              add: (x: any) => {
                calls.push(`values ${x.h}`);
                return new Proxy(
                  {},
                  {
                    set(_o, p, value) {
                      calls.push(`${String(p)} ${value}`);
                      return true;
                    },
                  },
                );
              },
            },
          };
        },
      },
      tables: { add: () => ({}) },
    };
    sheets.set(name, sheet);
    return sheet;
  };
  makeSheet("Sheet1");
  const workbook = {
    worksheets: {
      items: [] as any[],
      load() {},
      getItem: (n: string) => sheets.get(n),
      getItemOrNullObject: (n: string) =>
        sheets.has(n)
          ? Object.assign(sheets.get(n), { isNullObject: false, load() {} })
          : nullable(false),
      add: (n: string) => makeSheet(n),
    },
    tables: {
      items: [] as any[],
      load() {},
      getItemOrNullObject: (n: string) => ({
        isNullObject: n !== "Sheet1_Vynor_table",
        load() {},
        convertToRange: () => calls.push(`convert ${n}`),
      }),
    },
    pivotTables: { getItemOrNullObject: () => nullable(false) },
  };
  return {
    calls,
    written,
    sheets,
    workbook,
    runtime: {
      run: <T>(callback: (context: any) => Promise<T>) =>
        callback({ workbook, sync: async () => undefined }),
    },
  };
}

test("apply builds a multi-series stacked chart, an average pivot and a highlighted view", async () => {
  const plan = createExcelPreviewPlan(
    input,
    ["chart", "pivot-table", "view"],
    undefined,
    {
      chart: {
        category: 1,
        value: 2,
        chartType: "stacked-column",
        extraValues: [3],
      },
      pivot: { rows: 1, values: 2, aggregation: "average", columns: 0 },
      view: {
        filter: { column: 2, operator: ">", value: 1400 },
        sort: { column: 2, direction: "desc" },
        highlight: { column: 2, rule: "top-n", n: 2 },
      },
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
    report.results.map((r) => r.status),
    ["created", "created", "created"],
  );
  assert.ok(excel.calls.includes("chart.add ColumnStacked Columns"));
  assert.ok(excel.calls.includes("series.add Cost"));
  assert.ok(excel.calls.includes("rows Region"));
  assert.ok(excel.calls.includes("columns Month"));
  assert.ok(excel.calls.includes("values Sales"));
  assert.ok(excel.calls.includes("summarizeBy Average"));
  const view = excel.written["Sheet1_Vynor_View!0,0,4,4.values"];
  assert.deepEqual(
    view.map((row: any[]) => row[0]),
    ["Month", "May", "Mar", "Feb"],
  );
  assert.equal(
    excel.written["Sheet1_Vynor_View!1,0,1,4.fill.color"],
    "#FFF2CC",
  );
  assert.equal(
    excel.written["Sheet1_Vynor_View!2,0,1,4.fill.color"],
    "#FFF2CC",
  );
  assert.equal(
    excel.written["Sheet1_Vynor_View!3,0,1,4.fill.color"],
    undefined,
  );
  assert.equal(report.sourceUnchangedAfterApply, true);
});

// ------------------------------------------------------------------ rollback + overview
test("rollback removes only sheets and the table this add-in generated", async () => {
  const excel = fakeWorkbook();
  excel.workbook.worksheets.add("Sheet1_Vynor_Result");
  excel.workbook.worksheets.add("Budget");
  await assert.rejects(
    rollbackCreatedItems(excel.runtime, { sheets: [], tables: [] }, false),
    /confirmation/,
  );
  const report = await rollbackCreatedItems(
    excel.runtime,
    {
      sheets: ["Sheet1_Vynor_Result", "Budget", "Sheet1"],
      tables: ["Sheet1_Vynor_table", "RealTable"],
    },
    true,
  );
  assert.deepEqual(report.removedSheets, ["Sheet1_Vynor_Result"]);
  assert.deepEqual(report.convertedTables, ["Sheet1_Vynor_table"]);
  assert.deepEqual(report.skipped.sort(), ["Budget", "RealTable", "Sheet1"]);
  assert.ok(excel.sheets.has("Budget") && excel.sheets.has("Sheet1"));
});

test("workbook overview loads names and sizes, never cell values", async () => {
  const loaded: string[] = [];
  const range = (rows: number, columns: number, isNullObject = false) => ({
    isNullObject,
    rowCount: rows,
    columnCount: columns,
    load: (props: unknown) => loaded.push(String(props)),
  });
  const workbook = {
    worksheets: {
      items: [
        { name: "Sales", getUsedRangeOrNullObject: () => range(10, 4) },
        { name: "Empty", getUsedRangeOrNullObject: () => range(0, 0, true) },
      ],
      load: (p: unknown) => loaded.push(String(p)),
    },
    tables: {
      items: [
        {
          name: "T1",
          worksheet: { name: "Sales", load: () => undefined },
          getRange: () => range(9, 4),
        },
      ],
      load: (p: unknown) => loaded.push(String(p)),
    },
  };
  const overview = await inspectWorkbookOverview({
    run: (callback) =>
      callback({ workbook, sync: async () => undefined } as any),
  });
  assert.deepEqual(overview.sheets, [
    { name: "Sales", rows: 10, columns: 4 },
    { name: "Empty", rows: 0, columns: 0 },
  ]);
  assert.deepEqual(overview.tables, [
    { name: "T1", sheet: "Sales", rows: 9, columns: 4 },
  ]);
  assert.ok(loaded.every((entry) => !/values|text|formulas/i.test(entry)));
});

// ------------------------------------------------------------------ instructions
test("sort, filter, top-N and highlight requests are read from plain words", () => {
  const read = (text: string) => interpretInstruction(text, headers, rows);
  const sorted = read("Sort by Sales descending");
  assert.deepEqual(sorted.specs.view?.sort, { column: 2, direction: "desc" });
  const top = read("Top 3 by Sales");
  assert.deepEqual(top.specs.view?.highlight, {
    column: 2,
    rule: "top-n",
    n: 3,
  });
  assert.equal(top.specs.view?.sort?.direction, "desc");
  const filter = read("Only Region = North");
  assert.deepEqual(filter.specs.view?.filter, {
    column: 1,
    operator: "=",
    value: "North",
  });
  const numeric = read("Show only rows where Sales > 1500");
  assert.deepEqual(numeric.specs.view?.filter, {
    column: 2,
    operator: ">",
    value: 1500,
  });
  const highlight = read("Highlight above average Sales");
  assert.equal(highlight.specs.view?.highlight?.rule, "above-average");
  assert.ok(read("Sort by Sales").actions.includes("view"));
});

test("chart and PivotTable column choices are read from plain words", () => {
  const chart = interpretInstruction(
    "Create a stacked column chart of Sales and Cost by Region",
    headers,
    rows,
  );
  assert.deepEqual(chart.specs.chart, {
    category: 1,
    value: 2,
    chartType: "stacked-column",
    extraValues: [3],
  });
  const pivot = interpretInstruction(
    "Pivot table of average Sales by Region and Month",
    headers,
    rows,
  );
  assert.equal(pivot.specs.pivot?.aggregation, "average");
  assert.equal(pivot.specs.pivot?.rows, 1);
  assert.equal(pivot.specs.pivot?.columns, 0);
  const plain = interpretInstruction("Create a chart.", headers, rows);
  assert.equal(plain.specs.chart?.category, 0);
  assert.ok(plain.specs.chart?.value !== undefined);
});

test("Sinhala and Singlish keywords map to the same actions", () => {
  assert.match(normalizeInstruction("Sales by Region ප්‍රස්තාරයක්"), /chart/);
  assert.match(normalizeInstruction("data pirisidu karanna"), /clean/);
  const parsed = interpretInstruction(
    "Sales by Region ප්‍රස්තාරයක් chart",
    headers,
    rows,
  );
  assert.ok(parsed.actions.includes("chart"));
});

// ------------------------------------------------------------------ i18n
test("language helpers fall back to English and cycle through the three languages", () => {
  assert.equal(
    translate("en", "hero", "What would you like to do?"),
    "What would you like to do?",
  );
  assert.notEqual(translate("si", "hero", "x"), "x");
  assert.notEqual(translate("ta", "hero", "x"), "x");
  assert.equal(translate("si", "no-such-key", "fallback"), "fallback");
  assert.equal(nextLanguage("en"), "si");
  assert.equal(nextLanguage("si"), "ta");
  assert.equal(nextLanguage("ta"), "en");
  assert.equal(LANGUAGE_NAMES.si, "සිංහල");
  assert.equal(loadLanguage({ getItem: () => "ta" }), "ta");
  assert.equal(loadLanguage({ getItem: () => "xx" }), "en");
  assert.equal(
    loadLanguage({
      getItem: () => {
        throw new Error("blocked");
      },
    }),
    "en",
  );
});

// ------------------------------------------------------------------ text assist
test("a text request needs consent, an allowed task and a bounded length", () => {
  const base = {
    host: "word" as const,
    task: "summarize" as const,
    text: " Hello \r\nworld ",
  };
  assert.throws(
    () => buildAssistRequest({ ...base, consent: false }),
    TextConsentError,
  );
  const request = buildAssistRequest({ ...base, consent: true });
  assert.equal(request.text, "Hello \nworld");
  assert.equal(request.consent, true);
  assert.throws(
    () =>
      buildAssistRequest({
        ...base,
        task: "draft-reply",
        consent: true,
      }),
    /not available/,
  );
  assert.equal(
    buildAssistRequest({
      host: "outlook",
      task: "draft-reply",
      text: "Hi",
      consent: true,
    }).task,
    "draft-reply",
  );
  assert.throws(
    () =>
      buildAssistRequest({
        ...base,
        text: "x".repeat(MAX_TEXT_CHARS + 1),
        consent: true,
      }),
    TextTooLongError,
  );
  assert.throws(
    () => buildAssistRequest({ ...base, text: "  ", consent: true }),
    /Select some text/,
  );
});

test("a text answer is shown only when it matches the strict contract", () => {
  assert.deepEqual(validateAssistResult({ text: "ok", notes: ["a"] }), {
    text: "ok",
    notes: ["a"],
  });
  for (const bad of [
    null,
    "text",
    { text: "" },
    { text: "ok", extra: 1 },
    { text: "ok", notes: ["a", "b", "c", "d", "e", "f"] },
    { text: "x".repeat(12_001) },
  ])
    assert.throws(() => validateAssistResult(bad), /AI_ASSIST_INVALID/);
});
