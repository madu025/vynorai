import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AgentToolError,
  PersonalMask,
  describeChange,
  stageChange,
} from "./agent.js";
import { ACTION_TOOLS, needsSheetBackup } from "./agentActions.js";

const stage = (name: string, args: Record<string, unknown>) =>
  stageChange(name, args, String) as any;

test("every workbook-object tool checks its arguments and describes the change", () => {
  const cases: [string, Record<string, unknown>, RegExp][] = [
    [
      "edit_rows_columns",
      { action: "insert_columns", sheet: "Data", address: "C:C" },
      /insert columns 'Data'!C:C/,
    ],
    [
      "edit_rows_columns",
      { action: "column_width", sheet: "Data", address: "A:B", value: 20 },
      /to 20/,
    ],
    [
      "edit_rows_columns",
      {
        action: "remove_duplicates",
        sheet: "Data",
        address: "A1:J9",
        columns: ["Service ID"],
      },
      /match on Service ID/,
    ],
    [
      "delete_rows_where",
      {
        sheet: "Data",
        address: "A1:J9",
        conditions: [{ column: "Status", operator: "=", value: "X" }],
      },
      /Delete the rows .* where Status = X/,
    ],
    [
      "filter_range",
      {
        sheet: "Data",
        address: "A1:J9",
        kind: "values",
        column: "RTOM",
        values: ["R-HK"],
      },
      /Filter .* on RTOM/,
    ],
    [
      "filter_range",
      { sheet: "Data", address: "A1:J9", kind: "clear" },
      /Clear the filter/,
    ],
    [
      "sheet_action",
      { action: "freeze_rows", sheet: "Data", value: 1 },
      /freeze rows sheet "Data" \(1\)/,
    ],
    ["sheet_action", { action: "delete", sheet: "Old" }, /hidden copy is kept/],
    [
      "sheet_action",
      { action: "delete", sheet: "Old", permanent: true },
      /PERMANENTLY/,
    ],
    [
      "conditional_format",
      { sheet: "Data", address: "H2:H9", rule: "greater_than", value: 100 },
      /greater than 100, fill #FFC7CE/,
    ],
    [
      "conditional_format",
      {
        sheet: "Data",
        address: "A2:J9",
        rule: "formula",
        formula: "=$H2>100",
        fill: "#FFF2CC",
      },
      /formula =\$H2>100/,
    ],
    [
      "data_validation",
      {
        sheet: "Data",
        address: "E2:E9",
        rule: "list",
        values: ["S", "E", "X"],
      },
      /list S, E, X/,
    ],
    [
      "data_validation",
      {
        sheet: "Data",
        address: "H2:H9",
        rule: "whole_number",
        min: 0,
        max: 1000,
      },
      /between 0 and 1000/,
    ],
    [
      "table_action",
      { action: "create", sheet: "Data", address: "A1:J9", name: "Lines" },
      /Excel Table "Lines"/,
    ],
    [
      "named_range",
      { action: "add", name: "TaxRate", refers_to: "=0.15" },
      /TaxRate = =0.15/,
    ],
    [
      "pivot_action",
      {
        action: "show_as",
        pivot: "PivotTable1",
        field: "Sum of Qty",
        value: "percent_of_row_total",
      },
      /percent of row total/,
    ],
    [
      "chart_action",
      { action: "legend", sheet: "Out", chart: "Chart 1", value: "bottom" },
      /legend bottom/,
    ],
    [
      "comment",
      { action: "add", sheet: "Data", cell: "H2", text: "Check this" },
      /comment to 'Data'!H2/,
    ],
    [
      "page_setup",
      { sheet: "Data", orientation: "landscape", fit_width: 1 },
      /orientation landscape/,
    ],
    ["workbook_action", { action: "recalculate" }, /recalculate/],
    [
      "protect_sheet",
      { action: "lock_cells", sheet: "Data", address: "K2:K9" },
      /no password/,
    ],
    [
      "find_replace",
      { sheet: "Data", find: "km", replace: "Km" },
      /Replace "km" with "Km"/,
    ],
    [
      "goal_seek",
      { sheet: "Model", formula_cell: "B5", changing_cell: "B1", target: 0 },
      /until B5 = 0/,
    ],
  ];
  for (const [tool, args, pattern] of cases) {
    const change = stage(tool, args);
    assert.equal(change.kind, "excel_action", tool);
    assert.match(describeChange(change), pattern, tool);
  }
  assert.equal(Object.keys(ACTION_TOOLS).length, 17);
});

test("bad arguments come back as messages the model can act on", () => {
  const bad: [string, Record<string, unknown>][] = [
    ["edit_rows_columns", { action: "explode", sheet: "Data", address: "A1" }],
    ["delete_rows_where", { sheet: "Data", address: "A1:J9", conditions: [] }],
    [
      "delete_rows_where",
      {
        sheet: "Data",
        address: "A1:J9",
        conditions: [{ column: "Qty", operator: ">" }],
      },
    ],
    [
      "filter_range",
      { sheet: "Data", address: "A1:J9", kind: "values", column: "RTOM" },
    ],
    [
      "conditional_format",
      {
        sheet: "Data",
        address: "A1",
        rule: "formula",
        formula: '=WEBSERVICE("x")',
      },
    ],
    ["data_validation", { sheet: "Data", address: "A1", rule: "list" }],
    ["named_range", { action: "add", name: "A1", refers_to: "=1" }],
    ["table_action", { action: "style", table: "T", value: "Pretty" }],
    [
      "chart_action",
      { action: "chart_type", sheet: "S", chart: "C", value: "3d_mess" },
    ],
    ["sheet_action", { action: "tab_color", sheet: "S", value: "red" }],
    ["goal_seek", { sheet: "S", formula_cell: "B5", changing_cell: "B1" }],
  ];
  for (const [tool, args] of bad)
    assert.throws(() => stage(tool, args), AgentToolError, tool);
});

test("personal data in action arguments is restored before Excel sees it", () => {
  const mask = new PersonalMask();
  const token = mask.mask("0112005016");
  const change: any = stageChange(
    "delete_rows_where",
    {
      sheet: "Data",
      address: "A1:J9",
      conditions: [{ column: "Circuit ID", operator: "=", value: token }],
    },
    (text) => mask.unmask(text),
  );
  assert.equal(change.args.conditions[0].value, "0112005016");
});

test("changes to cell data take a sheet backup; reversible view changes do not", () => {
  assert.equal(needsSheetBackup("delete_rows_where", {}), true);
  assert.equal(
    needsSheetBackup("edit_rows_columns", { action: "delete_columns" }),
    true,
  );
  assert.equal(
    needsSheetBackup("edit_rows_columns", { action: "hide_rows" }),
    false,
  );
  assert.equal(needsSheetBackup("conditional_format", { rule: "clear" }), true);
  assert.equal(needsSheetBackup("conditional_format", { rule: "top" }), false);
});

test("format_range takes the extra options and sort_range several keys", () => {
  const format = stage("format_range", {
    sheet: "Data",
    address: "A1:J1",
    font_size: 14,
    borders: "all",
    horizontal: "center",
    merge_center: true,
  });
  assert.match(
    describeChange(format),
    /size 14, borders all, align center, merge and centre/,
  );
  assert.throws(
    () =>
      stage("format_range", { sheet: "Data", address: "A1", borders: "thick" }),
    AgentToolError,
  );
  const sort = stage("sort_range", {
    sheet: "Data",
    address: "A1:J9",
    column: "RTOM",
    then: [{ column: "Issued Quantity", descending: true }],
    custom_order: "R-HK,R-GP",
  });
  assert.deepEqual(sort.then, [
    { column: "Issued Quantity", descending: true },
  ]);
  assert.equal(sort.customOrder, "R-HK,R-GP");
  const chart = stage("create_chart", {
    sheet: "Out",
    chart_type: "waterfall",
    position: "E2:L20",
  });
  assert.equal(chart.position, "E2:L20");
});

test("delete_rows_where builds one whole-column test: text compare for = and !=, numbers for > <", async () => {
  const { rowTestFormula } = await import("./officeAgentActions.js");
  const names = [
    "service id",
    "rtom",
    "status",
    "issued quantity",
    "circuit id",
  ];
  assert.equal(
    rowTestFormula(
      names,
      [
        { column: "Status", operator: "=", value: "X" },
        { column: "Issued Quantity", operator: ">", value: 5 },
      ],
      "all",
      0,
      2,
      520126,
    ),
    '(($C$2:$C$520126&"")="X")*(($D$2:$D$520126>5))',
  );
  // An ID with leading zeros matches as text; "any" joins the tests with OR.
  assert.equal(
    rowTestFormula(
      names,
      [
        { column: "Circuit ID", operator: "=", value: "0112005016" },
        { column: "RTOM", operator: "blank" },
      ],
      "any",
      1,
      3,
      10,
    ),
    '((($F$3:$F$10&"")="0112005016")+(($C$3:$C$10&"")="")>0)',
  );
  assert.throws(() =>
    rowTestFormula(
      names,
      [{ column: "Colour", operator: "=", value: "red" }],
      "all",
      0,
      2,
      9,
    ),
  );
  assert.throws(() =>
    rowTestFormula(
      names,
      [{ column: "Status", operator: ">", value: "abc" }],
      "all",
      0,
      2,
      9,
    ),
  );
});

test("format painter, left-to-right sort, rule replace and stop-if-true are staged", () => {
  const painter = stage("format_range", {
    sheet: "Data",
    address: "A2:J2",
    copy_from: "A1:J1",
  });
  assert.match(describeChange(painter), /formats copied from A1:J1/);
  assert.equal(
    stage("sort_range", {
      sheet: "Data",
      address: "A1:J9",
      column: "x",
      by_columns: true,
    }).byColumns,
    true,
  );
  const rule = stage("conditional_format", {
    sheet: "Data",
    address: "H2:H9",
    rule: "top",
    value: 5,
    replace: true,
    stop_if_true: true,
  });
  assert.equal(rule.args.replace, true);
  assert.equal(rule.args.stop_if_true, true);
});

test("clean_in_place keeps formulas and leading-zero IDs, and parses d/m/y dates", async () => {
  const { cleanValue } = await import("./officeAgentActions.js");
  assert.equal(cleanValue("  Ea   km ", "trim"), "Ea km");
  assert.equal(cleanValue("a\u00a0b\u0007", "clean"), "a b");
  assert.equal(cleanValue("=TRIM(A1)", "trim"), "=TRIM(A1)");
  assert.equal(cleanValue("1,250", "to_number"), 1250);
  assert.equal(cleanValue("0112005016", "to_number"), "0112005016");
  assert.equal(cleanValue(42, "to_number"), 42);
  assert.equal(cleanValue("2025-03-01", "to_date"), 45717);
  assert.equal(cleanValue("01/03/2025", "to_date"), 45717);
  assert.equal(cleanValue("31/02/2025", "to_date"), "31/02/2025");
  assert.equal(cleanValue("hello WORLD", "proper"), "Hello World");
  const change = stage("clean_in_place", {
    sheet: "Data",
    address: "I2:I520126",
    op: "trim",
  });
  assert.match(
    describeChange(change),
    /Clean 'Data'!I2:I520126 in place: trim/,
  );
  assert.equal(needsSheetBackup("clean_in_place", {}), true);
});

test("batch-test fixes: a name without = works, Table filters use the same criteria builder", async () => {
  const withoutEquals = stage("named_range", {
    action: "add",
    name: "BatchTest",
    refers_to: "'Test copy'!$A$1:$J$10",
  });
  assert.equal(withoutEquals.args.refers_to, "='Test copy'!$A$1:$J$10");
  const withEquals = stage("named_range", {
    action: "add",
    name: "TaxRate",
    refers_to: "=0.15",
  });
  assert.equal(withEquals.args.refers_to, "=0.15");
  assert.throws(
    () =>
      stage("named_range", {
        action: "add",
        name: "Bad",
        refers_to: 'WEBSERVICE("x")',
      }),
    AgentToolError,
  );
  const { filterCriteria } = await import("./officeAgentActions.js");
  assert.deepEqual(filterCriteria({ kind: "values", values: ["R-KO"] }), {
    filterOn: "Values",
    values: ["R-KO"],
  });
  assert.deepEqual(
    filterCriteria({
      kind: "custom",
      criterion1: ">5",
      criterion2: "<9",
      operator: "and",
    }),
    {
      filterOn: "Custom",
      criterion1: ">5",
      criterion2: "<9",
      operator: "And",
    },
  );
  assert.deepEqual(filterCriteria({ kind: "top", count: 10 }), {
    filterOn: "TopItems",
    criterion1: "10",
  });
  assert.deepEqual(filterCriteria({ kind: "dynamic", dynamic: "this_month" }), {
    filterOn: "Dynamic",
    dynamicCriteria: "ThisMonth",
  });
});

test("delete_rows_where uses a filter pass per OR condition and one pass for AND", async () => {
  const { conditionCriteria, deletePasses } = await import(
    "./officeAgentActions.js"
  );
  assert.deepEqual(conditionCriteria({ operator: "=", value: "m" }), {
    criterion1: "=m",
  });
  assert.deepEqual(conditionCriteria({ operator: "!=", value: "S" }), {
    criterion1: "<>S",
  });
  assert.deepEqual(conditionCriteria({ operator: ">", value: 100 }), {
    criterion1: ">100",
  });
  assert.deepEqual(conditionCriteria({ operator: "contains", value: "km" }), {
    criterion1: "=*km*",
  });
  assert.deepEqual(conditionCriteria({ operator: "blank" }), {
    criterion1: "=",
  });
  assert.deepEqual(conditionCriteria({ operator: "not_blank" }), {
    criterion1: "<>",
  });
  const a = { column: "UoM", operator: "=", value: "m" };
  const b = { column: "Status", operator: "=", value: "X" };
  assert.deepEqual(deletePasses([a, b], "any"), [[a], [b]]);
  assert.deepEqual(deletePasses([a, b], "all"), [[a, b]]);
  // Three conditions on one column cannot be one filter: the formula route takes over.
  const c = (v: number) => ({ column: "Qty", operator: ">", value: v });
  assert.equal(deletePasses([c(1), c(2), c(3)], "all"), undefined);
  assert.deepEqual(deletePasses([c(1), c(2)], "all"), [[c(1), c(2)]]);
});
