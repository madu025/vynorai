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

test("server and add-in agree when a complete header row follows a merged title band", () => {
  const titledInput = {
    ...input,
    address: "Sheet1!A1:D3",
    values: [
      ["", "Mileage", "", ""],
      ["Date", "Start", "End", "Purpose"],
      ["2026-09-02", 14952, 14980, "Visit Homagama"],
    ],
  };
  const server = createServerExcelPreviewPlan(titledInput, ["table"], 500);
  const local = createExcelPreviewPlan(titledInput as any, ["table"], 500);
  assert.equal(excelPlansMatch(local, server), true);
  assert.deepEqual(local.normalization, {
    headerRowCount: 2,
    headers: ["Date", "Start", "End", "Purpose"],
  });
});

test("server and add-in build the same plan for explicit column choices", () => {
  const specs = {
    chart: { category: 1, value: 2, chartType: "pie" as const },
    pivot: { rows: 1, values: 3 },
  };
  const actions = ["chart", "pivot-table"] as const;
  const server = createServerExcelPreviewPlan(input, [...actions], 500, specs);
  const local = createExcelPreviewPlan(input as any, [...actions], 500, specs);
  assert.equal(excelPlansMatch(local, server), true);
  assert.deepEqual(
    server.actions.map((action) => action.kind),
    ["chart", "pivot-table"],
  );
  assert.equal(server.actions[0].spec.valueColumn, "Sales");
  assert.equal(server.actions[1].spec.rowsColumn, "Region");
});

test("server and add-in preserve explicit chart data-label intent", () => {
  const specs = {
    chart: {
      category: 1,
      value: 2,
      chartType: "column" as const,
      showDataLabels: true,
    },
  };
  const local = createExcelPreviewPlan(input as any, ["chart"], 500, specs);
  const server = createServerExcelPreviewPlan(input, ["chart"], 500, specs);
  assert.equal(excelPlansMatch(local, server), true);
  assert.equal(server.actions[0].spec.showDataLabels, true);
});

test("server and add-in preserve explicit PivotTable-result chart intent", () => {
  const specs = {
    chart: {
      category: 1,
      value: 2,
      chartType: "line" as const,
      pivotResult: true,
    },
    pivot: { rows: 1, values: 2 },
  };
  const actions = ["chart", "pivot-table"] as const;
  const local = createExcelPreviewPlan(input as any, [...actions], 500, specs);
  const server = createServerExcelPreviewPlan(input, [...actions], 500, specs);
  assert.equal(excelPlansMatch(local, server), true);
  assert.deepEqual(
    server.actions.map((action) => action.kind),
    ["pivot-table", "chart"],
  );
  assert.equal(
    server.actions[1].spec.pivotSourceName,
    "Sheet1_Vynor_pivot_table",
  );
});

test("server and add-in build the same safe combine plan", () => {
  const specs = {
    addColumn: {
      name: "Region - Status",
      derived: "combine" as const,
      source: 1,
      source2: 2,
    },
  };
  const actions = ["add-column"] as const;
  const local = createExcelPreviewPlan(input as any, [...actions], 500, specs);
  const server = createServerExcelPreviewPlan(input, [...actions], 500, specs);
  assert.equal(excelPlansMatch(local, server), true);
  assert.equal(server.actions[0].spec.sourceColumn2, "Sales");
  assert.equal(server.actions[0].spec.separator, " - ");
});

test("server and add-in build the same safe multi-key lookup plan", () => {
  const specs = {
    addColumn: {
      name: "Manager",
      lookup: {
        sheet: "Staff",
        sourceKey: 0,
        keyIndex: 0,
        keyHeader: "Month",
        returnIndex: 3,
        returnHeader: "Cost",
        rows: 40,
        sourceKeys: [0, 1],
        keyIndexes: [0, 1],
        keyHeaders: ["Month", "Region"],
      },
    },
  };
  const actions = ["add-column"] as const;
  const local = createExcelPreviewPlan(input as any, [...actions], 500, specs);
  const server = createServerExcelPreviewPlan(input, [...actions], 500, specs);
  assert.equal(excelPlansMatch(local, server), true);
  assert.deepEqual(server.actions[0].spec?.sourceKeyIndexes, [0, 1]);
  assert.deepEqual(server.actions[0].spec?.lookupKeyHeaders, [
    "Month",
    "Region",
  ]);
  assert.throws(
    () =>
      createServerExcelPreviewPlan(input, [...actions], 500, {
        addColumn: {
          ...specs.addColumn,
          lookup: { ...specs.addColumn.lookup, sourceKeys: [0, 0] },
        },
      }),
    /not valid/,
  );
});

test("server and add-in build the same approximate lookup plan and refuse multi-key approximate", () => {
  const specs = {
    addColumn: {
      name: "Tax Rate",
      lookup: {
        sheet: "Rates",
        sourceKey: 2,
        keyIndex: 2,
        keyHeader: "Sales",
        returnIndex: 3,
        returnHeader: "Cost",
        rows: 40,
        matchMode: "approximate" as const,
      },
    },
  };
  const actions = ["add-column"] as const;
  const local = createExcelPreviewPlan(input as any, [...actions], 500, specs);
  const server = createServerExcelPreviewPlan(input, [...actions], 500, specs);
  assert.equal(excelPlansMatch(local, server), true);
  assert.equal(server.actions[0].spec?.lookupMatchMode, "approximate");
  assert.throws(
    () =>
      createServerExcelPreviewPlan(input, [...actions], 500, {
        addColumn: {
          ...specs.addColumn,
          lookup: {
            ...specs.addColumn.lookup,
            sourceKeys: [0, 1],
            keyIndexes: [0, 1],
            keyHeaders: ["Month", "Region"],
          },
        },
      }),
    /not valid/,
  );
});

test("server and add-in build the same multiple-return lookup plan", () => {
  const specs = {
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
  };
  const actions = ["lookup-columns"] as const;
  const local = createExcelPreviewPlan(input as any, [...actions], 500, specs);
  const server = createServerExcelPreviewPlan(input, [...actions], 500, specs);
  assert.equal(excelPlansMatch(local, server), true);
  assert.equal(server.actions[0].targetSheet, "Sheet1_Vynor_Lookup");
  assert.deepEqual(server.actions[0].spec?.lookupReturnIndexes, [1, 2]);
  assert.throws(
    () =>
      createServerExcelPreviewPlan(input, [...actions], 500, {
        lookupColumns: {
          ...specs.lookupColumns,
          lookup: {
            ...specs.lookupColumns.lookup,
            returnIndexes: [1, 1],
          },
        },
      } as any),
    /not valid/,
  );
});

test("server and add-in build the same XLOOKUP plan and refuse approximate XLOOKUP", () => {
  const specs = {
    addColumn: {
      name: "Manager",
      lookup: {
        sheet: "Staff",
        sourceKey: 0,
        keyIndex: 0,
        keyHeader: "Name",
        returnIndex: 1,
        returnHeader: "Manager",
        rows: 40,
        method: "xlookup" as const,
      },
    },
  };
  const actions = ["add-column"] as const;
  const local = createExcelPreviewPlan(input as any, [...actions], 500, specs);
  const server = createServerExcelPreviewPlan(input, [...actions], 500, specs);
  assert.equal(excelPlansMatch(local, server), true);
  assert.equal(server.actions[0].spec?.lookupMethod, "xlookup");
  assert.throws(
    () =>
      createServerExcelPreviewPlan(input, [...actions], 500, {
        addColumn: {
          ...specs.addColumn,
          lookup: {
            ...specs.addColumn.lookup,
            matchMode: "approximate",
          },
        },
      } as any),
    /not valid/,
  );
});

test("server and add-in build the same safe split plan", () => {
  const specs = {
    split: {
      source: 0,
      firstName: "Customer First",
      lastName: "Customer Last",
    },
  };
  const actions = ["split-column"] as const;
  const local = createExcelPreviewPlan(input as any, [...actions], 500, specs);
  const server = createServerExcelPreviewPlan(input, [...actions], 500, specs);
  assert.equal(excelPlansMatch(local, server), true);
  assert.equal(server.actions[0].spec.splitSourceColumn, "Month");
});

test("server and add-in build the same safe unpivot plan", () => {
  const specs = {
    unpivot: { values: [2, 3], name: "Measure", value: "Amount" },
  };
  const actions = ["unpivot"] as const;
  const local = createExcelPreviewPlan(input as any, [...actions], 500, specs);
  const server = createServerExcelPreviewPlan(input, [...actions], 500, specs);
  assert.equal(excelPlansMatch(local, server), true);
  assert.deepEqual(server.actions[0].spec, {
    unpivotValueColumns: ["Sales", "Cost"],
    unpivotValueIndexes: [2, 3],
    unpivotNameColumn: "Measure",
    unpivotValueColumn: "Amount",
  });
  assert.throws(
    () =>
      createServerExcelPreviewPlan(input, [...actions], 500, {
        unpivot: { values: [0, 1, 2, 3], name: "Measure", value: "Amount" },
      }),
    /keep at least one identifier column/,
  );
});

test("server and add-in accept fuzzy dedupe with a bounded row limit", () => {
  const fuzzyInput = {
    ...input,
    values: [
      ["Region", "Sales"],
      ["North", 10],
      ["Noth", 10],
    ],
  };
  const specs = { clean: { operations: ["fuzzy-dedupe"] } };
  const local = createExcelPreviewPlan(
    fuzzyInput as any,
    ["clean"],
    500,
    specs,
  );
  const server = createServerExcelPreviewPlan(
    fuzzyInput,
    ["clean"],
    500,
    specs,
  );
  assert.equal(excelPlansMatch(local, server), true);
  assert.deepEqual(server.actions[0].spec.operations, ["fuzzy-dedupe"]);
});

test("server and add-in build the same safe running-total plan", () => {
  const actions = ["add-column"] as const;
  const specs = {
    addColumn: {
      name: "Running Total of Sales",
      derived: "running-total" as const,
      source: 2,
    },
  };
  const server = createServerExcelPreviewPlan(input, [...actions], 500, specs);
  const local = createExcelPreviewPlan(input as any, [...actions], 500, specs);
  assert.equal(excelPlansMatch(local, server), true);
  assert.deepEqual(server.actions[0].spec, {
    columnName: "Running Total of Sales",
    derived: "running-total",
    sourceColumn: "Sales",
    sourceIndex: 2,
  });
  assert.throws(
    () =>
      createServerExcelPreviewPlan(input, [...actions], 500, {
        addColumn: {
          name: "Running Total",
          derived: "running-total",
          source: 1,
        },
      } as any),
    /holds text, not numbers/,
  );
});

test("server and add-in build the same safe rank plan", () => {
  const actions = ["add-column"] as const;
  const specs = {
    addColumn: {
      name: "Rank of Sales",
      derived: "rank" as const,
      source: 2,
    },
  };
  const server = createServerExcelPreviewPlan(input, [...actions], 500, specs);
  const local = createExcelPreviewPlan(input as any, [...actions], 500, specs);
  assert.equal(excelPlansMatch(local, server), true);
  assert.deepEqual(server.actions[0].spec, {
    columnName: "Rank of Sales",
    derived: "rank",
    sourceColumn: "Sales",
    sourceIndex: 2,
  });
  assert.throws(
    () =>
      createServerExcelPreviewPlan(input, [...actions], 500, {
        addColumn: { name: "Rank", derived: "rank", source: 1 },
      } as any),
    /holds text, not numbers/,
  );
});

test("server and add-in build the same safe percent-change plan", () => {
  const actions = ["add-column"] as const;
  const specs = {
    addColumn: {
      name: "% Change of Sales",
      derived: "percent-change" as const,
      source: 2,
    },
  };
  const server = createServerExcelPreviewPlan(input, [...actions], 500, specs);
  const local = createExcelPreviewPlan(input as any, [...actions], 500, specs);
  assert.equal(excelPlansMatch(local, server), true);
  assert.deepEqual(server.actions[0].spec, {
    columnName: "% Change of Sales",
    derived: "percent-change",
    sourceColumn: "Sales",
    sourceIndex: 2,
    percentFormat: true,
  });
  assert.throws(
    () =>
      createServerExcelPreviewPlan(input, [...actions], 500, {
        addColumn: {
          name: "% Change",
          derived: "percent-change",
          source: 1,
        },
      } as any),
    /holds text, not numbers/,
  );
});

test("server and add-in build the same safe moving-average plan", () => {
  const actions = ["add-column"] as const;
  const specs = {
    addColumn: {
      name: "3-Period Moving Average of Sales",
      derived: "moving-average" as const,
      source: 2,
      window: 3,
    },
  };
  const server = createServerExcelPreviewPlan(input, [...actions], 500, specs);
  const local = createExcelPreviewPlan(input as any, [...actions], 500, specs);
  assert.equal(excelPlansMatch(local, server), true);
  assert.deepEqual(server.actions[0].spec, {
    columnName: "3-Period Moving Average of Sales",
    derived: "moving-average",
    sourceColumn: "Sales",
    sourceIndex: 2,
    window: 3,
  });
  assert.throws(
    () =>
      createServerExcelPreviewPlan(input, [...actions], 500, {
        addColumn: {
          name: "Moving Average",
          derived: "moving-average",
          source: 2,
          window: 1,
        },
      } as any),
    /window from 2 to 12/,
  );
});

test("server and add-in build the same safe YoY plan", () => {
  const actions = ["add-column"] as const;
  const specs = {
    addColumn: {
      name: "YoY Change of Sales",
      derived: "yoy" as const,
      source: 2,
      lag: 12,
    },
  };
  const server = createServerExcelPreviewPlan(input, [...actions], 500, specs);
  const local = createExcelPreviewPlan(input as any, [...actions], 500, specs);
  assert.equal(excelPlansMatch(local, server), true);
  assert.deepEqual(server.actions[0].spec, {
    columnName: "YoY Change of Sales",
    derived: "yoy",
    sourceColumn: "Sales",
    sourceIndex: 2,
    lag: 12,
    percentFormat: true,
  });
  assert.throws(
    () =>
      createServerExcelPreviewPlan(input, [...actions], 500, {
        addColumn: {
          name: "YoY Change",
          derived: "yoy",
          source: 2,
          lag: 4,
        },
      } as any),
    /12-period lag/,
  );
});

test("server and add-in build the same safe date-group plan", () => {
  const dateInput = {
    ...input,
    values: [
      ["Date", "Sales"],
      [44927, 100],
      [44958, 110],
      [45017, 120],
    ],
  };
  const actions = ["add-column"] as const;
  const specs = {
    addColumn: {
      name: "Month of Date",
      derived: "date-group" as const,
      source: 0,
      group: "month" as const,
    },
  };
  const server = createServerExcelPreviewPlan(
    dateInput,
    [...actions],
    500,
    specs,
  );
  const local = createExcelPreviewPlan(
    dateInput as any,
    [...actions],
    500,
    specs,
  );
  assert.equal(excelPlansMatch(local, server), true);
  assert.deepEqual(server.actions[0].spec, {
    columnName: "Month of Date",
    derived: "date-group",
    sourceColumn: "Date",
    sourceIndex: 0,
    group: "month",
  });
  assert.throws(
    () =>
      createServerExcelPreviewPlan(dateInput, [...actions], 500, {
        addColumn: {
          name: "Date Group",
          derived: "date-group",
          source: 0,
          group: "week",
        },
      } as any),
    /month, quarter or year/,
  );
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

test("server and add-in agree on a validated input-message format plan", () => {
  const specs = {
    format: {
      validation: [{ column: 1, rule: "list" as const }],
      inputMessage: {
        column: 1,
        title: "Status guidance",
        message: "Choose a valid status.",
      },
    },
  };
  const actions = ["format"] as const;
  const server = createServerExcelPreviewPlan(input, [...actions], 500, specs);
  const local = createExcelPreviewPlan(input as any, [...actions], 500, specs);
  assert.equal(excelPlansMatch(local, server), true);
  assert.deepEqual(server.actions[0].spec?.inputMessage, {
    column: "Region",
    index: 1,
    title: "Status guidance",
    message: "Choose a valid status.",
  });
});

test("server and add-in agree on a dependent dropdown plan", () => {
  const dependentInput = {
    ...input,
    values: [
      ["Region", "Status"],
      ["North", "Open"],
      ["North", "Closed"],
      ["South", "Open"],
    ],
    address: "Sheet1!A1:B4",
  };
  const specs = {
    format: { dependentDropdown: { child: 1, parent: 0 } },
  };
  const actions = ["format"] as const;
  const server = createServerExcelPreviewPlan(
    dependentInput,
    [...actions],
    500,
    specs,
  );
  const local = createExcelPreviewPlan(
    dependentInput as any,
    [...actions],
    500,
    specs,
  );
  assert.equal(excelPlansMatch(local, server), true);
  assert.equal(server.actions[0].spec?.dependentDropdown?.groups.length, 2);
  assert.equal(
    server.actions[0].spec?.dependentDropdown?.groups[0].name,
    "VynorAI_DD_North",
  );
});

test("server refuses unsafe dependent dropdown parent values", () => {
  assert.throws(
    () =>
      createServerExcelPreviewPlan(
        {
          ...input,
          values: [
            ["Parent", "Child"],
            ["North/West", "Open"],
          ],
          address: "Sheet1!A1:B2",
        },
        ["format"],
        500,
        { format: { dependentDropdown: { child: 1, parent: 0 } } },
      ),
    /parent values must use/,
  );
  assert.throws(
    () =>
      createServerExcelPreviewPlan(
        {
          ...input,
          values: [
            ["Parent", "Child"],
            ["North", "Open, Closed"],
          ],
          address: "Sheet1!A1:B2",
        },
        ["format"],
        500,
        { format: { dependentDropdown: { child: 1, parent: 0 } } },
      ),
    /child values must be/,
  );
});

test("server and add-in agree on a safe custom conditional formula", () => {
  const specs = {
    format: {
      conditional: [
        { column: 2, rule: "custom-formula", operator: ">", value: 1000 },
      ],
    },
  } as any;
  const client = createExcelPreviewPlan(input, ["format"], 500, specs);
  const server = createServerExcelPreviewPlan(input, ["format"], 500, specs);
  assert.equal(excelPlansMatch(client as any, server as any), true);
  assert.deepEqual(server.actions[0].spec?.conditional, [
    {
      column: "Sales",
      index: 2,
      rule: "custom-formula",
      operator: ">",
      value: 1000,
    },
  ]);
  assert.throws(
    () =>
      createServerExcelPreviewPlan(input, ["format"], 500, {
        format: {
          conditional: [
            { column: 2, rule: "custom-formula", operator: "|", value: 1 },
          ],
        },
      } as any),
    /safe numeric comparison/,
  );
});

test("server and add-in agree on a safe date-range conditional format", () => {
  const dateInput = {
    ...input,
    values: [
      ["Date", "Sales"],
      [46023, 100],
      [46112, 200],
    ],
  };
  const actions = ["format"] as const;
  const specs = {
    format: {
      conditional: [
        {
          column: 0,
          rule: "date-range" as const,
          startDate: "2026-01-01",
          endDate: "2026-03-31",
        },
      ],
    },
  };
  const server = createServerExcelPreviewPlan(
    dateInput,
    [...actions],
    500,
    specs,
  );
  const local = createExcelPreviewPlan(
    dateInput as any,
    [...actions],
    500,
    specs,
  );
  assert.equal(excelPlansMatch(local, server), true);
  assert.deepEqual(server.actions[0].spec?.conditional, [
    {
      column: "Date",
      index: 0,
      rule: "date-range",
      startDate: "2026-01-01",
      endDate: "2026-03-31",
    },
  ]);
  assert.throws(
    () =>
      createServerExcelPreviewPlan(dateInput, [...actions], 500, {
        format: {
          conditional: [
            {
              column: 0,
              rule: "date-range",
              startDate: "2026-03-32",
              endDate: "2026-04-01",
            },
          ],
        },
      } as any),
    /valid ISO dates/,
  );
  assert.throws(
    () =>
      createServerExcelPreviewPlan(dateInput, [...actions], 500, {
        format: {
          conditional: [
            {
              column: 0,
              rule: "date-range",
              startDate: "2026-04-01",
              endDate: "2026-01-01",
            },
          ],
        },
      } as any),
    /ascending order/,
  );
});

test("server and add-in accept grouped count summaries over text columns", () => {
  const countInput = {
    ...input,
    values: [
      ["Order ID", "Customer", "Status"],
      ["O-001", "Asha", "Open"],
      ["O-002", "Asha", "Closed"],
      ["O-003", "Bimal", "Open"],
    ],
  };
  const actions = ["summary"] as const;
  const specs = {
    summary: {
      group: 1,
      values: [{ column: 0, aggregation: "count" as const }],
    },
  };
  const server = createServerExcelPreviewPlan(
    countInput,
    [...actions],
    500,
    specs,
  );
  const local = createExcelPreviewPlan(
    countInput as any,
    [...actions],
    500,
    specs,
  );
  assert.equal(excelPlansMatch(local, server), true);
  assert.deepEqual(server.actions[0].spec?.summaryValues, [
    { column: "Order ID", index: 0, aggregation: "count" },
  ]);
  assert.throws(
    () =>
      createServerExcelPreviewPlan(countInput, [...actions], 500, {
        summary: {
          group: 1,
          values: [{ column: 0, aggregation: "average" }],
        },
      } as any),
    /must contain numbers unless the aggregation is count/,
  );
});

test("server and add-in agree on bounded top and bottom conditional formats", () => {
  for (const rule of ["top-n", "bottom-n"] as const) {
    const specs = {
      format: { conditional: [{ column: 2, rule, n: 2 }] },
    } as any;
    const client = createExcelPreviewPlan(input, ["format"], 500, specs);
    const server = createServerExcelPreviewPlan(input, ["format"], 500, specs);
    assert.equal(excelPlansMatch(client as any, server as any), true);
    assert.deepEqual(server.actions[0].spec?.conditional, [
      { column: "Sales", index: 2, rule, n: 2 },
    ]);
  }
  assert.throws(
    () =>
      createServerExcelPreviewPlan(input, ["format"], 500, {
        format: { conditional: [{ column: 2, rule: "top-n", n: 101 }] },
      } as any),
    /rank from 1 to 100/,
  );
});

test("server and add-in agree on text-contains conditional formatting", () => {
  const specs = {
    format: {
      conditional: [{ column: 1, rule: "text-contains", text: "Pending" }],
    },
  } as any;
  const client = createExcelPreviewPlan(
    {
      ...input,
      values: [
        ["Status", "Region"],
        ["Pending", "North"],
        ["Done", "South"],
      ],
    },
    ["format"],
    500,
    specs,
  );
  const server = createServerExcelPreviewPlan(
    {
      ...input,
      values: [
        ["Status", "Region"],
        ["Pending", "North"],
        ["Done", "South"],
      ],
    },
    ["format"],
    500,
    specs,
  );
  assert.equal(excelPlansMatch(client as any, server as any), true);
  assert.deepEqual(server.actions[0].spec?.conditional, [
    { column: "Region", index: 1, rule: "text-contains", text: "Pending" },
  ]);
  assert.throws(
    () =>
      createServerExcelPreviewPlan(input, ["format"], 500, {
        format: {
          conditional: [
            { column: 1, rule: "text-contains", text: "line\nfeed" },
          ],
        },
      } as any),
    /1 to 80 visible characters/,
  );
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

test("server and add-in agree on a target-column blank fill and reject bad targets", () => {
  const targetInput = {
    ...input,
    values: [
      ["Customer", "Status", "Sales"],
      ["Asha", null, 10],
      ["Bimal", "Open", 20],
    ],
    address: "Sheet1!A1:C3",
  };
  const specs = {
    clean: {
      operations: ["fill-blanks"],
      fillBlanks: "Unknown",
      fillBlanksColumn: 1,
    },
  };
  const actions = ["clean"] as const;
  const server = createServerExcelPreviewPlan(
    targetInput,
    [...actions],
    500,
    specs,
  );
  const client = createExcelPreviewPlan(
    targetInput as any,
    [...actions],
    500,
    specs,
  );
  assert.equal(excelPlansMatch(client as any, server as any), true);
  assert.deepEqual(server.actions[0].spec, {
    operations: ["fill-blanks"],
    fillBlanks: "Unknown",
    fillBlanksColumn: "Status",
    fillBlanksColumnIndex: 1,
  });
  assert.throws(
    () =>
      createServerExcelPreviewPlan(targetInput, [...actions], 500, {
        clean: {
          operations: ["fill-blanks"],
          fillBlanks: "Unknown",
          fillBlanksColumn: 9,
        },
      }),
    /valid column for filling blanks/,
  );
});

test("server and add-in agree on a formula quality audit and reject bad modes", () => {
  const specs = { quality: { mode: "formula" as const } };
  const actions = ["quality"] as const;
  const server = createServerExcelPreviewPlan(input, [...actions], 500, specs);
  const client = createExcelPreviewPlan(input as any, [...actions], 500, specs);
  assert.equal(excelPlansMatch(client as any, server as any), true);
  assert.deepEqual(server.actions[0].spec, { qualityMode: "formula" });
  assert.throws(
    () =>
      createServerExcelPreviewPlan(input, [...actions], 500, {
        quality: { mode: "unsupported" },
      } as any),
    /valid quality report mode/,
  );
  assert.throws(
    () =>
      createServerExcelPreviewPlan(input, ["clean"], 500, {
        quality: { mode: "formula" },
      } as any),
    /Quality options need the quality action/,
  );
});

test("server and add-in agree on a safe formula repair copy mode", () => {
  const specs = { quality: { mode: "repair" as const } };
  const actions = ["quality"] as const;
  const server = createServerExcelPreviewPlan(input, [...actions], 500, specs);
  const client = createExcelPreviewPlan(input as any, [...actions], 500, specs);
  assert.equal(excelPlansMatch(client as any, server as any), true);
  assert.deepEqual(server.actions[0].spec, { qualityMode: "repair" });
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

test("server and add-in agree on a combo chart plan", () => {
  const specs = {
    chart: {
      category: 1,
      value: 2,
      chartType: "combo" as const,
      extraValues: [3],
    },
  };
  const actions = ["chart"] as const;
  const local = createExcelPreviewPlan(input as any, [...actions], 500, specs);
  const server = createServerExcelPreviewPlan(input, [...actions], 500, specs);
  assert.equal(excelPlansMatch(local, server), true);
  assert.equal(server.actions[0].spec?.chartType, "combo");
  assert.deepEqual(server.actions[0].spec?.extraValueIndexes, [3]);
});

test("server and add-in agree on a histogram plan", () => {
  const specs = {
    chart: {
      category: 2,
      value: 2,
      chartType: "histogram" as const,
    },
  };
  const actions = ["chart"] as const;
  const local = createExcelPreviewPlan(input as any, [...actions], 500, specs);
  const server = createServerExcelPreviewPlan(input, [...actions], 500, specs);
  assert.equal(excelPlansMatch(local, server), true);
  assert.equal(server.actions[0].spec?.chartType, "histogram");
  assert.equal(server.actions[0].spec?.valueColumn, "Sales");
});

test("server and add-in agree on a waterfall plan", () => {
  const specs = {
    chart: {
      category: 1,
      value: 2,
      chartType: "waterfall" as const,
    },
  };
  const actions = ["chart"] as const;
  const local = createExcelPreviewPlan(input as any, [...actions], 500, specs);
  const server = createServerExcelPreviewPlan(input, [...actions], 500, specs);
  assert.equal(excelPlansMatch(local, server), true);
  assert.equal(server.actions[0].spec?.chartType, "waterfall");
  assert.equal(server.actions[0].spec?.categoryColumn, "Region");
});

test("server and add-in agree on a named-range plan", () => {
  const specs = { namedRange: { source: 2 } };
  const actions = ["named-range"] as const;
  const local = createExcelPreviewPlan(input as any, [...actions], 500, specs);
  const server = createServerExcelPreviewPlan(input, [...actions], 500, specs);
  assert.equal(excelPlansMatch(local, server), true);
  assert.equal(server.actions[0].kind, "named-range");
  assert.equal(server.actions[0].spec?.namedRangeName, "VynorAI_Sales_3");
});

test("server and add-in agree on a slicer plan", () => {
  const specs = { slicer: { source: 1 } };
  const actions = ["slicer"] as const;
  const local = createExcelPreviewPlan(input as any, [...actions], 500, specs);
  const server = createServerExcelPreviewPlan(input, [...actions], 500, specs);
  assert.equal(excelPlansMatch(local, server), true);
  assert.equal(server.actions[0].kind, "slicer");
  assert.equal(server.actions[0].targetSheet, "Sheet1_Vynor_Slicer");
  assert.equal(server.actions[0].spec?.slicerName, "VynorAI_Region_slicer");
});

test("server refuses a slicer column outside the selected range", () => {
  assert.throws(
    () =>
      createServerExcelPreviewPlan(input, ["slicer"], 500, {
        slicer: { source: 99 },
      }),
    /valid column for the slicer/,
  );
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
    "export-csv",
    "export-pdf",
  ])
    assert.ok(schema.includes(`"${kind}"`), `apply-result misses ${kind}`);
  assert.match(
    schema,
    /results:[\s\S]*?\.max\(10\)/,
    "apply-result must accept every result from a ten-action plan",
  );
});

test("server and add-in agree on the source-preserving CSV export plan", () => {
  const server = createServerExcelPreviewPlan(input, ["export-csv"], 500);
  const local = createExcelPreviewPlan(input as any, ["export-csv"], 500);
  assert.equal(excelPlansMatch(local, server), true);
  assert.equal(server.actions[0].targetSheet, "Sheet1_Vynor_CSV");
  assert.equal(server.actions[0].preservesSource, true);
});

test("server and add-in agree on the source-preserving PDF export plan", () => {
  const server = createServerExcelPreviewPlan(input, ["export-pdf"], 500);
  const local = createExcelPreviewPlan(input as any, ["export-pdf"], 500);
  assert.equal(excelPlansMatch(local, server), true);
  assert.equal(server.actions[0].targetSheet, "Sheet1_Vynor_PDF");
  assert.equal(server.actions[0].preservesSource, true);
});

test("server and add-in reuse one dashboard sheet for dashboard PDF export", () => {
  const specs = { dashboard: { category: 1, values: [2] } };
  const server = createServerExcelPreviewPlan(
    input,
    ["dashboard", "export-pdf"],
    500,
    specs,
  );
  const local = createExcelPreviewPlan(
    input as any,
    ["dashboard", "export-pdf"],
    500,
    specs,
  );
  assert.equal(excelPlansMatch(local, server), true);
  assert.equal(server.actions[0].targetSheet, server.actions[1].targetSheet);
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

test("server and add-in agree on a sampled very large range and refuse other results", () => {
  const input = {
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
  const server = createServerExcelPreviewPlan(input, ["pivot-table"], 500);
  const local = createExcelPreviewPlan(input as any, ["pivot-table"], 500);
  assert.equal(server.profile.rowCount, 600000);
  assert.deepEqual(server.profile.sample, input.sample);
  assert.equal(excelPlansMatch(local, server), true);
  for (const kind of ["chart", "summary", "unpivot"])
    assert.throws(
      () => createServerExcelPreviewPlan(input, [kind], 500),
      /too large to read in full/,
    );
});

test("server and add-in agree on a PivotTable top N and the server refuses a bad one", () => {
  const input = {
    workbookId: "w",
    worksheetName: "Sales",
    address: "A1:C4",
    hasHeaders: true,
    values: [
      ["Item", "Qty", "Region"],
      ["a", 1, "N"],
      ["b", 2, "S"],
      ["c", 3, "N"],
    ],
  };
  const specs = { pivot: { rows: 2, values: 1, topN: 2 } } as any;
  const server = createServerExcelPreviewPlan(
    input,
    ["pivot-table"],
    500,
    specs,
  );
  const local = createExcelPreviewPlan(
    input as any,
    ["pivot-table"],
    500,
    specs,
  );
  assert.equal(server.actions[0].spec.topN, 2);
  assert.equal(excelPlansMatch(local, server), true);
  assert.throws(
    () =>
      createServerExcelPreviewPlan(input, ["pivot-table"], 500, {
        pivot: { rows: 2, values: 1, topN: 101 },
      } as any),
    /top N must be between 1 and 100/,
  );
});

test("server and add-in agree on a sampled chart over a PivotTable and on describe statistics", () => {
  const input = {
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
  const chartSpecs = {
    pivot: { rows: 0, values: 1, aggregation: "sum" },
    chart: { category: 0, value: 1, chartType: "column", pivotResult: true },
  } as any;
  const kinds = ["pivot-table", "chart"];
  const server = createServerExcelPreviewPlan(input, kinds, 500, chartSpecs);
  const local = createExcelPreviewPlan(
    input as any,
    kinds as any,
    500,
    chartSpecs,
  );
  assert.equal(excelPlansMatch(local, server), true);
  const statSpecs = { statistics: { mode: "describe", columns: [1] } } as any;
  const serverStats = createServerExcelPreviewPlan(
    input,
    ["statistics"],
    500,
    statSpecs,
  );
  const localStats = createExcelPreviewPlan(
    input as any,
    ["statistics"],
    500,
    statSpecs,
  );
  assert.equal(excelPlansMatch(localStats, serverStats), true);
  assert.throws(
    () =>
      createServerExcelPreviewPlan(input, ["chart"], 500, {
        chart: { category: 0, value: 1, chartType: "column" },
      } as any),
    /too large to read in full/,
  );
});

test("server and add-in agree on a sampled clean-up and format, including their row-limit warnings", () => {
  const input = {
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
  for (const [kind, specs] of [
    ["clean", { clean: { operations: ["trim", "dedupe"] } }],
    ["format", { format: { freezeHeader: true } }],
  ] as const) {
    const server = createServerExcelPreviewPlan(
      input,
      [kind],
      500,
      specs as any,
    );
    const local = createExcelPreviewPlan(
      input as any,
      [kind] as any,
      500,
      specs as any,
    );
    assert.equal(excelPlansMatch(local, server), true, kind);
    assert.ok(
      server.warnings.some((w: string) => /first (100,000|5,000) rows/.test(w)),
    );
  }
});
