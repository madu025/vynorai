/**
 * An in-memory Excel workbook for the benchmark: every value, formula, number format and style that
 * the add-in writes lands in a real cell grid, so a result sheet can be graded cell by cell after
 * apply. Two host profiles: "desktop" (Microsoft 365: PivotTables and slicers work) and "web"
 * (the PivotTable is refused and there are no slicers, as Excel on the web does for some sources).
 * Formulas are stored, not calculated; graders check what was written, the live add-in checks values.
 */
export type HostProfile = "desktop" | "web";

export interface GridCell {
  value?: unknown;
  formula?: string;
  numberFormat?: string;
  style: Record<string, unknown>;
}

export interface GridSheet {
  name: string;
  cells: Map<string, GridCell>;
  charts: Array<{
    type: string;
    name?: string;
    title?: string;
    from?: string;
    to?: string;
  }>;
  pivots: Array<{
    name: string;
    anchor: string;
    rows: string[];
    values: string[];
  }>;
  slicers: Array<{ field: string; name?: string; caption?: string }>;
  conditional: string[];
  columnWidths: Map<number, number>;
  properties: Record<string, string>;
  showGridlines?: boolean;
}

const key = (row: number, col: number) => `${row},${col}`;

export function columnIndex(letters: string): number {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export function columnName(index: number): string {
  let n = index;
  let out = "";
  do {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
}

function parseAddress(address: string): {
  r0: number;
  c0: number;
  rows: number;
  cols: number;
} {
  const local = address.includes("!")
    ? address.slice(address.lastIndexOf("!") + 1)
    : address;
  const [a, b] = local.replace(/\$/g, "").split(":");
  const cell = (text: string) => {
    const match = /^([A-Z]+)(\d+)$/i.exec(text);
    if (!match) throw new Error(`gridWorkbook: unsupported address ${address}`);
    return { col: columnIndex(match[1]), row: Number(match[2]) - 1 };
  };
  const start = cell(a);
  const end = b ? cell(b) : start;
  return {
    r0: Math.min(start.row, end.row),
    c0: Math.min(start.col, end.col),
    rows: Math.abs(end.row - start.row) + 1,
    cols: Math.abs(end.col - start.col) + 1,
  };
}

/** A recorder object: every property set on it (deeply) is stored under a dotted path. */
function recorder(store: Record<string, unknown>, prefix = ""): any {
  const children = new Map<string, any>();
  return new Proxy(
    {},
    {
      get(_target, prop) {
        if (typeof prop !== "string") return undefined;
        if (prop === "load") return () => undefined;
        if (
          prop === "autofitColumns" ||
          prop === "autofitRows" ||
          prop === "clear"
        )
          return () => undefined;
        const path = prefix ? `${prefix}.${prop}` : prop;
        if (path in store) return store[path];
        if (!children.has(prop)) children.set(prop, recorder(store, path));
        return children.get(prop);
      },
      set(_target, prop, value) {
        store[prefix ? `${prefix}.${String(prop)}` : String(prop)] = value;
        return true;
      },
    },
  );
}

export function gridWorkbook(
  sheetName: string,
  source: unknown[][],
  options: { host?: HostProfile; sourceFormats?: string[] } = {},
) {
  const host = options.host ?? "desktop";
  const sheets = new Map<string, GridSheet>();
  const objectNames = new Set<string>();
  const calls: string[] = [];

  const cellOf = (sheet: GridSheet, row: number, col: number) => {
    let cell = sheet.cells.get(key(row, col));
    if (!cell) {
      cell = { style: {} };
      sheet.cells.set(key(row, col), cell);
    }
    return cell;
  };

  const usedBounds = (sheet: GridSheet) => {
    let rows = 0;
    let cols = 0;
    for (const [k, cell] of sheet.cells) {
      if (cell.value === undefined && cell.formula === undefined) continue;
      const [r, c] = k.split(",").map(Number);
      rows = Math.max(rows, r + 1);
      cols = Math.max(cols, c + 1);
    }
    return { rows, cols };
  };

  const makeRange = (
    sheet: GridSheet,
    r0: number,
    c0: number,
    rows: number,
    cols: number,
  ): any => {
    const grid = <T>(
      read: (cell: GridCell | undefined, r: number, c: number) => T,
    ): T[][] =>
      Array.from({ length: rows }, (_, r) =>
        Array.from({ length: cols }, (_, c) =>
          read(sheet.cells.get(key(r0 + r, c0 + c)), r, c),
        ),
      );
    const broadcast = (value: unknown, r: number, c: number) =>
      Array.isArray(value) ? (value as unknown[][])[r]?.[c] : value;
    const styleStore: Record<string, unknown> = {};
    const format = recorder(styleStore);
    const applyStyle = () => {
      // Style is applied when the test reads it back; keep the newest settings on every cell.
      for (let r = 0; r < Math.min(rows, 200); r += 1)
        for (let c = 0; c < Math.min(cols, 60); c += 1)
          Object.assign(cellOf(sheet, r0 + r, c0 + c).style, styleStore);
    };
    const range: any = {
      worksheet: sheetObject(sheet),
      load: () => applyStyle(),
      get address() {
        return `${sheet.name}!${columnName(c0)}${r0 + 1}:${columnName(c0 + cols - 1)}${r0 + rows}`;
      },
      rowCount: rows,
      columnCount: cols,
      isNullObject: false,
      get left() {
        let left = 0;
        for (let c = 0; c < c0; c += 1) left += sheet.columnWidths.get(c) ?? 48;
        return left;
      },
      get top() {
        return r0 * 15;
      },
      get values() {
        return grid((cell) => cell?.value ?? "");
      },
      set values(value: unknown) {
        for (let r = 0; r < rows; r += 1)
          for (let c = 0; c < cols; c += 1) {
            const v = broadcast(value, r, c);
            const cell = cellOf(sheet, r0 + r, c0 + c);
            if (typeof v === "string" && v.startsWith("=")) {
              cell.formula = v;
              cell.value = 0;
            } else {
              cell.value = v;
              delete cell.formula;
            }
          }
      },
      get formulas() {
        return grid((cell) => cell?.formula ?? cell?.value ?? "");
      },
      set formulas(value: unknown) {
        for (let r = 0; r < rows; r += 1)
          for (let c = 0; c < cols; c += 1) {
            const v = broadcast(value, r, c);
            const cell = cellOf(sheet, r0 + r, c0 + c);
            if (typeof v === "string" && v.startsWith("=")) {
              cell.formula = v;
              cell.value = 0;
            } else {
              // A leading apostrophe keeps text that looks like a formula as text.
              cell.value =
                typeof v === "string" && v.startsWith("'") ? v.slice(1) : v;
              delete cell.formula;
            }
          }
      },
      get numberFormat() {
        return grid(
          (cell, r, c) =>
            cell?.numberFormat ??
            (sheet.name === sheetName && r0 + r > 0
              ? options.sourceFormats?.[c0 + c]
              : undefined) ??
            "General",
        );
      },
      set numberFormat(value: unknown) {
        // Whole-column formats are recorded on the first rows only.
        for (let r = 0; r < Math.min(rows, 2000); r += 1)
          for (let c = 0; c < cols; c += 1)
            cellOf(sheet, r0 + r, c0 + c).numberFormat = String(
              broadcast(value, r, c),
            );
      },
      format: new Proxy(format, {
        get(target, prop) {
          if (prop === "columnWidth") return sheet.columnWidths.get(c0) ?? 48;
          const value = target[prop as any];
          queueMicrotask(applyStyle);
          return value;
        },
        set(target, prop, value) {
          if (prop === "columnWidth") {
            for (let c = 0; c < cols; c += 1)
              sheet.columnWidths.set(c0 + c, Number(value));
            return true;
          }
          target[prop as any] = value;
          queueMicrotask(applyStyle);
          return true;
        },
      }),
      conditionalFormats: {
        add(type: string) {
          sheet.conditional.push(type);
          return recorder({});
        },
      },
      dataValidation: recorder({}),
      getCell: (r: number, c: number) => makeRange(sheet, r0 + r, c0 + c, 1, 1),
      getResizedRange: (dr: number, dc: number) =>
        makeRange(sheet, r0, c0, rows + dr, cols + dc),
      getAbsoluteResizedRange: (nr: number, nc: number) =>
        makeRange(sheet, r0, c0, nr, nc),
      getOffsetRange: (dr: number, dc: number) =>
        makeRange(sheet, r0 + dr, c0 + dc, rows, cols),
      getRow: (i: number) => makeRange(sheet, r0 + i, c0, 1, cols),
      getColumn: (i: number) => makeRange(sheet, r0, c0 + i, rows, 1),
      getSurroundingRegion: () => {
        const used = usedBounds(sheet);
        return makeRange(
          sheet,
          0,
          0,
          Math.max(1, used.rows),
          Math.max(1, used.cols),
        );
      },
      getUsedRangeOrNullObject: () => {
        const used = usedBounds(sheet);
        return makeRange(
          sheet,
          0,
          0,
          Math.max(1, used.rows),
          Math.max(1, used.cols),
        );
      },
      merge: () => undefined,
      select: () => undefined,
    };
    return range;
  };

  const sheetObjects = new Map<GridSheet, any>();
  function sheetObject(sheet: GridSheet): any {
    const known = sheetObjects.get(sheet);
    if (known) return known;
    const object: any = {
      get name() {
        return sheet.name;
      },
      load: () => undefined,
      isNullObject: false,
      set showGridlines(value: boolean) {
        sheet.showGridlines = value;
      },
      get showGridlines() {
        return sheet.showGridlines ?? true;
      },
      position: 0,
      visibility: "Visible",
      tabColor: "",
      customProperties: {
        add: (k: string, v: string) => {
          sheet.properties[k] = v;
        },
      },
      freezePanes: {
        freezeRows: () => undefined,
        freezeColumns: () => undefined,
      },
      getRange: (address = "A1") => {
        const at = parseAddress(address);
        return makeRange(sheet, at.r0, at.c0, at.rows, at.cols);
      },
      getRangeByIndexes: (r: number, c: number, rows: number, cols: number) =>
        makeRange(sheet, r, c, rows, cols),
      getUsedRangeOrNullObject: () => {
        const used = usedBounds(sheet);
        return makeRange(
          sheet,
          0,
          0,
          Math.max(1, used.rows),
          Math.max(1, used.cols),
        );
      },
      activate: () => undefined,
      delete: () => {
        sheets.delete(sheet.name);
      },
      tables: {
        add: () => {
          const table: any = recorder({});
          return table;
        },
      },
      charts: {
        getItemOrNullObject: (name: string) => ({
          isNullObject: !sheet.charts.some((chart) => chart.name === name),
          load: () => undefined,
        }),
        add(type: string) {
          const entry: GridSheet["charts"][number] = { type };
          sheet.charts.push(entry);
          const chart: any = recorder({});
          return new Proxy(chart, {
            get(target, prop) {
              if (prop === "setPosition")
                return (from: string, to?: string) => {
                  entry.from = from;
                  entry.to = to;
                };
              if (prop === "title")
                return new Proxy(
                  {},
                  {
                    set(_t, p, v) {
                      if (p === "text") entry.title = String(v);
                      return true;
                    },
                  },
                );
              return target[prop as any];
            },
            set(target, prop, value) {
              if (prop === "name") entry.name = String(value);
              target[prop as any] = value;
              return true;
            },
          });
        },
      },
      pivotTables: {
        add(name: string, _source: unknown, destination: any) {
          calls.push(`pivot.add ${name}`);
          if (host === "web")
            throw Object.assign(new Error("This operation is not supported."), {
              code: "NotImplemented",
            });
          const entry = {
            name: String(name),
            anchor:
              String(destination.address).split("!")[1]?.split(":")[0] ?? "",
            rows: [] as string[],
            values: [] as string[],
          };
          sheet.pivots.push(entry);
          objectNames.add(entry.name);
          return {
            name: entry.name,
            load: () => undefined,
            delete: () => {
              sheet.pivots.splice(sheet.pivots.indexOf(entry), 1);
            },
            hierarchies: {
              load: () => undefined,
              items: [],
              getItem: (field: string) => field,
            },
            rowHierarchies: { add: (field: string) => entry.rows.push(field) },
            columnHierarchies: { add: () => undefined },
            filterHierarchies: { add: () => undefined },
            dataHierarchies: {
              add: (field: string) => {
                entry.values.push(field);
                return recorder({});
              },
            },
            layout: {
              getRange: () => makeRange(sheet, 0, 0, 5, 2),
              showRowGrandTotals: true,
            },
          };
        },
      },
    };
    sheetObjects.set(sheet, object);
    return object;
  }

  const addSheet = (name: string): GridSheet => {
    const sheet: GridSheet = {
      name,
      cells: new Map(),
      charts: [],
      pivots: [],
      slicers: [],
      conditional: [],
      columnWidths: new Map(),
      properties: {},
    };
    sheets.set(name, sheet);
    return sheet;
  };

  const sourceSheet = addSheet(sheetName);
  source.forEach((row, r) =>
    row.forEach((value, c) => {
      if (value !== null && value !== undefined)
        cellOf(sourceSheet, r, c).value = value;
    }),
  );
  const sourceRows = source.length;
  const sourceCols = Math.max(...source.map((row) => row.length));

  const workbook: any = {
    getSelectedRange: () =>
      makeRange(sourceSheet, 0, 0, sourceRows, sourceCols),
    worksheets: {
      load: () => undefined,
      get items() {
        return [...sheets.values()].map(sheetObject);
      },
      getItem: (name: string) => {
        const sheet = sheets.get(name);
        if (!sheet) throw new Error(`gridWorkbook: no sheet ${name}`);
        return sheetObject(sheet);
      },
      getItemOrNullObject: (name: string) => {
        const sheet = sheets.get(name);
        return sheet
          ? sheetObject(sheet)
          : { isNullObject: true, load: () => undefined };
      },
      add: (name: string) => sheetObject(addSheet(name)),
      getActiveWorksheet: () => sheetObject(sourceSheet),
    },
    pivotTables: {
      load: () => undefined,
      items: [],
      getItemOrNullObject: (name: string) => ({
        isNullObject: !objectNames.has(name),
        load: () => undefined,
      }),
    },
    tables: {
      load: () => undefined,
      items: [],
      getItemOrNullObject: () => ({
        isNullObject: true,
        load: () => undefined,
      }),
    },
    names: {
      load: () => undefined,
      items: [],
      add: (name: string) => objectNames.add(name),
      getItemOrNullObject: () => ({
        isNullObject: true,
        load: () => undefined,
      }),
    },
    ...(host === "desktop"
      ? {
          slicers: {
            load: () => undefined,
            items: [],
            add(_pivot: unknown, field: string, sheet: any) {
              const target = sheets.get(String(sheet.name));
              const entry: GridSheet["slicers"][number] = {
                field: String(field),
              };
              target?.slicers.push(entry);
              return new Proxy({} as any, {
                set(object, prop, value) {
                  if (prop === "name") entry.name = String(value);
                  if (prop === "caption") entry.caption = String(value);
                  object[prop] = value;
                  return true;
                },
              });
            },
          },
        }
      : {}),
  };

  return {
    calls,
    sheets,
    runtime: {
      run: <T>(callback: (context: any) => Promise<T>) =>
        callback({
          workbook,
          sync: async () => {
            await Promise.resolve();
          },
        }),
    },
    supportsExcelApi: (version: string) =>
      host === "desktop" ? true : Number(version.split(".")[1] ?? 0) <= 9,
  };
}

/** Text of a cell for graders: the formula when there is one, else the value. */
export function cellText(sheet: GridSheet, row: number, col: number): string {
  const cell = sheet.cells.get(`${row},${col}`);
  if (!cell) return "";
  return String(cell.formula ?? cell.value ?? "");
}

/** Every filled cell of a sheet as [row, col, text]. */
export function filledCells(
  sheet: GridSheet,
): Array<[number, number, string, GridCell]> {
  const out: Array<[number, number, string, GridCell]> = [];
  for (const [k, cell] of sheet.cells) {
    if (cell.value === undefined && cell.formula === undefined) continue;
    if (cell.value === "" && cell.formula === undefined) continue;
    const [r, c] = k.split(",").map(Number);
    out.push([r, c, String(cell.formula ?? cell.value), cell]);
  }
  return out.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}
