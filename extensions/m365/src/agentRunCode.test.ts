import assert from "node:assert/strict";
import { test } from "node:test";
import {
  PersonalMask,
  runAgent,
  type AgentHost,
  type ToolCall,
} from "./agent.js";

// The agent's run_code tool: the code runs on the device, never on the server.

const call = (id: string, name: string, args: unknown): ToolCall => ({
  id,
  type: "function",
  function: { name, arguments: JSON.stringify(args) },
});

const host = (over: Partial<AgentHost> = {}): AgentHost => ({
  getWorkbook: async () => ({
    sheets: [{ name: "Data", rows: 520126, columns: 10 }],
  }),
  readRange: async (_sheet, address) => ({
    address,
    values: [["Circuit ID"], ["0112005016"]],
  }),
  calculate: async () => [[42]],
  checkStep: async (instruction) =>
    /pivot/i.test(instruction)
      ? { ok: true, understood: "pivot-table" }
      : { ok: false, error: "no action found." },
  ...over,
});

test("run_code: the host runs the restored code; the result goes back masked; limit of 4", async () => {
  const mask = new PersonalMask();
  mask.mask("0112005016"); // the model saw this phone number as [p1]
  const seen: {
    sheet: string;
    areas: string[];
    code: string;
    hasHeaders: boolean;
  }[] = [];
  let turn = 0;
  const run = await runAgent({
    request: "find outliers",
    mask,
    host: host({
      runCode: async (input) => {
        seen.push(input);
        return { result: { outlier: "a@b.lk" }, rows_read: 3 };
      },
    }),
    model: async () => {
      turn += 1;
      if (turn === 1)
        return {
          content: "",
          tool_calls: [
            call("c1", "run_code", {
              sheet: "Data",
              address: "b:b, H2:H9",
              code: 'return rows.filter((r) => r[0] === "[p1]").length;',
            }),
            call("c2", "run_code", {
              sheet: "Data",
              address: "A:C",
              code: "1 + 1",
            }),
          ],
        };
      if (turn === 2)
        return {
          content: "",
          tool_calls: Array.from({ length: 4 }, (_, i) =>
            call(`d${i}`, "run_code", {
              sheet: "Data",
              address: "A1:C9",
              code: "return 1;",
              has_headers: false,
            }),
          ),
        };
      return { content: "done", tool_calls: [] };
    },
  });
  const results = run.messages
    .filter((m) => m.role === "tool")
    .map((m: any) => m.content as string);
  assert.deepEqual(seen[0].areas, ["B:B", "H2:H9"]);
  assert.equal(seen[0].hasHeaders, true);
  assert.match(seen[0].code, /=== "0112005016"/);
  assert.match(results[0], /\[p2\]/); // the e-mail in the result is masked
  assert.doesNotMatch(results[0], /a@b\.lk/);
  assert.match(results[1], /must return/);
  assert.equal(seen[1].hasHeaders, false);
  assert.match(results[5], /already ran code 4 times/);
});

test("run_code: a host without it says so", async () => {
  let turn = 0;
  const run = await runAgent({
    request: "x",
    mask: new PersonalMask(),
    host: host(),
    model: async () =>
      ++turn === 1
        ? {
            content: "",
            tool_calls: [
              call("c", "run_code", {
                sheet: "Data",
                address: "A:A",
                code: "return 1;",
              }),
            ],
          }
        : { content: "ok", tool_calls: [] },
  });
  assert.match((run.messages[2] as any).content, /not available/);
});
