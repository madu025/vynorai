import assert from "node:assert/strict";
import { test } from "node:test";
import { createExcelPreviewPlan } from "./excel.js";
import {
  applyApprovedExcelPlan,
  inspectSelectedExcelRange,
  localExcelAddress,
  rollbackItemsFromApplyReport,
} from "./officeExcel.js";

/**
 * Small in-memory stand-in for the Office.js objects the add-in touches. It records every
 * workbook call so tests can assert argument order and that nothing ran before a check.
 */
function fakeWorkbook(
  cells: unknown[][],
  options: { failChart?: boolean } = {},
) {
  const calls: string[] = [];
  const formulaWrites: Array<{
    sheet: string;
    address: string;
    values: unknown;
  }> = [];
  const sheets = new Map<string, any>();
  const tables = new Set<string>();
  const pivots = new Set<string>();
  const names = new Set<string>();
  const nullable = (exists: boolean, value: any = {}) =>
    Object.assign(value, { isNullObject: !exists, load() {} });
  const range = (sheet: string, address: string, values?: unknown[][]) => {
    const data = values ?? cells;
    return {
      kind: "range",
      sheet,
      address,
      rowCount: data.length,
      columnCount: data[0]?.length ?? 0,
      values: data,
      formulas: data.map((row) =>
        row.map((cell) =>
          typeof cell === "string" && cell.startsWith("=") ? cell : "",
        ),
      ),
      format: { font: {}, fill: {}, autofitColumns() {} },
      conditionalFormats: {
        add(type: string) {
          calls.push(`conditional.add ${type}`);
          const customRule = new Proxy(
            {},
            {
              set(object, key, value) {
                calls.push(`custom.${String(key)} = ${String(value)}`);
                object[key] = value;
                return true;
              },
            },
          );
          return {
            custom: {
              rule: customRule,
              format: { fill: {} },
            },
            cellValue: { rule: {}, format: { font: {}, fill: {} } },
            colorScale: { criteria: {} },
            iconSet: { style: "" },
            topBottom: { rule: {}, format: { fill: {} } },
            textComparison: { rule: {}, format: { fill: {} } },
          };
        },
      },
      dataValidation: new Proxy(
        {},
        {
          set(object, key, value) {
            calls.push(`validation.${String(key)} ${JSON.stringify(value)}`);
            object[key] = value;
            return true;
          },
        },
      ),
      load() {},
      getCell(row: number) {
        return {
          getResizedRange(rows: number) {
            return { load() {}, values: data.slice(row, row + rows + 1) };
          },
        };
      },
    };
  };
  const makeSheet = (name: string) => {
    const charts = new Set<string>();
    const sheet: any = {
      name,
      load() {},
      customProperties: {
        add: (key: string, value: string) =>
          calls.push(`mark ${name} ${key}=${value}`),
      },
      freezePanes: {
        freezeRows: (count: number) => calls.push(`freeze ${count}`),
      },
      getRange: (address: string) => {
        const target = range(name, address);
        return new Proxy(target, {
          set(object: any, key, value) {
            if (key === "values") {
              calls.push(`write ${name}!${address}`);
              if (name === "Sales") cells = value;
              return true;
            }
            if (key === "formulas") {
              calls.push(`formula ${name}!${address}`);
              formulaWrites.push({ sheet: name, address, values: value });
              return true;
            }
            object[key] = value;
            return true;
          },
        });
      },
      getRangeByIndexes: (
        _row: number,
        _column: number,
        rows: number,
        columns: number,
      ) => {
        const target = range(
          name,
          "A1",
          Array.from({ length: rows }, () =>
            Array.from({ length: columns }, () => ""),
          ),
        );
        return new Proxy(target, {
          set(object: any, key, value) {
            if (key === "values") {
              calls.push(`write ${name}!A1 normalized`);
              object.values = value;
              return true;
            }
            if (key === "formulas") {
              calls.push(`formula ${name}!A1 normalized`);
              formulaWrites.push({ sheet: name, address: "A1", values: value });
              object.formulas = value;
              return true;
            }
            object[key] = value;
            return true;
          },
        });
      },
      tables: {
        add(source: any, hasHeaders: boolean) {
          calls.push(
            `table.add ${source.kind}:${source.address} ${hasHeaders}`,
          );
          const table: any = {};
          return new Proxy(table, {
            set(_object, key, value) {
              if (key === "name") tables.add(value);
              return true;
            },
          });
        },
      },
      charts: {
        getItemOrNullObject: (chartName: string) =>
          nullable(charts.has(chartName)),
        add(type: string, source: any) {
          calls.push(`chart.add ${type} ${source.kind}:${source.address}`);
          if (options.failChart)
            throw Object.assign(new Error("chart failed"), {
              code: "InvalidArgument",
            });
          const chart: any = {
            setPosition: (cell: string) => calls.push(`chart.position ${cell}`),
            title: {},
          };
          return new Proxy(chart, {
            set(object, key, value) {
              if (key === "name") charts.add(value);
              object[key] = value;
              return true;
            },
          });
        },
      },
      pivotTables: {
        add(pivotName: unknown, source: any, destination: any) {
          calls.push(
            `pivot.add ${typeof pivotName} ${source.kind}:${source.address} ${destination.kind}:${destination.address}`,
          );
          pivots.add(String(pivotName));
          return {
            hierarchies: { getItem: (name: string) => name },
            rowHierarchies: {
              add: (name: string) => calls.push(`pivot.row ${name}`),
            },
            dataHierarchies: {
              add: (name: string) => {
                calls.push(`pivot.value ${name}`);
                return {};
              },
            },
          };
        },
      },
    };
    sheets.set(name, sheet);
    return sheet;
  };
  makeSheet("Sales");
  const workbook = {
    getSelectedRange() {
      const selected: any = range("Sales", "Sales!A1:B3");
      selected.address = "Sales!A1:B3";
      selected.worksheet = sheets.get("Sales");
      return selected;
    },
    tables: {
      getItemOrNullObject: (name: string) => nullable(tables.has(name)),
    },
    pivotTables: {
      getItemOrNullObject: (name: string) => nullable(pivots.has(name)),
    },
    names: {
      items: [],
      load() {},
      add(name: string, formula: string) {
        names.add(name);
        calls.push(`name.add ${name} ${formula}`);
      },
    },
    worksheets: {
      getItem: (name: string) => sheets.get(name),
      getItemOrNullObject: (name: string) =>
        sheets.has(name)
          ? Object.assign(sheets.get(name), { isNullObject: false, load() {} })
          : nullable(false),
      add: (name: string) => {
        calls.push(`sheet.add ${name}`);
        return makeSheet(name);
      },
    },
  };
  return {
    calls,
    formulaWrites,
    setCells: (next: unknown[][]) => (cells = next),
    addSheet: makeSheet,
    runtime: {
      run: <T>(callback: (context: any) => Promise<T>) =>
        callback({ workbook, sync: async () => {} }),
    },
  };
}

const sourceCells = [
  ["region", "amount"],
  ["LK", 10],
  ["IN", 20],
];

async function previewFor(excel: ReturnType<typeof fakeWorkbook>) {
  const input = await inspectSelectedExcelRange(excel.runtime, "book-1");
  const plan = createExcelPreviewPlan(input, [
    "table",
    "chart",
    "new-sheet",
    "pivot-table",
  ]);
  return { input, plan };
}

test("local address strips the sheet prefix, including quoted names", () => {
  assert.equal(localExcelAddress("Sales!A1:B3"), "A1:B3");
  assert.equal(localExcelAddress("'My!Sheet'!C2:D9"), "C2:D9");
  assert.equal(localExcelAddress("A1"), "A1");
});

test("inspect rejects a selection without a data row", async () => {
  const excel = fakeWorkbook([["header"]]);
  await assert.rejects(
    inspectSelectedExcelRange(excel.runtime, "book-1"),
    /header row and at least one data row/,
  );
});

test("inspect refuses an oversized selection before reading cell values", async () => {
  const rows = Array.from({ length: 1001 }, () =>
    Array.from({ length: 100 }, () => 1),
  );
  const excel = fakeWorkbook(rows);
  await assert.rejects(
    inspectSelectedExcelRange(excel.runtime, "book-1"),
    /at most 100,000 cells and 100 columns/,
  );
});

test("inspect reads a merged multi-row header for normalized planning", async () => {
  const excel = fakeWorkbook([
    ["Date", "Time", ""],
    ["", "Start", "End"],
    ["2026-09-02", "08:00", "09:00"],
  ]);
  const input = await inspectSelectedExcelRange(excel.runtime, "book-1");
  assert.equal(input.values.length, 3);
});

test("apply creates each object with Office.js argument order and keeps source unchanged", async () => {
  const excel = fakeWorkbook(sourceCells.map((row) => [...row]));
  const { plan } = await previewFor(excel);
  const seen: string[] = [];
  const report = await applyApprovedExcelPlan(
    excel.runtime,
    plan,
    true,
    "approval",
    {
      expectedSourceFingerprint: plan.sourceFingerprint,
      onAction: (result) => seen.push(`${result.kind}:${result.status}`),
    },
  );
  assert.deepEqual(seen, [
    "new-sheet:created",
    "table:created",
    "chart:created",
    "pivot-table:created",
  ]);
  assert.equal(report.sourceUnchangedAfterApply, true);
  assert.ok(
    excel.calls.includes("table.add range:A1 true"),
    "the table is made from the copied result range, not the Sales source range",
  );
  assert.ok(excel.calls.includes("chart.add ColumnClustered range:A1:B3"));
  assert.ok(
    excel.calls.includes("pivot.add string range:A1:B3 range:A3"),
    excel.calls.join("\n"),
  );
  assert.ok(!excel.calls.some((call) => call.startsWith("write Sales!")));

  const again = await applyApprovedExcelPlan(
    excel.runtime,
    plan,
    true,
    "approval",
    {
      expectedSourceFingerprint: plan.sourceFingerprint,
    },
  );
  assert.deepEqual(
    again.results.map((result) => result.status),
    ["exists", "exists", "exists", "exists"],
  );
});

test("apply writes a normalized copy to the result sheet for two-row headers", async () => {
  const excel = fakeWorkbook([
    ["Date", "Time", ""],
    ["", "Start", "End"],
    ["2026-09-02", "08:00", "09:00"],
  ]);
  const input = await inspectSelectedExcelRange(excel.runtime, "book-1");
  const plan = createExcelPreviewPlan(input, ["table", "pivot-table"]);
  const report = await applyApprovedExcelPlan(
    excel.runtime,
    plan,
    true,
    "approval",
    { expectedSourceFingerprint: plan.sourceFingerprint },
  );
  assert.deepEqual(
    report.results.map((result) => `${result.kind}:${result.status}`),
    ["new-sheet:created", "table:created", "pivot-table:created"],
  );
  assert.ok(excel.calls.includes("write Result of Sales!A1 normalized"));
  assert.ok(!excel.calls.some((call) => call.startsWith("write Sales!")));
});

test("apply adds an input message to validation on a copied result sheet", async () => {
  const excel = fakeWorkbook(sourceCells.map((row) => [...row]));
  const input = await inspectSelectedExcelRange(excel.runtime, "book-1");
  const plan = createExcelPreviewPlan(input, ["format"], 500, {
    format: {
      validation: [{ column: 0, rule: "list" }],
      inputMessage: {
        column: 0,
        title: "Status guidance",
        message: "Choose a valid region.",
      },
    },
  });
  const report = await applyApprovedExcelPlan(
    excel.runtime,
    plan,
    true,
    "approval",
    { expectedSourceFingerprint: plan.sourceFingerprint },
  );
  assert.equal(report.results[0].status, "created");
  assert.ok(
    excel.calls.some((call) =>
      call.includes(
        'validation.prompt {"showPrompt":true,"title":"Status guidance"',
      ),
    ),
    excel.calls.join("\n"),
  );
  assert.ok(!excel.calls.some((call) => call.startsWith("write Sales!")));
});

test("apply creates dependent validation from helper names on a copied result sheet", async () => {
  const excel = fakeWorkbook([
    ["Region", "Status"],
    ["North", "Open"],
    ["North", "Closed"],
    ["South", "Open"],
  ]);
  const input = await inspectSelectedExcelRange(excel.runtime, "book-1");
  const plan = createExcelPreviewPlan(input, ["format"], 500, {
    format: { dependentDropdown: { child: 1, parent: 0 } },
  });
  const report = await applyApprovedExcelPlan(
    excel.runtime,
    plan,
    true,
    "approval",
    { expectedSourceFingerprint: plan.sourceFingerprint },
  );
  assert.equal(report.results[0].status, "created", JSON.stringify(report));
  assert.ok(
    excel.calls.some((call) => call.includes("name.add VynorAI_DD_North")),
  );
  assert.ok(
    excel.calls.some((call) => call.includes("name.add VynorAI_DD_South")),
  );
  assert.ok(
    excel.calls.some((call) =>
      call.includes(
        'validation.rule {"list":{"inCellDropDown":true,"source":"=INDIRECT',
      ),
    ),
    excel.calls.join("\n"),
  );
  assert.deepEqual(report.results[0].createdNames, [
    "VynorAI_DD_North",
    "VynorAI_DD_South",
  ]);
  assert.ok(!excel.calls.some((call) => call.startsWith("write Sales!")));
});

test("apply creates a custom conditional formula on a copied result sheet", async () => {
  const excel = fakeWorkbook([
    ["Region", "Sales"],
    ["North", 1200],
    ["South", 800],
  ]);
  const input = await inspectSelectedExcelRange(excel.runtime, "book-1");
  const plan = createExcelPreviewPlan(input, ["format"], 500, {
    format: {
      conditional: [
        { column: 1, rule: "custom-formula", operator: ">", value: 1000 },
      ],
    },
  });
  const report = await applyApprovedExcelPlan(
    excel.runtime,
    plan,
    true,
    "approval",
    { expectedSourceFingerprint: plan.sourceFingerprint },
  );
  assert.equal(report.results[0].status, "created", JSON.stringify(report));
  assert.ok(
    excel.calls.some(
      (call) =>
        call.includes("conditional.add Custom") ||
        call.includes("custom.formula ="),
    ),
    excel.calls.join("\n"),
  );
  assert.ok(
    excel.calls.some((call) => call.includes("custom.formula = =B2>1000")),
    excel.calls.join("\n"),
  );
  assert.ok(!excel.calls.some((call) => call.startsWith("write Sales!")));
});

test("apply creates a top-bottom conditional format on a copied result sheet", async () => {
  const excel = fakeWorkbook([
    ["Region", "Sales"],
    ["North", 1200],
    ["South", 800],
  ]);
  const input = await inspectSelectedExcelRange(excel.runtime, "book-1");
  const plan = createExcelPreviewPlan(input, ["format"], 500, {
    format: {
      conditional: [{ column: 1, rule: "top-n", n: 1 }],
    },
  });
  const report = await applyApprovedExcelPlan(
    excel.runtime,
    plan,
    true,
    "approval",
    { expectedSourceFingerprint: plan.sourceFingerprint },
  );
  assert.equal(report.results[0].status, "created", JSON.stringify(report));
  assert.ok(
    excel.calls.includes("conditional.add TopBottom"),
    excel.calls.join("\n"),
  );
  assert.ok(!excel.calls.some((call) => call.startsWith("write Sales!")));
});

test("apply creates a text-contains conditional format on a copied result sheet", async () => {
  const excel = fakeWorkbook([
    ["Status", "Region"],
    ["Pending", "North"],
    ["Done", "South"],
  ]);
  const input = await inspectSelectedExcelRange(excel.runtime, "book-1");
  const plan = createExcelPreviewPlan(input, ["format"], 500, {
    format: {
      conditional: [{ column: 1, rule: "text-contains", text: "Pending" }],
    },
  });
  const report = await applyApprovedExcelPlan(
    excel.runtime,
    plan,
    true,
    "approval",
    { expectedSourceFingerprint: plan.sourceFingerprint },
  );
  assert.equal(report.results[0].status, "created", JSON.stringify(report));
  assert.ok(
    excel.calls.includes("conditional.add ContainsText"),
    excel.calls.join("\n"),
  );
  assert.ok(!excel.calls.some((call) => call.startsWith("write Sales!")));
});

test("apply creates a date-range conditional format on a copied result sheet", async () => {
  const excel = fakeWorkbook([
    ["Date", "Sales"],
    [46023, 100],
    [46112, 200],
  ]);
  const input = await inspectSelectedExcelRange(excel.runtime, "book-1");
  const plan = createExcelPreviewPlan(input, ["format"], 500, {
    format: {
      conditional: [
        {
          column: 0,
          rule: "date-range",
          startDate: "2026-01-01",
          endDate: "2026-03-31",
        },
      ],
    },
  });
  const report = await applyApprovedExcelPlan(
    excel.runtime,
    plan,
    true,
    "approval",
    { expectedSourceFingerprint: plan.sourceFingerprint },
  );
  assert.equal(report.results[0].status, "created", JSON.stringify(report));
  assert.ok(
    excel.calls.includes("conditional.add Custom"),
    excel.calls.join("\n"),
  );
  assert.ok(
    excel.calls.some((call) =>
      call.includes(
        "custom.formula = =AND(ISNUMBER(A2),A2>=DATE(2026,1,1),A2<=DATE(2026,3,31))",
      ),
    ),
    excel.calls.join("\n"),
  );
  assert.ok(!excel.calls.some((call) => call.startsWith("write Sales!")));
});

test("an insight report writes only live formulas to a new marked result sheet", async () => {
  const source = [
    ["Region", "Sales"],
    ["North", 100],
    ["South", 200],
    ["North", 300],
  ];
  const excel = fakeWorkbook(source.map((row) => [...row]));
  const input = await inspectSelectedExcelRange(excel.runtime, "book-1");
  const plan = createExcelPreviewPlan(input, ["statistics"], 500, {
    statistics: { mode: "insights", value: 1, category: 0 },
  });
  const report = await applyApprovedExcelPlan(
    excel.runtime,
    plan,
    true,
    "approval",
    { expectedSourceFingerprint: plan.sourceFingerprint },
  );
  assert.deepEqual(
    report.results.map((result) => `${result.kind}:${result.status}`),
    ["statistics:created"],
  );
  assert.equal(report.results[0].targetSheet, "Insights of Sales");
  assert.equal(report.results[0].createdSheet, true);
  assert.ok(excel.calls.includes("formula Insights of Sales!A1 normalized"));
  assert.ok(!excel.calls.some((call) => call.startsWith("write Sales!")));
  assert.ok(!excel.calls.some((call) => call.startsWith("formula Sales!")));
});

test("a dashboard creates one result sheet with live KPIs, charts and a PivotTable", async () => {
  const source = [
    ["Region", "Sales", "Cost"],
    ["North", 100, 60],
    ["South", 200, 120],
    ["North", 300, 180],
  ];
  const excel = fakeWorkbook(source.map((row) => [...row]));
  const input = await inspectSelectedExcelRange(excel.runtime, "book-1");
  const plan = createExcelPreviewPlan(input, ["dashboard"], 500, {
    dashboard: { category: 0, values: [1, 2] },
  });
  const report = await applyApprovedExcelPlan(
    excel.runtime,
    plan,
    true,
    "approval",
    { expectedSourceFingerprint: plan.sourceFingerprint },
  );
  assert.deepEqual(
    report.results.map((result) => `${result.kind}:${result.status}`),
    ["dashboard:created"],
  );
  assert.equal(report.results[0].targetSheet, "Dashboard Sales-Cost Region");
  assert.equal(report.results[0].createdSheet, true);
  assert.ok(excel.calls.includes("pivot.row Region"));
  assert.ok(excel.calls.includes("pivot.value Sales"));
  assert.ok(excel.calls.includes("pivot.value Cost"));
  assert.ok(
    excel.calls.includes("mark Dashboard Sales-Cost Region vynorai=result"),
  );
  assert.equal(
    excel.calls.filter((call) => call.startsWith("chart.add ColumnClustered"))
      .length,
    2,
  );
  assert.ok(
    excel.calls.some((call) =>
      call.startsWith("formula Dashboard Sales-Cost Region!"),
    ),
  );
  assert.ok(!excel.calls.some((call) => call.startsWith("write Sales!")));
  assert.ok(!excel.calls.some((call) => call.startsWith("formula Sales!")));
  assert.deepEqual(
    rollbackItemsFromApplyReport("dashboard", report.results).sheets,
    ["Dashboard Sales-Cost Region"],
  );
});

test("dashboard helper labels from cells are escaped instead of evaluated as formulas", async () => {
  const excel = fakeWorkbook([
    ["Region", "Sales"],
    ['=HYPERLINK("https://example.test")', 100],
    ["South", 200],
  ]);
  const input = await inspectSelectedExcelRange(excel.runtime, "book-1");
  const plan = createExcelPreviewPlan(input, ["dashboard"], 500, {
    dashboard: { category: 0, values: [1] },
  });
  await applyApprovedExcelPlan(excel.runtime, plan, true, "approval", {
    expectedSourceFingerprint: plan.sourceFingerprint,
  });
  const written = excel.formulaWrites
    .filter((entry) => entry.sheet.startsWith("Dashboard"))
    .flatMap((entry) => (entry.values as unknown[][]).flat());
  assert.ok(written.includes(`'=HYPERLINK("https://example.test")`));
  assert.ok(!written.includes(`=HYPERLINK("https://example.test")`));
});

test("apply refuses to write when the source changed after the preview", async () => {
  const excel = fakeWorkbook(sourceCells.map((row) => [...row]));
  const { plan } = await previewFor(excel);
  excel.setCells([
    ["region", "amount"],
    ["LK", 99],
    ["IN", 20],
  ]);
  const before = excel.calls.length;
  await assert.rejects(
    applyApprovedExcelPlan(excel.runtime, plan, true, "approval", {
      expectedSourceFingerprint: plan.sourceFingerprint,
    }),
    /source_changed_since_preview/,
  );
  assert.equal(excel.calls.length, before);
});

test("one failing action is reported without stopping the others", async () => {
  const excel = fakeWorkbook(
    sourceCells.map((row) => [...row]),
    { failChart: true },
  );
  const { plan } = await previewFor(excel);
  const report = await applyApprovedExcelPlan(
    excel.runtime,
    plan,
    true,
    "approval",
    {
      expectedSourceFingerprint: plan.sourceFingerprint,
      supportsExcelApi: (version) => version !== "1.8",
      requirements: { "pivot-table": "1.8" },
    },
  );
  const byKind = Object.fromEntries(
    report.results.map((result) => [result.kind, result]),
  );
  assert.equal(byKind.table.status, "created");
  assert.equal(byKind.chart.status, "failed");
  assert.match(byKind.chart.error!, /InvalidArgument: chart failed/);
  assert.equal(byKind["new-sheet"].status, "created");
  assert.equal(byKind["pivot-table"].status, "skipped_unsupported");
});

test("an object created on a pre-existing result sheet never grants rollback ownership", async () => {
  const excel = fakeWorkbook(sourceCells.map((row) => [...row]));
  excel.addSheet("Chart of Sales");
  const input = await inspectSelectedExcelRange(excel.runtime, "book-1");
  const plan = createExcelPreviewPlan(input, ["chart"]);
  const report = await applyApprovedExcelPlan(
    excel.runtime,
    plan,
    true,
    "approval",
    { expectedSourceFingerprint: plan.sourceFingerprint },
  );
  assert.equal(report.results[0].status, "created");
  assert.equal(report.results[0].createdSheet, false);
  assert.deepEqual(
    rollbackItemsFromApplyReport("test-plan", report.results).sheets,
    [],
  );
});

test("a failed action still tracks a worksheet that this apply call created", async () => {
  const excel = fakeWorkbook(
    sourceCells.map((row) => [...row]),
    { failChart: true },
  );
  const input = await inspectSelectedExcelRange(excel.runtime, "book-1");
  const plan = createExcelPreviewPlan(input, ["chart"]);
  const report = await applyApprovedExcelPlan(
    excel.runtime,
    plan,
    true,
    "approval",
    { expectedSourceFingerprint: plan.sourceFingerprint },
  );
  assert.equal(report.results[0].status, "failed");
  assert.equal(report.results[0].createdSheet, true);
  assert.deepEqual(
    rollbackItemsFromApplyReport("test-plan", report.results).sheets,
    ["Chart of Sales"],
  );
});

test("apply requires confirmation, approval and the previewed fingerprint", async () => {
  const excel = fakeWorkbook(sourceCells);
  const { plan } = await previewFor(excel);
  await assert.rejects(
    applyApprovedExcelPlan(excel.runtime, plan, false, "approval", {
      expectedSourceFingerprint: plan.sourceFingerprint,
    }),
    /confirmation/,
  );
  await assert.rejects(
    applyApprovedExcelPlan(excel.runtime, plan, true, "", {
      expectedSourceFingerprint: plan.sourceFingerprint,
    }),
    /approval token/,
  );
  await assert.rejects(
    applyApprovedExcelPlan(excel.runtime, plan, true, "approval", {
      expectedSourceFingerprint: "",
    }),
    /fingerprint/,
  );
});

test("formula quality audit writes a report sheet and never changes source formulas", async () => {
  const excel = fakeWorkbook([
    ["Label", "Value"],
    ["Broken", "=1/0"],
    ["Circular", "=B3"],
  ]);
  const input = await inspectSelectedExcelRange(excel.runtime, "book-1");
  const plan = createExcelPreviewPlan(input, ["quality"], 500, {
    quality: { mode: "formula" },
  });
  const report = await applyApprovedExcelPlan(
    excel.runtime,
    plan,
    true,
    "approval",
    { expectedSourceFingerprint: plan.sourceFingerprint },
  );
  assert.equal(report.results[0].status, "created", JSON.stringify(report));
  assert.ok(excel.calls.some((call) => call.includes("write ")));
  assert.ok(excel.calls.some((call) => call.includes("mark ")));
  assert.ok(!excel.calls.some((call) => call.startsWith("write Sales!")));
});

test("formula repair writes safe candidates to a new copy and leaves source unchanged", async () => {
  const excel = fakeWorkbook([["Value"], ["=A2/#DIV/0!"]]);
  const input = await inspectSelectedExcelRange(excel.runtime, "book-1");
  const plan = createExcelPreviewPlan(input, ["quality"], 500, {
    quality: { mode: "repair" },
  });
  const report = await applyApprovedExcelPlan(
    excel.runtime,
    plan,
    true,
    "approval",
    { expectedSourceFingerprint: plan.sourceFingerprint },
  );
  assert.equal(report.results[0].status, "created", JSON.stringify(report));
  assert.ok(
    excel.formulaWrites.some((entry) =>
      JSON.stringify(entry.values).includes("=IFERROR(A2/#DIV/0!,"),
    ),
    JSON.stringify(excel.formulaWrites),
  );
  assert.ok(!excel.calls.some((call) => call.startsWith("write Sales!")));
});
