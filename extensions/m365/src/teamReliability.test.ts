/**
 * The agent team (planner, builder, two reviewers, one correction) under the conditions that must
 * hold in production: helpers cannot write, a failed helper never loses the work, the number of
 * model runs per request is bounded, and the person always gets a reply.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  PersonalMask,
  type AgentHost,
  type AgentMessage,
  type ToolCall,
} from "./agent.js";
import { runTeam } from "./agentReview.js";

const call = (id: string, name: string, args: unknown): ToolCall => ({
  id,
  type: "function",
  function: { name, arguments: JSON.stringify(args) },
});
const host: AgentHost = {
  getWorkbook: async () => ({ sheets: [{ name: "Data", rows: 11, columns: 3 }] }),
  readRange: async (_sheet, address) => ({ address, values: [["Amount"], [5]] }),
  calculate: async () => [[50]],
  checkStep: async () => ({ ok: false, error: "no action found." }),
};
const lastUser = (messages: AgentMessage[]) =>
  String([...messages].reverse().find((m) => m.role === "user")?.content ?? "");
const fresh = (messages: AgentMessage[]) =>
  messages[messages.length - 1].role === "user";

type Role = "planner" | "builder" | "reviewer" | "reviser";
const roleOf = (messages: AgentMessage[]): Role => {
  const user = lastUser(messages);
  if (/You are the planner/.test(user)) return "planner";
  if (/You are the reviewer/.test(user)) return "reviewer";
  if (/A reviewer checked/.test(user)) return "reviser";
  return "builder";
};

/** A team model: every call is counted by role, and each role can be told to behave or fail. */
function team(
  behave: Partial<Record<Role, (messages: AgentMessage[]) => Promise<any> | any>> = {},
) {
  const runs: Record<Role, number> = { planner: 0, builder: 0, reviewer: 0, reviser: 0 };
  const calls: Role[] = [];
  const model = async (messages: AgentMessage[]) => {
    const role = roleOf(messages);
    calls.push(role);
    if (fresh(messages)) runs[role] += 1;
    const custom = behave[role];
    if (custom) return custom(messages);
    if (role === "planner") return { content: "PLAN:\n1. Add the total", tool_calls: [] };
    if (role === "reviewer") return { content: "VERDICT: OK", tool_calls: [] };
    if (fresh(messages))
      return {
        content: "",
        tool_calls: [
          call("w", "write_formula", { sheet: "Data", cell: "C12", formula: "=SUM(C2:C11)" }),
        ],
      };
    return { content: "- Added a total in C12.", tool_calls: [] };
  };
  return { model, runs, calls };
}

const request = "Add a total under Amount";
const go = (model: (m: AgentMessage[]) => Promise<any>) =>
  runTeam({ request, host, model, mask: new PersonalMask() });

test("a reviewer that tries to write changes nothing: only the builder's changes are staged", async () => {
  const t = team({
    reviewer: async (messages) =>
      fresh(messages)
        ? {
            content: "",
            tool_calls: [
              call("x", "write_values", { sheet: "Data", cell: "A1", values: [["HACKED"]] }),
              call("y", "excel_action", {}),
            ],
          }
        : { content: "VERDICT: OK", tool_calls: [] },
  });
  const result = await go(t.model);
  assert.equal(result.run.changes.length, 1);
  assert.equal(result.run.changes[0].change.kind, "write_formula");
  assert.ok(
    !JSON.stringify(result.run.changes).includes("HACKED"),
    "no helper change reaches the person's approval list",
  );
});

test("when every reviewer fails, the builder's work is still returned with a reply", async () => {
  const t = team({
    reviewer: async () => {
      throw Object.assign(new Error("HTTP_503"), { code: "HTTP_503" });
    },
  });
  const result = await go(t.model);
  assert.equal(result.run.changes.length, 1);
  assert.ok(result.run.reply.length > 0);
  assert.equal(result.revised, false);
});

test("when the planner fails, the builder still works", async () => {
  const t = team({
    planner: async () => {
      throw new Error("network");
    },
  });
  const result = await go(t.model);
  assert.equal(result.run.changes.length, 1);
  assert.equal(result.plan, undefined);
});

test("the worst case is bounded: one planner run, one builder, two reviewers, one correction, two re-reviews at most", async () => {
  // Reviewers always say FIX and the builder always restages: the team must still stop.
  const t = team({
    reviewer: async (messages) =>
      fresh(messages)
        ? { content: "", tool_calls: [call("c", "calculate", { formula: "=1" })] }
        : { content: "VERDICT: FIX\n- C12 is wrong", tool_calls: [] },
  });
  const result = await go(t.model);
  assert.equal(t.runs.planner, 1);
  assert.equal(t.runs.builder, 1);
  assert.equal(t.runs.reviewer, 2, "two reviewers, once each");
  assert.ok(t.runs.reviser <= 1, "one correction round");
  assert.ok(result.run.reply.length > 0);
  assert.ok(t.calls.length <= 30, `${t.calls.length} model calls`);
});

test("a question is answered by the builder alone: no planner and no reviewers", async () => {
  const t = team({
    builder: async () => ({ content: "- The total is 50.", tool_calls: [] }),
  });
  const result = await runTeam({
    request: "What is the total of Amount?",
    host,
    model: t.model,
    mask: new PersonalMask(),
  });
  assert.equal(t.runs.planner, 0);
  assert.equal(t.runs.reviewer, 0);
  assert.equal(result.run.reply, "- The total is 50.");
});

test("a read-only audit request is not planned either", async () => {
  const t = team({
    builder: async () => ({ content: "- No formula errors.", tool_calls: [] }),
  });
  await runTeam({
    request: "audit every formula in this workbook for errors",
    host,
    model: t.model,
    mask: new PersonalMask(),
  });
  assert.equal(t.runs.planner, 0);
});

test("a silent builder still gives the person a reply", async () => {
  const t = team({ builder: async () => ({ content: "", tool_calls: [] }) });
  const result = await go(t.model);
  assert.ok(result.run.reply.trim().length > 0);
});
