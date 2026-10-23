import assert from "node:assert/strict";
import test from "node:test";
import type { AgentHost, StagedChange } from "./agent.js";
import { evaluateJoins } from "./resultCheck.js";

const change: { change: StagedChange } = {
  change: {
    kind: "excel_action",
    tool: "combine_tables",
    args: {
      mode: "join",
      left_sheet: "Orders",
      left_address: "A1:C4",
      right_sheet: "Customers",
      right_address: "A1:B3",
      key: "Customer",
      columns: ["Region"],
      sheet: "Result",
      cell: "A1",
    },
  } as StagedChange,
};

const hostWith = (errors: number, missing: number, rows: number) =>
  ({
    readRange: async (sheet: string) => ({
      address: "A1",
      values: [sheet === "Orders" ? ["Order", "Customer", "Amount"] : ["Customer", "Region"]],
    }),
    calculate: async (formula: string) =>
      [[formula.includes("ISERROR") ? errors : formula.includes("ROWS(") ? rows : missing]],
  }) as unknown as AgentHost;

test("a join that errors on the real cells is reported", async () => {
  const issues = await evaluateJoins([change], hostWith(3, 0, 10));
  assert.equal(issues.length, 1);
  assert.match(issues[0], /3 error value/);
});

test("a join where most rows say Not found is reported", async () => {
  const issues = await evaluateJoins([change], hostWith(0, 8, 10));
  assert.match(issues[0], /Not found/);
});

test("a clean join, other changes and a failing calculate give no issue", async () => {
  assert.deepEqual(await evaluateJoins([change], hostWith(0, 1, 10)), []);
  assert.deepEqual(
    await evaluateJoins(
      [{ change: { kind: "write_values", sheet: "S", cell: "A1", values: [[1]] } as StagedChange }],
      hostWith(5, 5, 1),
    ),
    [],
  );
  const broken = { ...hostWith(0, 0, 1), calculate: async () => { throw new Error("x"); } } as AgentHost;
  assert.deepEqual(await evaluateJoins([change], broken), []);
});
