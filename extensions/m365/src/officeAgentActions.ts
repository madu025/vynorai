/**
 * Runs the agent's workbook-object tools (`agentActions.ts`) with Office.js after approval, and
 * undoes them. Every action leaves a journal entry: either an exact inverse (a rename back, an old
 * width, the id of an added conditional format) or, for changes to cell data, a hidden backup copy
 * of the sheet made first. Sheets are tracked by their Office id, so a later rename cannot break
 * undo. The few actions Excel cannot undo say so in their description.
 */
import { parseA1 } from "./agent.js";
import { inspectFormulas } from "./formulaInspector.js";

export type JournalEntry =
  | { type: "backup"; sheetId: string; backupId: string }
  | { type: "inverse"; tool: string; data: any };

export interface ActionRun {
  context: any;
  /** The sheet by name, after renames done earlier in this apply. */
  sheet(name: string): any;
  /** True when this apply created the sheet (no undo data needed). */
  ours(name: string): boolean;
  journal: JournalEntry[];
  /** Makes (once per sheet per apply) a hidden copy so undo can put the cells back. */
  backup(name: string): Promise<void>;
  rename(from: string, to: string): void;
}

export const CHART_TYPES: Record<string, string> = {
  column: "ColumnClustered",
  stacked_column: "ColumnStacked",
  bar: "BarClustered",
  stacked_bar: "BarStacked",
  line: "Line",
  line_markers: "LineMarkers",
  pie: "Pie",
  doughnut: "Doughnut",
  area: "Area",
  stacked_area: "AreaStacked",
  scatter: "XYScatter",
  bubble: "Bubble",
  radar: "Radar",
  waterfall: "Waterfall",
  treemap: "Treemap",
  sunburst: "Sunburst",
  histogram: "Histogram",
  pareto: "Pareto",
  box_whisker: "BoxWhisker",
  funnel: "Funnel",
  map: "RegionMap",
};
const title = (text: string) =>
  text
    .split("_")
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join("");
const quote = (sheet: string) => `'${sheet.replace(/'/g, "''")}'`;
const excelText = (value: string) => `"${value.replace(/"/g, '""')}"`;
const columnLetter = (index: number) => {
  let value = index;
  let letters = "";
  do {
    letters = String.fromCharCode(65 + (value % 26)) + letters;
    value = Math.floor(value / 26) - 1;
  } while (value >= 0);
  return letters;
};
const isoSerial = (value: unknown) =>
  typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? String(Math.round(Date.parse(`${value}T00:00:00Z`) / 86_400_000 + 25569))
    : String(value);
const criterionFormula = (value: unknown) =>
  typeof value === "number" || /^-?\d+(?:\.\d+)?$/.test(String(value))
    ? `=${value}`
    : /^\d{4}-\d{2}-\d{2}$/.test(String(value))
      ? `=${isoSerial(value)}`
      : `=${excelText(String(value))}`;

async function headerIndex(
  context: any,
  range: any,
  column: string,
): Promise<number> {
  const header = range.getRow(0);
  header.load("values");
  await context.sync();
  const names = (header.values[0] as unknown[]).map((value) =>
    String(value).trim().toLowerCase(),
  );
  const index = names.indexOf(column.trim().toLowerCase());
  if (index < 0) throw new Error(`"${column}" is not a header of this range`);
  return index;
}

/** Runs one approved workbook-object action. */
export async function runExcelAction(
  run: ActionRun,
  tool: string,
  args: any,
): Promise<unknown> {
  const { context } = run;
  const workbook = context.workbook;
  const sheetName = args.sheet as string | undefined;
  const sheet = sheetName ? run.sheet(sheetName) : undefined;
  const ours = sheetName ? run.ours(sheetName) : false;
  const inverse = (data: any) => {
    if (!ours) run.journal.push({ type: "inverse", tool, data });
  };
  const sheetId = async () => {
    sheet.load("id");
    await context.sync();
    return String(sheet.id);
  };

  switch (tool) {
    case "edit_rows_columns": {
      const range = sheet.getRange(args.address);
      const action = args.action as string;
      const visual = [
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
      ];
      if (!visual.includes(action) && !ours) await run.backup(sheetName!);
      const id = await sheetId();
      switch (action) {
        case "insert_rows":
          range.getEntireRow().insert("Down");
          break;
        case "delete_rows":
          range.getEntireRow().delete("Up");
          break;
        case "insert_columns":
          range.getEntireColumn().insert("Right");
          break;
        case "delete_columns":
          range.getEntireColumn().delete("Left");
          break;
        case "hide_rows":
        case "unhide_rows":
          range.getEntireRow().rowHidden = action === "hide_rows";
          inverse({
            sheetId: id,
            address: args.address,
            rows: true,
            hidden: action !== "hide_rows",
          });
          break;
        case "hide_columns":
        case "unhide_columns":
          range.getEntireColumn().columnHidden = action === "hide_columns";
          inverse({
            sheetId: id,
            address: args.address,
            rows: false,
            hidden: action !== "hide_columns",
          });
          break;
        case "group_rows":
          range.getEntireRow().group("ByRows");
          inverse({ sheetId: id, address: args.address, ungroup: "ByRows" });
          break;
        case "group_columns":
          range.getEntireColumn().group("ByColumns");
          inverse({ sheetId: id, address: args.address, ungroup: "ByColumns" });
          break;
        case "ungroup_rows":
          range.getEntireRow().ungroup("ByRows");
          inverse({ sheetId: id, address: args.address, group: "ByRows" });
          break;
        case "ungroup_columns":
          range.getEntireColumn().ungroup("ByColumns");
          inverse({ sheetId: id, address: args.address, group: "ByColumns" });
          break;
        case "column_width":
        case "row_height": {
          const widths = action === "column_width";
          range.load(["columnCount", "rowCount"]);
          await context.sync();
          const count = Math.min(
            widths ? Number(range.columnCount) : Number(range.rowCount),
            200,
          );
          const parts = Array.from({ length: count }, (_, index) => {
            const part = widths ? range.getColumn(index) : range.getRow(index);
            part.load(["address", "format/columnWidth", "format/rowHeight"]);
            return part;
          });
          await context.sync();
          inverse({
            sheetId: id,
            sizes: parts.map((part: any) => ({
              address: String(part.address).split("!").pop(),
              value: widths ? part.format.columnWidth : part.format.rowHeight,
            })),
            widths,
          });
          if (widths) range.format.columnWidth = args.value;
          else range.format.rowHeight = args.value;
          break;
        }
        case "clear_contents":
          range.clear("Contents");
          break;
        case "clear_formats":
          range.clear("Formats");
          break;
        case "merge":
          range.merge(false);
          break;
        case "unmerge":
          range.unmerge();
          break;
        case "fill_down":
        case "fill_right": {
          const first =
            action === "fill_down" ? range.getRow(0) : range.getColumn(0);
          range.copyFrom(first, "All");
          break;
        }
        case "move":
          range.moveTo(sheet.getRange(args.to));
          break;
        case "paste_values":
          range.copyFrom(range, "Values");
          break;
        case "transpose":
          range.load("cellCount");
          await context.sync();
          if (Number(range.cellCount) > 100_000)
            throw new Error("transpose is limited to 100,000 cells");
          sheet.getRange(args.to).copyFrom(range, "All", false, true);
          break;
        case "remove_duplicates": {
          const indexes: number[] = [];
          for (const column of args.columns as string[])
            indexes.push(await headerIndex(context, range, column));
          const result = range.removeDuplicates(indexes, true);
          result.load(["removed", "uniqueRemaining"]);
          await context.sync();
          return { removed: result.removed, remaining: result.uniqueRemaining };
        }
      }
      await context.sync();
      return { done: action };
    }

    case "delete_rows_where": {
      if (!ours) await run.backup(sheetName!);
      return deleteRowsWhere(context, sheet, args);
    }

    case "filter_range": {
      const range = sheet.getRange(args.address);
      // Data inside an Excel Table is filtered through the Table: a sheet AutoFilter on it is refused.
      const tables = sheet.tables;
      tables.load("items/name");
      await context.sync();
      const overlaps = tables.items.map((table: any) => {
        const tableRange = table.getRange();
        const shared = range.getIntersectionOrNullObject(tableRange);
        shared.load("isNullObject");
        return { table, tableRange, shared };
      });
      await context.sync();
      const hit = overlaps.find((item: any) => !item.shared.isNullObject);
      if (hit) {
        const tableFilter = hit.table.autoFilter;
        const tableName = String(hit.table.name);
        const id = await sheetId();
        run.journal.push({
          type: "inverse",
          tool,
          data: { sheetId: id, table: tableName },
        });
        if (args.kind === "clear") {
          tableFilter.clearCriteria();
          await context.sync();
          return { cleared: true, table: tableName };
        }
        if (args.kind === "remove") {
          hit.table.showFilterButton = false;
          await context.sync();
          return { removed: true, table: tableName };
        }
        const headers = hit.table.getHeaderRowRange();
        headers.load("values");
        await context.sync();
        const at = (headers.values[0] as unknown[])
          .map((value) => String(value).trim().toLowerCase())
          .indexOf(String(args.column).trim().toLowerCase());
        if (at < 0)
          throw new Error(`"${args.column}" is not a column of ${tableName}`);
        tableFilter.apply(hit.tableRange, at, filterCriteria(args));
        await context.sync();
        const visible = hit.tableRange.getVisibleView();
        visible.load("rowCount");
        await context.sync();
        return {
          shownRows: Math.max(0, Number(visible.rowCount) - 1),
          table: tableName,
        };
      }
      const filter = sheet.autoFilter;
      filter.load(["enabled", "criteria"]);
      const current = filter.getRangeOrNullObject();
      current.load(["isNullObject", "address"]);
      await context.sync();
      inverse({
        sheetId: await sheetId(),
        had: Boolean(filter.enabled) && !current.isNullObject,
        address: current.isNullObject
          ? undefined
          : String(current.address).split("!").pop(),
        criteria: filter.criteria,
      });
      if (args.kind === "remove") {
        filter.remove();
        await context.sync();
        return { removed: true };
      }
      if (args.kind === "clear") {
        filter.clearCriteria();
        await context.sync();
        return { cleared: true };
      }
      const index = await headerIndex(context, range, args.column);
      filter.apply(range, index, filterCriteria(args));
      await context.sync();
      const visible = range.getVisibleView?.();
      if (visible) {
        visible.load("rowCount");
        await context.sync();
        return { shownRows: Math.max(0, Number(visible.rowCount) - 1) };
      }
      return { filtered: true };
    }

    case "sheet_action": {
      const id = await sheetId();
      sheet.load([
        "name",
        "visibility",
        "position",
        "tabColor",
        "showGridlines",
      ]);
      await context.sync();
      switch (args.action) {
        case "rename":
          inverse({ sheetId: id, name: sheet.name });
          sheet.name = args.value;
          run.rename(sheetName!, args.value);
          break;
        case "hide":
        case "unhide":
          if (args.action === "hide") {
            const all = workbook.worksheets;
            all.load("items/visibility");
            await context.sync();
            if (
              all.items.filter((item: any) => item.visibility === "Visible")
                .length < 2
            )
              throw new Error("the last visible sheet cannot be hidden");
          }
          inverse({ sheetId: id, visibility: sheet.visibility });
          sheet.visibility = args.action === "hide" ? "Hidden" : "Visible";
          break;
        case "move":
          inverse({ sheetId: id, position: sheet.position });
          sheet.position = args.value;
          break;
        case "copy": {
          const copy = sheet.copy("After", sheet);
          copy.name = args.value;
          copy.customProperties.add("vynorai", "agent");
          copy.load("id");
          await context.sync();
          run.journal.push({
            type: "inverse",
            tool,
            data: { deleteId: String(copy.id) },
          });
          break;
        }
        case "delete": {
          const all = workbook.worksheets;
          all.load("items/visibility");
          await context.sync();
          if (
            all.items.filter((item: any) => item.visibility === "Visible")
              .length < 2
          )
            throw new Error("the last visible sheet cannot be deleted");
          if (args.permanent) {
            // The person asked for it explicitly: no hidden copy, undo cannot bring the sheet back.
            sheet.delete();
            break;
          }
          const copy = sheet.copy("End");
          copy.load("id");
          await context.sync();
          copy.name = `VynorAI_backup_${Date.now().toString(36)}`;
          copy.visibility = "Hidden";
          copy.customProperties.add("vynorai-backup", sheet.name);
          await context.sync();
          run.journal.push({
            type: "inverse",
            tool,
            data: {
              restoreId: String(copy.id),
              name: sheet.name,
              position: sheet.position,
            },
          });
          sheet.delete();
          break;
        }
        case "tab_color":
          inverse({ sheetId: id, tabColor: sheet.tabColor });
          sheet.tabColor = args.value;
          break;
        case "freeze_rows":
        case "freeze_columns":
        case "freeze_at":
        case "unfreeze": {
          const location = sheet.freezePanes.getLocationOrNullObject();
          location.load(["isNullObject", "address"]);
          await context.sync();
          inverse({
            sheetId: id,
            freeze: location.isNullObject
              ? null
              : String(location.address).split("!").pop(),
          });
          sheet.freezePanes.unfreeze();
          if (args.action === "freeze_rows")
            sheet.freezePanes.freezeRows(args.value);
          if (args.action === "freeze_columns")
            sheet.freezePanes.freezeColumns(args.value);
          if (args.action === "freeze_at")
            sheet.freezePanes.freezeAt(sheet.getRange(args.value));
          break;
        }
        case "activate":
          sheet.activate();
          break;
        case "gridlines_on":
        case "gridlines_off":
          inverse({ sheetId: id, showGridlines: sheet.showGridlines });
          sheet.showGridlines = args.action === "gridlines_on";
          break;
      }
      await context.sync();
      return { done: args.action };
    }

    case "conditional_format": {
      const range = sheet.getRange(args.address);
      if (args.replace) {
        // Editing a rule: the old rules on this range go (a backup keeps them for undo).
        if (!ours) await run.backup(sheetName!);
        range.conditionalFormats.clearAll();
      }
      if (args.rule === "clear") {
        if (!ours) await run.backup(sheetName!);
        range.conditionalFormats.clearAll();
        await context.sync();
        return { cleared: true };
      }
      const styleOf = (format: any) => {
        if (args.fill) format.fill.color = args.fill;
        if (args.font_color) format.font.color = args.font_color;
        if (args.bold !== undefined) format.font.bold = args.bold;
      };
      let cf: any;
      const rule = args.rule as string;
      if (rule === "color_scale") {
        cf = range.conditionalFormats.add("ColorScale");
        cf.colorScale.criteria = {
          minimum: {
            formula: null,
            type: "LowestValue",
            color: args.min_color,
          },
          ...(args.mid_color
            ? {
                midpoint: {
                  formula: "50",
                  type: "Percentile",
                  color: args.mid_color,
                },
              }
            : {}),
          maximum: {
            formula: null,
            type: "HighestValue",
            color: args.max_color,
          },
        };
      } else if (rule === "data_bar") {
        cf = range.conditionalFormats.add("DataBar");
        cf.dataBar.positiveFormat.fillColor = args.fill;
      } else if (rule === "icon_set") {
        cf = range.conditionalFormats.add("IconSet");
        cf.iconSet.style = {
          three_arrows: "ThreeArrows",
          three_traffic_lights: "ThreeTrafficLights1",
          three_symbols: "ThreeSymbols",
          four_arrows: "FourArrows",
          five_arrows: "FiveArrows",
          three_flags: "ThreeFlags",
          three_stars: "ThreeStars",
        }[args.icons as "three_arrows"];
      } else if (
        [
          "greater_than",
          "less_than",
          "between",
          "equal_to",
          "not_equal_to",
        ].includes(rule)
      ) {
        cf = range.conditionalFormats.add("CellValue");
        styleOf(cf.cellValue.format);
        cf.cellValue.rule = {
          formula1: criterionFormula(args.value),
          ...(rule === "between"
            ? { formula2: criterionFormula(args.value2) }
            : {}),
          operator: {
            greater_than: "GreaterThan",
            less_than: "LessThan",
            between: "Between",
            equal_to: "EqualTo",
            not_equal_to: "NotEqualTo",
          }[rule as "between"],
        };
      } else if (rule === "text_contains" || rule === "text_not_contains") {
        cf = range.conditionalFormats.add("ContainsText");
        styleOf(cf.textComparison.format);
        cf.textComparison.rule = {
          operator: rule === "text_contains" ? "Contains" : "NotContains",
          text: args.value,
        };
      } else if (rule === "top" || rule === "bottom") {
        cf = range.conditionalFormats.add("TopBottom");
        styleOf(cf.topBottom.format);
        cf.topBottom.rule = {
          rank: args.value,
          type: rule === "top" ? "TopItems" : "BottomItems",
        };
      } else if (rule === "formula") {
        cf = range.conditionalFormats.add("Custom");
        styleOf(cf.custom.format);
        cf.custom.rule.formula = args.formula;
      } else {
        cf = range.conditionalFormats.add("PresetCriteria");
        styleOf(cf.preset.format);
        cf.preset.rule = {
          criterion: {
            duplicates: "DuplicateValues",
            unique: "UniqueValues",
            above_average: "AboveAverage",
            below_average: "BelowAverage",
            blanks: "Blanks",
            errors: "Errors",
          }[rule as "duplicates"],
        };
      }
      if (args.stop_if_true) cf.stopIfTrue = true;
      cf.load("id");
      await context.sync();
      inverse({
        sheetId: await sheetId(),
        address: args.address,
        id: String(cf.id),
      });
      return { added: rule };
    }

    case "data_validation": {
      const range = sheet.getRange(args.address);
      const validation = range.dataValidation;
      validation.load(["type", "rule", "prompt", "errorAlert"]);
      await context.sync();
      inverse({
        sheetId: await sheetId(),
        address: args.address,
        previous:
          validation.type === "Inconsistent" || validation.type === "None"
            ? null
            : {
                rule: validation.rule,
                prompt: validation.prompt,
                errorAlert: validation.errorAlert,
              },
      });
      validation.clear();
      if (args.rule === "clear") {
        await context.sync();
        return { cleared: true };
      }
      if (args.rule === "copy_from") {
        const source = sheet.getRange(args.from).dataValidation;
        source.load(["rule", "prompt", "errorAlert"]);
        await context.sync();
        validation.rule = source.rule;
        validation.prompt = source.prompt;
        validation.errorAlert = source.errorAlert;
        await context.sync();
        return { copied: true };
      }
      const operator = args.operator
        ? {
            between: "Between",
            not_between: "NotBetween",
            equal_to: "EqualTo",
            not_equal_to: "NotEqualTo",
            greater_than: "GreaterThan",
            less_than: "LessThan",
            greater_or_equal: "GreaterThanOrEqualTo",
            less_or_equal: "LessThanOrEqualTo",
          }[args.operator as "between"]
        : undefined;
      const basic = {
        formula1: isoSerial(args.min),
        ...(args.max !== undefined ? { formula2: isoSerial(args.max) } : {}),
        operator,
      };
      validation.rule =
        args.rule === "list"
          ? {
              list: {
                inCellDropDown: true,
                source: args.values
                  ? (args.values as string[]).join(",")
                  : args.source,
              },
            }
          : args.rule === "whole_number"
            ? { wholeNumber: basic }
            : args.rule === "decimal"
              ? { decimal: basic }
              : args.rule === "date"
                ? { date: basic }
                : args.rule === "text_length"
                  ? { textLength: basic }
                  : { custom: { formula: args.formula } };
      if (args.input_message || args.input_title)
        validation.prompt = {
          showPrompt: true,
          title: args.input_title ?? "",
          message: args.input_message ?? "",
        };
      if (args.error_message || args.error_style)
        validation.errorAlert = {
          showAlert: true,
          style: title(args.error_style ?? "stop"),
          title: "Not allowed",
          message: args.error_message ?? "This value is not allowed here.",
        };
      await context.sync();
      return { rule: args.rule };
    }

    case "table_action": {
      const tables = workbook.tables;
      if (args.action === "create") {
        const table = tables.add(`${quote(sheetName!)}!${args.address}`, true);
        if (args.name) table.name = args.name;
        if (args.style) table.style = args.style;
        table.load("name");
        await context.sync();
        run.journal.push({
          type: "inverse",
          tool,
          data: { unmake: String(table.name) },
        });
        return { table: table.name };
      }
      const table = tables.getItem(args.table);
      table.load(["name", "style", "showTotals"]);
      const tableRange = table.getRange();
      tableRange.load("address");
      table.worksheet.load("name");
      await context.sync();
      const data = { name: String(table.name) };
      switch (args.action) {
        case "rename":
          run.journal.push({
            type: "inverse",
            tool,
            data: { name: args.value, rename: data.name },
          });
          table.name = args.value;
          break;
        case "style":
          run.journal.push({
            type: "inverse",
            tool,
            data: { ...data, style: table.style },
          });
          table.style = args.value;
          break;
        case "total_row_on":
        case "total_row_off":
          run.journal.push({
            type: "inverse",
            tool,
            data: { ...data, showTotals: table.showTotals },
          });
          table.showTotals = args.action === "total_row_on";
          break;
        case "resize":
          run.journal.push({
            type: "inverse",
            tool,
            data: {
              ...data,
              resize: String(tableRange.address).split("!").pop(),
            },
          });
          table.resize(args.value);
          break;
        case "add_column":
          table.columns.add(null, null, args.value);
          run.journal.push({
            type: "inverse",
            tool,
            data: { ...data, deleteColumn: args.value },
          });
          break;
        case "convert_to_range":
          run.journal.push({
            type: "inverse",
            tool,
            data: {
              remake: {
                sheet: String(table.worksheet.name),
                address: String(tableRange.address).split("!").pop(),
                name: data.name,
                style: table.style,
              },
            },
          });
          table.convertToRange();
          break;
        case "sort": {
          await run.backup(String(table.worksheet.name));
          const header = table.getHeaderRowRange();
          header.load("values");
          await context.sync();
          const key = (header.values[0] as unknown[])
            .map((v) => String(v).toLowerCase())
            .indexOf(String(args.column).toLowerCase());
          if (key < 0)
            throw new Error(`"${args.column}" is not a column of ${data.name}`);
          table.sort.apply([{ key, ascending: !args.descending }]);
          break;
        }
        case "filter":
          table.columns
            .getItem(args.column)
            .filter.applyValuesFilter(args.values);
          run.journal.push({
            type: "inverse",
            tool,
            data: { ...data, clearColumn: args.column },
          });
          break;
        case "clear_filter":
          table.clearFilters();
          break;
      }
      await context.sync();
      return { done: args.action };
    }

    case "named_range": {
      const names = workbook.names;
      if (args.action === "add") {
        names.add(args.name, args.refers_to, args.comment);
        await context.sync();
        run.journal.push({
          type: "inverse",
          tool,
          data: { remove: args.name },
        });
        return { added: args.name };
      }
      const item = names.getItem(args.name);
      item.load(["formula", "comment"]);
      await context.sync();
      run.journal.push({
        type: "inverse",
        tool,
        data: {
          readd: {
            name: args.name,
            formula: item.formula,
            comment: item.comment,
          },
          ...(args.action === "rename" ? { remove: args.value } : {}),
        },
      });
      const formula = item.formula;
      const comment = item.comment;
      item.delete();
      if (args.action === "rename") names.add(args.value, formula, comment);
      await context.sync();
      return { done: args.action };
    }

    case "pivot_action": {
      const pivot = workbook.pivotTables.getItem(args.pivot);
      const record = (data: any) =>
        run.journal.push({
          type: "inverse",
          tool,
          data: { pivot: args.pivot, ...data },
        });
      const hierarchy = () => pivot.hierarchies.getItem(args.field);
      switch (args.action) {
        case "add_row":
        case "add_column":
        case "add_filter": {
          const collection = {
            add_row: "rowHierarchies",
            add_column: "columnHierarchies",
            add_filter: "filterHierarchies",
          }[args.action as "add_row"];
          pivot[collection].add(hierarchy());
          record({ removeFrom: collection, name: args.field });
          break;
        }
        case "add_value": {
          const added = pivot.dataHierarchies.add(hierarchy());
          added.load("name");
          await context.sync();
          record({ removeFrom: "dataHierarchies", name: String(added.name) });
          break;
        }
        case "remove_field": {
          for (const collection of [
            "rowHierarchies",
            "columnHierarchies",
            "filterHierarchies",
            "dataHierarchies",
          ]) {
            const found = pivot[collection].getItemOrNullObject(args.field);
            found.load("isNullObject");
            await context.sync();
            if (found.isNullObject) continue;
            pivot[collection].remove(found);
            record({ addTo: collection, name: args.field });
            break;
          }
          break;
        }
        case "summarize_by":
        case "show_as":
        case "number_format": {
          const data = pivot.dataHierarchies.getItem(args.field);
          data.load(["summarizeBy", "showAs", "numberFormat"]);
          await context.sync();
          record({
            data: args.field,
            summarizeBy: data.summarizeBy,
            showAs: data.showAs,
            numberFormat: data.numberFormat,
          });
          if (args.action === "summarize_by")
            data.summarizeBy =
              {
                countnumbers: "CountNumbers",
                standarddeviation: "StandardDeviation",
              }[args.value as string] ?? title(args.value);
          if (args.action === "show_as")
            data.showAs = {
              calculation: {
                none: "None",
                percent_of_grand_total: "PercentOfGrandTotal",
                percent_of_row_total: "PercentOfRowTotal",
                percent_of_column_total: "PercentOfColumnTotal",
                running_total: "RunningTotal",
                rank_ascending: "RankAscending",
                rank_descending: "RankDecending",
                difference_from: "DifferenceFrom",
                percent_of_parent_row_total: "PercentOfParentRowTotal",
              }[args.value as "none"],
              ...(args.base_field
                ? {
                    baseField: pivot.rowHierarchies
                      .getItem(args.base_field)
                      .fields.getItem(args.base_field),
                  }
                : {}),
            };
          if (args.action === "number_format") data.numberFormat = args.value;
          break;
        }
        case "layout":
        case "grand_totals_on":
        case "grand_totals_off":
          pivot.layout.load([
            "layoutType",
            "showRowGrandTotals",
            "showColumnGrandTotals",
          ]);
          await context.sync();
          record({
            layout: {
              layoutType: pivot.layout.layoutType,
              showRowGrandTotals: pivot.layout.showRowGrandTotals,
              showColumnGrandTotals: pivot.layout.showColumnGrandTotals,
            },
          });
          if (args.action === "layout")
            pivot.layout.layoutType = title(args.value);
          else {
            pivot.layout.showRowGrandTotals = args.action === "grand_totals_on";
            pivot.layout.showColumnGrandTotals =
              args.action === "grand_totals_on";
          }
          break;
        case "subtotals_on":
        case "subtotals_off": {
          const field = pivot.rowHierarchies
            .getItem(args.field)
            .fields.getItem(args.field);
          field.load("subtotals");
          await context.sync();
          record({ subtotalsField: args.field, subtotals: field.subtotals });
          field.subtotals = { automatic: args.action === "subtotals_on" };
          break;
        }
        case "refresh":
          pivot.refresh();
          break;
        case "sort_labels":
          pivot.rowHierarchies
            .getItem(args.field)
            .fields.getItem(args.field)
            .sortByLabels(args.descending ? "Descending" : "Ascending");
          break;
        case "sort_values":
          pivot.rowHierarchies
            .getItem(args.field)
            .fields.getItem(args.field)
            .sortByValues(
              args.descending ? "Descending" : "Ascending",
              pivot.dataHierarchies.getItem(args.value_field),
            );
          break;
      }
      await context.sync();
      return { done: args.action };
    }

    case "chart_action": {
      const chart = sheet.charts.getItem(args.chart);
      chart.load(["chartType", "top", "left", "width", "height"]);
      chart.title.load(["text", "visible"]);
      chart.legend.load(["visible", "position"]);
      chart.dataLabels.load("showValue");
      await context.sync();
      const id = await sheetId();
      const record = (data: any) =>
        inverse({ sheetId: id, chart: args.chart, ...data });
      const series = () => chart.series.getItemAt(args.series ?? 0);
      switch (args.action) {
        case "title":
          record({
            title: { text: chart.title.text, visible: chart.title.visible },
          });
          chart.title.text = args.value;
          chart.title.visible = Boolean(args.value);
          break;
        case "axis_titles": {
          const category = chart.axes.categoryAxis.title;
          const value = chart.axes.valueAxis.title;
          category.load("text");
          value.load("text");
          await context.sync();
          record({
            axisTitles: { category: category.text, value: value.text },
          });
          if (args.category_title !== undefined)
            category.text = args.category_title;
          if (args.value_title !== undefined) value.text = args.value_title;
          break;
        }
        case "data_labels_on":
        case "data_labels_off":
          record({ showValue: chart.dataLabels.showValue });
          chart.dataLabels.showValue = args.action === "data_labels_on";
          break;
        case "legend":
          record({
            legend: {
              visible: chart.legend.visible,
              position: chart.legend.position,
            },
          });
          if (args.value === "none") chart.legend.visible = false;
          else {
            chart.legend.visible = true;
            chart.legend.position = title(args.value);
          }
          break;
        case "series_color":
          series().format.fill.setSolidColor(args.value);
          record({ clearSeriesFill: args.series });
          break;
        case "chart_type":
          record({ chartType: chart.chartType });
          chart.chartType = CHART_TYPES[args.value];
          break;
        case "position": {
          record({
            box: {
              top: chart.top,
              left: chart.left,
              width: chart.width,
              height: chart.height,
            },
          });
          const [start, end = start] = String(args.value).split(":");
          chart.setPosition(start, end);
          break;
        }
        case "trendline": {
          const lines = series().trendlines;
          lines.add(
            {
              linear: "Linear",
              exponential: "Exponential",
              logarithmic: "Logarithmic",
              moving_average: "MovingAverage",
              polynomial: "Polynomial",
              power: "Power",
            }[args.kind as "linear"],
          );
          lines.load("items");
          await context.sync();
          record({
            trendlineSeries: args.series,
            trendlineIndex: lines.items.length - 1,
          });
          break;
        }
        case "secondary_axis": {
          const target = series();
          target.load("axisGroup");
          await context.sync();
          record({ axisGroupSeries: args.series, axisGroup: target.axisGroup });
          target.axisGroup = "Secondary";
          break;
        }
        case "series_type": {
          const target = series();
          target.load("chartType");
          await context.sync();
          record({
            seriesTypeSeries: args.series,
            seriesType: target.chartType,
          });
          target.chartType = CHART_TYPES[args.value];
          break;
        }
        case "delete":
          chart.delete();
          break;
      }
      await context.sync();
      return { done: args.action };
    }

    case "comment": {
      const address = `${quote(sheetName!)}!${args.cell}`;
      if (args.action === "add") {
        const comment = workbook.comments.add(address, args.text);
        comment.load("id");
        await context.sync();
        run.journal.push({
          type: "inverse",
          tool,
          data: { deleteComment: String(comment.id) },
        });
      } else if (args.action === "note") {
        const note = sheet.notes.add(args.cell, args.text);
        await context.sync();
        run.journal.push({
          type: "inverse",
          tool,
          data: { deleteNote: { sheet: sheetName, cell: args.cell } },
        });
        void note;
      } else {
        const comment = workbook.comments.getItemByCell(address);
        comment.load(["id", "resolved"]);
        await context.sync();
        if (args.action === "reply") {
          const reply = comment.replies.add(args.text);
          reply.load("id");
          await context.sync();
          run.journal.push({
            type: "inverse",
            tool,
            data: {
              deleteReply: {
                comment: String(comment.id),
                reply: String(reply.id),
              },
            },
          });
        } else {
          run.journal.push({
            type: "inverse",
            tool,
            data: {
              resolve: {
                comment: String(comment.id),
                resolved: comment.resolved,
              },
            },
          });
          comment.resolved = args.action === "resolve";
        }
      }
      await context.sync();
      return { done: args.action };
    }

    case "page_setup": {
      const layout = sheet.pageLayout;
      layout.load([
        "orientation",
        "zoom",
        "printGridlines",
        "leftMargin",
        "rightMargin",
        "topMargin",
        "bottomMargin",
      ]);
      const area = layout.getPrintAreaOrNullObject();
      area.load(["isNullObject", "address"]);
      const titles = layout.getPrintTitleRowsOrNullObject();
      titles.load(["isNullObject", "address"]);
      const header = layout.headersFooters.defaultForAllPages;
      header.load(["centerHeader", "centerFooter"]);
      await context.sync();
      inverse({
        sheetId: await sheetId(),
        orientation: layout.orientation,
        zoom: layout.zoom,
        printGridlines: layout.printGridlines,
        margins: [
          layout.leftMargin,
          layout.rightMargin,
          layout.topMargin,
          layout.bottomMargin,
        ],
        printArea: area.isNullObject
          ? null
          : String(area.address).split("!").pop(),
        titles: titles.isNullObject
          ? null
          : String(titles.address).split("!").pop(),
        centerHeader: header.centerHeader,
        centerFooter: header.centerFooter,
      });
      if (args.orientation) layout.orientation = title(args.orientation);
      if (args.fit_width !== undefined || args.fit_height !== undefined)
        layout.zoom = {
          horizontalFitToPages: args.fit_width ?? 1,
          verticalFitToPages: args.fit_height ?? 0,
        };
      if (args.print_area) layout.setPrintArea(args.print_area);
      if (args.print_title_rows)
        layout.setPrintTitleRows(
          `$${args.print_title_rows.replace(":", ":$")}`,
        );
      if (args.margins) {
        const [side, edge] = {
          narrow: [18, 54],
          normal: [50.4, 54],
          wide: [72, 72],
        }[args.margins as "normal"];
        layout.leftMargin = side;
        layout.rightMargin = side;
        layout.topMargin = edge;
        layout.bottomMargin = edge;
      }
      if (args.center_header !== undefined)
        header.centerHeader = args.center_header;
      if (args.center_footer !== undefined)
        header.centerFooter = args.center_footer;
      if (args.gridlines !== undefined) layout.printGridlines = args.gridlines;
      await context.sync();
      return { done: true };
    }

    case "workbook_action": {
      const application = workbook.application;
      application.load("calculationMode");
      await context.sync();
      if (args.action === "recalculate") application.calculate("Full");
      else {
        run.journal.push({
          type: "inverse",
          tool,
          data: { calculationMode: application.calculationMode },
        });
        application.calculationMode =
          args.action === "calculation_manual" ? "Manual" : "Automatic";
      }
      await context.sync();
      return { done: args.action };
    }

    case "protect_sheet": {
      const id = await sheetId();
      if (args.action === "protect" || args.action === "unprotect") {
        sheet.protection.load("protected");
        await context.sync();
        inverse({ sheetId: id, protected: sheet.protection.protected });
        if (args.action === "protect") sheet.protection.protect();
        else sheet.protection.unprotect();
      } else {
        const range = sheet.getRange(args.address);
        range.format.protection.load("locked");
        await context.sync();
        inverse({
          sheetId: id,
          address: args.address,
          locked: range.format.protection.locked,
        });
        range.format.protection.locked = args.action === "lock_cells";
      }
      await context.sync();
      return { done: args.action };
    }

    case "find_replace": {
      if (!ours) await run.backup(sheetName!);
      if (!args.address) {
        const count = sheet.replaceAll(args.find, args.replace, {
          completeMatch: args.whole_cell,
          matchCase: args.match_case,
        });
        await context.sync();
        return { replaced: count.value };
      }
      // Inside a range: constants only (formulas are kept), in chunks, at most 2,000,000 cells.
      const range = sheet.getRange(args.address);
      range.load(["rowCount", "columnCount"]);
      await context.sync();
      const rows = Number(range.rowCount);
      const width = Number(range.columnCount);
      if (rows * width > 2_000_000)
        throw new Error(
          "a range replace is limited to 2,000,000 cells; leave out address to replace on the whole sheet",
        );
      let replaced = 0;
      const flags = args.match_case ? "g" : "gi";
      const pattern = new RegExp(
        String(args.find).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
        flags,
      );
      const chunk = Math.max(1, Math.floor(20_000 / width));
      for (let start = 0; start < rows; start += chunk) {
        const part = range
          .getCell(start, 0)
          .getResizedRange(Math.min(chunk, rows - start) - 1, width - 1);
        part.load("formulas");
        await context.sync();
        let touched = false;
        const next = (part.formulas as any[][]).map((row) =>
          row.map((cell) => {
            if (typeof cell !== "string" || cell.startsWith("=")) return cell;
            if (args.whole_cell) {
              if (
                args.match_case
                  ? cell === args.find
                  : cell.toLowerCase() === String(args.find).toLowerCase()
              ) {
                replaced += 1;
                touched = true;
                return args.replace;
              }
              return cell;
            }
            const out = cell.replace(pattern, () => {
              replaced += 1;
              touched = true;
              return args.replace;
            });
            return out;
          }),
        );
        if (touched) {
          part.formulas = next;
          await context.sync();
        }
      }
      return { replaced };
    }

    case "clean_in_place": {
      if (!ours) await run.backup(sheetName!);
      const range = sheet.getRange(args.address);
      range.load(["rowCount", "columnCount", "rowIndex", "columnIndex"]);
      await context.sync();
      const rows = Number(range.rowCount);
      const columns = Number(range.columnCount);
      if (rows * columns > 2_000_000)
        throw new Error(
          "clean_in_place is limited to 2,000,000 cells; clean one column at a time",
        );
      let changed = 0;
      const dates: [number, number][] = [];
      // Chunks keep each Excel call small on 500k rows.
      const chunk = Math.max(1, Math.floor(20_000 / columns));
      for (let start = 0; start < rows; start += chunk) {
        const part = range
          .getCell(start, 0)
          .getResizedRange(Math.min(chunk, rows - start) - 1, columns - 1);
        part.load("formulas");
        await context.sync();
        let touched = false;
        const next = (part.formulas as unknown[][]).map((row, r) =>
          row.map((cell, c) => {
            const out = cleanValue(cell, args.op);
            if (out !== cell) {
              touched = true;
              changed += 1;
              if (args.op === "to_date") dates.push([start + r, c]);
            }
            return out;
          }),
        );
        if (touched) {
          part.formulas = next;
          await context.sync();
        }
      }
      if (dates.length && args.op === "to_date") {
        // Dates need a date format to show as dates; set it on the cleaned columns.
        const cols = new Set(dates.map(([, c]) => c));
        for (const c of cols)
          (range.getColumn(c) as { numberFormat: unknown }).numberFormat =
            "yyyy-mm-dd";
        await context.sync();
      }
      return { changed };
    }

    case "goal_seek": {
      const changing = sheet.getRange(args.changing_cell);
      const result = sheet.getRange(args.formula_cell);
      changing.load(["formulas", "values"]);
      result.load("formulas");
      await context.sync();
      if (!String(result.formulas[0][0]).startsWith("="))
        throw new Error(`${args.formula_cell} holds no formula`);
      run.journal.push({
        type: "inverse",
        tool,
        data: {
          sheetId: await sheetId(),
          cell: args.changing_cell,
          formulas: changing.formulas,
        },
      });
      const evaluate = async (x: number) => {
        changing.values = [[x]];
        result.load("values");
        await context.sync();
        return Number(result.values[0][0]) - args.target;
      };
      // Secant search, then bisection fallback when it does not converge.
      let x0 = Number(changing.values[0][0]) || 0;
      let x1 = x0 === 0 ? 1 : x0 * 1.1;
      let f0 = await evaluate(x0);
      let f1 = await evaluate(x1);
      for (
        let step = 0;
        step < 60 && Math.abs(f1) > 1e-9 * Math.max(1, Math.abs(args.target));
        step += 1
      ) {
        if (f1 === f0) break;
        const x2 = x1 - (f1 * (x1 - x0)) / (f1 - f0);
        if (!Number.isFinite(x2)) break;
        x0 = x1;
        f0 = f1;
        x1 = x2;
        f1 = await evaluate(x1);
      }
      if (
        !Number.isFinite(f1) ||
        Math.abs(f1) > 1e-6 * Math.max(1, Math.abs(args.target))
      ) {
        await evaluate(Number(changing.values[0][0]) || 0);
        throw new Error("no value of the changing cell reaches the target");
      }
      return { value: x1, reached: args.target };
    }
  }
  throw new Error(`unknown action ${tool}`);
}

/** Cells per copy request when a backup is put back: one request for millions of cells times out. */
const RESTORE_CELLS = 100_000;
const RESTORE_CELLS_MAX = 1_000_000;
const RESTORE_CELLS_MIN = 20_000;

/**
 * Puts a backup copy of a sheet (or of one range of it) back, in parts. Nothing is cleared up front:
 * every part is overwritten from the backup, so a failure half way leaves the data in place (the
 * backup sheet is kept) instead of an empty sheet. Cells the agent added outside the backup's
 * range are cleared at the end.
 */
export async function restoreFromBackup(
  context: any,
  sheet: any,
  backup: any,
  address?: string,
): Promise<void> {
  const source = address
    ? backup.getRange(address)
    : backup.getUsedRangeOrNullObject();
  const current = sheet.getUsedRangeOrNullObject();
  source.load(
    address
      ? ["rowIndex", "columnIndex", "rowCount", "columnCount"]
      : ["isNullObject", "rowIndex", "columnIndex", "rowCount", "columnCount"],
  );
  current.load([
    "isNullObject",
    "rowIndex",
    "columnIndex",
    "rowCount",
    "columnCount",
  ]);
  await context.sync();
  if (!address && source.isNullObject) {
    if (!current.isNullObject) current.clear("All");
    await context.sync();
    return;
  }
  const row0 = Number(source.rowIndex);
  const col0 = Number(source.columnIndex);
  const rows = Number(source.rowCount);
  const columns = Number(source.columnCount);
  // The part size adapts: a part that finishes quickly doubles it, a slow one halves it.
  let cells = RESTORE_CELLS;
  for (let start = 0; start < rows; ) {
    const count = Math.min(
      Math.max(1, Math.floor(cells / columns)),
      rows - start,
    );
    const began = Date.now();
    sheet
      .getRangeByIndexes(row0 + start, col0, count, columns)
      .copyFrom(
        backup.getRangeByIndexes(row0 + start, col0, count, columns),
        "All",
      );
    await context.sync();
    start += count;
    const took = Date.now() - began;
    if (took < 4_000) cells = Math.min(RESTORE_CELLS_MAX, cells * 2);
    else if (took > 20_000)
      cells = Math.max(RESTORE_CELLS_MIN, Math.floor(cells / 2));
  }
  if (!address && !current.isNullObject) {
    // Rows and columns the agent added after the backup was made.
    const endRow = Number(current.rowIndex) + Number(current.rowCount);
    const endColumn = Number(current.columnIndex) + Number(current.columnCount);
    if (endRow > row0 + rows) {
      sheet
        .getRangeByIndexes(
          row0 + rows,
          Number(current.columnIndex),
          endRow - row0 - rows,
          Number(current.columnCount),
        )
        .clear("All");
    }
    if (endColumn > col0 + columns) {
      sheet
        .getRangeByIndexes(
          Number(current.rowIndex),
          col0 + columns,
          Number(current.rowCount),
          endColumn - col0 - columns,
        )
        .clear("All");
    }
    await context.sync();
  }
}

/** Undoes one journal entry (newest first). Entries for objects already gone are skipped. */
export async function undoJournalEntry(
  context: any,
  entry: JournalEntry,
): Promise<void> {
  const workbook = context.workbook;
  const sheets = workbook.worksheets;
  const byId = async (id: string) => {
    const sheet = sheets.getItemOrNullObject(id);
    sheet.load("isNullObject");
    await context.sync();
    return sheet.isNullObject ? undefined : sheet;
  };
  if (entry.type === "backup") {
    const sheet = await byId(entry.sheetId);
    const backup = await byId(entry.backupId);
    if (!sheet || !backup) return;
    await restoreFromBackup(context, sheet, backup);
    // Only after every part is back: the backup is no longer needed.
    backup.delete();
    await context.sync();
    return;
  }
  const data = entry.data;
  const sheet = data.sheetId ? await byId(data.sheetId) : undefined;
  switch (entry.tool) {
    case "edit_rows_columns":
      if (!sheet) return;
      if (data.hidden !== undefined) {
        const range = sheet.getRange(data.address);
        if (data.rows) range.getEntireRow().rowHidden = data.hidden;
        else range.getEntireColumn().columnHidden = data.hidden;
      }
      if (data.ungroup) {
        const range = sheet.getRange(data.address);
        (data.ungroup === "ByRows"
          ? range.getEntireRow()
          : range.getEntireColumn()
        ).ungroup(data.ungroup);
      }
      if (data.group) {
        const range = sheet.getRange(data.address);
        (data.group === "ByRows"
          ? range.getEntireRow()
          : range.getEntireColumn()
        ).group(data.group);
      }
      for (const size of data.sizes ?? []) {
        if (size.value === null || size.value === undefined) continue;
        const part = sheet.getRange(size.address);
        if (data.widths) part.format.columnWidth = size.value;
        else part.format.rowHeight = size.value;
      }
      break;
    case "filter_range": {
      if (data.table) {
        const table = workbook.tables.getItemOrNullObject(data.table);
        table.load("isNullObject");
        await context.sync();
        if (!table.isNullObject) {
          table.autoFilter.clearCriteria();
          table.showFilterButton = true;
        }
        break;
      }
      if (!sheet) return;
      sheet.autoFilter.remove();
      await context.sync();
      if (data.had && data.address) {
        const range = sheet.getRange(data.address);
        sheet.autoFilter.apply(range);
        (data.criteria ?? []).forEach((criteria: any, index: number) => {
          if (criteria && criteria.filterOn)
            sheet.autoFilter.apply(range, index, criteria);
        });
      }
      break;
    }
    case "sheet_action": {
      if (data.deleteId) {
        const copy = await byId(data.deleteId);
        copy?.delete();
        break;
      }
      if (data.restoreId) {
        const copy = await byId(data.restoreId);
        if (!copy) return;
        copy.name = data.name;
        copy.visibility = "Visible";
        copy.position = data.position;
        copy.customProperties.getItemOrNullObject("vynorai-backup").delete();
        break;
      }
      if (!sheet) return;
      if (data.name !== undefined) sheet.name = data.name;
      if (data.visibility !== undefined) sheet.visibility = data.visibility;
      if (data.position !== undefined) sheet.position = data.position;
      if (data.tabColor !== undefined) sheet.tabColor = data.tabColor || "";
      if (data.showGridlines !== undefined)
        sheet.showGridlines = data.showGridlines;
      if (data.freeze !== undefined) {
        sheet.freezePanes.unfreeze();
        if (data.freeze)
          sheet.freezePanes.freezeAt(sheet.getRange(data.freeze));
      }
      break;
    }
    case "conditional_format":
      if (!sheet) return;
      try {
        sheet
          .getRange(data.address)
          .conditionalFormats.getItem(data.id)
          .delete();
        await context.sync();
      } catch {
        // Already removed.
      }
      return;
    case "data_validation": {
      if (!sheet) return;
      const validation = sheet.getRange(data.address).dataValidation;
      validation.clear();
      if (data.previous) {
        validation.rule = data.previous.rule;
        if (data.previous.prompt) validation.prompt = data.previous.prompt;
        if (data.previous.errorAlert)
          validation.errorAlert = data.previous.errorAlert;
      }
      break;
    }
    case "table_action": {
      const tables = workbook.tables;
      if (data.unmake) {
        const table = tables.getItemOrNullObject(data.unmake);
        table.load("isNullObject");
        await context.sync();
        if (table.isNullObject) return;
        try {
          table.style = null;
          await context.sync();
        } catch {
          // Some hosts refuse an empty style; the range conversion still runs.
        }
        table.convertToRange();
        break;
      }
      if (data.remake) {
        const table = tables.add(
          `${quote(data.remake.sheet)}!${data.remake.address}`,
          true,
        );
        table.name = data.remake.name;
        if (data.remake.style) table.style = data.remake.style;
        break;
      }
      const table = tables.getItemOrNullObject(data.name);
      table.load("isNullObject");
      await context.sync();
      if (table.isNullObject) return;
      if (data.rename) table.name = data.rename;
      if (data.style !== undefined) table.style = data.style;
      if (data.showTotals !== undefined) table.showTotals = data.showTotals;
      if (data.resize) table.resize(data.resize);
      if (data.deleteColumn) table.columns.getItem(data.deleteColumn).delete();
      if (data.clearColumn)
        table.columns.getItem(data.clearColumn).filter.clear();
      break;
    }
    case "named_range": {
      const names = workbook.names;
      if (data.remove) {
        const item = names.getItemOrNullObject(data.remove);
        item.load("isNullObject");
        await context.sync();
        if (!item.isNullObject) item.delete();
      }
      if (data.readd)
        names.add(
          data.readd.name,
          data.readd.formula,
          data.readd.comment || undefined,
        );
      break;
    }
    case "pivot_action": {
      const pivot = workbook.pivotTables.getItemOrNullObject(data.pivot);
      pivot.load("isNullObject");
      await context.sync();
      if (pivot.isNullObject) return;
      if (data.removeFrom)
        pivot[data.removeFrom].remove(
          pivot[data.removeFrom].getItem(data.name),
        );
      if (data.addTo)
        pivot[data.addTo].add(pivot.hierarchies.getItem(data.name));
      if (data.data) {
        const field = pivot.dataHierarchies.getItem(data.data);
        field.summarizeBy = data.summarizeBy;
        if (data.showAs)
          field.showAs = { calculation: data.showAs.calculation ?? "None" };
        if (data.numberFormat !== undefined)
          field.numberFormat = data.numberFormat;
      }
      if (data.layout) {
        pivot.layout.layoutType = data.layout.layoutType;
        pivot.layout.showRowGrandTotals = data.layout.showRowGrandTotals;
        pivot.layout.showColumnGrandTotals = data.layout.showColumnGrandTotals;
      }
      if (data.subtotalsField)
        pivot.rowHierarchies
          .getItem(data.subtotalsField)
          .fields.getItem(data.subtotalsField).subtotals = data.subtotals;
      break;
    }
    case "chart_action": {
      if (!sheet) return;
      const chart = sheet.charts.getItemOrNullObject(data.chart);
      chart.load("isNullObject");
      await context.sync();
      if (chart.isNullObject) return;
      if (data.title) {
        chart.title.text = data.title.text ?? "";
        chart.title.visible = data.title.visible;
      }
      if (data.axisTitles) {
        chart.axes.categoryAxis.title.text = data.axisTitles.category ?? "";
        chart.axes.valueAxis.title.text = data.axisTitles.value ?? "";
      }
      if (data.showValue !== undefined)
        chart.dataLabels.showValue = data.showValue;
      if (data.legend) {
        chart.legend.visible = data.legend.visible;
        if (data.legend.position) chart.legend.position = data.legend.position;
      }
      if (data.clearSeriesFill !== undefined)
        chart.series.getItemAt(data.clearSeriesFill).format.fill.clear();
      if (data.chartType) chart.chartType = data.chartType;
      if (data.box) {
        chart.top = data.box.top;
        chart.left = data.box.left;
        chart.width = data.box.width;
        chart.height = data.box.height;
      }
      if (data.trendlineSeries !== undefined)
        chart.series
          .getItemAt(data.trendlineSeries)
          .trendlines.getItem(data.trendlineIndex)
          .delete();
      if (data.axisGroupSeries !== undefined)
        chart.series.getItemAt(data.axisGroupSeries).axisGroup = data.axisGroup;
      if (data.seriesTypeSeries !== undefined)
        chart.series.getItemAt(data.seriesTypeSeries).chartType =
          data.seriesType;
      break;
    }
    case "comment":
      try {
        if (data.deleteComment)
          workbook.comments.getItem(data.deleteComment).delete();
        if (data.deleteReply)
          workbook.comments
            .getItem(data.deleteReply.comment)
            .replies.getItem(data.deleteReply.reply)
            .delete();
        if (data.resolve)
          workbook.comments.getItem(data.resolve.comment).resolved =
            data.resolve.resolved;
        if (data.deleteNote)
          sheets
            .getItem(data.deleteNote.sheet)
            .notes.getItem(data.deleteNote.cell)
            .delete();
        await context.sync();
      } catch {
        // The comment or note was already removed.
      }
      return;
    case "page_setup": {
      if (!sheet) return;
      const layout = sheet.pageLayout;
      layout.orientation = data.orientation;
      layout.zoom = data.zoom;
      layout.printGridlines = data.printGridlines;
      [
        layout.leftMargin,
        layout.rightMargin,
        layout.topMargin,
        layout.bottomMargin,
      ] = data.margins;
      if (data.printArea) layout.setPrintArea(data.printArea);
      if (data.titles) layout.setPrintTitleRows(data.titles);
      layout.headersFooters.defaultForAllPages.centerHeader =
        data.centerHeader ?? "";
      layout.headersFooters.defaultForAllPages.centerFooter =
        data.centerFooter ?? "";
      break;
    }
    case "workbook_action":
      workbook.application.calculationMode = data.calculationMode;
      break;
    case "protect_sheet":
      if (!sheet) return;
      if (data.protected !== undefined) {
        if (data.protected) sheet.protection.protect();
        else sheet.protection.unprotect();
      }
      if (data.locked !== undefined && data.locked !== null)
        sheet.getRange(data.address).format.protection.locked = data.locked;
      break;
    case "goal_seek":
      if (!sheet) return;
      sheet.getRange(data.cell).formulas = data.formulas;
      break;
  }
  await context.sync();
}

/** Read-only details the agent can ask for with get_details. */
export async function readDetails(
  context: any,
  what: string,
  sheetName?: string,
  address?: string,
): Promise<unknown> {
  const workbook = context.workbook;
  const sheets = workbook.worksheets;
  const sheet = sheetName
    ? sheets.getItem(sheetName)
    : sheets.getActiveWorksheet();
  const strip = (value: unknown) =>
    String(value ?? "")
      .split("!")
      .pop();
  switch (what) {
    case "names": {
      const names = workbook.names;
      names.load("items/name,items/formula,items/comment,items/visible");
      await context.sync();
      return names.items.slice(0, 100).map((item: any) => ({
        name: item.name,
        refersTo: item.formula,
        comment: item.comment || undefined,
      }));
    }
    case "tables": {
      const tables = workbook.tables;
      tables.load("items/name,items/style,items/showTotals");
      await context.sync();
      const ranges = tables.items.map((table: any) => {
        const range = table.getRange();
        range.load(["address", "rowCount"]);
        const header = table.getHeaderRowRange();
        header.load("values");
        return { table, range, header };
      });
      await context.sync();
      return ranges.slice(0, 50).map(({ table, range, header }: any) => ({
        name: table.name,
        address: range.address,
        rows: Number(range.rowCount) - 1,
        columns: header.values[0],
        style: table.style,
        totalRow: table.showTotals,
      }));
    }
    case "charts":
    case "pivots": {
      sheets.load("items/name");
      await context.sync();
      const found: any[] = [];
      for (const item of sheets.items) {
        const collection = what === "charts" ? item.charts : item.pivotTables;
        collection.load(
          what === "charts" ? "items/name,items/chartType" : "items/name",
        );
        found.push({ sheet: item.name, collection });
      }
      await context.sync();
      if (what === "charts")
        return found
          .flatMap(({ sheet: name, collection }) =>
            collection.items.map((chart: any) => ({
              sheet: name,
              chart: chart.name,
              type: chart.chartType,
            })),
          )
          .slice(0, 100);
      const pivots = found.flatMap(({ sheet: name, collection }) =>
        collection.items.map((pivot: any) => ({ sheet: name, pivot })),
      );
      for (const entry of pivots) {
        for (const kind of [
          "rowHierarchies",
          "columnHierarchies",
          "dataHierarchies",
          "filterHierarchies",
        ])
          entry.pivot[kind].load("items/name");
      }
      await context.sync();
      return pivots.slice(0, 50).map(({ sheet: name, pivot }) => ({
        sheet: name,
        pivot: pivot.name,
        rows: pivot.rowHierarchies.items.map((h: any) => h.name),
        columns: pivot.columnHierarchies.items.map((h: any) => h.name),
        values: pivot.dataHierarchies.items.map((h: any) => h.name),
        filters: pivot.filterHierarchies.items.map((h: any) => h.name),
      }));
    }
    case "hidden": {
      sheets.load("items/name,items/visibility");
      await context.sync();
      const hiddenSheets = sheets.items
        .filter(
          (item: any) =>
            item.visibility !== "Visible" && !/^VynorAI_/.test(item.name),
        )
        .map((item: any) => item.name);
      const used = sheet.getUsedRangeOrNullObject();
      used.load(["isNullObject", "rowCount", "columnCount", "rowIndex"]);
      await context.sync();
      if (used.isNullObject) return { hiddenSheets };
      // Hidden rows by halving: a block that is all shown or all hidden needs no more checks.
      const hiddenRows: string[] = [];
      let probes = 0;
      const scan = async (start: number, count: number): Promise<void> => {
        if (hiddenRows.length >= 30 || probes >= 200 || count < 1) return;
        probes += 1;
        const block = used
          .getRow(start)
          .getResizedRange(count - 1, 0)
          .getEntireRow();
        block.load("rowHidden");
        await context.sync();
        if (block.rowHidden === false) return;
        const first = Number(used.rowIndex) + start + 1;
        if (block.rowHidden === true) {
          hiddenRows.push(
            count === 1 ? String(first) : `${first}:${first + count - 1}`,
          );
          return;
        }
        const half = Math.floor(count / 2);
        await scan(start, half);
        await scan(start + half, count - half);
      };
      await scan(0, Number(used.rowCount));
      const columns = Array.from(
        { length: Math.min(Number(used.columnCount), 100) },
        (_, index) => {
          const column = used.getColumn(index);
          column.load(["columnHidden", "address"]);
          return column;
        },
      );
      await context.sync();
      return {
        hiddenSheets,
        hiddenColumns: columns
          .filter((column: any) => column.columnHidden)
          .map((column: any) => strip(column.address)),
        hiddenRows,
        ...(hiddenRows.length >= 30 || probes >= 200
          ? { note: "More hidden rows exist than are listed." }
          : {}),
      };
    }
    case "formula_check": {
      // Errors, possible circular references and formulas that differ from their neighbours.
      const range = address
        ? sheet.getRange(address)
        : sheet.getUsedRange(true);
      range.load(["address", "cellCount"]);
      await context.sync();
      if (Number(range.cellCount) > 20_000)
        throw new Error(
          "formula_check reads at most 20,000 cells; give a smaller address",
        );
      range.load(["formulas", "values"]);
      sheet.load("name");
      await context.sync();
      const report = inspectFormulas({
        worksheetName: String(sheet.name),
        address: strip(range.address)!,
        formulas: range.formulas,
        values: range.values,
      });
      return {
        formulas: report.formulaCellCount,
        errors: report.errorCellCount,
        possibleCircular: report.possibleCircularReferenceCount,
        inconsistent: report.inconsistentFormulaCount,
        hardCoded: report.hardCodedCellCount,
        cells: report.items
          .filter(
            (item) =>
              item.errors.length ||
              item.possibleCircularReference ||
              item.inconsistentFormula,
          )
          .slice(0, 30)
          .map((item) => ({
            cell: item.address,
            formula: item.formula,
            errors: item.errors,
            circular: item.possibleCircularReference || undefined,
            inconsistent: item.inconsistentFormula || undefined,
          })),
      };
    }
    case "merged": {
      const range = address
        ? sheet.getRange(address)
        : sheet.getUsedRange(true);
      const merged = range.getMergedAreasOrNullObject();
      merged.load(["isNullObject", "address", "areaCount"]);
      await context.sync();
      return merged.isNullObject
        ? []
        : {
            areas: Number(merged.areaCount),
            address: String(merged.address).slice(0, 2000),
          };
    }
    case "comments": {
      const comments = workbook.comments;
      comments.load("items/id,items/content,items/resolved,items/authorName");
      await context.sync();
      const located = comments.items.slice(0, 50).map((comment: any) => {
        const cell = comment.getLocation();
        cell.load("address");
        return { comment, cell };
      });
      await context.sync();
      return located.map(({ comment, cell }: any) => ({
        cell: cell.address,
        text: comment.content,
        resolved: comment.resolved,
      }));
    }
    case "conditional_formats": {
      const range = address
        ? sheet.getRange(address)
        : sheet.getUsedRange(true);
      const formats = range.conditionalFormats;
      formats.load("items/type,items/id");
      await context.sync();
      const ranges = formats.items.slice(0, 50).map((format: any) => {
        const target = format.getRange();
        target.load("address");
        return { format, target };
      });
      await context.sync();
      return ranges.map(({ format, target }: any) => ({
        type: format.type,
        address: strip(target.address),
      }));
    }
    case "validation": {
      const range = sheet.getRange(address ?? "A1");
      range.dataValidation.load(["type", "rule"]);
      await context.sync();
      return {
        type: range.dataValidation.type,
        rule: range.dataValidation.rule,
      };
    }
    case "freeze": {
      const location = sheet.freezePanes.getLocationOrNullObject();
      location.load(["isNullObject", "address"]);
      await context.sync();
      return { frozen: location.isNullObject ? null : strip(location.address) };
    }
    case "autofilter": {
      const filter = sheet.autoFilter;
      filter.load(["enabled", "isDataFiltered", "criteria"]);
      const range = filter.getRangeOrNullObject();
      range.load(["isNullObject", "address"]);
      await context.sync();
      return {
        enabled: filter.enabled,
        filtered: filter.isDataFiltered,
        range: range.isNullObject ? null : strip(range.address),
        criteria: filter.criteria,
      };
    }
    case "precedents":
    case "dependents": {
      if (!address)
        throw new Error("precedents and dependents need address (one cell)");
      const cell = sheet.getRange(address);
      const linked =
        what === "precedents"
          ? cell.getDirectPrecedents()
          : cell.getDirectDependents();
      linked.load("addresses");
      await context.sync();
      return { [what]: (linked.addresses as string[]).slice(0, 100) };
    }
    case "protection": {
      sheet.protection.load("protected");
      await context.sync();
      return { protected: sheet.protection.protected };
    }
    case "page_setup": {
      const layout = sheet.pageLayout;
      layout.load(["orientation", "zoom", "printGridlines"]);
      const area = layout.getPrintAreaOrNullObject();
      area.load(["isNullObject", "address"]);
      await context.sync();
      return {
        orientation: layout.orientation,
        zoom: layout.zoom,
        printGridlines: layout.printGridlines,
        printArea: area.isNullObject ? null : strip(area.address),
      };
    }
  }
  throw new Error(`unknown detail ${what}`);
}

export { parseA1 };

/**
 * One cell of clean_in_place. Formulas are never touched. A text such as 0112005016 is an
 * identifier, so to_number leaves it as text.
 */
export function cleanValue(cell: unknown, op: string): unknown {
  if (typeof cell !== "string" || cell.startsWith("=")) return cell;
  switch (op) {
    case "trim":
      return cell.replace(/ +/g, " ").trim();
    case "clean":
      return cell
        .replace(/[\u0000-\u001f\u007f]/g, "")
        .replace(/\u00a0/g, " ")
        .replace(/ +/g, " ")
        .trim();
    case "upper":
      return cell.toLocaleUpperCase();
    case "lower":
      return cell.toLocaleLowerCase();
    case "proper":
      return cell
        .toLocaleLowerCase()
        .replace(
          /(^|[^\p{L}])(\p{L})/gu,
          (_m, p: string, c: string) => p + c.toLocaleUpperCase(),
        );
    case "to_number": {
      const text = cell.trim().replace(/,/g, "");
      if (!/^-?\d+(?:\.\d+)?$/.test(text) || /^-?0\d/.test(text)) return cell;
      return Number(text);
    }
    case "to_date": {
      const text = cell.trim();
      let match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
      let year: number, month: number, day: number;
      if (match)
        [year, month, day] = [
          Number(match[1]),
          Number(match[2]),
          Number(match[3]),
        ];
      else {
        match = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(text);
        if (!match) return cell;
        // d/m/y, the usual order in the product's markets.
        [day, month, year] = [
          Number(match[1]),
          Number(match[2]),
          Number(match[3]),
        ];
        if (year < 100) year += 2000;
      }
      if (month < 1 || month > 12 || day < 1 || day > 31) return cell;
      const time = Date.UTC(year, month - 1, day);
      if (new Date(time).getUTCDate() !== day) return cell;
      return Math.round(time / 86_400_000) + 25569;
    }
  }
  return cell;
}

/** AutoFilter criteria for one delete_rows_where condition. */
export function conditionCriteria(condition: {
  operator: string;
  value?: unknown;
}): {
  criterion1: string;
} {
  const value = String(condition.value ?? "");
  switch (condition.operator) {
    case "=":
      return { criterion1: `=${value}` };
    case "!=":
      return { criterion1: `<>${value}` };
    case "contains":
      return { criterion1: `=*${value}*` };
    case "not_contains":
      return { criterion1: `<>*${value}*` };
    case "blank":
      return { criterion1: "=" };
    case "not_blank":
      return { criterion1: "<>" };
    default:
      return { criterion1: `${condition.operator}${value}` };
  }
}

/** Splits conditions into passes: "any" is one pass per condition, "all" is one pass (at most two per column). */
export function deletePasses(
  conditions: { column: string; operator: string; value?: unknown }[],
  match: unknown,
): { column: string; operator: string; value?: unknown }[][] | undefined {
  if (match === "any") return conditions.map((condition) => [condition]);
  const perColumn = new Map<string, number>();
  for (const condition of conditions) {
    const key = condition.column.trim().toLowerCase();
    perColumn.set(key, (perColumn.get(key) ?? 0) + 1);
  }
  // A filter column carries two criteria at most: more than that uses the formula route.
  return [...perColumn.values()].every((count) => count <= 2)
    ? [conditions]
    : undefined;
}

/**
 * Deletes the rows that match, the way a person does: AutoFilter the rows, delete the visible
 * ones, clear the filter. On 366k rows this takes seconds; a helper-column and sort route times out.
 */
async function deleteRowsWhere(
  context: any,
  sheet: any,
  args: any,
): Promise<unknown> {
  const passes = deletePasses(args.conditions, args.match);
  if (!passes) return deleteRowsByFormula(context, sheet, args);
  const range = sheet.getRange(args.address);
  range.load(["rowCount", "columnCount"]);
  const header = range.getRow(0);
  header.load("values");
  const tables = sheet.tables;
  tables.load("items/name");
  await context.sync();
  const names = (header.values[0] as unknown[]).map((value) =>
    String(value).trim().toLowerCase(),
  );
  const overlaps = tables.items.map((table: any) => {
    const tableRange = table.getRange();
    const shared = range.getIntersectionOrNullObject(tableRange);
    shared.load("isNullObject");
    return { table, tableRange, shared };
  });
  await context.sync();
  const hit = overlaps.find((item: any) => !item.shared.isNullObject);
  const filter = hit ? hit.table.autoFilter : sheet.autoFilter;
  const filterRange = hit ? hit.tableRange : range;
  // Filter columns count from the first column of the filtered range (a Table can start elsewhere).
  const filterHeader = filterRange.getRow(0);
  filterHeader.load("values");
  await context.sync();
  const filterNames = (filterHeader.values[0] as unknown[]).map((value) =>
    String(value).trim().toLowerCase(),
  );
  const body = range.getOffsetRange(1, 0).getResizedRange(-1, 0);
  const index = (column: string) => {
    const at = filterNames.indexOf(column.trim().toLowerCase());
    if (at < 0) throw new Error(`"${column}" is not a header of the range`);
    return at;
  };
  void names;
  let deleted = 0;
  for (const pass of passes) {
    filter.clearCriteria();
    await context.sync();
    const byColumn = new Map<number, { criterion1: string }[]>();
    for (const condition of pass) {
      const at = index(condition.column);
      byColumn.set(at, [
        ...(byColumn.get(at) ?? []),
        conditionCriteria(condition),
      ]);
    }
    for (const [at, list] of byColumn) {
      filter.apply(
        filterRange,
        // A table's filter columns count from the table, a sheet filter's from the range.
        at,
        list.length === 1
          ? { filterOn: "Custom", criterion1: list[0].criterion1 }
          : {
              filterOn: "Custom",
              criterion1: list[0].criterion1,
              criterion2: list[1].criterion1,
              operator: "And",
            },
      );
    }
    await context.sync();
    const view = body.getVisibleView();
    view.load("rowCount");
    const visible = body.getSpecialCellsOrNullObject("Visible");
    visible.load("isNullObject");
    await context.sync();
    if (!visible.isNullObject) {
      deleted += Number(view.rowCount);
      visible.getEntireRow().delete("Up");
      await context.sync();
    }
    filter.clearCriteria();
    await context.sync();
  }
  return { deleted };
}

/** The slow route for conditions a filter cannot express: a flag column, a sort, a delete. */
async function deleteRowsByFormula(
  context: any,
  sheet: any,
  args: any,
): Promise<unknown> {
  const range = sheet.getRange(args.address);
  range.load(["rowIndex", "columnIndex", "rowCount", "columnCount"]);
  const header = range.getRow(0);
  header.load("values");
  const used = sheet.getUsedRange(true);
  used.load(["columnIndex", "columnCount"]);
  await context.sync();
  const rows = Number(range.rowCount) - 1;
  if (rows < 1) return { deleted: 0 };
  const names = (header.values[0] as unknown[]).map((value) =>
    String(value).trim().toLowerCase(),
  );
  const top = Number(range.rowIndex) + 2;
  const bottom = Number(range.rowIndex) + Number(range.rowCount);
  const test = rowTestFormula(
    names,
    args.conditions,
    args.match,
    Number(range.columnIndex),
    top,
    bottom,
  );
  // Two helper columns after everything on the sheet: delete flag and original order.
  const helper = Math.max(
    Number(used.columnIndex) + Number(used.columnCount),
    Number(range.columnIndex) + Number(range.columnCount),
  );
  const flags = sheet.getRangeByIndexes(top - 1, helper, rows, 1);
  const order = sheet.getRangeByIndexes(top - 1, helper + 1, rows, 1);
  flags.getCell(0, 0).formulas = [[`=IF(${test},1,0)`]];
  order.getCell(0, 0).formulas = [[`=SEQUENCE(${rows})`]];
  await context.sync();
  flags.copyFrom(flags, "Values");
  order.copyFrom(order, "Values");
  const count = sheet.getRangeByIndexes(top - 1, helper + 2, 1, 1);
  count.formulas = [
    [`=SUM(${columnLetter(helper)}${top}:${columnLetter(helper)}${bottom})`],
  ];
  count.load("values");
  await context.sync();
  const remove = Number(count.values[0][0]) || 0;
  count.clear("All");
  const width = helper + 2 - Number(range.columnIndex);
  const body = sheet.getRangeByIndexes(
    top - 1,
    Number(range.columnIndex),
    rows,
    width,
  );
  if (remove > 0) {
    // Rows to delete go to the bottom (original order kept), then that block is removed.
    body.sort.apply(
      [
        { key: width - 2, ascending: true },
        { key: width - 1, ascending: true },
      ],
      false,
      false,
    );
    await context.sync();
    sheet
      .getRangeByIndexes(
        top - 1 + rows - remove,
        Number(range.columnIndex),
        remove,
        width,
      )
      .delete("Up");
  }
  sheet.getRangeByIndexes(top - 1, helper, rows, 2).clear("All");
  await context.sync();
  return { deleted: remove, kept: rows - remove };
}

/** The AutoFilter criteria of a filter_range call. */
export function filterCriteria(args: any): any {
  return args.kind === "values"
    ? { filterOn: "Values", values: args.values }
    : args.kind === "custom"
      ? {
          filterOn: "Custom",
          criterion1: args.criterion1,
          ...(args.criterion2
            ? { criterion2: args.criterion2, operator: title(args.operator) }
            : {}),
        }
      : args.kind === "dynamic"
        ? { filterOn: "Dynamic", dynamicCriteria: title(args.dynamic) }
        : args.kind === "cell_color"
          ? { filterOn: "CellColor", color: args.color }
          : {
              filterOn: {
                top: "TopItems",
                bottom: "BottomItems",
                top_percent: "TopPercent",
                bottom_percent: "BottomPercent",
              }[args.kind as "top"],
              criterion1: String(args.count),
            };
}

/** The Excel test (an array of TRUE/1 per data row) for delete_rows_where; = and != compare as text. */
export function rowTestFormula(
  names: string[],
  conditions: { column: string; operator: string; value?: unknown }[],
  match: unknown,
  firstColumn: number,
  top: number,
  bottom: number,
): string {
  const range = { columnIndex: firstColumn };
  const args = { conditions, match };
  const ref = (column: string) => {
    const index = names.indexOf(column.trim().toLowerCase());
    if (index < 0) throw new Error(`"${column}" is not a header of the range`);
    const letter = columnLetter(Number(range.columnIndex) + index);
    return `$${letter}$${top}:$${letter}$${bottom}`;
  };
  const tests = (args.conditions as any[]).map((condition) => {
    const column = ref(condition.column);
    const value = condition.value;
    const number =
      typeof value === "number"
        ? String(value)
        : /^-?\d+(?:\.\d+)?$/.test(String(value))
          ? String(value)
          : undefined;
    switch (condition.operator) {
      case "=":
        return `(${column}&"")=${excelText(String(value))}`;
      case "!=":
        return `(${column}&"")<>${excelText(String(value))}`;
      case "contains":
        return `ISNUMBER(SEARCH(${excelText(String(value))},${column}))`;
      case "not_contains":
        return `NOT(ISNUMBER(SEARCH(${excelText(String(value))},${column})))`;
      case "blank":
        return `(${column}&"")=""`;
      case "not_blank":
        return `(${column}&"")<>""`;
      default:
        if (number === undefined)
          throw new Error(`${condition.operator} needs a number`);
        return `(${column}${condition.operator}${number})`;
    }
  });
  return args.match === "any"
    ? `((${tests.join(")+(")})>0)`
    : `(${tests.join(")*(")})`;
}
