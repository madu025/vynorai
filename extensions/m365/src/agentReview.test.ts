import assert from "node:assert/strict";
import { test } from "node:test";
import {
  PersonalMask,
  runAgent,
  type AgentHost,
  type AgentMessage,
  type ToolCall,
} from "./agent.js";
import {
  describeReview,
  parseReview,
  reviewAndRevise,
  reviewRequest,
  revisionRequest,
} from "./agentReview.js";

const call = (id: string, name: string, args: unknown): ToolCall => ({
  id,
  type: "function",
  function: { name, arguments: JSON.stringify(args) },
});

const host: AgentHost = {
  getWorkbook: async () => ({
    sheets: [{ name: "Data", rows: 11, columns: 3 }],
  }),
  readRange: async (_sheet, address) => ({
    address,
    values: [["Amount"], [5]],
  }),
  calculate: async () => [[50]],
  checkStep: async () => ({ ok: false, error: "no action found." }),
};

const lastUser = (messages: AgentMessage[]) =>
  String([...messages].reverse().find((m) => m.role === "user")?.content ?? "");

/** A model that stages a total, then answers the reviewer and the revision as scripted. */
function scripted(review: string, revisedFormula?: string) {
  const seen: string[] = [];
  const model = async (messages: AgentMessage[]) => {
    const user = lastUser(messages);
    const last = messages[messages.length - 1];
    if (/You are the reviewer/.test(user)) {
      seen.push("review");
      if (last.role === "user")
        return {
          content: "",
          tool_calls: [
            call("r1", "calculate", { formula: "=SUM(Data!C2:C11)" }),
          ],
        };
      return { content: review, tool_calls: [] };
    }
    if (/A reviewer checked/.test(user)) {
      seen.push("revise");
      if (last.role === "user" && revisedFormula)
        return {
          content: "",
          tool_calls: [
            call("w2", "write_formula", {
              sheet: "Data",
              cell: "C12",
              formula: revisedFormula,
            }),
          ],
        };
      return { content: "Corrected the total.", tool_calls: [] };
    }
    seen.push("plan");
    if (last.role === "user")
      return {
        content: "",
        tool_calls: [
          call("w1", "write_formula", {
            sheet: "Data",
            cell: "C12",
            formula: "=SUM(C2:C10)",
          }),
        ],
      };
    return { content: "Added a total.", tool_calls: [] };
  };
  return { model, seen };
}

async function planned(model: (m: AgentMessage[]) => Promise<any>) {
  const mask = new PersonalMask();
  const run = await runAgent({
    request: "Add a total under Amount",
    host,
    model,
    mask,
  });
  return { run, mask };
}

test("the reviewer's verdict is read strictly: only a clear FIX with problems asks for a fix", () => {
  assert.deepEqual(parseReview("VERDICT: OK"), { ok: true, issues: [] });
  assert.deepEqual(
    parseReview("**VERDICT: FIX**\n- C12 sums C2:C10 but data ends at C11"),
    {
      ok: false,
      issues: ["C12 sums C2:C10 but data ends at C11"],
    },
  );
  // FIX with no listed problem, or an answer with no verdict, never blocks the plan.
  assert.equal(parseReview("VERDICT: FIX").ok, true);
  assert.equal(parseReview("Looks fine to me").ok, true);
  assert.equal(
    parseReview(`VERDICT: FIX\n${"- x\n".repeat(9)}`).issues.length,
    5,
  );
});

test("the review and revision requests are add-in reports, so request checks skip them", () => {
  const text = reviewRequest("Add a total", {
    reply: "Added a total.",
    changes: [
      {
        callId: "w1",
        change: { kind: "create_sheet", name: "Summary" } as any,
      },
    ],
  });
  assert.match(text, /^\[Report from the add-in/);
  assert.match(text, /1\. Add a new sheet "Summary"/);
  assert.match(text, /Do not stage any change yourself/);
  assert.match(
    revisionRequest(["a", "b"]),
    /^\[Report from the add-in.*\(1\) a \(2\) b/,
  );
});

test("a plan the reviewer accepts is shown unchanged", async () => {
  const { model, seen } = scripted("VERDICT: OK");
  const { run, mask } = await planned(model);
  const result = await reviewAndRevise({
    request: "Add a total under Amount",
    run,
    host,
    model,
    mask,
  });
  assert.equal(result.run, run);
  assert.equal(result.revised, false);
  assert.deepEqual(
    seen.filter((s) => s !== "plan"),
    ["review", "review"],
  );
  assert.match(describeReview(result), /no problems found/);
});

test("a problem the reviewer finds is fixed by the first agent before the preview", async () => {
  const { model, seen } = scripted(
    "VERDICT: FIX\n- C12 sums C2:C10 but the data ends at C11",
    "=SUM(C2:C11)",
  );
  const { run, mask } = await planned(model);
  const result = await reviewAndRevise({
    request: "Add a total under Amount",
    run,
    host,
    model,
    mask,
  });
  assert.equal(result.revised, true);
  assert.equal(result.run.changes.length, 1);
  assert.equal((result.run.changes[0].change as any).formula, "=SUM(C2:C11)");
  // The corrected plan continues the first agent's conversation, not the reviewer's.
  assert.ok(
    result.run.messages.some((m) =>
      /A reviewer checked/.test(String(m.content)),
    ),
  );
  assert.ok(
    !result.run.messages.some((m) =>
      /You are the reviewer/.test(String(m.content)),
    ),
  );
  assert.ok(seen.includes("revise"));
  assert.match(describeReview(result), /plan was corrected/);
});

test("a revision that stages nothing keeps the first plan and shows the problems", async () => {
  const { model } = scripted("VERDICT: FIX\n- The header is bold already");
  const { run, mask } = await planned(model);
  const result = await reviewAndRevise({
    request: "Add a total under Amount",
    run,
    host,
    model,
    mask,
  });
  assert.equal(result.revised, false);
  assert.deepEqual(result.run.changes, run.changes);
  assert.match(describeReview(result), /found: The header is bold already/);
});

test("a failed review never loses the plan, and Stop still stops", async () => {
  const { model } = scripted("VERDICT: OK");
  const { run, mask } = await planned(model);
  const broken = async () => {
    throw new Error("network");
  };
  const result = await reviewAndRevise({
    request: "x",
    run,
    host,
    model: broken,
    mask,
  });
  assert.equal(result.run, run);
  assert.equal(result.review, undefined);
  const stopped = async () => {
    throw new Error("stopped");
  };
  await assert.rejects(
    reviewAndRevise({ request: "x", run, host, model: stopped, mask }),
    /stopped/,
  );
});

test("a run with nothing staged is not reviewed", async () => {
  let calls = 0;
  const model = async () => {
    calls += 1;
    return { content: "The total is 50.", tool_calls: [] };
  };
  const mask = new PersonalMask();
  const run = await runAgent({
    request: "What is the total?",
    host,
    model,
    mask,
  });
  const result = await reviewAndRevise({
    request: "What is the total?",
    run,
    host,
    model,
    mask,
  });
  assert.equal(calls, 1);
  assert.equal(result.review, undefined);
});
