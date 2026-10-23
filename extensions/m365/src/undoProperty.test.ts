/**
 * Randomized end-to-end test of apply + undo against an in-memory Excel runtime.
 *
 * The fake models what undo has to put back: the sheet list (names, order, visibility, tab color),
 * every cell's content and format, shared cell borders, column widths, hidden rows and charts. Each
 * case builds a random workbook, applies a random sequence of changes (one apply, two merged
 * applies, a failure at a random operation, Stop at a random change), undoes it and compares the
 * workbook with a snapshot taken before. A second group injects a failure into Undo itself and
 * presses Undo again.
 *
 * Office.js is queued; this fake runs every operation at once. What it cannot show is listed in the
 * report of the commit that added this file (not-loaded properties, sync batching, calculation,
 * Excel's own text-to-number conversion, real shared-border and fill rules).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { parseA1, type StagedChange } from "./agent.js";
import {
  applyAgentChanges,
  dropAgentBackups,
  mergeUndoData,
  undoAgentChanges,
  type AgentUndo,
} from "./officeAgentHost.js";
import { sheetAliases } from "./officeAgentActions.js";

// --- the fake workbook ----------------------------------------------------------------------

const DEFAULTS: Record<string, unknown> = {
  numberFormat: "General",
  "font.bold": false,
  "font.italic": false,
  "font.underline": "None",
  "font.color": "#000000",
  "font.name": "Calibri",
  "font.size": 11,
  "fill.color": "",
  horizontalAlignment: "General",
  verticalAlignment: "Bottom",
  wrapText: false,
  indentLevel: 0,
  textOrientation: 0,
  "borders.top": "None",
  "borders.left": "None",
};

type Content = string | number | boolean;
interface Cell {
  f: Content;
  fmt: Record<string, unknown>;
}

const letters = (index: number) => {
  let value = index;
  let out = "";
  do {
    out = String.fromCharCode(65 + (value % 26)) + out;
    value = Math.floor(value / 26) - 1;
  } while (value >= 0);
  return out;
};
const at = (value: unknown, r: number, c: number): any =>
  Array.isArray(value) ? (value as any[][])[r]?.[c] : value;
/** Like Office.js: besides `isNullObject` and `load`, every call on a null object fails. */
const nullObject = (): any =>
  new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === "isNullObject") return true;
        if (prop === "load") return () => undefined;
        if (typeof prop !== "string" || prop === "then") return undefined;
        return () => {
          throw new Error(`ItemNotFound: ${prop} on a null object`);
        };
      },
    },
  );

class Workbook {
  sheets: Sheet[] = [];
  nextId = 1;
  ops = 0;
  failAt = -1;
  /** Workbook structure protection: deleting a sheet fails. */
  protectDelete = false;
  trace: string[] = [];
  tick(what: string) {
    this.ops += 1;
    if (process.env.UNDO_TRACE) this.trace.push(`${this.ops} ${what}${this.ops === this.failAt ? " (fails)" : ""}`);
    if (this.ops === this.failAt) throw new Error(`injected failure at ${what}`);
  }
  arm(failAt: number) {
    this.ops = 0;
    this.failAt = failAt;
  }
  find(key: string): Sheet | undefined {
    return (
      this.sheets.find((s) => s.id === key) ??
      this.sheets.find((s) => s.name.toLowerCase() === key.toLowerCase())
    );
  }
  addSheet(name: string): Sheet {
    if (this.find(name)) throw new Error(`The name "${name}" is already taken`);
    const sheet = new Sheet(this, `{${this.nextId++}}`, name);
    this.sheets.push(sheet);
    return sheet;
  }
  context(): any {
    const wb = this;
    const worksheets = {
      load() {},
      get items() {
        return [...wb.sheets];
      },
      getItem(key: string) {
        const sheet = wb.find(key);
        if (!sheet) throw new Error(`ItemNotFound: ${key}`);
        return sheet;
      },
      getItemOrNullObject(key: string) {
        return wb.find(key) ?? nullObject();
      },
      add(name: string) {
        wb.tick("worksheets.add");
        return wb.addSheet(name);
      },
    };
    return {
      sync: async () => {},
      workbook: {
        worksheets,
        tables: { getItemOrNullObject: () => nullObject() },
      },
    };
  }
  runtime(): any {
    return { run: async (fn: (context: any) => Promise<unknown>) => fn(this.context()) };
  }
}

class Sheet {
  dead = false;
  visibility = "Visible";
  tabColor = "";
  showGridlines = true;
  cells = new Map<string, Cell>();
  chartList: { name: string; type: string; source: string }[] = [];
  props = new Map<string, string>();
  hiddenRows = new Set<number>();
  hiddenCols = new Set<number>();
  widths = new Map<number, number>();
  constructor(
    public wb: Workbook,
    public id: string,
    public name_: string,
  ) {}
  get isNullObject() {
    return false;
  }
  load() {}
  chk() {
    if (this.dead) throw new Error("ItemNotFound: the sheet was deleted");
  }
  get name() {
    return this.name_;
  }
  set name(value: string) {
    this.chk();
    this.wb.tick("sheet.name");
    const other = this.wb.find(value);
    if (other && other !== this) throw new Error(`The name "${value}" is already taken`);
    if (value.length > 31) throw new Error("name too long");
    this.name_ = value;
  }
  get position() {
    return this.wb.sheets.indexOf(this);
  }
  set position(value: number) {
    this.chk();
    this.wb.tick("sheet.position");
    const list = this.wb.sheets;
    list.splice(list.indexOf(this), 1);
    list.splice(Math.max(0, Math.min(value, list.length)), 0, this);
  }
  cell(r: number, c: number): Cell | undefined {
    return this.cells.get(`${r},${c}`);
  }
  ensure(r: number, c: number): Cell {
    let cell = this.cells.get(`${r},${c}`);
    if (!cell) {
      cell = { f: "", fmt: {} };
      this.cells.set(`${r},${c}`, cell);
    }
    return cell;
  }
  tidy(r: number, c: number) {
    const cell = this.cell(r, c);
    if (cell && cell.f === "" && !Object.keys(cell.fmt).length) this.cells.delete(`${r},${c}`);
  }
  setFmt(r: number, c: number, key: string, value: unknown) {
    if (value === undefined) return;
    const cell = this.ensure(r, c);
    if (value === DEFAULTS[key]) delete cell.fmt[key];
    else cell.fmt[key] = value;
    this.tidy(r, c);
  }
  getFmt(r: number, c: number, key: string): unknown {
    return this.cell(r, c)?.fmt[key] ?? DEFAULTS[key];
  }
  setContent(r: number, c: number, value: Content) {
    this.ensure(r, c).f = value;
    this.tidy(r, c);
  }
  getRange(address: string) {
    this.chk();
    const a = parseA1(address);
    return new Range(this, a.row - 1, a.column, a.lastRow - a.row + 1, a.lastColumn - a.column + 1);
  }
  getRangeByIndexes(r: number, c: number, rows: number, cols: number) {
    this.chk();
    return new Range(this, r, c, rows, cols);
  }
  bounds(valuesOnly: boolean) {
    let r1 = -1;
    let c1 = -1;
    let r0 = Infinity;
    let c0 = Infinity;
    for (const [k, cell] of this.cells) {
      if (valuesOnly && cell.f === "") continue;
      const [r, c] = k.split(",").map(Number);
      r0 = Math.min(r0, r);
      c0 = Math.min(c0, c);
      r1 = Math.max(r1, r);
      c1 = Math.max(c1, c);
    }
    return r1 < 0 ? undefined : { r0, c0, rows: r1 - r0 + 1, cols: c1 - c0 + 1 };
  }
  getUsedRange(valuesOnly = false) {
    this.chk();
    const b = this.bounds(valuesOnly);
    return b ? new Range(this, b.r0, b.c0, b.rows, b.cols) : new Range(this, 0, 0, 1, 1);
  }
  getUsedRangeOrNullObject(valuesOnly = false): any {
    this.chk();
    const b = this.bounds(valuesOnly);
    return b ? new Range(this, b.r0, b.c0, b.rows, b.cols) : nullObject();
  }
  copy(position = "End", relativeTo?: Sheet) {
    this.chk();
    this.wb.tick("sheet.copy");
    let name = `${this.name_} (2)`;
    for (let n = 3; this.wb.find(name); n += 1) name = `${this.name_} (${n})`;
    const clone = new Sheet(this.wb, `{${this.wb.nextId++}}`, name);
    for (const [k, cell] of this.cells) clone.cells.set(k, { f: cell.f, fmt: { ...cell.fmt } });
    clone.chartList = this.chartList.map((chart) => ({ ...chart }));
    clone.hiddenRows = new Set(this.hiddenRows);
    clone.hiddenCols = new Set(this.hiddenCols);
    clone.widths = new Map(this.widths);
    clone.tabColor = this.tabColor;
    clone.showGridlines = this.showGridlines;
    const list = this.wb.sheets;
    if (position === "After" && relativeTo) list.splice(list.indexOf(relativeTo) + 1, 0, clone);
    else list.push(clone);
    return clone;
  }
  delete() {
    this.chk();
    this.wb.tick("sheet.delete");
    if (this.wb.protectDelete) throw new Error("The workbook structure is protected");
    this.dead = true;
    this.wb.sheets.splice(this.wb.sheets.indexOf(this), 1);
  }
  activate() {}
  get customProperties() {
    const sheet = this;
    return {
      add(key: string, value: string) {
        sheet.chk();
        sheet.wb.tick("customProperties.add");
        sheet.props.set(key, value);
      },
      getItemOrNullObject(key: string): any {
        sheet.chk();
        if (!sheet.props.has(key)) return nullObject();
        return {
          isNullObject: false,
          load() {},
          delete() {
            sheet.wb.tick("customProperties.delete");
            sheet.props.delete(key);
          },
        };
      },
    };
  }
  get tables() {
    return { load() {}, items: [] as any[] };
  }
  get freezePanes() {
    return { getLocationOrNullObject: () => nullObject(), unfreeze() {} };
  }
  get charts() {
    return this.chartApi;
  }
  chartApi = (() => {
    const sheet = this;
    return {
      add(type: string, source: Range) {
        sheet.chk();
        sheet.wb.tick("charts.add");
        let n = sheet.chartList.length + 1;
        while (sheet.chartList.some((c) => c.name === `Chart ${n}`)) n += 1;
        const record = { name: `Chart ${n}`, type, source: source.address };
        sheet.chartList.push(record);
        return {
          title: {} as any,
          setPosition() {},
          load() {},
          get name() {
            return record.name;
          },
        };
      },
      getItemOrNullObject(name: string): any {
        sheet.chk();
        const record = sheet.chartList.find((c) => c.name === name);
        if (!record) return nullObject();
        return {
          isNullObject: false,
          load() {},
          delete() {
            sheet.wb.tick("chart.delete");
            sheet.chartList.splice(sheet.chartList.indexOf(record), 1);
          },
        };
      },
    };
  })();
}
class Range {
  constructor(
    public sh: Sheet,
    public r0: number,
    public c0: number,
    public rows: number,
    public cols: number,
  ) {}
  get isNullObject() {
    return false;
  }
  get worksheet() {
    return this.sh;
  }
  load() {}
  get rowIndex() {
    return this.r0;
  }
  get columnIndex() {
    return this.c0;
  }
  get rowCount() {
    return this.rows;
  }
  get columnCount() {
    return this.cols;
  }
  get cellCount() {
    return this.rows * this.cols;
  }
  get address() {
    const name = /[^A-Za-z0-9_]/.test(this.sh.name) ? `'${this.sh.name}'` : this.sh.name;
    const a = `${letters(this.c0)}${this.r0 + 1}`;
    const b = `${letters(this.c0 + this.cols - 1)}${this.r0 + this.rows}`;
    return `${name}!${a === b ? a : `${a}:${b}`}`;
  }
  private each(fn: (r: number, c: number, i: number, j: number) => void) {
    this.sh.chk();
    for (let i = 0; i < this.rows; i += 1)
      for (let j = 0; j < this.cols; j += 1) fn(this.r0 + i, this.c0 + j, i, j);
  }
  private shape(value: unknown) {
    if (Array.isArray(value)) {
      const grid = value as any[][];
      if (grid.length !== this.rows || grid.some((row) => row.length !== this.cols))
        throw new Error("InvalidArgument: the array does not match the range");
    }
  }
  get values(): any[][] {
    const out: any[][] = [];
    this.each((r, c, i, j) => {
      (out[i] ??= [])[j] = this.valueAt(r, c);
    });
    return out;
  }
  valueAt(r: number, c: number) {
    const f = this.sh.cell(r, c)?.f ?? "";
    return typeof f === "string" && f.startsWith("=") ? 0 : f;
  }
  set values(value: unknown) {
    this.write(value);
  }
  get formulas(): any[][] {
    const out: any[][] = [];
    this.each((r, c, i, j) => {
      (out[i] ??= [])[j] = this.sh.cell(r, c)?.f ?? "";
    });
    return out;
  }
  set formulas(value: unknown) {
    this.write(value);
  }
  private write(value: unknown) {
    this.shape(value);
    this.sh.wb.tick("range.values");
    this.each((r, c, i, j) => {
      const v = at(value, i, j);
      if (v === null || v === undefined) return; // null leaves the cell as it is
      this.sh.setContent(r, c, v);
    });
  }
  get numberFormat(): any[][] {
    const out: any[][] = [];
    this.each((r, c, i, j) => {
      (out[i] ??= [])[j] = this.sh.getFmt(r, c, "numberFormat");
    });
    return out;
  }
  set numberFormat(value: unknown) {
    this.shape(value);
    this.sh.wb.tick("range.numberFormat");
    this.each((r, c, i, j) => this.sh.setFmt(r, c, "numberFormat", at(value, i, j)));
  }
  set style(value: string) {
    this.sh.wb.tick("range.style");
    this.each((r, c) => this.sh.setFmt(r, c, "style", value));
  }
  getCell(r: number, c: number) {
    return new Range(this.sh, this.r0 + r, this.c0 + c, 1, 1);
  }
  getResizedRange(dr: number, dc: number) {
    return new Range(this.sh, this.r0, this.c0, Math.max(1, this.rows + dr), Math.max(1, this.cols + dc));
  }
  getRow(i: number) {
    return new Range(this.sh, this.r0 + i, this.c0, 1, this.cols);
  }
  getColumn(i: number) {
    return new Range(this.sh, this.r0, this.c0 + i, this.rows, 1);
  }
  getSpillingToRangeOrNullObject() {
    return nullObject();
  }
  getEntireRow() {
    return this.entire(true);
  }
  getEntireColumn() {
    return this.entire(false);
  }
  private entire(byRow: boolean) {
    const range = this;
    const sh = this.sh;
    const first = byRow ? this.r0 : this.c0;
    const count = byRow ? this.rows : this.cols;
    const shift = (move: (r: number, c: number) => [number, number] | undefined) => {
      const next = new Map<string, Cell>();
      for (const [k, cell] of sh.cells) {
        const [r, c] = k.split(",").map(Number);
        const to = move(r, c);
        if (to) next.set(`${to[0]},${to[1]}`, cell);
      }
      sh.cells = next;
    };
    return {
      insert() {
        sh.wb.tick("insert");
        if (byRow) {
          shift((r, c) => [r >= first ? r + count : r, c]);
          sh.hiddenRows = new Set([...sh.hiddenRows].map((r) => (r >= first ? r + count : r)));
        } else {
          shift((r, c) => [r, c >= first ? c + count : c]);
          sh.widths = new Map([...sh.widths].map(([c, w]) => [c >= first ? c + count : c, w]));
          sh.hiddenCols = new Set([...sh.hiddenCols].map((c) => (c >= first ? c + count : c)));
        }
      },
      delete() {
        sh.wb.tick("delete");
        if (byRow) {
          shift((r, c) => (r >= first && r < first + count ? undefined : [r >= first + count ? r - count : r, c]));
          sh.hiddenRows = new Set(
            [...sh.hiddenRows].filter((r) => r < first || r >= first + count).map((r) => (r >= first ? r - count : r)),
          );
        } else {
          shift((r, c) => (c >= first && c < first + count ? undefined : [r, c >= first + count ? c - count : c]));
          sh.widths = new Map(
            [...sh.widths].filter(([c]) => c < first || c >= first + count).map(([c, w]) => [c >= first ? c - count : c, w]),
          );
          sh.hiddenCols = new Set(
            [...sh.hiddenCols].filter((c) => c < first || c >= first + count).map((c) => (c >= first ? c - count : c)),
          );
        }
      },
      set rowHidden(value: boolean | null) {
        sh.wb.tick("rowHidden");
        for (let r = first; r < first + count; r += 1) value ? sh.hiddenRows.add(r) : sh.hiddenRows.delete(r);
      },
      get columnHidden() {
        const flags = Array.from({ length: count }, (_, i) => sh.hiddenCols.has(first + i));
        return flags.every(Boolean) ? true : flags.some(Boolean) ? null : false;
      },
      set columnHidden(value: boolean | null) {
        sh.wb.tick("columnHidden");
        for (let c = first; c < first + count; c += 1) value ? sh.hiddenCols.add(c) : sh.hiddenCols.delete(c);
      },
      get rowHidden() {
        const flags = Array.from({ length: count }, (_, i) => sh.hiddenRows.has(first + i));
        return flags.every(Boolean) ? true : flags.some(Boolean) ? null : false;
      },
      load() {},
      group() {},
      ungroup() {},
      range,
    };
  }
  clear(type = "All") {
    this.sh.wb.tick("range.clear");
    this.each((r, c) => {
      const cell = this.sh.cell(r, c);
      if (!cell) return;
      if (type === "All" || type === "Contents") cell.f = "";
      if (type === "All" || type === "Formats") cell.fmt = {};
      this.sh.tidy(r, c);
    });
    if (type === "All" || type === "Formats") {
      // The lines under and right of the range belong to the neighbours' cells.
      for (let j = 0; j < this.cols; j += 1)
        this.sh.setFmt(this.r0 + this.rows, this.c0 + j, "borders.top", "None");
      for (let i = 0; i < this.rows; i += 1)
        this.sh.setFmt(this.r0 + i, this.c0 + this.cols, "borders.left", "None");
    }
  }
  copyFrom(source: Range, type = "All", _skipBlanks = false, transpose = false) {
    this.sh.wb.tick("range.copyFrom");
    this.sh.chk();
    source.sh.chk();
    const sr = transpose ? source.cols : source.rows;
    const sc = transpose ? source.rows : source.cols;
    const grab: (Cell | undefined)[][] = [];
    for (let i = 0; i < source.rows; i += 1)
      for (let j = 0; j < source.cols; j += 1) {
        const cell = source.sh.cell(source.r0 + i, source.c0 + j);
        const copy = cell ? { f: cell.f, fmt: { ...cell.fmt } } : undefined;
        if (transpose) (grab[j] ??= [])[i] = copy;
        else (grab[i] ??= [])[j] = copy;
      }
    const rows = this.rows === 1 && this.cols === 1 ? sr : this.rows;
    const cols = this.rows === 1 && this.cols === 1 ? sc : this.cols;
    // The line under (right of) a source cell is the next cell's top (left) line, outside the source.
    const under = (i: number, j: number) => source.sh.getFmt(source.r0 + i + 1, source.c0 + j, "borders.top");
    const beside = (i: number, j: number) => source.sh.getFmt(source.r0 + i, source.c0 + j + 1, "borders.left");
    const underLines = Array.from({ length: source.rows }, (_, i) => Array.from({ length: source.cols }, (_, j) => under(i, j)));
    const besideLines = Array.from({ length: source.rows }, (_, i) => Array.from({ length: source.cols }, (_, j) => beside(i, j)));
    for (let i = 0; i < rows; i += 1)
      for (let j = 0; j < cols; j += 1) {
        const from = grab[i % sr]?.[j % sc];
        const r = this.r0 + i;
        const c = this.c0 + j;
        const target = this.sh.ensure(r, c);
        if (type === "All" || type === "Formulas" || type === "Values") {
          let f = from?.f ?? "";
          if (type === "Values" && typeof f === "string" && f.startsWith("=")) f = 0;
          target.f = f;
        }
        if (type === "All" || type === "Formats") {
          const keep = Object.fromEntries(Object.entries(target.fmt).filter(([k]) => k.startsWith("borders.")));
          target.fmt = { ...(from?.fmt ?? {}) };
          if (type === "Formats") void keep;
          if (!transpose) {
            if (i === rows - 1) this.sh.setFmt(r + 1, c, "borders.top", underLines[i % sr][j % sc]);
            if (j === cols - 1) this.sh.setFmt(r, c + 1, "borders.left", besideLines[i % sr][j % sc]);
          }
        }
        this.sh.tidy(r, c);
      }
  }
  moveTo(dest: Range) {
    this.sh.wb.tick("range.moveTo");
    const grab: (Cell | undefined)[][] = [];
    this.each((r, c, i, j) => {
      const cell = this.sh.cell(r, c);
      (grab[i] ??= [])[j] = cell ? { f: cell.f, fmt: { ...cell.fmt } } : undefined;
      if (cell) this.sh.cells.delete(`${r},${c}`);
    });
    for (let i = 0; i < this.rows; i += 1)
      for (let j = 0; j < this.cols; j += 1) {
        const from = grab[i][j];
        const target = dest.sh.ensure(dest.r0 + i, dest.c0 + j);
        target.f = from?.f ?? "";
        target.fmt = { ...(from?.fmt ?? {}) };
        dest.sh.tidy(dest.r0 + i, dest.c0 + j);
      }
  }
  merge() {
    this.sh.wb.tick("range.merge");
  }
  unmerge() {
    this.sh.wb.tick("range.unmerge");
  }
  get sort() {
    const range = this;
    return {
      apply(fields: { key: number; ascending?: boolean }[], _matchCase?: boolean, hasHeaders?: boolean, orientation = "Rows") {
        range.sh.wb.tick("sort.apply");
        range.sh.chk();
        const rank = (v: unknown) => (v === "" || v === undefined ? 2 : typeof v === "number" ? 0 : 1);
        const compare = (a: unknown, b: unknown) => {
          if (rank(a) !== rank(b)) return rank(a) - rank(b);
          if (typeof a === "number" && typeof b === "number") return a - b;
          return String(a).toLowerCase() < String(b).toLowerCase() ? -1 : String(a).toLowerCase() > String(b).toLowerCase() ? 1 : 0;
        };
        const sortFmt = (cell: Cell | undefined) =>
          cell ? { f: cell.f, fmt: Object.fromEntries(Object.entries(cell.fmt).filter(([k]) => !k.startsWith("borders."))) } : undefined;
        const border = (r: number, c: number) =>
          Object.fromEntries(Object.entries(range.sh.cell(r, c)?.fmt ?? {}).filter(([k]) => k.startsWith("borders.")));
        const columns = orientation === "Columns";
        const lines = columns ? range.cols : range.rows;
        const span = columns ? range.rows : range.cols;
        const read = (line: number, k: number) =>
          columns ? range.sh.cell(range.r0 + k, range.c0 + line) : range.sh.cell(range.r0 + line, range.c0 + k);
        const start = hasHeaders ? 1 : 0;
        const order = Array.from({ length: lines - start }, (_, i) => i + start);
        const keyOf = (line: number, key: number) => {
          const cell = read(line, key);
          const f = cell?.f ?? "";
          return typeof f === "string" && f.startsWith("=") ? 0 : f;
        };
        order.sort((x, y) => {
          for (const field of fields) {
            const d = compare(keyOf(x, field.key), keyOf(y, field.key));
            if (d) return field.ascending === false ? -d : d;
          }
          return x - y;
        });
        const moved = order.map((line) => Array.from({ length: span }, (_, k) => sortFmt(read(line, k))));
        order.forEach((_, slot) => {
          const line = slot + start;
          for (let k = 0; k < span; k += 1) {
            const r = columns ? range.r0 + k : range.r0 + line;
            const c = columns ? range.c0 + line : range.c0 + k;
            const keep = border(r, c);
            const from = moved[slot][k];
            const cell = range.sh.ensure(r, c);
            cell.f = from?.f ?? "";
            cell.fmt = { ...(from?.fmt ?? {}), ...keep };
            range.sh.tidy(r, c);
          }
        });
      },
    };
  }
  // --- formats ---
  get format(): any {
    return formatProxy(this, "");
  }
  setFormat(path: string, value: unknown) {
    this.sh.wb.tick(`format.${path}`);
    if (path === "columnWidth") {
      for (let j = 0; j < this.cols; j += 1)
        value === 64 ? this.sh.widths.delete(this.c0 + j) : this.sh.widths.set(this.c0 + j, value as number);
      return;
    }
    if (path === "rowHeight") return;
    const edge = /^borders\.(Edge\w+|Inside\w+)\.style$/.exec(path);
    if (edge) return this.setBorder(edge[1], String(value));
    this.each((r, c) => this.sh.setFmt(r, c, path, value));
  }
  private setBorder(edge: string, style: string) {
    const last = (this.rows - 1) | 0;
    const lastC = this.cols - 1;
    for (let i = 0; i < this.rows; i += 1)
      for (let j = 0; j < this.cols; j += 1) {
        const r = this.r0 + i;
        const c = this.c0 + j;
        if (edge === "EdgeTop" && i === 0) this.sh.setFmt(r, c, "borders.top", style);
        if (edge === "EdgeBottom" && i === last) this.sh.setFmt(r + 1, c, "borders.top", style);
        if (edge === "EdgeLeft" && j === 0) this.sh.setFmt(r, c, "borders.left", style);
        if (edge === "EdgeRight" && j === lastC) this.sh.setFmt(r, c + 1, "borders.left", style);
        if (edge === "InsideHorizontal" && i > 0) this.sh.setFmt(r, c, "borders.top", style);
        if (edge === "InsideVertical" && j > 0) this.sh.setFmt(r, c, "borders.left", style);
      }
  }
  autofit() {
    this.sh.wb.tick("autofit");
    for (let j = 0; j < this.cols; j += 1) {
      let longest = 0;
      for (let i = 0; i < this.rows; i += 1)
        longest = Math.max(longest, String(this.sh.cell(this.r0 + i, this.c0 + j)?.f ?? "").length);
      this.sh.widths.set(this.c0 + j, 20 + longest * 7);
    }
  }
  getCellProperties(): { value: any[][] } {
    const value: any[][] = [];
    this.each((r, c, i, j) => {
      const g = (k: string) => this.sh.getFmt(r, c, k);
      (value[i] ??= [])[j] = {
        format: {
          fill: { color: g("fill.color") },
          font: {
            bold: g("font.bold"),
            color: g("font.color"),
            italic: g("font.italic"),
            underline: g("font.underline"),
            name: g("font.name"),
            size: g("font.size"),
          },
          horizontalAlignment: g("horizontalAlignment"),
          verticalAlignment: g("verticalAlignment"),
          wrapText: g("wrapText"),
          indentLevel: g("indentLevel"),
          textOrientation: g("textOrientation"),
          borders: {
            top: { style: g("borders.top") },
            bottom: { style: this.sh.getFmt(r + 1, c, "borders.top") },
            left: { style: g("borders.left") },
            right: { style: this.sh.getFmt(r, c + 1, "borders.left") },
          },
        },
      };
    });
    return { value };
  }
  setCellProperties(cells: any[][]) {
    this.shape(cells);
    this.sh.wb.tick("setCellProperties");
    this.each((r, c, i, j) => {
      const f = cells[i][j]?.format;
      if (!f) return;
      const s = (k: string, v: unknown) => this.sh.setFmt(r, c, k, v);
      s("fill.color", f.fill?.color);
      for (const key of ["bold", "color", "italic", "underline", "name", "size"]) s(`font.${key}`, f.font?.[key]);
      for (const key of ["horizontalAlignment", "verticalAlignment", "wrapText", "indentLevel", "textOrientation"]) s(key, f[key]);
      s("borders.top", f.borders?.top?.style);
      s("borders.left", f.borders?.left?.style);
      if (f.borders?.bottom) this.sh.setFmt(r + 1, c, "borders.top", f.borders.bottom.style);
      if (f.borders?.right) this.sh.setFmt(r, c + 1, "borders.left", f.borders.right.style);
    });
  }
}

function formatProxy(range: Range, path: string): any {
  return new Proxy(
    {},
    {
      get(_target, prop) {
        if (typeof prop !== "string") return undefined;
        if (prop === "autofitColumns") return () => range.autofit();
        if (prop === "autofitRows") return () => undefined;
        if (prop === "getItem") return (name: string) => formatProxy(range, `${path}.${name}`.replace(/^\./, ""));
        if (!path && prop === "columnWidth") return range.sh.widths.get(range.c0) ?? 64;
        if (!path && prop === "rowHeight") return 15;
        return formatProxy(range, path ? `${path}.${prop}` : prop);
      },
      set(_target, prop, value) {
        range.setFormat(path ? `${path}.${String(prop)}` : String(prop), value);
        return true;
      },
    },
  );
}


// --- random workbooks and changes -----------------------------------------------------------

const mulberry32 = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
type Rng = () => number;
const pick = <T,>(rng: Rng, list: readonly T[]): T => list[Math.floor(rng() * list.length)];
const int = (rng: Rng, lo: number, hi: number) => lo + Math.floor(rng() * (hi - lo + 1));
const chance = (rng: Rng, p: number) => rng() < p;

const HEADERS = ["id", "name", "qty", "price"];
const SHEET_POOL = ["Data", "Sales", "Notes", "Summary", "Report", "My Sheet"];

/** The starting workbook of a case: 1-3 data sheets (the table sometimes starts away from A1), maybe a hidden one. */
function buildWorkbook(seed: number): Workbook {
  const rng = mulberry32(seed);
  const wb = new Workbook();
  const names = ["Data", "Sales", "Notes"].filter((_, i) => i === 0 || chance(rng, 0.6));
  if (chance(rng, 0.3)) names.splice(int(rng, 0, names.length), 0, "Archive");
  for (const name of names) {
    const sheet = wb.addSheet(name);
    if (name === "Archive") sheet.visibility = "Hidden";
    const r0 = chance(rng, 0.4) ? 2 : 0;
    const c0 = chance(rng, 0.4) ? 1 : 0;
    const rows = int(rng, 2, 8);
    HEADERS.forEach((h, j) => {
      sheet.setContent(r0, c0 + j, h);
      sheet.setFmt(r0, c0 + j, "font.bold", true);
      sheet.setFmt(r0, c0 + j, "fill.color", "#DDDDDD");
    });
    for (let i = 1; i <= rows; i += 1) {
      sheet.setContent(r0 + i, c0, i);
      sheet.setContent(r0 + i, c0 + 1, pick(rng, ["ann", "bob", "cy", "dee", "eve"]));
      sheet.setContent(r0 + i, c0 + 2, int(rng, 1, 50));
      sheet.setContent(r0 + i, c0 + 3, int(rng, 1, 900) / 10);
      sheet.setFmt(r0 + i, c0 + 3, "numberFormat", "0.00");
      if (chance(rng, 0.3)) sheet.setContent(r0 + i, c0 + 4, `=${letters(c0 + 2)}${r0 + i + 1}*2`);
    }
    if (chance(rng, 0.3)) sheet.setFmt(r0, c0, "borders.top", "Continuous");
    if (chance(rng, 0.3)) sheet.setFmt(r0 + 1, c0 + 1, "borders.left", "Continuous");
    if (chance(rng, 0.3)) sheet.tabColor = "#00FF00";
    if (chance(rng, 0.3)) sheet.chartList.push({ name: "Chart 1", type: "ColumnClustered", source: "A1:D4" });
    if (chance(rng, 0.2)) sheet.widths.set(1, 90);
    if (chance(rng, 0.2)) sheet.hiddenRows.add(r0 + 1);
    (sheet as any).block = { r0, c0, rows: rows + 1, cols: 4 };
  }
  return wb;
}

function snapshot(wb: Workbook, skip = new Set<string>()): any {
  return wb.sheets.filter((s) => !skip.has(s.id)).map((s) => ({
    name: s.name_,
    visibility: s.visibility,
    tabColor: s.tabColor,
    gridlines: s.showGridlines,
    hiddenRows: [...s.hiddenRows].sort((a, b) => a - b),
    hiddenCols: [...s.hiddenCols].sort((a, b) => a - b),
    widths: [...s.widths].sort((a, b) => a[0] - b[0]),
    charts: s.chartList.map((c) => c.name),
    props: [...s.props.keys()].sort(),
    cells: Object.fromEntries(
      [...s.cells]
        .sort((a, b) => (a[0] < b[0] ? -1 : 1))
        .map(([k, c]) => [k, `${JSON.stringify(c.f)} ${JSON.stringify(Object.entries(c.fmt).sort())}`]),
    ),
  }));
}

function diff(before: any, after: any, skipLayout = false): string {
  const out: string[] = [];
  const names = (x: any[]) => x.map((s) => `${s.name}${s.visibility === "Hidden" ? "(hidden)" : ""}`).join(", ");
  if (names(before) !== names(after)) out.push(`sheets: [${names(before)}] -> [${names(after)}]`);
  for (const a of before) {
    const b = after.find((s: any) => s.name === a.name);
    if (!b) continue;
    for (const key of ["tabColor", "gridlines", "hiddenRows", "hiddenCols", "widths", "charts", "props"])
      if (
        !(skipLayout && ["hiddenRows", "hiddenCols", "widths"].includes(key)) &&
        JSON.stringify(a[key]) !== JSON.stringify(b[key])
      )
        out.push(`${a.name}.${key}: ${JSON.stringify(a[key])} -> ${JSON.stringify(b[key])}`);
    for (const k of new Set([...Object.keys(a.cells), ...Object.keys(b.cells)]))
      if (a.cells[k] !== b.cells[k]) out.push(`${a.name}[${k}]: ${a.cells[k]} -> ${b.cells[k]}`);
  }
  return out.slice(0, 12).join("\n");
}

const range = (rng: Rng, maxR = 9, maxC = 6) => {
  const r = int(rng, 1, maxR);
  const c = int(rng, 0, maxC);
  const r2 = Math.min(r + int(rng, 0, 4), 12);
  const c2 = c + int(rng, 0, 3);
  return `${letters(c)}${r}:${letters(c2)}${r2}`;
};
const cellAddr = (rng: Rng) => `${letters(int(rng, 0, 6))}${int(rng, 1, 10)}`;

function genChange(rng: Rng, live: string[], initial: Workbook): StagedChange {
  const sheet = chance(rng, 0.04) ? "Ghost" : pick(rng, live);
  const lower = new Set(live.map((n) => n.toLowerCase()));
  const block = (initial.find(sheet) as any)?.block as { r0: number; c0: number; rows: number; cols: number } | undefined;
  const kind = pick(rng, [
    "write_values", "write_values", "write_formula", "create_sheet", "sort_range", "sort_range", "format_range",
    "format_range", "create_chart", "rename", "delete", "copy", "hide", "move", "rows", "rows", "rows", "step", "step",
    "tab", "unhide",
  ]);
  switch (kind) {
    case "write_values": {
      const rows = int(rng, 1, 3);
      const cols = int(rng, 1, 3);
      const cell = pick(rng, [cellAddr(rng), "A1", "A1", "B2"]);
      return {
        kind,
        sheet,
        cell,
        values: Array.from({ length: rows }, () =>
          Array.from({ length: cols }, () => pick(rng, [1, 2.5, "x", "", null, "=A1+1", "abc", true, 0])),
        ),
      };
    }
    case "write_formula": {
      const cell = pick(rng, ["F2", "E2", "G3", "A1", "C5"]);
      const fill = chance(rng, 0.5);
      const a = parseA1(cell);
      return {
        kind,
        sheet,
        cell,
        formula: "=SUM(A1:A3)",
        ...(fill ? { fillRange: `${cell}:${letters(a.column)}${a.row + int(rng, 1, 4)}` } : {}),
        ...(chance(rng, 0.5) ? { header: "Total" } : {}),
      };
    }
    case "create_sheet": {
      const name = pick(rng, SHEET_POOL);
      let final = name;
      for (let n = 2; lower.has(final.toLowerCase()); n += 1) final = `${name.slice(0, 28)} ${n}`;
      live.push(final);
      return { kind, name };
    }
    case "sort_range": {
      const b = block ?? { r0: 0, c0: 0, rows: 5, cols: 4 };
      const address = chance(rng, 0.8)
        ? `${letters(b.c0)}${b.r0 + 1}:${letters(b.c0 + b.cols - 1)}${b.r0 + b.rows}`
        : range(rng);
      return {
        kind,
        sheet,
        address,
        column: pick(rng, [...HEADERS, "zzz"]),
        descending: chance(rng, 0.5),
        ...(chance(rng, 0.3) ? { then: [{ column: pick(rng, HEADERS), descending: false }] } : {}),
        ...(chance(rng, 0.1) ? { byColumns: true } : {}),
      };
    }
    case "format_range":
      return {
        kind,
        sheet,
        address: range(rng),
        ...(chance(rng, 0.4) ? { bold: chance(rng, 0.7) } : {}),
        ...(chance(rng, 0.4) ? { numberFormat: pick(rng, ["0.00", "#,##0", "@"]) } : {}),
        ...(chance(rng, 0.3) ? { fill: pick(rng, ["#FFFF00", "#FF0000"]) } : {}),
        ...(chance(rng, 0.2) ? { fontSize: int(rng, 8, 20) } : {}),
        ...(chance(rng, 0.25) ? { borders: pick(rng, ["all", "outside", "bottom", "none"] as const) } : {}),
        ...(chance(rng, 0.15) ? { autofit: true } : {}),
        ...(chance(rng, 0.1) ? { horizontal: "center" as const } : {}),
        ...(chance(rng, 0.08) ? { style: "Currency" } : {}),
        ...(chance(rng, 0.08) ? { clear: true } : {}),
        ...(chance(rng, 0.06) ? { mergeCenter: true } : {}),
        ...(chance(rng, 0.06) ? { copyFrom: range(rng) } : {}),
      };
    case "create_chart":
      return {
        kind,
        sheet,
        ...(chance(rng, 0.7) ? { address: range(rng) } : {}),
        chartType: pick(rng, ["column", "line", "pie"] as const),
        ...(chance(rng, 0.5) ? { title: "T" } : {}),
      };
    case "rename": {
      const value = pick(rng, SHEET_POOL);
      const i = live.indexOf(sheet);
      if (i >= 0 && !lower.has(value.toLowerCase())) live[i] = value;
      return { kind: "excel_action", tool: "sheet_action", args: { sheet, action: "rename", value } };
    }
    case "delete": {
      const i = live.indexOf(sheet);
      if (i >= 0 && live.length > 1) live.splice(i, 1);
      return { kind: "excel_action", tool: "sheet_action", args: { sheet, action: "delete" } };
    }
    case "copy": {
      const value = pick(rng, SHEET_POOL);
      if (!lower.has(value.toLowerCase())) live.push(value);
      return { kind: "excel_action", tool: "sheet_action", args: { sheet, action: "copy", value } };
    }
    case "hide":
      return { kind: "excel_action", tool: "sheet_action", args: { sheet, action: "hide" } };
    case "unhide":
      return { kind: "excel_action", tool: "sheet_action", args: { sheet: pick(rng, [...live, "Archive"]), action: "unhide" } };
    case "move":
      return { kind: "excel_action", tool: "sheet_action", args: { sheet, action: "move", value: int(rng, 0, 3) } };
    case "tab":
      return {
        kind: "excel_action",
        tool: "sheet_action",
        args: { sheet, action: pick(rng, ["tab_color", "gridlines_off"]), value: "#FF8800" },
      };
    case "rows": {
      const action = pick(rng, [
        "insert_rows", "delete_rows", "insert_columns", "delete_columns", "clear_contents", "clear_formats",
        "hide_rows", "unhide_rows", "hide_columns", "unhide_columns", "column_width", "fill_down", "move", "transpose", "paste_values",
      ]);
      return {
        kind: "excel_action",
        tool: "edit_rows_columns",
        args: { sheet, action, address: range(rng, 8, 4), value: int(rng, 10, 120), to: cellAddr(rng) },
      };
    }
    default:
      return {
        kind: "vynor_step",
        understood: "",
        instruction: `step|${sheet}|${int(rng, 0, 8)}|${int(rng, 0, 6)}|${int(rng, 1, 99)}${chance(rng, 0.15) ? "|fail" : ""}`,
      };
  }
}

/** Built-in steps (vynor_step): write one cell, roll back by writing the old content. */
function stepRunner(wb: Workbook) {
  const undone = new Map<unknown, number>();
  return {
    undone,
    run: async (instruction: string) => {
      const [, name, r, c, value, fail] = instruction.split("|");
      const sheet = wb.find(name);
      if (!sheet) return { ok: false, detail: null, error: `no sheet ${name}` };
      wb.tick("step");
      const rollback = { name: sheet.name_, r: Number(r), c: Number(c), prev: sheet.cell(Number(r), Number(c))?.f ?? "" };
      sheet.setContent(Number(r), Number(c), Number(value));
      return fail ? { ok: false, detail: null, rollback, error: "the step failed" } : { ok: true, detail: null, rollback };
    },
    undo: async (rollback: any) => {
      const sheet = wb.find(rollback.name);
      if (!sheet) return; // like rollbackCreatedItems: what is already gone is skipped
      wb.tick("step.undo");
      sheet.setContent(rollback.r, rollback.c, rollback.prev);
      undone.set(rollback, (undone.get(rollback) ?? 0) + 1);
    },
  };
}

// --- one case -------------------------------------------------------------------------------

interface Spec {
  wbSeed: number;
  applies: StagedChange[][];
  /** Operation number (over all applies) that fails. */
  failAt?: number;
  /** Stop is pressed after this many changes were checked. */
  cancelAt?: number;
  /** Operation numbers that fail in successive Undo attempts; the last attempt has no failure. */
  undoFails?: number[];
  /** The soft-delete of a sheet fails in Excel (structure protection) and is then fine. */
  protectDelete?: boolean;
}

async function runCase(spec: Spec): Promise<string | undefined> {
  sheetAliases.clear();
  const wb = buildWorkbook(spec.wbSeed);
  const before = snapshot(wb);
  const steps = stepRunner(wb);
  wb.arm(spec.failAt ?? -1);
  wb.protectDelete = Boolean(spec.protectDelete);
  let calls = 0;
  let undo: AgentUndo | undefined;
  for (const changes of spec.applies) {
    const report = await applyAgentChanges(wb.runtime(), changes, steps.run, {
      isCancelled: () => spec.cancelAt !== undefined && calls++ >= spec.cancelAt,
    });
    undo = mergeUndoData(undo, report.undo);
  }
  wb.protectDelete = false;
  if (!undo) return undefined;
  let done = false;
  for (const k of spec.undoFails ?? []) {
    wb.arm(k);
    try {
      await undoAgentChanges(wb.runtime(), undo, steps.undo);
      done = true;
      break;
    } catch {
      // Undo did not finish: the person presses Undo again.
    }
  }
  wb.arm(-1);
  if (!done)
    try {
      await undoAgentChanges(wb.runtime(), undo, steps.undo);
    } catch (error) {
      return `the last Undo threw: ${(error as Error).message}`;
    }
  if (process.env.UNDO_TRACE) console.log(wb.trace.join("\n"));
  const twice = [...steps.undone].filter(([, n]) => n > 1);
  if (twice.length) return `a step was rolled back ${twice[0][1]} times`;
  return diff(before, snapshot(wb), structural(spec)) || undefined;
}

/** Inserting, deleting or moving cells shifts row heights, hidden rows and widths, which no undo data holds. */
const structural = (spec: Spec) =>
  spec.applies.some((list) =>
    list.some(
      (change) =>
        change.kind === "excel_action" &&
        ["insert_rows", "delete_rows", "insert_columns", "delete_columns", "move", "transpose"].includes(
          String(change.args.action),
        ),
    ),
  );

function genSpec(seed: number, extras: (rng: Rng) => Partial<Spec>): Spec {
  const rng = mulberry32(seed * 7919 + 13);
  const initial = buildWorkbook(seed);
  const live = initial.sheets.filter((s) => s.visibility === "Visible").map((s) => s.name_);
  const applies: StagedChange[][] = [];
  const nApplies = chance(rng, 0.35) ? 2 : 1;
  for (let a = 0; a < nApplies; a += 1)
    applies.push(Array.from({ length: int(rng, 1, 6) }, () => genChange(rng, live, initial)));
  return { wbSeed: seed, applies, ...extras(rng) };
}

/** Drops changes and options while the case still fails, so the report is short. */
async function minimize(spec: Spec): Promise<Spec> {
  let best = spec;
  const fails = async (candidate: Spec) => Boolean(await runCase(candidate));
  for (let again = true; again; ) {
    again = false;
    for (const key of ["failAt", "cancelAt", "undoFails", "protectDelete"] as const) {
      if (best[key] === undefined) continue;
      const candidate = { ...best, [key]: undefined };
      if (await fails(candidate)) {
        best = candidate;
        again = true;
      }
    }
    for (let a = 0; a < best.applies.length; a += 1)
      for (let i = 0; i < (best.applies[a]?.length ?? 0); i += 1) {
        const applies = best.applies.map((list, x) => (x === a ? list.filter((_, y) => y !== i) : list));
        const candidate = { ...best, applies: applies.filter((l) => l.length) };
        if (await fails(candidate)) {
          best = { ...best, applies };
          again = true;
          i -= 1;
        }
      }
    best = { ...best, applies: best.applies.filter((l) => l.length) };
  }
  return best;
}

async function property(name: string, count: number, extras: (rng: Rng) => Partial<Spec>, base: number) {
  const bad: string[] = [];
  // UNDO_SCALE=10 UNDO_BASE=100000 searches with more, different cases.
  const total = count * Number(process.env.UNDO_SCALE ?? 1);
  for (let i = 0; i < total; i += 1) {
    const spec = genSpec(base + Number(process.env.UNDO_BASE ?? 0) + i, extras);
    if (!(await runCase(spec))) continue;
    const small = await minimize(spec);
    bad.push(`seed ${spec.wbSeed}: ${await runCase(small)}\n${JSON.stringify(small)}`);
    if (bad.length >= 3) break;
  }
  assert.equal(bad.length, 0, `${name}: ${bad.join("\n---\n")}`);
}

// --- the properties -------------------------------------------------------------------------

test("apply then undo restores the workbook (one or two merged applies)", async () => {
  await property("plain", 400, () => ({}), 1000);
});

test("a failure at any operation of apply is undone completely", async () => {
  await property("apply failure", 300, (rng) => ({ failAt: int(rng, 1, 60) }), 5000);
});

test("Stop in the middle of an apply is undone completely", async () => {
  await property("stop", 200, (rng) => ({ cancelAt: int(rng, 0, 5) }), 9000);
});

test("a sheet delete refused by Excel is undone completely", async () => {
  await property("protected", 120, () => ({ protectDelete: true }), 12000);
});

test("a failure inside Undo, then Undo again, ends with the original workbook", async () => {
  await property(
    "undo failure",
    400,
    (rng) => ({
      undoFails: Array.from({ length: int(rng, 1, 3) }, () => int(rng, 1, 40)),
      ...(chance(rng, 0.2) ? { cancelAt: int(rng, 0, 5) } : {}),
    }),
    20000,
  );
});

test("a failure inside apply, then a failure inside Undo, then Undo again", async () => {
  await property(
    "both",
    300,
    (rng) => ({ failAt: int(rng, 1, 40), undoFails: [int(rng, 1, 30), int(rng, 1, 30)] }),
    30000,
  );
});

test("keeping the result drops every hidden backup copy and nothing else", async () => {
  for (let i = 0; i < 300; i += 1) {
    const spec = genSpec(40000 + i, (rng) => (chance(rng, 0.3) ? { failAt: int(rng, 1, 50) } : {}));
    sheetAliases.clear();
    const wb = buildWorkbook(spec.wbSeed);
    const steps = stepRunner(wb);
    wb.arm(spec.failAt ?? -1);
    let undo: AgentUndo | undefined;
    for (const changes of spec.applies) {
      const report = await applyAgentChanges(wb.runtime(), changes, steps.run);
      undo = mergeUndoData(undo, report.undo);
    }
    wb.arm(-1);
    const copies = new Set<string>([
      ...undo!.backups.map((item) => item.backup),
      ...(undo!.journal ?? []).flatMap((entry) =>
        entry.type === "backup" ? [entry.backupId] : entry.data?.restoreId ? [String(entry.data.restoreId)] : [],
      ),
    ]);
    const expected = snapshot(wb, copies);
    await dropAgentBackups(wb.runtime(), undo!);
    const left = wb.sheets.filter((s) => copies.has(s.id) || /^VynorAI_backup/.test(s.name_)).map((s) => s.name_);
    assert.deepEqual(left, [], `seed ${spec.wbSeed}: backup copies left behind: ${JSON.stringify(spec)}`);
    assert.equal(diff(expected, snapshot(wb)), "", `seed ${spec.wbSeed}: ${JSON.stringify(spec)}`);
  }
});

// --- regressions: each spec failed before its fix (minimized by the properties above) ----------

const action = (tool: string, args: Record<string, unknown>): StagedChange => ({ kind: "excel_action", tool, args });
const regressions: Record<string, Spec> = {
  "a sheet copy to a name that is taken leaves no copy behind": {
    wbSeed: 1000,
    applies: [[action("sheet_action", { sheet: "Data", action: "copy", value: "Data" })]],
  },
  "unhiding rows that were visible does not hide them on undo": {
    wbSeed: 1007,
    applies: [[action("edit_rows_columns", { sheet: "Notes", action: "unhide_rows", address: "D3:D6" })]],
  },
  "unhiding partly hidden rows puts back which rows were hidden": {
    wbSeed: 1012,
    applies: [[action("edit_rows_columns", { sheet: "Data", action: "unhide_rows", address: "E5:H8" })]],
  },
  "unhiding columns that were visible does not hide them on undo": {
    wbSeed: 1000,
    applies: [[action("edit_rows_columns", { sheet: "Data", action: "unhide_columns", address: "B1:C4" })]],
  },
  "autofit puts the column widths back": {
    wbSeed: 5000,
    applies: [[{ kind: "format_range", sheet: "Notes", address: "E8:E11", bold: true, autofit: true, clear: true }]],
  },
  "a deleted column of a table that starts at B is restored without leftovers in A": {
    wbSeed: 1195,
    applies: [[action("edit_rows_columns", { sheet: "Data", action: "delete_columns", address: "A8:A11" })]],
  },
  "the border above a restored table that does not start at A1 comes back": {
    wbSeed: 12019,
    applies: [[action("edit_rows_columns", { sheet: "Notes", action: "delete_rows", address: "C1:E1" })]],
  },
  "a sheet delete that Excel refuses is undone": {
    wbSeed: 12005,
    applies: [[action("sheet_action", { sheet: "Data", action: "delete" })]],
    protectDelete: true,
  },
  "a new sheet that could not be marked is deleted by undo": {
    wbSeed: 30172,
    applies: [[{ kind: "create_sheet", name: "Report" }]],
    failAt: 2,
  },
  "a backup copy that could not be named is deleted by undo": {
    wbSeed: 30005,
    applies: [[action("edit_rows_columns", { sheet: "Data", action: "transpose", address: "E3:E3", to: "A3" })]],
    failAt: 3,
  },
  "formats copied onto one cell are undone over the whole painted range": {
    wbSeed: 502950,
    applies: [[{ kind: "format_range", sheet: "Data", address: "D3:D3", numberFormat: "0.00", copyFrom: "F9:H12" }]],
  },
  "a second Undo does not let a retried write bring back a cell an older write cleared": {
    wbSeed: 30046,
    applies: [
      [
        { kind: "write_values", sheet: "Notes", cell: "A1", values: [[null, 1]] },
        { kind: "write_values", sheet: "Notes", cell: "A1", values: [[2.5, 0, "=A1+1"], [2.5, "", "x"]] },
      ],
    ],
    undoFails: [1],
  },
  "a second Undo still finds a sheet that the first Undo restored": {
    wbSeed: 20307,
    applies: [
      [{ kind: "create_chart", sheet: "Sales", chartType: "column" }, action("sheet_action", { sheet: "Sales", action: "delete" })],
    ],
    undoFails: [1],
  },
  "a new sheet renamed to the name of a deleted sheet does not block the restore of that sheet": {
    wbSeed: 1041852,
    applies: [
      [
        { kind: "create_sheet", name: "Sales" },
        action("sheet_action", { sheet: "Data", action: "delete" }),
        action("sheet_action", { sheet: "Sales", action: "rename", value: "Data" }),
      ],
    ],
  },
  "the name of a sheet made and deleted in this apply is free for a sheet of the person": {
    wbSeed: 1009715,
    applies: [
      [
        { kind: "create_sheet", name: "Report" },
        action("sheet_action", { sheet: "Report", action: "delete" }),
        action("sheet_action", { sheet: "Data", action: "rename", value: "Report" }),
        { kind: "write_values", sheet: "Report", cell: "C4", values: [[1, 2]] },
      ],
    ],
  },
  "a sheet made and moved in this apply does not shift the place of a restored sheet": {
    wbSeed: 2040456,
    applies: [
      [
        { kind: "create_sheet", name: "Notes" },
        action("sheet_action", { sheet: "Sales", action: "delete" }),
        action("sheet_action", { sheet: "Notes", action: "move", value: 0 }),
      ],
    ],
  },
  "a second Undo keeps sheet positions right": {
    wbSeed: 30218,
    applies: [
      [
        action("sheet_action", { sheet: "Data", action: "delete" }),
        action("sheet_action", { sheet: "Notes", action: "move", value: 3 }),
        action("sheet_action", { sheet: "Sales", action: "move", value: 2 }),
        { kind: "format_range", sheet: "Sales", address: "B8:B9", fill: "#FFFF00" },
      ],
    ],
    undoFails: [4],
  },
};
for (const [name, spec] of Object.entries(regressions))
  test(name, async () => {
    assert.equal(await runCase(spec), undefined);
  });

test("a name given to a sheet by rename means that sheet, not the sheet an earlier rename moved off it", async () => {
  sheetAliases.clear();
  const wb = buildWorkbook(1000);
  const before = snapshot(wb);
  const report = await applyAgentChanges(
    wb.runtime(),
    [
      { kind: "create_sheet", name: "Summary" },
      action("sheet_action", { sheet: "Summary", action: "rename", value: "Report" }),
      action("sheet_action", { sheet: "Data", action: "rename", value: "Summary" }),
      { kind: "write_values", sheet: "Summary", cell: "A1", values: [["zz"]] },
    ],
    async () => ({ ok: true, detail: null }),
  );
  assert.deepEqual(report.results.map((r) => r.status), ["applied", "applied", "applied", "applied"]);
  assert.equal(wb.find("Summary")!.cell(0, 0)?.f, "zz", "the write landed on the renamed Data sheet");
  assert.equal(wb.find("Report")!.cell(0, 0), undefined);
  // The renamed Data sheet is the person's: the write is recorded for undo.
  await undoAgentChanges(wb.runtime(), report.undo, async () => {});
  assert.equal(diff(before, snapshot(wb)), "");
});

test("replay one case (UNDO_SPEC='<json>')", async () => {
  if (!process.env.UNDO_SPEC) return;
  console.log(await runCase(JSON.parse(process.env.UNDO_SPEC)));
});
