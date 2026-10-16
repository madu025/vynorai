import assert from "node:assert/strict";
import { test } from "node:test";
import {
  adaptForSampledRange,
  createExcelPreviewPlan,
  fingerprintExcelRange,
} from "./excel.js";
import {
  applyApprovedExcelPlan,
  excelValuesToCsv,
  inspectSelectedExcelRange,
  localExcelAddress,
  rollbackItemsFromApplyReport,
  sampleBlocks,
  sampleRowBudget,
} from "./officeExcel.js";

test("CSV export quotes cells and neutralizes formula injection", () => {
  assert.equal(
    excelValuesToCsv([
      ["Name", "Note"],
      ["Asha, Ltd", '=HYPERLINK("https://evil.example")'],
      ["Bimal", -4],
    ]),
    '"Name","Note"\r\n"Asha, Ltd","\'=HYPERLINK(""https://evil.example"")"\r\n"Bimal","-4"\r\n',
  );
});

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
      getColumn() {
        return {
          getOffsetRange() {
            return {
              getResizedRange() {
                return {};
              },
            };
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
            series: {
              getItemAt: () => ({
                setXAxisValues() {},
              }),
              add: () => ({
                setValues() {},
                setXAxisValues() {},
              }),
            },
            axes: {
              categoryAxis: { title: {} },
              valueAxis: { title: {} },
            },
            legend: {},
            dataLabels: new Proxy(
              {},
              {
                set(object, key, value) {
                  calls.push(
                    `chart.dataLabels.${String(key)} = ${String(value)}`,
                  );
                  object[key] = value;
                  return true;
                },
              },
            ),
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
            layout: { getRange: () => range("Result", "A3:B6") },
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
      getItemOrNullObject: (name: string) => {
        const item = nullable(pivots.has(name));
        if (!item.isNullObject)
          item.layout = { getRange: () => range("Result", "A3:B6") };
        return item;
      },
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

test("CSV export copies the source, marks the result and starts a download", async () => {
  const excel = fakeWorkbook(sourceCells.map((row) => [...row]));
  const input = await inspectSelectedExcelRange(excel.runtime, "book-1");
  const plan = createExcelPreviewPlan(input, ["export-csv"]);
  const downloads: string[] = [];
  (globalThis as any).document = {
    createElement: () => ({
      click() {
        downloads.push(this.download);
      },
    }),
  };
  try {
    const report = await applyApprovedExcelPlan(
      excel.runtime,
      plan,
      true,
      "approval",
      { expectedSourceFingerprint: plan.sourceFingerprint },
    );
    assert.equal(report.results[0].kind, "export-csv");
    assert.equal(report.results[0].status, "created");
    assert.equal(report.sourceUnchangedAfterApply, true);
    assert.deepEqual(downloads, ["CSV export of Sales.csv"]);
    assert.ok(excel.calls.includes("mark CSV export of Sales vynorai=result"));
  } finally {
    delete (globalThis as any).document;
  }
});

test("PDF export copies the source, marks the result and downloads Office file slices", async () => {
  const excel = fakeWorkbook(sourceCells.map((row) => [...row]));
  const input = await inspectSelectedExcelRange(excel.runtime, "book-1");
  const plan = createExcelPreviewPlan(input, ["export-pdf"]);
  const downloads: string[] = [];
  (globalThis as any).document = {
    createElement: () => ({
      click() {
        downloads.push(this.download);
      },
    }),
  };
  (globalThis as any).Office = {
    FileType: { Pdf: "pdf" },
    context: {
      document: {
        getFileAsync(_type: string, callback: (result: any) => void) {
          callback({
            status: "succeeded",
            value: {
              sliceCount: 1,
              getSliceAsync(
                _index: number,
                sliceCallback: (result: any) => void,
              ) {
                sliceCallback({
                  status: "succeeded",
                  value: { data: "JVBERi0xLjQ=" },
                });
              },
              closeAsync() {},
            },
          });
        },
      },
    },
  };
  try {
    const report = await applyApprovedExcelPlan(
      excel.runtime,
      plan,
      true,
      "approval",
      { expectedSourceFingerprint: plan.sourceFingerprint },
    );
    assert.equal(report.results[0].kind, "export-pdf");
    assert.equal(report.results[0].status, "created");
    assert.equal(report.sourceUnchangedAfterApply, true);
    assert.deepEqual(downloads, ["PDF export of Sales.pdf"]);
    assert.ok(excel.calls.includes("mark PDF export of Sales vynorai=result"));
  } finally {
    delete (globalThis as any).document;
    delete (globalThis as any).Office;
  }
});

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

test("inspect refuses a selection with too many columns before reading cell values", async () => {
  const rows = Array.from({ length: 5 }, () =>
    Array.from({ length: 101 }, () => 1),
  );
  const excel = fakeWorkbook(rows);
  await assert.rejects(
    inspectSelectedExcelRange(excel.runtime, "book-1"),
    /at most 100 columns/,
  );
});

test("inspect samples a table over the cell limit instead of refusing it", async () => {
  const nothing = { isNullObject: true, load() {} };
  const hugeRegion = {
    isNullObject: false,
    address: "A1:T6000",
    rowCount: 6000,
    columnCount: 20,
    worksheet: { name: "Big", load() {} },
    load() {},
    getCell: (start: number) => ({
      getResizedRange: (lastRow: number, lastColumn: number) => ({
        load() {},
        values: Array.from({ length: lastRow + 1 }, (_, row) =>
          Array.from({ length: lastColumn + 1 }, (_, column) =>
            start + row === 0 ? `H${column}` : start + row,
          ),
        ),
      }),
    }),
  };
  const selected: any = {
    address: "A2",
    rowCount: 1,
    columnCount: 1,
    load() {},
    getSurroundingRegion: () => hugeRegion,
    getUsedRangeOrNullObject: () => nothing,
    worksheet: {
      name: "Big",
      load() {},
      getUsedRangeOrNullObject: () => nothing,
    },
  };
  const runtime: any = {
    run: (callback: (context: any) => Promise<unknown>) =>
      callback({
        workbook: { getSelectedRange: () => selected },
        sync: async () => {},
      }),
  };
  const input: any = await inspectSelectedExcelRange(runtime, "book-1");
  assert.equal(input.address, "A1:T6000");
  assert.deepEqual(input.sample, { totalRows: 6000, sampledRows: 4000 });
  assert.equal(input.values.length, 4000);
  assert.equal(input.values[0][0], "H0");
  assert.equal(input.values[3999][0], 5999);
});

test("sample blocks start at the top, are spaced evenly and reach the last row", () => {
  assert.deepEqual(sampleBlocks(500, 4000), [[0, 500]]);
  const blocks = sampleBlocks(1_000_000, 4000);
  assert.deepEqual(blocks[0], [0, 1000]);
  assert.equal(blocks.length, 31);
  const [lastStart, lastCount] = blocks[blocks.length - 1];
  assert.equal(lastStart + lastCount, 1_000_000);
  assert.equal(
    blocks.reduce((total, [, count]) => total + count, 0),
    4000,
  );
  assert.equal(sampleRowBudget(100), 1000);
  assert.equal(sampleRowBudget(5), 4000);
});

test("inspect stops between read chunks when cancelled", async () => {
  const rows = [
    ["Value"],
    ...Array.from({ length: 1200 }, (_, index) => [index]),
  ];
  const excel = fakeWorkbook(rows);
  let completedRows = 0;

  await assert.rejects(
    inspectSelectedExcelRange(
      excel.runtime,
      "book-1",
      500,
      (completed) => {
        completedRows = completed;
      },
      undefined,
      () => completedRows >= 500,
    ),
    /EXCEL_READ_CANCELLED/,
  );
  assert.equal(completedRows, 500);
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

test("apply writes large result copies in bounded chunks", async () => {
  const cells = Array.from({ length: 1201 }, (_, index) => [
    index === 0 ? "Region" : `R${index}`,
    index,
  ]);
  const excel = fakeWorkbook(cells);
  const input = await inspectSelectedExcelRange(excel.runtime, "book-1");
  const plan = createExcelPreviewPlan(input, ["table"]);
  const progress: number[] = [];
  const report = await applyApprovedExcelPlan(
    excel.runtime,
    plan,
    true,
    "approval",
    {
      expectedSourceFingerprint: plan.sourceFingerprint,
      onProgress: (completed, total) => progress.push(completed / total),
    },
  );
  assert.equal(report.sourceUnchangedAfterApply, true);
  assert.deepEqual(progress, [500 / 1201, 1000 / 1201, 1]);
  assert.equal(
    excel.calls.filter(
      (call) => call.startsWith("write ") && !call.startsWith("write Sales!"),
    ).length,
    3,
  );
  assert.ok(!excel.calls.some((call) => call.startsWith("write Sales!")));
});

test("apply enables chart data labels only on the copied result", async () => {
  const excel = fakeWorkbook(sourceCells.map((row) => [...row]));
  const input = await inspectSelectedExcelRange(excel.runtime, "book-1");
  const plan = createExcelPreviewPlan(input, ["chart"], 500, {
    chart: { category: 0, value: 1, chartType: "column", showDataLabels: true },
  });
  const report = await applyApprovedExcelPlan(
    excel.runtime,
    plan,
    true,
    "approval",
    { expectedSourceFingerprint: plan.sourceFingerprint },
  );
  assert.equal(report.results[0].status, "created");
  assert.ok(excel.calls.includes("chart.dataLabels.showValue = true"));
  assert.ok(!excel.calls.some((call) => call.startsWith("write Sales!")));
});

test("apply charts the actual PivotTable layout when both actions are requested", async () => {
  const excel = fakeWorkbook(sourceCells.map((row) => [...row]));
  const input = await inspectSelectedExcelRange(excel.runtime, "book-1");
  const plan = createExcelPreviewPlan(input, ["chart", "pivot-table"], 500, {
    chart: { category: 0, value: 1, chartType: "column", pivotResult: true },
    pivot: { rows: 0, values: 1 },
  });
  assert.deepEqual(
    plan.actions.map((action) => action.kind),
    ["pivot-table", "chart"],
  );
  assert.equal(
    plan.actions[1].spec?.pivotSourceName,
    "Sales_Vynor_pivot_table",
  );
  const report = await applyApprovedExcelPlan(
    excel.runtime,
    plan,
    true,
    "approval",
    { expectedSourceFingerprint: plan.sourceFingerprint },
  );
  assert.deepEqual(
    report.results.map((result) => `${result.kind}:${result.status}`),
    ["pivot-table:created", "chart:created"],
  );
  assert.ok(excel.calls.includes("chart.add ColumnClustered range:A3:B6"));
  assert.ok(!excel.calls.some((call) => call.startsWith("write Sales!")));
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

test("a sampled very large range plans only a PivotTable and pins the source by its header", () => {
  const base = {
    workbookId: "w",
    worksheetName: "Big",
    address: "A1:C600000",
    values: [
      ["Item", "Qty", "Region"],
      ["a", 1, "N"],
      ["b", 2, "S"],
      ["a", 3, "N"],
    ],
    hasHeaders: true,
    sample: { totalRows: 600000, sampledRows: 4 },
  };
  const plan: any = createExcelPreviewPlan(base, ["pivot-table"]);
  assert.equal(plan.profile.rowCount, 600000);
  assert.deepEqual(plan.profile.sample, base.sample);
  assert.equal(plan.profile.chunkCount, 1);
  assert.ok(
    plan.warnings.some((w: string) => /Very large data.*600,000 rows/.test(w)),
  );
  assert.throws(
    () => createExcelPreviewPlan(base, ["chart"]),
    /too large to read in full/,
  );
  // Only the first rows pin the source; later rows are not re-read at apply time.
  assert.equal(
    fingerprintExcelRange({
      ...base,
      values: [...base.values.slice(0, 3), ["x", 1, "N"]],
    }),
    fingerprintExcelRange({
      ...base,
      values: [...base.values.slice(0, 3), ["y", 9, "Q"]],
    }),
  );
  assert.notEqual(
    fingerprintExcelRange({
      ...base,
      values: [["Other", "Qty", "Region"], ...base.values.slice(1)],
    }),
    fingerprintExcelRange(base),
  );
});

test("a sampled range turns a chart or a summary into a PivotTable and allows describe statistics", () => {
  const base: any = {
    workbookId: "w",
    worksheetName: "Big",
    address: "A1:C600000",
    values: [
      ["Item", "Qty", "Region"],
      ["a", 1, "N"],
      ["b", 2, "S"],
      ["a", 3, "N"],
    ],
    hasHeaders: true,
    sample: { totalRows: 600000, sampledRows: 4 },
  };
  const chart = adaptForSampledRange(["chart"], {
    chart: { category: 0, value: 1, chartType: "column" },
  });
  assert.deepEqual(chart.actions.sort(), ["chart", "pivot-table"]);
  assert.equal(chart.specs.chart?.pivotResult, true);
  assert.deepEqual(chart.specs.pivot, {
    rows: 0,
    values: 1,
    aggregation: "sum",
  });
  const plan: any = createExcelPreviewPlan(
    base,
    chart.actions,
    500,
    chart.specs,
  );
  assert.deepEqual(
    plan.actions.map((action: any) => action.kind),
    ["pivot-table", "chart"],
  );
  const summary = adaptForSampledRange(["summary"], {
    summary: {
      group: 0,
      values: [
        { column: 1, aggregation: "average" },
        { column: 2, aggregation: "sum" },
      ],
    },
  } as any);
  assert.deepEqual(summary.actions, ["pivot-table"]);
  assert.equal(summary.specs.pivot?.aggregation, "average");
  assert.equal(summary.specs.summary, undefined);
  const stats: any = createExcelPreviewPlan(base, ["statistics"], 500, {
    statistics: { mode: "describe", columns: [1] },
  });
  assert.equal(stats.actions[0].kind, "statistics");
  const view: any = createExcelPreviewPlan(base, ["view"], 500, {
    view: { sort: { column: 1, direction: "desc" }, limit: 10 },
  });
  assert.equal(view.actions[0].kind, "view");
  assert.throws(
    () =>
      createExcelPreviewPlan(base, ["statistics"], 500, {
        statistics: { mode: "forecast", value: 1, periods: 3 },
      }),
    /too large to read in full/,
  );
  assert.throws(
    () =>
      createExcelPreviewPlan(base, ["chart"], 500, {
        chart: { category: 0, value: 1, chartType: "column" },
      }),
    /too large to read in full/,
  );
});
