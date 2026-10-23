/**
 * A small stateful Office.js / Excel stub for driving the task pane in a real browser
 * (test/ui/taskpane-drive.mts). It is plain browser JavaScript, served in place of
 * https://appsforoffice.microsoft.com/lib/1/hosted/office.js.
 *
 * It models just enough of Excel to run the pane for real: worksheets (values by cell), ranges
 * (address, values, formulas, getCell/getResizedRange/getRow/getSurroundingRegion/getUsedRange...),
 * tables, charts, a movable selection with the DocumentSelectionChanged event, and document settings.
 * Anything it does not model answers with a chainable no-op and is listed in `__xl.misses`, so a
 * test can see which Excel calls the stub could not answer.
 *
 * Input: `window.__XL_DATA__ = { sheets: [{ name, values: unknown[][], table?: string, chart?: string }],
 * selection: { sheet, address } }`, set before this script runs.
 */
(() => {
  const data = window.__XL_DATA__ || { sheets: [], selection: { sheet: "Sheet1", address: "A1" } };
  const misses = new Set();
  const handlers = [];
  const settings = new Map();
  let nextId = 1;
  const state = { delay: 0, syncs: 0, writes: 0, failWrites: false };

  const colName = (index) => {
    let n = index + 1;
    let out = "";
    while (n > 0) {
      const rem = (n - 1) % 26;
      out = String.fromCharCode(65 + rem) + out;
      n = Math.floor((n - 1) / 26);
    }
    return out;
  };
  const colIndex = (letters) => {
    let n = 0;
    for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
    return n - 1;
  };
  const parse = (address) => {
    const text = String(address).includes("!") ? String(address).split("!").pop() : String(address);
    const m = /^\$?([A-Za-z]+)\$?(\d+)(?::\$?([A-Za-z]+)\$?(\d+))?$/.exec(text.trim());
    if (!m) throw Object.assign(new Error(`The stub cannot read the address "${address}"`), { code: "InvalidReference" });
    const c0 = colIndex(m[1]);
    const r0 = Number(m[2]) - 1;
    const c1 = m[3] ? colIndex(m[3]) : c0;
    const r1 = m[4] ? Number(m[4]) - 1 : r0;
    return { r0: Math.min(r0, r1), c0: Math.min(c0, c1), r1: Math.max(r0, r1), c1: Math.max(c0, c1) };
  };
  const quoteSheet = (name) => (/^[A-Za-z_][A-Za-z0-9_.]*$/.test(name) ? name : `'${name.replace(/'/g, "''")}'`);

  /** A chainable no-op for everything the stub does not model. */
  const ghost = (label) =>
    new Proxy(function () {}, {
      get(_, prop) {
        if (prop === "then") return undefined;
        if (prop === Symbol.toPrimitive) return () => "";
        if (prop === "isNullObject") return false;
        if (prop === "items") return [];
        misses.add(`${label}.${String(prop)}`);
        return ghost(`${label}.${String(prop)}`);
      },
      apply() {
        return ghost(`${label}()`);
      },
      set() {
        return true;
      },
    });
  const withFallback = (target, label) =>
    new Proxy(target, {
      get(obj, prop, receiver) {
        if (prop in obj || typeof prop === "symbol" || prop === "then") return Reflect.get(obj, prop, receiver);
        misses.add(`${label}.${String(prop)}`);
        return ghost(`${label}.${String(prop)}`);
      },
      set(obj, prop, value) {
        obj[prop] = value;
        return true;
      },
    });
  const enumLike = () => new Proxy({}, { get: (_, prop) => (typeof prop === "string" ? prop : undefined) });

  const sheets = [];
  const makeSheet = (name, values = []) => {
    const sheet = { id: `{${nextId++}}`, name, cells: new Map(), tables: [], charts: [], visibility: "Visible", deleted: false };
    values.forEach((row, r) => row.forEach((v, c) => {
      if (v !== null && v !== undefined && v !== "") sheet.cells.set(`${r},${c}`, v);
    }));
    sheets.push(sheet);
    return sheet;
  };
  const extent = (sheet) => {
    let r1 = -1, c1 = -1, r0 = Infinity, c0 = Infinity;
    for (const key of sheet.cells.keys()) {
      const [r, c] = key.split(",").map(Number);
      r0 = Math.min(r0, r); c0 = Math.min(c0, c); r1 = Math.max(r1, r); c1 = Math.max(c1, c);
    }
    return r1 < 0 ? undefined : { r0, c0, r1, c1 };
  };
  const find = (key) => sheets.find((s) => !s.deleted && (s.id === key || s.name.toLowerCase() === String(key).toLowerCase()));

  let selection;

  function makeRange(sheet, box) {
    const rows = box.r1 - box.r0 + 1;
    const cols = box.c1 - box.c0 + 1;
    const self = {
      load() {},
      get worksheet() { return wrapSheet(sheet); },
      get rowIndex() { return box.r0; },
      get columnIndex() { return box.c0; },
      get rowCount() { return rows; },
      get columnCount() { return cols; },
      get cellCount() { return rows * cols; },
      get isNullObject() { return false; },
      get address() {
        const a = `${colName(box.c0)}${box.r0 + 1}`;
        const b = `${colName(box.c1)}${box.r1 + 1}`;
        return `${quoteSheet(sheet.name)}!${a === b ? a : `${a}:${b}`}`;
      },
      get values() {
        return Array.from({ length: rows }, (_, r) =>
          Array.from({ length: cols }, (_, c) => sheet.cells.get(`${box.r0 + r},${box.c0 + c}`) ?? ""));
      },
      set values(next) { write(next); },
      get formulas() { return this.values; },
      set formulas(next) { write(next); },
      get valueTypes() {
        return this.values.map((row) => row.map((v) => (v === "" ? "Empty" : typeof v === "number" ? "Double" : "String")));
      },
      numberFormat: undefined,
      select() { selection = { sheet, box }; state.selected = self.address; },
      getCell(r, c) { return makeRange(sheet, { r0: box.r0 + r, c0: box.c0 + c, r1: box.r0 + r, c1: box.c0 + c }); },
      getRow(r) { return makeRange(sheet, { r0: box.r0 + r, c0: box.c0, r1: box.r0 + r, c1: box.c1 }); },
      getColumn(c) { return makeRange(sheet, { r0: box.r0, c0: box.c0 + c, r1: box.r1, c1: box.c0 + c }); },
      getResizedRange(dr, dc) { return makeRange(sheet, { ...box, r1: box.r1 + dr, c1: box.c1 + dc }); },
      getOffsetRange(dr, dc) { return makeRange(sheet, { r0: box.r0 + dr, r1: box.r1 + dr, c0: box.c0 + dc, c1: box.c1 + dc }); },
      getUsedRangeOrNullObject() {
        const inside = { r0: Infinity, c0: Infinity, r1: -1, c1: -1 };
        for (const key of sheet.cells.keys()) {
          const [r, c] = key.split(",").map(Number);
          if (r >= box.r0 && r <= box.r1 && c >= box.c0 && c <= box.c1) {
            inside.r0 = Math.min(inside.r0, r); inside.c0 = Math.min(inside.c0, c);
            inside.r1 = Math.max(inside.r1, r); inside.c1 = Math.max(inside.c1, c);
          }
        }
        return inside.r1 < 0 ? nullObject() : makeRange(sheet, inside);
      },
      getUsedRange() { const used = self.getUsedRangeOrNullObject(); return used.isNullObject ? self.getCell(0, 0) : used; },
      getSurroundingRegion() {
        let b = { ...box };
        const filled = (r, c) => sheet.cells.has(`${r},${c}`);
        for (let grew = true; grew;) {
          grew = false;
          const any = (r0, r1, c0, c1) => { for (let r = r0; r <= r1; r += 1) for (let c = c0; c <= c1; c += 1) if (filled(r, c)) return true; return false; };
          if (b.r0 > 0 && any(b.r0 - 1, b.r0 - 1, Math.max(0, b.c0 - 1), b.c1 + 1)) { b.r0 -= 1; grew = true; }
          if (any(b.r1 + 1, b.r1 + 1, Math.max(0, b.c0 - 1), b.c1 + 1)) { b.r1 += 1; grew = true; }
          if (b.c0 > 0 && any(Math.max(0, b.r0 - 1), b.r1 + 1, b.c0 - 1, b.c0 - 1)) { b.c0 -= 1; grew = true; }
          if (any(Math.max(0, b.r0 - 1), b.r1 + 1, b.c1 + 1, b.c1 + 1)) { b.c1 += 1; grew = true; }
        }
        return makeRange(sheet, b);
      },
      getSpillingToRangeOrNullObject() { return nullObject(); },
      getCellProperties() { return { value: Array.from({ length: rows }, () => Array.from({ length: cols }, () => ({}))), load() {} }; },
      setCellProperties() {},
      clear() { for (let r = box.r0; r <= box.r1; r += 1) for (let c = box.c0; c <= box.c1; c += 1) sheet.cells.delete(`${r},${c}`); state.writes += 1; },
      copyFrom() {},
      merge() {},
      sort: { apply() {} },
      format: ghost("Range.format"),
      conditionalFormats: ghost("Range.conditionalFormats"),
    };
    function write(next) {
      if (state.failWrites)
        throw Object.assign(new Error("Excel could not write the cells."), { code: "GeneralException" });
      if (!Array.isArray(next) || next.length !== rows || next.some((row) => !Array.isArray(row) || row.length !== cols))
        throw Object.assign(new Error("The number of rows or columns in the input array doesn't match the size of the range."), { code: "InvalidArgument" });
      next.forEach((row, r) => row.forEach((v, c) => {
        const key = `${box.r0 + r},${box.c0 + c}`;
        if (v === null || v === "") sheet.cells.delete(key); else sheet.cells.set(key, v);
      }));
      state.writes += 1;
    }
    return withFallback(self, "Range");
  }
  const nullObject = () => ({ isNullObject: true, load() {}, delete() {}, getCell() { return nullObject(); } });

  const wrappers = new WeakMap();
  function wrapSheet(sheet) {
    if (wrappers.has(sheet)) return wrappers.get(sheet);
    const self = {
      load() {},
      get id() { return sheet.id; },
      get name() { return sheet.name; },
      set name(value) { sheet.name = value; },
      get visibility() { return sheet.visibility; },
      set visibility(value) { sheet.visibility = value; },
      get position() { return sheets.filter((s) => !s.deleted).indexOf(sheet); },
      get isNullObject() { return false; },
      customProperties: { add() {}, load() {}, items: [], getItemOrNullObject: () => nullObject() },
      getRange(address) { return makeRange(sheet, parse(address)); },
      getRangeByIndexes(r, c, nr, nc) { return makeRange(sheet, { r0: r, c0: c, r1: r + nr - 1, c1: c + nc - 1 }); },
      getCell(r, c) { return makeRange(sheet, { r0: r, c0: c, r1: r, c1: c }); },
      getUsedRangeOrNullObject() {
        const box = extent(sheet);
        return box ? makeRange(sheet, box) : nullObject();
      },
      getUsedRange() {
        const box = extent(sheet);
        return makeRange(sheet, box ?? { r0: 0, c0: 0, r1: 0, c1: 0 });
      },
      get tables() { return collection(sheet.tables, "Table"); },
      get charts() {
        const col = collection(sheet.charts, "Chart");
        col.add = (type, source) => {
          const chart = chartObject(sheet, type, source);
          sheet.charts.push(chart);
          return chart;
        };
        return col;
      },
      copy() {
        const copy = makeSheet(`${sheet.name} (2)`);
        for (const [k, v] of sheet.cells) copy.cells.set(k, v);
        return wrapSheet(copy);
      },
      delete() { sheet.deleted = true; state.writes += 1; if (selection?.sheet === sheet) selectFirst(); },
      activate() {},
      getNext: () => nullObject(),
    };
    const wrapped = withFallback(self, "Worksheet");
    wrappers.set(sheet, wrapped);
    return wrapped;
  }
  const collection = (items, label) =>
    withFallback(
      {
        load() {},
        get items() { return items; },
        get count() { return items.length; },
        getItemOrNullObject(name) { return items.find((i) => i.name === name) ?? nullObject(); },
        getItem(name) {
          const found = items.find((i) => i.name === name);
          if (!found) throw Object.assign(new Error(`The requested ${label} was not found.`), { code: "ItemNotFound" });
          return found;
        },
        getItemAt: (index) => items[index],
      },
      `${label}s`,
    );
  function chartObject(sheet, type, source) {
    const index = sheet.charts.length + 1;
    const chart = {
      name: `Chart ${index}`,
      chartType: type,
      title: { text: "", visible: true },
      load() {},
      setPosition() {},
      delete() { sheet.charts.splice(sheet.charts.indexOf(chart), 1); state.writes += 1; },
      series: collection([], "Series"),
      axes: ghost("Chart.axes"),
      legend: ghost("Chart.legend"),
      format: ghost("Chart.format"),
      dataLabels: ghost("Chart.dataLabels"),
    };
    state.writes += 1;
    return withFallback(chart, "Chart");
  }

  function selectFirst() {
    const first = sheets.find((s) => !s.deleted);
    selection = { sheet: first, box: { r0: 0, c0: 0, r1: 0, c1: 0 } };
  }

  const worksheetsApi = withFallback(
    {
      load() {},
      get items() { return sheets.filter((s) => !s.deleted).map(wrapSheet); },
      get count() { return sheets.filter((s) => !s.deleted).length; },
      getItem(key) {
        const sheet = find(key);
        if (!sheet) throw Object.assign(new Error("The requested resource doesn't exist."), { code: "ItemNotFound" });
        return wrapSheet(sheet);
      },
      getItemOrNullObject(key) {
        const sheet = find(key);
        return sheet ? wrapSheet(sheet) : nullObject();
      },
      add(name) {
        const wanted = name || `Sheet${sheets.length + 1}`;
        if (find(wanted)) throw Object.assign(new Error("A worksheet with that name already exists."), { code: "InvalidArgument" });
        state.writes += 1;
        return wrapSheet(makeSheet(wanted));
      },
      getActiveWorksheet: () => wrapSheet(selection.sheet),
      getFirst: () => wrapSheet(sheets.find((s) => !s.deleted)),
    },
    "Worksheets",
  );

  const workbook = withFallback(
    {
      worksheets: worksheetsApi,
      get tables() { return collection(sheets.filter((s) => !s.deleted).flatMap((s) => s.tables), "Table"); },
      getSelectedRange: () => makeRange(selection.sheet, selection.box),
      names: collection([], "Name"),
      properties: ghost("Workbook.properties"),
    },
    "Workbook",
  );

  for (const spec of data.sheets) {
    const sheet = makeSheet(spec.name, spec.values);
    const box = extent(sheet);
    if (spec.table && box) {
      const columnsCount = box.c1 - box.c0 + 1;
      sheet.tables.push(
        withFallback(
          {
            name: spec.table,
            id: `tbl${nextId++}`,
            load() {},
            columns: { load() {}, count: columnsCount, getItemAt: () => ghost("Table.column") },
            getRange: () => makeRange(sheet, box),
            getDataBodyRange: () => makeRange(sheet, { ...box, r0: box.r0 + 1 }),
            getHeaderRowRange: () => makeRange(sheet, { ...box, r1: box.r0 }),
            worksheet: wrapSheet(sheet),
            rows: { load() {}, count: box.r1 - box.r0 },
          },
          "TableObject",
        ),
      );
    }
    if (spec.chart) sheet.charts.push(chartObject(sheet, "ColumnClustered", undefined));
  }
  {
    const first = find(data.selection.sheet) ?? sheets[0];
    selection = { sheet: first, box: parse(data.selection.address) };
  }

  window.Office = withFallback(
    {
      onReady: async () => ({ host: "Excel", platform: "OfficeOnline" }),
      context: {
        requirements: { isSetSupported: () => true },
        document: {
          addHandlerAsync(type, handler, callback) {
            handlers.push(handler);
            if (typeof callback === "function") callback({ status: "succeeded" });
          },
          removeHandlerAsync() {},
          settings: {
            get: (key) => (settings.has(key) ? settings.get(key) : null),
            set: (key, value) => settings.set(key, value),
            remove: (key) => settings.delete(key),
            saveAsync: (callback) => typeof callback === "function" && callback({ status: "succeeded" }),
          },
        },
        host: "Excel",
        platform: "OfficeOnline",
      },
      EventType: { DocumentSelectionChanged: "documentSelectionChanged" },
      AsyncResultStatus: { Succeeded: "succeeded", Failed: "failed" },
    },
    "Office",
  );
  window.Excel = new Proxy(
    {
      async run(callback) {
        const context = {
          workbook,
          async sync() {
            state.syncs += 1;
            if (state.delay) await new Promise((resolve) => setTimeout(resolve, state.delay));
          },
          trackedObjects: { add() {}, remove() {} },
        };
        return callback(context);
      },
    },
    { get: (target, prop) => (prop in target ? target[prop] : enumLike()) },
  );

  window.__xl = {
    state,
    misses,
    set delay(value) { state.delay = value; },
    set failWrites(value) { state.failWrites = value; },
    sheetNames: () => sheets.filter((s) => !s.deleted).map((s) => s.name),
    sheet: (name) => {
      const sheet = find(name);
      return sheet ? { cells: [...sheet.cells.entries()], charts: sheet.charts.length, visibility: sheet.visibility } : undefined;
    },
    select(sheetName, address) {
      selection = { sheet: find(sheetName), box: parse(address) };
      for (const handler of handlers) handler({ type: "documentSelectionChanged" });
    },
    selectedAddress: () => makeRange(selection.sheet, selection.box).address,
    handlerCount: () => handlers.length,
  };
})();
