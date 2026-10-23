import assert from "node:assert/strict";
import { test } from "node:test";
import { deleteHiddenSheets, mergeUndoData, undoAgentChanges } from "./officeAgentHost.js";

const emptyUndo: any = {
  steps: ["a", "b", "c"],
  journal: [],
  restores: [
    { sheet: "S", address: "L2:L301", formulas: undefined },
    { sheet: "S", address: "M2:M5", formulas: undefined },
  ],
  formats: [],
  backups: [],
  charts: [],
  createdSheets: [],
  tableSizes: [],
};

test("one step that cannot be undone does not stop the others, and the error names it", async () => {
  const cleared: string[] = [];
  const sheet = {
    getRange: (address: string) => ({
      clear: () => {
        if (address === "L2:L301") throw new Error("cannot clear");
        cleared.push(address);
      },
    }),
  };
  const context: any = {
    sync: async () => {},
    workbook: {
      worksheets: {
        getItemOrNullObject: () => ({ isNullObject: false, load() {}, ...sheet }),
      },
      tables: { getItemOrNullObject: () => ({ isNullObject: true, load() {} }) },
    },
  };
  const ran: string[] = [];
  await assert.rejects(
    undoAgentChanges({ run: (fn: any) => fn(context) } as any, emptyUndo, async (rollback) => {
      ran.push(String(rollback));
      if (rollback === "b") throw new Error("step b broke");
    }),
    /could not finish 2 step\(s\).*step b broke.*restore S!L2:L301.*cannot clear/s,
  );
  assert.deepEqual(ran, ["c", "b", "a"]);
  assert.deepEqual(cleared, ["M2:M5"]);
});

const fakeRuntime = (log: string[], failing = new Set<string>()): any => {
  const context: any = {
    sync: async () => {},
    workbook: {
      worksheets: {
        getItemOrNullObject: (key: string) => ({
          isNullObject: false,
          load() {},
          delete: () => log.push(`delete ${key}`),
          getRange: (address: string) => ({
            clear: () => {
              if (failing.has(address)) throw new Error("cannot clear");
              log.push(`clear ${key}!${address}`);
            },
          }),
        }),
      },
      tables: { getItemOrNullObject: () => ({ isNullObject: true, load() {} }) },
    },
  };
  return { run: (fn: any) => fn(context) };
};

const twoChanges = (): any => ({
  createdSheets: [],
  steps: ["step-of-change-1"],
  journal: [],
  restores: [{ sheet: "S", address: "A1:A2", formulas: null }],
  formats: [],
  backups: [],
  charts: [],
  tableSizes: [],
  // change 1 = the step, change 2 = a write after it
  marks: [
    { steps: 0, journal: 0, tableSizes: 0, restores: 0, formats: 0, backups: 0, charts: 0, createdSheets: 0 },
    { steps: 1, journal: 0, tableSizes: 0, restores: 0, formats: 0, backups: 0, charts: 0, createdSheets: 0 },
  ],
});

test("undo walks the changes newest first: a write after a step is undone before the step", async () => {
  const log: string[] = [];
  await undoAgentChanges(fakeRuntime(log), twoChanges(), async (rollback) => {
    log.push(String(rollback));
  });
  assert.deepEqual(log, ["clear S!A1:A2", "step-of-change-1"]);
});

test("a second Undo only runs the part that did not come back", async () => {
  const log: string[] = [];
  const undo = twoChanges();
  const failing = new Set(["A1:A2"]);
  await assert.rejects(
    undoAgentChanges(fakeRuntime(log, failing), undo, async (rollback) => {
      log.push(String(rollback));
    }),
    /could not finish 1 step/,
  );
  assert.deepEqual(log, ["step-of-change-1"]);
  failing.clear();
  await undoAgentChanges(fakeRuntime(log, failing), undo, async (rollback) => {
    log.push(String(rollback));
  });
  // The step was not run twice; only the failed write came back.
  assert.deepEqual(log, ["step-of-change-1", "clear S!A1:A2"]);
});

test("two applies keep their order after mergeUndoData", async () => {
  const a: any = { ...twoChanges() };
  const b: any = {
    createdSheets: [], steps: ["step-of-apply-2"], journal: [], restores: [],
    formats: [], backups: [], charts: [], tableSizes: [],
    marks: [{ steps: 0, journal: 0, tableSizes: 0, restores: 0, formats: 0, backups: 0, charts: 0, createdSheets: 0 }],
  };
  const merged = mergeUndoData(a, b);
  const log: string[] = [];
  await undoAgentChanges(fakeRuntime(log), merged, async (rollback) => {
    log.push(String(rollback));
  });
  assert.deepEqual(log, ["step-of-apply-2", "clear S!A1:A2", "step-of-change-1"]);
});

test("a sheet restored from its hidden copy is found again under its old id by earlier changes", async () => {
  const asked: string[] = [];
  const context: any = {
    sync: async () => {},
    workbook: {
      worksheets: {
        getItemOrNullObject: (key: string) => {
          asked.push(key);
          return {
            isNullObject: false,
            load() {},
            customProperties: { getItemOrNullObject: () => ({ delete() {} }) },
            getRange: () => ({ clear() {} }),
          };
        },
      },
      tables: { getItemOrNullObject: () => ({ isNullObject: true, load() {} }) },
    },
  };
  const undo: any = {
    createdSheets: [], steps: [], formats: [], backups: [], charts: [], tableSizes: [],
    restores: [{ sheet: "OLD", address: "A1:A2", formulas: null }],
    journal: [
      { type: "inverse", tool: "sheet_action", data: { restoreId: "COPY", oldId: "OLD", name: "X", position: 0 } },
    ],
    // change 1 wrote to OLD, change 2 deleted it (soft)
    marks: [
      { steps: 0, journal: 0, tableSizes: 0, restores: 0, formats: 0, backups: 0, charts: 0, createdSheets: 0 },
      { steps: 0, journal: 0, tableSizes: 0, restores: 1, formats: 0, backups: 0, charts: 0, createdSheets: 0 },
    ],
  };
  await undoAgentChanges({ run: (fn: any) => fn(context) } as any, undo, async () => {});
  // The delete is undone first (asks for COPY); the earlier write then goes to COPY, not to OLD.
  assert.ok(asked.indexOf("COPY") >= 0);
  assert.equal(asked.includes("OLD"), false);
});

test("a hidden backup that cannot be deleted is reported, the others are still deleted", async () => {
  const deleted: string[] = [];
  const context: any = {
    sync: async () => {},
    workbook: {
      worksheets: {
        getItemOrNullObject: (key: string) => ({
          isNullObject: false,
          load() {},
          delete: () => {
            if (key === "B2") throw new Error("protected");
            deleted.push(key);
          },
        }),
      },
    },
  };
  const left = await deleteHiddenSheets({ run: (fn: any) => fn(context) } as any, ["B1", "B2", "B3"]);
  assert.deepEqual(left, ["B2"]);
  assert.deepEqual(deleted, ["B1", "B3"]);
});
