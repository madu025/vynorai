import assert from "node:assert/strict";
import { test } from "node:test";
import { undoAgentChanges } from "./officeAgentHost.js";

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
