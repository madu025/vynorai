import assert from "node:assert/strict";
import { test } from "node:test";
import { createExcelPreviewPlan } from "./excel.js";
import {
  applyApprovedExcelPlan,
  inspectSelectedExcelRange,
  localExcelAddress,
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
  const sheets = new Map<string, any>();
  const tables = new Set<string>();
  const pivots = new Set<string>();
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
      getRange: (address: string) => {
        const target = range(name, address);
        return new Proxy(target, {
          set(object: any, key, value) {
            if (key === "values") {
              calls.push(`write ${name}!${address}`);
              if (name === "Sales") cells = value;
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
    setCells: (next: unknown[][]) => (cells = next),
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

test("inspect rejects a merged multi-row header before requesting a plan", async () => {
  const excel = fakeWorkbook([
    ["Date", "Time", ""],
    ["", "Start", "End"],
    ["2026-09-02", "08:00", "09:00"],
  ]);
  await assert.rejects(
    inspectSelectedExcelRange(excel.runtime, "book-1"),
    /blank or merged header cells/,
  );
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
    "table:created",
    "chart:created",
    "new-sheet:created",
    "pivot-table:created",
  ]);
  assert.equal(report.sourceUnchangedAfterApply, true);
  assert.ok(excel.calls.includes("table.add range:A1:B3 true"));
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
    ["exists", "exists", "created", "exists"],
  );
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
