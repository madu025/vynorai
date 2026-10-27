import assert from "node:assert/strict";
import test from "node:test";
import { AgentToolError, clampReadAddress, type AgentHost } from "./agent.js";
import { guardCombine } from "./combineGuard.js";

const tables: Record<string, unknown[][]> = {
  "Orders!A1:C4": [
    ["Order", "Customer", "Amount"],
    [1, "C-1", 10],
    [2, "C-2", 20],
    [3, "C-9", 5],
  ],
  "Customers!A1:B3": [
    ["Customer", "Region"],
    ["C-1", "East"],
    ["c-2 ", "West"],
  ],
  "Other!A1:B3": [
    ["Code", "Name"],
    ["X", "x"],
    ["Y", "y"],
  ],
};
const host = {
  readRange: async (sheet: string, address: string) => ({
    address,
    values: tables[`${sheet}!${address}`],
  }),
} as unknown as AgentHost;

const join = (over: Record<string, unknown> = {}) => ({
  mode: "join",
  left_sheet: "Orders",
  left_address: "A1:C4",
  right_sheet: "Customers",
  right_address: "A1:B3",
  key: "Customer",
  sheet: "Result",
  cell: "A1",
  ...over,
});

test("a join onto a new sheet with matching keys passes (case and spaces ignored)", async () => {
  await guardCombine(join(), host, clampReadAddress);
});

test("a join written on its source sheet is refused (it would spill into the table)", async () => {
  await assert.rejects(
    guardCombine(join({ sheet: "Orders" }), host, clampReadAddress),
    AgentToolError,
  );
});

test("a join whose keys barely match is refused instead of filling Not found", async () => {
  await assert.rejects(
    guardCombine(
      join({
        right_sheet: "Other",
        right_address: "A1:B3",
        key: "Customer",
        right_key: "Code",
      }),
      host,
      clampReadAddress,
    ),
    /exist in/,
  );
});

test("a join refuses duplicate right-side keys instead of silently taking the first match", async () => {
  const duplicateHost = {
    readRange: async (sheet: string, address: string) => ({
      address,
      values:
        sheet === "Customers"
          ? [
              ["Customer", "Region"],
              ["C-1", "East"],
              ["C-1", "West"],
            ]
          : tables[`${sheet}!${address}`],
    }),
  } as unknown as AgentHost;
  await assert.rejects(
    guardCombine(join(), duplicateHost, clampReadAddress),
    /duplicate value.*XLOOKUP/i,
  );
});

test("a key column that does not exist is named", async () => {
  await assert.rejects(
    guardCombine(join({ key: "Region" }), host, clampReadAddress),
    /no column "Region"/,
  );
});
