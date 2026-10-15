import assert from "node:assert/strict";
import { test } from "node:test";
import { createServerExcelPreviewPlan } from "../src/services/m365ExcelPlan.js";
import {
  createExcelPreviewPlan,
  excelPlansMatch,
} from "../../extensions/m365/src/excel.js";

const input = {
  workbookId: "book",
  worksheetName: "Sheet1",
  address: "Sheet1!A1:D5",
  hasHeaders: true,
  values: [
    ["Month", "Region", "Sales", "Cost"],
    ["Jan", "North", 1200, 800],
    ["Feb", "South", 1500, 950],
    ["Mar", "North", 1800, 1100],
    ["Apr", "East", 1350, 900],
  ],
};

test("server and add-in build the same plan for explicit column choices", () => {
  const specs = {
    chart: { category: 1, value: 2, chartType: "pie" as const },
    pivot: { rows: 1, values: 3 },
  };
  const actions = ["chart", "pivot-table"] as const;
  const server = createServerExcelPreviewPlan(input, [...actions], 500, specs);
  const local = createExcelPreviewPlan(input as any, [...actions], 500, specs);
  assert.equal(excelPlansMatch(local, server), true);
  assert.equal(server.actions[0].spec.valueColumn, "Sales");
  assert.equal(server.actions[1].spec.rowsColumn, "Region");
});

test("server and add-in agree on a deterministic insight report", () => {
  const actions = ["statistics"] as const;
  const specs = {
    statistics: { mode: "insights" as const, value: 2, category: 1, date: 0 },
  };
  const server = createServerExcelPreviewPlan(input, [...actions], 500, specs);
  const local = createExcelPreviewPlan(input as any, [...actions], 500, specs);
  assert.equal(excelPlansMatch(local, server), true);
  const statistics = server.actions[0].spec.statistics;
  assert.equal(statistics.mode, "insights");
  assert.equal(statistics.value.column, "Sales");
  assert.equal(statistics.category.column, "Region");
  assert.equal(statistics.date.column, "Month");
  assert.throws(
    () =>
      createServerExcelPreviewPlan(input, ["statistics"], 500, {
        statistics: { mode: "insights", value: 2, category: 2 },
      } as any),
    /different existing category/,
  );
});

test("server and add-in agree on one validated dashboard sheet", () => {
  const actions = ["dashboard"];
  const specs = {
    dashboard: { category: 1, values: [2, 3], aggregation: "sum" as const },
  };
  const server = createServerExcelPreviewPlan(input, actions, 500, specs);
  const local = createExcelPreviewPlan(
    input as any,
    actions as any,
    500,
    specs,
  );
  assert.equal(excelPlansMatch(local, server), true);
  assert.equal(server.actions.length, 1);
  assert.equal(server.actions[0].targetSheet, "Sheet1_Vynor_Dashboard");
  assert.equal(server.actions[0].spec.dashboard.category.column, "Region");
  assert.deepEqual(
    server.actions[0].spec.dashboard.values.map((entry: any) => entry.column),
    ["Sales", "Cost"],
  );
  assert.throws(
    () =>
      createServerExcelPreviewPlan(input, actions, 500, {
        dashboard: { category: 1, values: [1] },
      } as any),
    /different dashboard value columns/,
  );
  assert.throws(
    () => createServerExcelPreviewPlan(input, actions, 500),
    /explicit column choices/,
  );
});

test("a plan with different column choices is not accepted as the same plan", () => {
  const actions = ["chart"] as const;
  const server = createServerExcelPreviewPlan(input, [...actions], 500, {
    chart: { category: 1, value: 3, chartType: "column" },
  });
  const local = createExcelPreviewPlan(input as any, [...actions], 500, {
    chart: { category: 1, value: 2, chartType: "column" },
  });
  assert.equal(excelPlansMatch(local, server), false);
});

test("the server refuses unusable column choices", () => {
  const bad = (specs: unknown, actions = ["chart"]) =>
    createServerExcelPreviewPlan(input, actions, 500, specs as any);
  assert.throws(
    () => bad({ chart: { category: 1, value: 1, chartType: "column" } }),
    /different columns/,
  );
  assert.throws(
    () => bad({ chart: { category: 1, value: 99, chartType: "column" } }),
    /different columns/,
  );
  assert.throws(
    () => bad({ chart: { category: 2, value: 1, chartType: "column" } }),
    /must contain numbers/,
  );
  assert.throws(
    () => bad({ pivot: { rows: 1, values: 2 } }),
    /needs a PivotTable action/,
  );
});

test("plans without column choices are unchanged", () => {
  const server = createServerExcelPreviewPlan(input, ["chart"], 500);
  assert.equal(server.actions[0].spec, undefined);
});

test("server and add-in agree on clean and computed-column plans", () => {
  const specs = {
    clean: { operations: ["trim", "dedupe"] },
    addColumn: { name: "Profit", left: 2, operator: "-" as const, right: 3 },
  };
  const actions = ["clean", "add-column"] as const;
  const server = createServerExcelPreviewPlan(input, [...actions], 500, specs);
  const local = createExcelPreviewPlan(input as any, [...actions], 500, specs);
  assert.equal(excelPlansMatch(local, server), true);
  assert.deepEqual(
    server.actions.map((a: any) => [a.kind, a.targetSheet]),
    [
      ["clean", "Sheet1_Vynor_Clean"],
      ["add-column", "Sheet1_Vynor_Calc"],
    ],
  );
  assert.equal(server.actions[1].spec.rightColumn, "Cost");
});

test("server and add-in agree on an unambiguous text-date conversion", () => {
  const specs = { clean: { operations: ["text-to-date"] } };
  const actions = ["clean"] as const;
  const server = createServerExcelPreviewPlan(input, [...actions], 500, specs);
  const client = createExcelPreviewPlan(input as any, [...actions], 500, specs);
  assert.equal(excelPlansMatch(client as any, server as any), true);
});

test("server and add-in agree on explicit fill-blanks and reject formula values", () => {
  const specs = {
    clean: { operations: ["fill-blanks"], fillBlanks: 0 },
  };
  const actions = ["clean"] as const;
  const server = createServerExcelPreviewPlan(input, [...actions], 500, specs);
  const client = createExcelPreviewPlan(input as any, [...actions], 500, specs);
  assert.equal(excelPlansMatch(client as any, server as any), true);
  assert.throws(
    () =>
      createServerExcelPreviewPlan(input, [...actions], 500, {
        clean: { operations: ["fill-blanks"], fillBlanks: "=SUM(A1)" },
      }),
    /safe replacement value/,
  );
});

test("the server refuses unsafe computed columns and unknown clean steps", () => {
  const call = (specs: unknown, actions: string[]) =>
    createServerExcelPreviewPlan(input, actions, 500, specs as any);
  assert.throws(
    () =>
      call(
        { addColumn: { name: "=SUM(A1)", left: 2, operator: "-", right: 3 } },
        ["add-column"],
      ),
    /not allowed/,
  );
  assert.throws(
    () =>
      call({ addColumn: { name: "P", left: 2, operator: "^", right: 3 } }, [
        "add-column",
      ]),
    /Unsupported operator/,
  );
  assert.throws(
    () =>
      call({ addColumn: { name: "P", left: 1, operator: "+", right: 3 } }, [
        "add-column",
      ]),
    /must contain numbers/,
  );
  assert.throws(
    () => call({ clean: { operations: ["drop-table"] } }, ["clean"]),
    /valid, unique/,
  );
});

test("server and add-in agree on chart v2, pivot v2 and view plans", () => {
  const specs = {
    chart: {
      category: 1,
      value: 2,
      chartType: "stacked-column" as const,
      extraValues: [3],
    },
    pivot: {
      rows: 1,
      values: 2,
      aggregation: "average" as const,
      columns: 0,
    },
    view: {
      sort: { column: 2, direction: "desc" as const },
      filter: { column: 2, operator: ">" as const, value: 1400 },
      highlight: { column: 2, rule: "top-n" as const, n: 2 },
    },
  };
  const actions = ["chart", "pivot-table", "view"] as const;
  const server = createServerExcelPreviewPlan(input, [...actions], 500, specs);
  const local = createExcelPreviewPlan(input as any, [...actions], 500, specs);
  assert.equal(excelPlansMatch(local, server), true);
  const view = server.actions.find((a: any) => a.kind === "view");
  assert.equal(view.targetSheet, "Sheet1_Vynor_View");
  assert.equal(view.spec.filter.column, "Sales");
});

test("the server refuses unusable chart v2, pivot v2 and view choices", () => {
  const call = (specs: unknown, actions: string[]) =>
    createServerExcelPreviewPlan(input, actions, 500, specs as any);
  assert.throws(
    () =>
      call({ chart: { category: 1, value: 2, chartType: "radar" } }, ["chart"]),
    /Unsupported chart type/,
  );
  assert.throws(
    () =>
      call({ pivot: { rows: 1, values: 2, aggregation: "median" } }, [
        "pivot-table",
      ]),
    /aggregation/,
  );
  assert.throws(
    () => call({ view: {} }, ["view"]),
    /sort, filter or highlight/,
  );
  assert.throws(
    () =>
      call({ view: { highlight: { column: 2, rule: "top-n", n: 500 } } }, [
        "view",
      ]),
    /1-100/,
  );
});

test("the server refuses selections that exceed the bounded client contract", () => {
  const values = Array.from({ length: 1001 }, () =>
    Array.from({ length: 100 }, () => 1),
  );
  values[0] = Array.from({ length: 100 }, (_, index) => `Column ${index}`);
  assert.throws(
    () =>
      createServerExcelPreviewPlan({ ...input, address: "A1:CV1001", values }, [
        "table",
      ]),
    /100,000 cells/,
  );
  assert.throws(
    () =>
      createServerExcelPreviewPlan(
        {
          ...input,
          values: [["Name"], ["x".repeat(2_000_001)]],
        },
        ["table"],
      ),
    /2,000,000 text characters/,
  );
});

test("the apply-result schema accepts every action kind a plan can contain", async () => {
  const { readFileSync } = await import("node:fs");
  const route = readFileSync(
    new URL("../src/routes/m365.ts", import.meta.url),
    "utf8",
  );
  const block = route.slice(route.indexOf("const applyResultSchema"));
  const end = block.indexOf("const rollbackSchema");
  const schema = block.slice(0, end);
  for (const kind of [
    "table",
    "chart",
    "new-sheet",
    "pivot-table",
    "clean",
    "add-column",
    "view",
  ])
    assert.ok(schema.includes(`"${kind}"`), `apply-result misses ${kind}`);
  assert.match(
    schema,
    /results:[\s\S]*?\.max\(10\)/,
    "apply-result must accept every result from a ten-action plan",
  );
});

test("server and add-in agree on statistics plans and the server refuses bad ones", () => {
  for (const specs of [
    { statistics: { mode: "describe" as const, columns: [2, 3] } },
    {
      statistics: {
        mode: "correlation" as const,
        pair: [2, 3] as [number, number],
      },
    },
    { statistics: { mode: "forecast" as const, value: 2, periods: 4 } },
  ]) {
    const server = createServerExcelPreviewPlan(
      input,
      ["statistics"],
      500,
      specs,
    );
    const local = createExcelPreviewPlan(
      input as any,
      ["statistics"],
      500,
      specs,
    );
    assert.equal(excelPlansMatch(local, server), true);
    assert.equal(server.actions[0].targetSheet, "Sheet1_Vynor_Stats");
  }
  assert.throws(
    () =>
      createServerExcelPreviewPlan(input, ["statistics"], 500, {
        statistics: { mode: "correlation", pair: [1, 2] },
      }),
    /numeric/,
  );
});
