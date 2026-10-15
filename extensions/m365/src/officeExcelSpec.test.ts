import assert from "node:assert/strict";
import { test } from "node:test";
import { createExcelPreviewPlan } from "./excel.js";
import { applyApprovedExcelPlan } from "./officeExcel.js";

const cells = [
  ["Month", "Region", "Sales", "Cost"],
  ["Jan", "North", 1200, 800],
  ["Feb", "South", 1500, 950],
  ["Mar", "North", 1800, 1100],
];

/** Records column-level calls so the test can prove which columns a chart and pivot used. */
function fakeWorkbook() {
  const calls: string[] = [];
  const sheets = new Map<string, any>();
  const names = new Set<string>();
  const nullable = (exists: boolean) => ({ isNullObject: !exists, load() {} });
  const column = (index: number, label = `col${index}`) => ({
    label,
    getOffsetRange: (rows: number) => ({
      label: `${label}+${rows}`,
      getResizedRange: (resize: number) => ({
        label: `${label}+${rows}${resize}`,
      }),
    }),
  });
  const sourceRange = (address: string) => ({
    address,
    rowCount: cells.length,
    columnCount: cells[0].length,
    load() {},
    getCell: (row: number) => ({
      getResizedRange: (rows: number) => ({
        values: cells.slice(row, row + rows + 1),
        load() {},
      }),
    }),
    getColumn: (index: number) => {
      calls.push(`getColumn ${index}`);
      return column(index);
    },
  });
  const makeSheet = (name: string) => {
    const sheet: any = {
      name,
      getRange: (address: string) => sourceRange(address),
      getRangeByIndexes: (
        row: number,
        columnIndex: number,
        rows: number,
        columns: number,
      ) =>
        row === 19
          ? (() => {
              throw new Error("summary block unsupported");
            })()
          : Object.assign(sourceRange(name + "!A1"), {
              label:
                "range " + row + "," + columnIndex + "," + rows + "," + columns,
            }),
      charts: {
        getItemOrNullObject: () => nullable(false),
        add(type: string, range: any, by: string) {
          calls.push(`chart.add ${type} ${range.label} ${by}`);
          const chart: any = {
            title: {},
            setPosition: () => calls.push("chart.position"),
            series: {
              getItemAt: () => ({
                setXAxisValues: (range: any) =>
                  calls.push(`series.x ${range.label}`),
              }),
              add: (name: string) =>
                new Proxy(
                  {
                    setValues: (range: any) =>
                      calls.push(`series.values ${range.label}`),
                    setXAxisValues: (range: any) =>
                      calls.push(`series.x ${range.label}`),
                  } as any,
                  {
                    set(object, key, value) {
                      object[key] = value;
                      if (key === "chartType")
                        calls.push(`series.type ${value}`);
                      return true;
                    },
                  },
                ),
            },
          };
          return new Proxy(chart, {
            set(object, key, value) {
              object[key] = value;
              if (key === "name") calls.push(`chart.name ${value}`);
              return true;
            },
          });
        },
      },
      pivotTables: {
        add(name: string) {
          calls.push(`pivot.add ${name}`);
          return {
            hierarchies: { getItem: (header: string) => ({ header }) },
            rowHierarchies: {
              add: (hierarchy: any) =>
                calls.push(`pivot.rows ${hierarchy.header}`),
            },
            dataHierarchies: {
              add: (hierarchy: any) => {
                calls.push(`pivot.values ${hierarchy.header}`);
                return new Proxy(
                  {},
                  {
                    set(_o, key, value) {
                      calls.push(`pivot.${String(key)} ${value}`);
                      return true;
                    },
                  },
                );
              },
            },
          };
        },
      },
      tables: {
        add: (_range: any, _headers: boolean) =>
          new Proxy(
            {},
            {
              set(object, key, value) {
                object[key] = value;
                if (key === "name") calls.push(`table.name ${value}`);
                return true;
              },
            },
          ),
      },
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
      add: (name: string) => {
        calls.push(`sheet.add ${name}`);
        return makeSheet(name);
      },
    },
    tables: { getItemOrNullObject: () => nullable(false) },
    pivotTables: { getItemOrNullObject: () => nullable(false) },
    names: {
      items: [],
      load() {},
      getItemOrNullObject: (name: string) => ({
        isNullObject: !names.has(name),
        load() {},
        delete() {
          names.delete(name);
          calls.push("name.delete " + name);
        },
      }),
      add(name: string, formula: string) {
        names.add(name);
        calls.push("name.add " + name + " " + formula);
      },
    },
    slicers: {
      items: [],
      load() {},
      add(_table: any, field: string, _sheet: any) {
        calls.push(`slicer.add ${field}`);
        return new Proxy(
          {},
          {
            set(object, key, value) {
              object[key] = value;
              if (key === "name") calls.push(`slicer.name ${value}`);
              if (key === "caption") calls.push(`slicer.caption ${value}`);
              return true;
            },
          },
        );
      },
    },
  };
  return {
    calls,
    runtime: {
      run: <T>(callback: (context: any) => Promise<T>) =>
        callback({ workbook, sync: async () => undefined }),
    },
  };
}

const input = {
  workbookId: "book",
  worksheetName: "Sheet1",
  address: "Sheet1!A1:D4",
  hasHeaders: true,
  values: cells,
};

test("a chart with column choices uses exactly those columns", async () => {
  const plan = createExcelPreviewPlan(input as any, ["chart"], undefined, {
    chart: { category: 1, value: 2, chartType: "column" },
  });
  assert.deepEqual(plan.actions[0].spec, {
    categoryColumn: "Region",
    categoryIndex: 1,
    valueColumn: "Sales",
    valueIndex: 2,
    chartType: "column",
  });
  const excel = fakeWorkbook();
  const report = await applyApprovedExcelPlan(
    excel.runtime,
    plan,
    true,
    "approval",
    { expectedSourceFingerprint: plan.sourceFingerprint },
  );
  assert.equal(report.results[0].status, "created");
  assert.ok(excel.calls.includes("getColumn 2"));
  assert.ok(excel.calls.includes("getColumn 1"));
  assert.ok(
    excel.calls.some((call) =>
      /^chart\.add ColumnClustered col2 Columns$/.test(call),
    ),
    excel.calls.join("\n"),
  );
  assert.ok(excel.calls.includes("series.x col1+1-1"));
});

test("a pivot with column choices uses the named row and value fields", async () => {
  const plan = createExcelPreviewPlan(
    input as any,
    ["pivot-table"],
    undefined,
    {
      pivot: { rows: 1, values: 3 },
    },
  );
  const excel = fakeWorkbook();
  const report = await applyApprovedExcelPlan(
    excel.runtime,
    plan,
    true,
    "approval",
    { expectedSourceFingerprint: plan.sourceFingerprint },
  );
  assert.equal(report.results[0].status, "created");
  assert.ok(excel.calls.includes("pivot.rows Region"));
  assert.ok(excel.calls.includes("pivot.values Cost"));
  assert.ok(excel.calls.includes("pivot.summarizeBy Sum"));
});

test("apply creates a combo chart with line overlays on a new result sheet", async () => {
  const plan = createExcelPreviewPlan(input as any, ["chart"], undefined, {
    chart: {
      category: 1,
      value: 2,
      chartType: "combo",
      extraValues: [3],
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
  assert.equal(report.results[0].status, "created");
  assert.ok(
    excel.calls.some((call) =>
      /^chart\.add ColumnClustered col2 Columns$/.test(call),
    ),
    excel.calls.join("\n"),
  );
  assert.ok(excel.calls.includes("series.type Line"), excel.calls.join("\n"));
});

test("apply creates a histogram from one numeric column", async () => {
  const plan = createExcelPreviewPlan(input as any, ["chart"], undefined, {
    chart: { category: 2, value: 2, chartType: "histogram" },
  });
  const excel = fakeWorkbook();
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
      /^chart\.add Histogram col2 Columns$/.test(call),
    ),
    excel.calls.join("\n"),
  );
  assert.ok(!excel.calls.some((call) => call.startsWith("series.x")));
});

test("apply creates a waterfall chart from category and value columns", async () => {
  const plan = createExcelPreviewPlan(input as any, ["chart"], undefined, {
    chart: { category: 1, value: 2, chartType: "waterfall" },
  });
  const excel = fakeWorkbook();
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
      /^chart\.add Waterfall col2 Columns$/.test(call),
    ),
    excel.calls.join("\n"),
  );
  assert.ok(excel.calls.includes("series.x col1+1-1"));
});

test("apply creates a named range on a copied result sheet", async () => {
  const plan = createExcelPreviewPlan(
    input as any,
    ["named-range"],
    undefined,
    {
      namedRange: { source: 2 },
    },
  );
  const excel = fakeWorkbook();
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
      /^name\.add VynorAI_Sales_3 ='.*'!\$C\$2:\$C\$4$/.test(call),
    ),
    excel.calls.join("\n"),
  );
  assert.equal(report.results[0].createdSheet, true);
});

test("apply creates a slicer on a copied result table", async () => {
  const plan = createExcelPreviewPlan(input as any, ["slicer"], undefined, {
    slicer: { source: 1 },
  });
  const excel = fakeWorkbook();
  const report = await applyApprovedExcelPlan(
    excel.runtime,
    plan,
    true,
    "approval",
    { expectedSourceFingerprint: plan.sourceFingerprint },
  );
  assert.equal(report.results[0].status, "created");
  assert.ok(excel.calls.includes("table.name VynorAI_Region_slicer_data"));
  assert.ok(excel.calls.includes("slicer.add Region"));
  assert.ok(excel.calls.includes("slicer.name VynorAI_Region_slicer"));
  assert.equal(report.results[0].createdSheet, true);
});

test("without column choices the existing whole-range behaviour is unchanged", () => {
  const plan = createExcelPreviewPlan(input as any, ["chart", "pivot-table"]);
  assert.ok(plan.actions.every((action) => action.spec === undefined));
});

test("invalid column choices are rejected before a plan exists", () => {
  const make = (specs: any, actions: any = ["chart"]) =>
    createExcelPreviewPlan(input as any, actions, undefined, specs);
  assert.throws(
    () => make({ chart: { category: 1, value: 1, chartType: "column" } }),
    /EXCEL_SPEC_INVALID|different columns/,
  );
  assert.throws(
    () => make({ chart: { category: 1, value: 9, chartType: "column" } }),
    /different columns/,
  );
  assert.throws(
    () => make({ chart: { category: 2, value: 1, chartType: "column" } }),
    /must contain numbers/,
  );
  assert.throws(
    () => make({ pivot: { rows: 1, values: 2 } }, ["chart"]),
    /needs a PivotTable action/,
  );
});
