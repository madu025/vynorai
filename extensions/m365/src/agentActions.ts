/**
 * The agent's workbook-object tools (rows and columns, sheets, AutoFilter, conditional formats,
 * validation, Tables, names, PivotTables, charts, comments, page setup, protection, find and
 * replace, goal seek). Each tool here only CHECKS and DESCRIBES its arguments; the change is staged
 * like every other write and runs in `officeAgentActions.ts` after the person approves.
 * The tool list the model sees is in `backend/src/services/m365Agent.ts`.
 */
import {
  AgentToolError,
  checkCell,
  checkFormula,
  checkRange,
  checkSheetName,
} from "./agent.js";
import { COMBINE_MODES } from "./combineSheets.js";
import {
  FINANCIAL_KINDS,
  type FinancialSpec,
  financialCells,
  qualifiedRange,
} from "./financialBuilders.js";
import { type Scenario, type WhatIfArgs, checkWhatIf } from "./whatIf.js";

export type ActionArgs = Record<string, unknown>;
interface ActionDef {
  /** Checks and normalises the arguments; throws AgentToolError with a message for the model. */
  check(args: ActionArgs, restore: (text: string) => string): ActionArgs;
  describe(args: ActionArgs): string;
}

const HEX = /^#[0-9A-F]{6}$/i;
const NAME = /^[A-Za-z_\\][A-Za-z0-9_.]{0,254}$/;

const oneOf = <T extends string>(
  value: unknown,
  allowed: readonly T[],
  what: string,
): T => {
  const text = String(value ?? "")
    .trim()
    .toLowerCase() as T;
  if (!allowed.includes(text))
    throw new AgentToolError(`${what} must be one of: ${allowed.join(", ")}.`);
  return text;
};
const optionalNumber = (
  value: unknown,
  what: string,
  min: number,
  max: number,
) => {
  if (value === undefined || value === null || value === "") return undefined;
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max)
    throw new AgentToolError(`${what} must be a number from ${min} to ${max}.`);
  return number;
};
const colour = (value: unknown, what: string) => {
  if (value === undefined || value === null || value === "") return undefined;
  if (!HEX.test(String(value)))
    throw new AgentToolError(`${what} must be a colour like #FFF2CC.`);
  return String(value);
};
const shortText = (value: unknown, max: number) =>
  value === undefined || value === null
    ? undefined
    : String(value).slice(0, max);
const clean = (args: ActionArgs): ActionArgs =>
  Object.fromEntries(
    Object.entries(args).filter(([, value]) => value !== undefined),
  );
const at = (args: ActionArgs) =>
  `'${args.sheet}'!${args.address ?? args.cell ?? ""}`;
const plainValue = (value: unknown, restore: (text: string) => string) =>
  typeof value === "number" || typeof value === "boolean"
    ? value
    : restore(String(value ?? "")).slice(0, 255);

export const ROW_COLUMN_ACTIONS = [
  "insert_rows",
  "delete_rows",
  "insert_columns",
  "delete_columns",
  "hide_rows",
  "unhide_rows",
  "hide_columns",
  "unhide_columns",
  "group_rows",
  "ungroup_rows",
  "group_columns",
  "ungroup_columns",
  "column_width",
  "row_height",
  "clear_contents",
  "clear_formats",
  "merge",
  "unmerge",
  "fill_down",
  "fill_right",
  "move",
  "paste_values",
  "transpose",
  "remove_duplicates",
] as const;
export const SHEET_ACTIONS = [
  "rename",
  "hide",
  "unhide",
  "move",
  "copy",
  "delete",
  "tab_color",
  "freeze_rows",
  "freeze_columns",
  "freeze_at",
  "unfreeze",
  "activate",
  "gridlines_on",
  "gridlines_off",
] as const;
export const ROW_OPERATORS = [
  "=",
  "!=",
  ">",
  "<",
  ">=",
  "<=",
  "contains",
  "not_contains",
  "blank",
  "not_blank",
] as const;
export const FILTER_KINDS = [
  "values",
  "custom",
  "top",
  "bottom",
  "top_percent",
  "bottom_percent",
  "dynamic",
  "cell_color",
  "clear",
  "remove",
] as const;
export const DYNAMIC_FILTERS = [
  "today",
  "yesterday",
  "tomorrow",
  "this_week",
  "last_week",
  "next_week",
  "this_month",
  "last_month",
  "next_month",
  "this_quarter",
  "last_quarter",
  "this_year",
  "last_year",
  "year_to_date",
  "above_average",
  "below_average",
] as const;
export const CF_RULES = [
  "color_scale",
  "data_bar",
  "icon_set",
  "greater_than",
  "less_than",
  "between",
  "equal_to",
  "not_equal_to",
  "text_contains",
  "text_not_contains",
  "duplicates",
  "unique",
  "top",
  "bottom",
  "above_average",
  "below_average",
  "blanks",
  "errors",
  "formula",
  "clear",
] as const;
export const VALIDATION_RULES = [
  "list",
  "whole_number",
  "decimal",
  "date",
  "text_length",
  "custom",
  "clear",
  "copy_from",
] as const;
export const VALIDATION_OPERATORS = [
  "between",
  "not_between",
  "equal_to",
  "not_equal_to",
  "greater_than",
  "less_than",
  "greater_or_equal",
  "less_or_equal",
] as const;
export const TABLE_ACTIONS = [
  "create",
  "rename",
  "style",
  "total_row_on",
  "total_row_off",
  "resize",
  "add_column",
  "convert_to_range",
  "sort",
  "filter",
  "clear_filter",
] as const;
export const NAME_ACTIONS = ["add", "delete", "rename"] as const;
export const PIVOT_ACTIONS = [
  "add_row",
  "add_column",
  "add_value",
  "add_filter",
  "remove_field",
  "summarize_by",
  "show_as",
  "number_format",
  "layout",
  "subtotals_on",
  "subtotals_off",
  "grand_totals_on",
  "grand_totals_off",
  "refresh",
  "sort_labels",
  "sort_values",
] as const;
export const PIVOT_FUNCTIONS = [
  "sum",
  "count",
  "average",
  "max",
  "min",
  "product",
  "countnumbers",
  "standarddeviation",
  "variance",
] as const;
export const PIVOT_SHOW_AS = [
  "none",
  "percent_of_grand_total",
  "percent_of_row_total",
  "percent_of_column_total",
  "running_total",
  "rank_ascending",
  "rank_descending",
  "difference_from",
  "percent_of_parent_row_total",
] as const;
export const CHART_ACTIONS = [
  "title",
  "axis_titles",
  "data_labels_on",
  "data_labels_off",
  "legend",
  "series_color",
  "chart_type",
  "position",
  "trendline",
  "secondary_axis",
  "series_type",
  "delete",
] as const;
export const COMMENT_ACTIONS = [
  "add",
  "reply",
  "resolve",
  "reopen",
  "note",
] as const;
export const CLEAN_OPS = [
  "trim",
  "clean",
  "upper",
  "lower",
  "proper",
  "to_number",
  "to_date",
] as const;
export const PROTECT_ACTIONS = [
  "protect",
  "unprotect",
  "lock_cells",
  "unlock_cells",
] as const;

function conditionList(raw: unknown, restore: (text: string) => string) {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 6)
    throw new AgentToolError(
      "conditions must be 1 to 6 items of {column, operator, value}.",
    );
  return raw.map((item: any) => {
    const column = String(item?.column ?? "").trim();
    if (!column)
      throw new AgentToolError(
        "Each condition needs the header name in column.",
      );
    const operator = oneOf(item?.operator ?? "=", ROW_OPERATORS, "operator");
    const needsValue = operator !== "blank" && operator !== "not_blank";
    if (needsValue && (item?.value === undefined || item?.value === null))
      throw new AgentToolError(`The condition on ${column} needs a value.`);
    return clean({
      column: restore(column),
      operator,
      value: needsValue ? plainValue(item.value, restore) : undefined,
    });
  });
}

export const ACTION_TOOLS: Record<string, ActionDef> = {
  edit_rows_columns: {
    check(args, restore) {
      const action = oneOf(args.action, ROW_COLUMN_ACTIONS, "action");
      const out: ActionArgs = {
        action,
        sheet: checkSheetName(restore(String(args.sheet ?? ""))),
        address: checkRange(args.address),
      };
      if (action === "column_width")
        out.value = optionalNumber(args.value, "value (points)", 0, 1000) ?? 64;
      if (action === "row_height")
        out.value = optionalNumber(args.value, "value (points)", 0, 409) ?? 15;
      if (action === "move" || action === "transpose") {
        out.to = checkCell(args.to);
      }
      if (action === "remove_duplicates") {
        if (!Array.isArray(args.columns) || !args.columns.length)
          throw new AgentToolError(
            "remove_duplicates needs columns: the header names that must match.",
          );
        out.columns = args.columns
          .map((column) => restore(String(column)).trim())
          .slice(0, 30);
      }
      return clean(out);
    },
    describe: (args) =>
      `${String(args.action).replace(/_/g, " ")} ${at(args)}${args.value !== undefined ? ` to ${args.value}` : ""}${args.to ? ` to ${args.to}` : ""}${args.columns ? ` (match on ${(args.columns as string[]).join(", ")})` : ""} (undo restores it)`,
  },
  delete_rows_where: {
    check(args, restore) {
      return {
        sheet: checkSheetName(restore(String(args.sheet ?? ""))),
        address: checkRange(args.address),
        conditions: conditionList(args.conditions, restore),
        match: oneOf(args.match ?? "all", ["all", "any"] as const, "match"),
      };
    },
    describe: (args) =>
      `Delete the rows of ${at(args)} where ${(args.conditions as any[])
        .map(
          (c) =>
            `${c.column} ${c.operator}${c.value !== undefined ? ` ${c.value}` : ""}`,
        )
        .join(
          args.match === "any" ? " or " : " and ",
        )} (edits the data; undo restores it)`,
  },
  filter_range: {
    check(args, restore) {
      const kind = oneOf(args.kind ?? "values", FILTER_KINDS, "kind");
      const out: ActionArgs = {
        sheet: checkSheetName(restore(String(args.sheet ?? ""))),
        address: checkRange(args.address),
        kind,
      };
      if (kind === "clear" || kind === "remove") return out;
      const column = String(args.column ?? "").trim();
      if (!column)
        throw new AgentToolError("Name the header to filter on in column.");
      out.column = restore(column);
      if (kind === "values") {
        if (!Array.isArray(args.values) || !args.values.length)
          throw new AgentToolError(
            "values filter needs values: the values to show.",
          );
        out.values = args.values
          .slice(0, 200)
          .map((value) => restore(String(value)));
      } else if (kind === "custom") {
        const criterion = String(args.criterion1 ?? "").trim();
        if (
          !/^(?:=|<>|>=|<=|>|<)?[^\u0000-\u001f]{0,100}$/.test(criterion) ||
          !criterion
        )
          throw new AgentToolError(
            'custom needs criterion1 like ">100" or "=*km*".',
          );
        out.criterion1 = restore(criterion);
        if (args.criterion2) {
          out.criterion2 = restore(String(args.criterion2));
          out.operator = oneOf(
            args.operator ?? "and",
            ["and", "or"] as const,
            "operator",
          );
        }
      } else if (kind === "dynamic") {
        out.dynamic = oneOf(args.dynamic, DYNAMIC_FILTERS, "dynamic");
      } else if (kind === "cell_color") {
        out.color = colour(args.color, "color");
        if (!out.color) throw new AgentToolError("cell_color needs color.");
      } else {
        out.count = optionalNumber(args.count, "count", 1, 1000) ?? 10;
      }
      return clean(out);
    },
    describe: (args) =>
      args.kind === "clear"
        ? `Clear the filter on ${at(args)}`
        : args.kind === "remove"
          ? `Remove the filter buttons from ${at(args)}`
          : `Filter ${at(args)} on ${args.column}: ${String(args.kind).replace(/_/g, " ")} ${args.values ? (args.values as string[]).join(", ") : (args.criterion1 ?? args.dynamic ?? args.color ?? args.count ?? "")}${args.criterion2 ? ` ${args.operator} ${args.criterion2}` : ""} (rows are hidden, not deleted)`,
  },
  sheet_action: {
    check(args, restore) {
      const action = oneOf(args.action, SHEET_ACTIONS, "action");
      const out: ActionArgs = {
        action,
        sheet: checkSheetName(restore(String(args.sheet ?? ""))),
      };
      if (action === "rename" || action === "copy")
        out.value = checkSheetName(restore(String(args.value ?? "")));
      if (action === "move")
        out.value =
          optionalNumber(args.value, "value (position, 0 is first)", 0, 500) ??
          0;
      if (action === "tab_color") out.value = colour(args.value, "value");
      if (action === "delete" && args.permanent === true) out.permanent = true;
      if (action === "freeze_rows" || action === "freeze_columns")
        out.value = optionalNumber(args.value, "value (how many)", 1, 100) ?? 1;
      if (action === "freeze_at") out.value = checkRange(args.value);
      return clean(out);
    },
    describe: (args) =>
      `${String(args.action).replace(/_/g, " ")} sheet "${args.sheet}"${args.value !== undefined ? ` (${args.value})` : ""}${args.action === "delete" ? (args.permanent ? " PERMANENTLY (no copy is kept, undo cannot bring it back)" : " (a hidden copy is kept for undo)") : ""}`,
  },
  conditional_format: {
    check(args, restore) {
      const rule = oneOf(args.rule, CF_RULES, "rule");
      const out: ActionArgs = {
        sheet: checkSheetName(restore(String(args.sheet ?? ""))),
        address: checkRange(args.address),
        rule,
        fill: colour(args.fill, "fill"),
        font_color: colour(args.font_color, "font_color"),
        bold: typeof args.bold === "boolean" ? args.bold : undefined,
      };
      if (
        [
          "greater_than",
          "less_than",
          "equal_to",
          "not_equal_to",
          "between",
        ].includes(rule)
      ) {
        if (args.value === undefined)
          throw new AgentToolError(`${rule} needs value.`);
        out.value = plainValue(args.value, restore);
        if (rule === "between") {
          if (args.value2 === undefined)
            throw new AgentToolError("between needs value2.");
          out.value2 = plainValue(args.value2, restore);
        }
      }
      if (rule === "text_contains" || rule === "text_not_contains") {
        if (!args.value)
          throw new AgentToolError(`${rule} needs value (the text).`);
        out.value = restore(String(args.value)).slice(0, 255);
      }
      if (rule === "top" || rule === "bottom")
        out.value =
          optionalNumber(args.value, "value (how many)", 1, 1000) ?? 10;
      if (rule === "formula")
        out.formula = checkFormula(restore(String(args.formula ?? "")));
      if (rule === "color_scale") {
        out.min_color = colour(args.min_color, "min_color") ?? "#F8696B";
        out.mid_color = colour(args.mid_color, "mid_color");
        out.max_color = colour(args.max_color, "max_color") ?? "#63BE7B";
      }
      if (rule === "data_bar") out.fill = out.fill ?? "#638EC6";
      if (args.stop_if_true === true) out.stop_if_true = true;
      if (args.replace === true && rule !== "clear") out.replace = true;
      if (rule === "icon_set")
        out.icons = oneOf(
          args.icons ?? "three_arrows",
          [
            "three_arrows",
            "three_traffic_lights",
            "three_symbols",
            "four_arrows",
            "five_arrows",
            "three_flags",
            "three_stars",
          ] as const,
          "icons",
        );
      if (
        !["color_scale", "data_bar", "icon_set", "clear"].includes(rule) &&
        !out.fill &&
        !out.font_color &&
        out.bold === undefined
      )
        out.fill = "#FFC7CE";
      return clean(out);
    },
    describe: (args) =>
      args.rule === "clear"
        ? `Remove the conditional formatting from ${at(args)}`
        : `Conditional format ${at(args)}: ${String(args.rule).replace(/_/g, " ")}${args.value !== undefined ? ` ${args.value}` : ""}${args.value2 !== undefined ? ` and ${args.value2}` : ""}${args.formula ? ` ${args.formula}` : ""}${args.fill ? `, fill ${args.fill}` : ""}`,
  },
  data_validation: {
    check(args, restore) {
      const rule = oneOf(args.rule, VALIDATION_RULES, "rule");
      const out: ActionArgs = {
        sheet: checkSheetName(restore(String(args.sheet ?? ""))),
        address: checkRange(args.address),
        rule,
      };
      if (rule === "list") {
        if (Array.isArray(args.values) && args.values.length)
          out.values = args.values
            .slice(0, 200)
            .map((value) => restore(String(value)).replace(/,/g, " "));
        else if (args.source)
          out.source = checkFormula(
            `=${String(args.source).replace(/^=/, "")}`,
          );
        else
          throw new AgentToolError(
            "list needs values or source (a range such as Lists!$A$2:$A$20).",
          );
      }
      if (["whole_number", "decimal", "date", "text_length"].includes(rule)) {
        out.operator = oneOf(
          args.operator ?? "between",
          VALIDATION_OPERATORS,
          "operator",
        );
        if (args.min === undefined)
          throw new AgentToolError(`${rule} needs min (and max for between).`);
        out.min = plainValue(args.min, restore);
        if (out.operator === "between" || out.operator === "not_between") {
          if (args.max === undefined)
            throw new AgentToolError("between needs max.");
          out.max = plainValue(args.max, restore);
        }
      }
      if (rule === "custom")
        out.formula = checkFormula(restore(String(args.formula ?? "")));
      if (rule === "copy_from") out.from = checkRange(args.from);
      out.input_title = shortText(args.input_title, 32);
      out.input_message = shortText(args.input_message, 255);
      out.error_message = shortText(args.error_message, 255);
      if (args.error_style)
        out.error_style = oneOf(
          args.error_style,
          ["stop", "warning", "information"] as const,
          "error_style",
        );
      return clean(out);
    },
    describe: (args) =>
      `${args.rule === "clear" ? "Remove validation from" : `Validation on`} ${at(args)}${args.rule === "clear" ? "" : `: ${String(args.rule).replace(/_/g, " ")} ${args.values ? (args.values as string[]).slice(0, 6).join(", ") : (args.source ?? "")}${args.operator ? ` ${String(args.operator).replace(/_/g, " ")} ${args.min ?? ""}${args.max !== undefined ? ` and ${args.max}` : ""}` : ""}${args.formula ?? ""}${args.from ? ` copied from ${args.from}` : ""}`}`,
  },
  table_action: {
    check(args, restore) {
      const action = oneOf(args.action, TABLE_ACTIONS, "action");
      const out: ActionArgs = { action };
      if (action === "create") {
        out.sheet = checkSheetName(restore(String(args.sheet ?? "")));
        out.address = checkRange(args.address);
        if (args.name) out.name = tableName(args.name);
        out.style = args.style ? tableStyle(args.style) : undefined;
        return clean(out);
      }
      if (!args.table) throw new AgentToolError("Name the Table in table.");
      out.table = String(args.table).trim().slice(0, 255);
      if (action === "rename") out.value = tableName(args.value);
      if (action === "style") out.value = tableStyle(args.value);
      if (action === "resize") out.value = checkRange(args.value);
      if (action === "add_column")
        out.value = restore(String(args.value ?? "")).slice(0, 255) || "Column";
      if (action === "sort") {
        out.column = restore(String(args.column ?? "")).trim();
        out.descending = args.descending === true;
      }
      if (action === "filter") {
        out.column = restore(String(args.column ?? "")).trim();
        if (!Array.isArray(args.values) || !args.values.length)
          throw new AgentToolError("filter needs values to show.");
        out.values = args.values
          .slice(0, 200)
          .map((value) => restore(String(value)));
      }
      if ((action === "sort" || action === "filter") && !out.column)
        throw new AgentToolError(`${action} needs column.`);
      return clean(out);
    },
    describe: (args) =>
      args.action === "create"
        ? `Turn ${at(args)} into an Excel Table${args.name ? ` "${args.name}"` : ""}`
        : `Table "${args.table}": ${String(args.action).replace(/_/g, " ")}${args.value !== undefined ? ` ${args.value}` : ""}${args.column ? ` ${args.column}` : ""}${args.values ? ` = ${(args.values as string[]).join(", ")}` : ""}`,
  },
  named_range: {
    check(args, restore) {
      const action = oneOf(args.action, NAME_ACTIONS, "action");
      const name = String(args.name ?? "").trim();
      if (
        !NAME.test(name) ||
        /^[A-Z]{1,3}\d+$/i.test(name) ||
        /^R\d*C\d*$/i.test(name)
      )
        throw new AgentToolError(
          `"${name}" is not a valid name (letters, digits, _ and ., not a cell address).`,
        );
      const out: ActionArgs = { action, name };
      if (action === "add") {
        const target = restore(String(args.refers_to ?? "")).trim();
        out.refers_to = checkFormula(
          target.startsWith("=") ? target : `=${target}`,
        );
        out.comment = shortText(args.comment, 255);
      }
      if (action === "rename") {
        const next = String(args.value ?? "").trim();
        if (!NAME.test(next))
          throw new AgentToolError("rename needs value: the new name.");
        out.value = next;
      }
      return clean(out);
    },
    describe: (args) =>
      `${args.action === "add" ? "Add the name" : args.action === "delete" ? "Delete the name" : "Rename the name"} ${args.name}${args.refers_to ? ` = ${args.refers_to}` : ""}${args.value ? ` to ${args.value}` : ""}`,
  },
  pivot_action: {
    check(args, restore) {
      const action = oneOf(args.action, PIVOT_ACTIONS, "action");
      if (!args.pivot)
        throw new AgentToolError(
          "Name the PivotTable in pivot (get_details lists them).",
        );
      const out: ActionArgs = {
        action,
        pivot: String(args.pivot).trim().slice(0, 255),
      };
      if (args.sheet) out.sheet = checkSheetName(restore(String(args.sheet)));
      if (
        !["layout", "refresh", "grand_totals_on", "grand_totals_off"].includes(
          action,
        )
      ) {
        const field = String(args.field ?? "").trim();
        if (!field)
          throw new AgentToolError(
            `${action} needs field: the field (column) name.`,
          );
        out.field = restore(field);
      }
      if (action === "summarize_by")
        out.value = oneOf(args.value, PIVOT_FUNCTIONS, "value");
      if (action === "show_as") {
        out.value = oneOf(args.value, PIVOT_SHOW_AS, "value");
        if (args.base_field) out.base_field = restore(String(args.base_field));
      }
      if (action === "number_format")
        out.value = String(args.value ?? "#,##0").slice(0, 60);
      if (action === "layout")
        out.value = oneOf(
          args.value,
          ["compact", "outline", "tabular"] as const,
          "value",
        );
      if (action === "sort_labels" || action === "sort_values") {
        out.descending = args.descending === true;
        if (action === "sort_values")
          out.value_field = restore(String(args.value_field ?? ""));
      }
      return clean(out);
    },
    describe: (args) =>
      `PivotTable "${args.pivot}": ${String(args.action).replace(/_/g, " ")}${args.field ? ` ${args.field}` : ""}${args.value !== undefined ? ` ${String(args.value).replace(/_/g, " ")}` : ""}`,
  },
  chart_action: {
    check(args, restore) {
      const action = oneOf(args.action, CHART_ACTIONS, "action");
      const out: ActionArgs = {
        action,
        sheet: checkSheetName(restore(String(args.sheet ?? ""))),
        chart: String(args.chart ?? "")
          .trim()
          .slice(0, 255),
      };
      if (!out.chart)
        throw new AgentToolError(
          "Name the chart in chart (get_details lists them).",
        );
      if (action === "title")
        out.value = restore(String(args.value ?? "")).slice(0, 255);
      if (action === "axis_titles") {
        out.category_title = shortText(args.category_title, 255);
        out.value_title = shortText(args.value_title, 255);
      }
      if (action === "legend")
        out.value = oneOf(
          args.value ?? "right",
          ["right", "left", "top", "bottom", "none"] as const,
          "value",
        );
      if (action === "series_color") {
        out.series =
          optionalNumber(args.series, "series (0 is first)", 0, 50) ?? 0;
        out.value = colour(args.value, "value");
        if (!out.value) throw new AgentToolError("series_color needs value.");
      }
      if (action === "chart_type" || action === "series_type")
        out.value = oneOf(args.value, CHART_TYPE_NAMES, "value");
      if (
        action === "series_type" ||
        action === "secondary_axis" ||
        action === "trendline"
      )
        out.series =
          optionalNumber(args.series, "series (0 is first)", 0, 50) ?? 0;
      if (action === "trendline")
        out.kind = oneOf(
          args.kind ?? "linear",
          [
            "linear",
            "exponential",
            "logarithmic",
            "moving_average",
            "polynomial",
            "power",
          ] as const,
          "kind",
        );
      if (action === "position") out.value = checkRange(args.value);
      return clean(out);
    },
    describe: (args) =>
      `Chart "${args.chart}" on '${args.sheet}': ${String(args.action).replace(/_/g, " ")}${args.value !== undefined ? ` ${args.value}` : ""}${args.action === "delete" ? " (a chart the agent did not add cannot be restored by undo)" : ""}`,
  },
  comment: {
    check(args, restore) {
      const action = oneOf(args.action, COMMENT_ACTIONS, "action");
      const out: ActionArgs = {
        action,
        sheet: checkSheetName(restore(String(args.sheet ?? ""))),
        cell: checkCell(args.cell),
      };
      if (action === "add" || action === "reply" || action === "note") {
        const text = restore(String(args.text ?? "")).trim();
        if (!text) throw new AgentToolError(`${action} needs text.`);
        out.text = text.slice(0, 2000);
      }
      return out;
    },
    describe: (args) =>
      `${args.action === "note" ? "Add a note to" : args.action === "add" ? "Add a comment to" : `${String(args.action)[0].toUpperCase()}${String(args.action).slice(1)} the comment on`} ${at(args)}${args.text ? `: "${String(args.text).slice(0, 80)}"` : ""}`,
  },
  page_setup: {
    check(args, restore) {
      return clean({
        sheet: checkSheetName(restore(String(args.sheet ?? ""))),
        orientation: args.orientation
          ? oneOf(
              args.orientation,
              ["portrait", "landscape"] as const,
              "orientation",
            )
          : undefined,
        fit_width: optionalNumber(args.fit_width, "fit_width (pages)", 0, 50),
        fit_height: optionalNumber(
          args.fit_height,
          "fit_height (pages)",
          0,
          50,
        ),
        print_area: args.print_area ? checkRange(args.print_area) : undefined,
        print_title_rows: args.print_title_rows
          ? (() => {
              const rows = String(args.print_title_rows).replace(/\$/g, "");
              if (!/^\d{1,7}:\d{1,7}$/.test(rows))
                throw new AgentToolError('print_title_rows looks like "1:1".');
              return rows;
            })()
          : undefined,
        margins: args.margins
          ? oneOf(
              args.margins,
              ["narrow", "normal", "wide"] as const,
              "margins",
            )
          : undefined,
        center_header: shortText(args.center_header, 255),
        center_footer: shortText(args.center_footer, 255),
        gridlines:
          typeof args.gridlines === "boolean" ? args.gridlines : undefined,
      });
    },
    describe: (args) =>
      `Page setup of "${args.sheet}": ${Object.entries(args)
        .filter(([key]) => key !== "sheet")
        .map(([key, value]) => `${key.replace(/_/g, " ")} ${value}`)
        .join(", ")}`,
  },
  workbook_action: {
    check(args) {
      return {
        action: oneOf(
          args.action,
          [
            "calculation_manual",
            "calculation_automatic",
            "recalculate",
          ] as const,
          "action",
        ),
      };
    },
    describe: (args) => String(args.action).replace(/_/g, " "),
  },
  protect_sheet: {
    check(args, restore) {
      const action = oneOf(args.action, PROTECT_ACTIONS, "action");
      return clean({
        action,
        sheet: checkSheetName(restore(String(args.sheet ?? ""))),
        address:
          action === "lock_cells" || action === "unlock_cells"
            ? checkRange(args.address)
            : undefined,
      });
    },
    describe: (args) =>
      `${String(args.action).replace(/_/g, " ")} ${args.address ? at(args) : `sheet "${args.sheet}"`} (no password)`,
  },
  find_replace: {
    check(args, restore) {
      const find = restore(String(args.find ?? ""));
      if (!find) throw new AgentToolError("find needs the text to look for.");
      return clean({
        sheet: checkSheetName(restore(String(args.sheet ?? ""))),
        address: args.address ? checkRange(args.address) : undefined,
        find: find.slice(0, 255),
        replace: restore(String(args.replace ?? "")).slice(0, 255),
        match_case: args.match_case === true,
        whole_cell: args.whole_cell === true,
      });
    },
    describe: (args) =>
      `Replace "${args.find}" with "${args.replace}" in ${args.address ? at(args) : `sheet "${args.sheet}"`}${args.whole_cell ? " (whole cell)" : ""} (undo restores it)`,
  },
  clean_in_place: {
    check(args, restore) {
      return {
        sheet: checkSheetName(restore(String(args.sheet ?? ""))),
        address: checkRange(args.address),
        op: oneOf(args.op, CLEAN_OPS, "op"),
      };
    },
    describe: (args) =>
      `Clean ${at(args)} in place: ${String(args.op).replace(/_/g, " ")} (formulas and IDs with leading zeros are kept; undo restores it)`,
  },
  goal_seek: {
    check(args, restore) {
      const target = optionalNumber(args.target, "target", -1e15, 1e15);
      if (target === undefined)
        throw new AgentToolError(
          "goal_seek needs target: the value the formula cell must reach.",
        );
      return {
        sheet: checkSheetName(restore(String(args.sheet ?? ""))),
        formula_cell: checkCell(args.formula_cell),
        changing_cell: checkCell(args.changing_cell),
        target,
      };
    },
    describe: (args) =>
      `Goal seek: change '${args.sheet}'!${args.changing_cell} until ${args.formula_cell} = ${args.target}`,
  },
  combine_tables: {
    check(args, restore) {
      const mode = oneOf(args.mode, COMBINE_MODES, "mode");
      const header = (value: unknown) => {
        const name = restore(String(value ?? "")).trim();
        return name ? name.slice(0, 255) : undefined;
      };
      const key = header(args.key);
      if (mode !== "append" && !key)
        throw new AgentToolError(
          `${mode} needs key: the header of the column both tables share.`,
        );
      const columns = Array.isArray(args.columns)
        ? args.columns.slice(0, 30).map(header).filter(Boolean)
        : undefined;
      return clean({
        mode,
        left_sheet: checkSheetName(restore(String(args.left_sheet ?? ""))),
        left_address: checkRange(args.left_address),
        right_sheet: checkSheetName(restore(String(args.right_sheet ?? ""))),
        right_address: checkRange(args.right_address),
        key,
        right_key: header(args.right_key),
        columns: columns?.length ? columns : undefined,
        amount: mode === "reconcile" ? header(args.amount) : undefined,
        right_amount: mode === "reconcile" ? header(args.right_amount) : undefined,
        sheet: checkSheetName(restore(String(args.sheet ?? ""))),
        cell: args.cell ? checkCell(args.cell) : "A1",
      });
    },
    describe: (args) => {
      const left = `'${args.left_sheet}'!${args.left_address}`;
      const right = `'${args.right_sheet}'!${args.right_address}`;
      const on = args.right_key ? `${args.key} / ${args.right_key}` : args.key;
      const into = `into '${args.sheet}'!${args.cell} as live formulas`;
      if (args.mode === "append")
        return `Append ${right} under ${left} (columns matched by header) ${into}`;
      if (args.mode === "join")
        return `Join ${left} with ${right} on ${on}${Array.isArray(args.columns) ? ` (${args.columns.join(", ")})` : ""} ${into}`;
      const amounts = args.amount
        ? `, comparing ${args.right_amount ? `${args.amount} / ${args.right_amount}` : args.amount}`
        : "";
      return `Reconcile ${left} with ${right} on ${on}${amounts} ${into}`;
    },
  },
  financial_model: {
    check(args, restore) {
      const kind = oneOf(args.kind, FINANCIAL_KINDS, "kind");
      const range = (key: string) =>
        args[key] ? qualifiedRange(restore(String(args[key])), key) : undefined;
      const checked = clean({
        kind,
        sheet: checkSheetName(restore(String(args.sheet ?? ""))),
        cell: args.cell ? checkCell(args.cell) : "A1",
        principal: optionalNumber(args.principal, "principal", 0, 1e13),
        annual_rate: optionalNumber(args.annual_rate, "annual_rate", 0, 1),
        years: optionalNumber(args.years, "years", 0, 50),
        payments_per_year: optionalNumber(args.payments_per_year, "payments_per_year", 1, 365),
        rate: optionalNumber(args.rate, "rate", -0.99, 10),
        cash_flows: range("cash_flows"),
        dates: range("dates"),
        categories: range("categories"),
        actual: range("actual"),
        budget: range("budget"),
        due_dates: range("due_dates"),
        amounts: range("amounts"),
        customers: range("customers"),
        as_of: args.as_of ? String(args.as_of).trim() : undefined,
      });
      // Builds the model once now, so a missing or mismatched input is reported before staging.
      financialCells(checked as unknown as FinancialSpec);
      return checked;
    },
    describe: (args) => {
      const into = `into '${args.sheet}'!${args.cell} as live formulas`;
      const amount = (value: unknown) => Number(value).toLocaleString("en-US");
      switch (args.kind) {
        case "loan_schedule":
          return `Loan schedule: ${amount(args.principal)} at ${Math.round(Number(args.annual_rate) * 10000) / 100}% for ${args.years} years, ${args.payments_per_year ?? 12} payments a year, ${into}`;
        case "npv_irr":
          return `${args.dates ? "XNPV and XIRR" : "NPV, IRR"} and payback of ${args.cash_flows} at ${Math.round(Number(args.rate) * 10000) / 100}% ${into}`;
        case "budget_variance":
          return `Budget against actual by ${args.categories}: ${args.actual} vs ${args.budget} ${into}`;
        default:
          return `Receivables ageing of ${args.amounts}${args.customers ? ` by ${args.customers}` : ""} as of ${args.as_of ?? "today"} (0-30, 31-60, 61-90, over 90 days) ${into}`;
      }
    },
  },
  what_if: {
    check(args, restore) {
      return {
        ...checkWhatIf(args),
        model_sheet: checkSheetName(restore(String(args.model_sheet ?? ""))),
        sheet: checkSheetName(restore(String(args.sheet ?? ""))),
        cell: args.cell ? checkCell(args.cell) : "A1",
      };
    },
    describe: (raw) => {
      const args = raw as unknown as WhatIfArgs & Record<string, string>;
      const outputs = `'${args.model_sheet}'!${args.outputs.join(", ")}`;
      const into = `into '${args.sheet}'!${args.cell} as values (inputs are put back)`;
      if (args.mode === "scenarios")
        return `Compare ${args.scenarios!.length} scenarios (${args.scenarios!.map((s: Scenario) => s.name).join(", ")}) on ${outputs} ${into}`;
      return args.second_input_cell
        ? `Two-input data table of ${outputs}: ${args.input_cell} x ${args.second_input_cell} (${args.values!.length} x ${args.second_values!.length}) ${into}`
        : `Data table of ${outputs} for ${args.values!.length} values of ${args.input_cell} ${into}`;
    },
  },
};

export const CHART_TYPE_NAMES = [
  "column",
  "stacked_column",
  "bar",
  "stacked_bar",
  "line",
  "line_markers",
  "pie",
  "doughnut",
  "area",
  "stacked_area",
  "scatter",
  "bubble",
  "radar",
  "waterfall",
  "treemap",
  "sunburst",
  "histogram",
  "pareto",
  "box_whisker",
  "funnel",
  "map",
] as const;

function tableName(value: unknown): string {
  const name = String(value ?? "").trim();
  if (
    !/^[A-Za-z_\\][A-Za-z0-9_]{0,254}$/.test(name) ||
    /^[A-Z]{1,3}\d+$/i.test(name)
  )
    throw new AgentToolError(`"${name}" is not a valid Table name.`);
  return name;
}
function tableStyle(value: unknown): string {
  const style = String(value ?? "").trim();
  if (!/^TableStyle(?:Light|Medium|Dark)\d{1,2}$/.test(style))
    throw new AgentToolError('style looks like "TableStyleMedium2".');
  return style;
}

/** Changes that need a backup copy of the sheet first, so undo can put the data back. */
export function needsSheetBackup(tool: string, args: ActionArgs): boolean {
  if (
    tool === "delete_rows_where" ||
    tool === "find_replace" ||
    tool === "clean_in_place"
  )
    return true;
  if (tool === "edit_rows_columns")
    return ![
      "hide_rows",
      "unhide_rows",
      "hide_columns",
      "unhide_columns",
      "group_rows",
      "ungroup_rows",
      "group_columns",
      "ungroup_columns",
      "column_width",
      "row_height",
    ].includes(String(args.action));
  if (tool === "conditional_format") return args.rule === "clear";
  if (tool === "table_action") return args.action === "sort";
  return false;
}
