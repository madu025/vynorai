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
  mergeIssues,
  needsPlan,
  parsePlan,
  parseReview,
  planFacts,
  reviewAndRevise,
  reviewRequest,
  revisionRequest,
  runTeam,
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
  // Two reviewers (accuracy, then coverage), each reading once and then answering.
  assert.deepEqual(
    seen.filter((s) => s !== "plan"),
    ["review", "review", "review", "review"],
  );
  assert.deepEqual(
    result.reviewers?.map((r) => r.focus),
    ["accuracy", "coverage"],
  );
  assert.match(describeReview(result), /3 agents.*no problems found/);
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

test("each reviewer has its own focus", () => {
  const run = { reply: "", changes: [] };
  assert.match(reviewRequest("x", run, "accuracy"), /focus is accuracy/);
  assert.match(reviewRequest("x", run, "coverage"), /focus is coverage/);
  assert.match(
    reviewRequest("x", run, "coverage"),
    /^\[Report from the add-in: review\] You are the reviewer/,
  );
});

test("problems from both reviewers are merged without repeats", () => {
  assert.deepEqual(
    mergeIssues([
      { ok: false, issues: ["C12 misses row 11", "Header is overwritten"] },
      { ok: false, issues: ["c12  misses row 11", "Chart has no title"] },
    ]),
    ["C12 misses row 11", "Header is overwritten", "Chart has no title"],
  );
  assert.equal(
    mergeIssues([
      { ok: false, issues: Array.from({ length: 6 }, (_, i) => `a${i}`) },
      { ok: false, issues: Array.from({ length: 6 }, (_, i) => `b${i}`) },
    ]).length,
    8,
  );
});

test("one reviewer's problem is enough to correct the plan", async () => {
  let review = 0;
  const base = scripted("VERDICT: OK", "=SUM(C2:C11)").model;
  const model = async (messages: AgentMessage[]) => {
    const user = lastUser(messages);
    const last = messages[messages.length - 1];
    if (/focus is coverage/.test(user) && last.role === "user") {
      review += 1;
      return {
        content: "VERDICT: FIX\n- The total misses row 11",
        tool_calls: [],
      };
    }
    return base(messages);
  };
  const { run, mask } = await planned(model);
  const result = await reviewAndRevise({
    request: "Add a total under Amount",
    run,
    host,
    model,
    mask,
  });
  assert.equal(review, 1);
  assert.equal(result.revised, true);
  assert.deepEqual(result.review?.issues, ["The total misses row 11"]);
  assert.deepEqual(
    result.reviewers?.map((r) => [r.focus, r.ok]),
    [
      ["accuracy", true],
      ["coverage", false],
    ],
  );
});

test("reviewers are told the changes run in order, so a sheet an earlier change creates counts as existing", () => {
  const text = reviewRequest(
    "Summarize by region on a new sheet",
    { changes: [], reply: "" },
    "coverage",
  );
  assert.match(text, /run in the listed order/);
  assert.match(text, /earlier change creates/);
});

test("reviewers list only real problems: a correct change is never a problem", () => {
  const text = reviewRequest("x", { changes: [], reply: "" }, "accuracy");
  assert.match(text, /Never list something that is correct/);
  assert.match(text, /reply exactly "VERDICT: OK"/);
});

test("a question gets no planner; a change request does", () => {
  assert.equal(needsPlan("What is the total of Amount?"), false);
  assert.equal(needsPlan("how many rows are there"), false);
  assert.equal(needsPlan("Add a total under Amount"), true);
  assert.equal(needsPlan("Clean the data, pivot by region and chart it"), true);
  assert.equal(needsPlan("[Report from the add-in] applied"), false);
});

test("a read-only request (audit, check, explain, list) gets no planner, unless it also changes something", () => {
  for (const text of [
    "audit every formula in this workbook for errors and inconsistent formulas",
    "Check the totals for mistakes",
    "explain what the formula in K2 does",
    "list the sheets that have hidden rows",
    "Show me the largest 5 customers",
    "find duplicate service IDs",
  ])
    assert.equal(needsPlan(text), false, text);
  for (const text of [
    "audit the formulas and fix the errors",
    "check the totals and add a chart",
    "show the top 5 customers on a new sheet",
    "find duplicates and delete them",
    "list the sheets and write them in column A",
  ])
    assert.equal(needsPlan(text), true, text);
});

test("the planner's steps are read strictly and passed as a note", () => {
  assert.deepEqual(
    parsePlan("PLAN:\n1. Read Data!A1:C11\n2) Add =SUM(C2:C11) in C12\nThanks"),
    ["Read Data!A1:C11", "Add =SUM(C2:C11) in C12"],
  );
  assert.deepEqual(parsePlan("PLAN: none"), []);
  assert.deepEqual(parsePlan("no plan here"), []);
  assert.equal(parsePlan(`PLAN:\n${"1. x\n".repeat(12)}`).length, 8);
  assert.equal(planFacts([]), "");
  assert.match(planFacts(["a", "b"]), /planner agent.*\(1\) a \(2\) b/);
});

test("the team: planner, builder with the plan, two reviewers", async () => {
  const roles: string[] = [];
  let builderNote = "";
  const base = scripted("VERDICT: OK").model;
  const model = async (messages: AgentMessage[]) => {
    const user = lastUser(messages);
    if (/You are the planner/.test(user)) {
      roles.push("planner");
      return {
        content: "PLAN:\n1. Add =SUM(C2:C11) in Data!C12",
        tool_calls: [],
      };
    }
    if (/You are the reviewer/.test(user)) {
      if (messages[messages.length - 1].role === "user")
        roles.push(/focus is accuracy/.test(user) ? "accuracy" : "coverage");
    } else if (messages[messages.length - 1].role === "user") {
      roles.push("builder");
      builderNote = String(messages[messages.length - 1].content);
    }
    return base(messages);
  };
  const result = await runTeam({
    request: "Add a total under Amount",
    host,
    model,
    mask: new PersonalMask(),
  });
  assert.deepEqual(roles, ["planner", "builder", "accuracy", "coverage"]);
  assert.match(
    builderNote,
    /^Add a total under Amount\n\n.*Plan from the planner agent/s,
  );
  assert.deepEqual(result.plan, ["Add =SUM(C2:C11) in Data!C12"]);
  assert.equal(result.run.changes.length, 1);
  assert.match(
    describeReview(result),
    /Planner \(1 step\), builder and 2 reviewer\(s\) checked the plan: no problems found/,
  );
});

test("the plan reaches onPlan before the builder starts, and only when there is one", async () => {
  const order: string[] = [];
  const base = scripted("VERDICT: OK").model;
  const model = async (messages: AgentMessage[]) => {
    const user = lastUser(messages);
    if (/You are the planner/.test(user))
      return {
        content: "PLAN:\n1. Read the Data sheet\n2. Add a total under Amount",
        tool_calls: [],
      };
    if (
      !/You are the reviewer/.test(user) &&
      messages[messages.length - 1].role === "user"
    )
      order.push("builder");
    return base(messages);
  };
  let seen: string[] = [];
  await runTeam({
    request: "Add a total under Amount",
    host,
    model,
    mask: new PersonalMask(),
    onPlan: (steps: string[]) => {
      seen = steps;
      order.push("plan");
    },
  });
  assert.deepEqual(seen, ["Read the Data sheet", "Add a total under Amount"]);
  assert.deepEqual(order.slice(0, 2), ["plan", "builder"]);

  let called = false;
  await runTeam({
    request: "What is in column B?",
    host,
    model: base,
    mask: new PersonalMask(),
    onPlan: () => {
      called = true;
    },
  });
  assert.equal(called, false);
});

test("a failed planner leaves the builder working as before", async () => {
  const base = scripted("VERDICT: OK").model;
  const model = async (messages: AgentMessage[]) => {
    if (/You are the planner/.test(lastUser(messages)))
      throw new Error("network");
    return base(messages);
  };
  const result = await runTeam({
    request: "Add a total under Amount",
    host,
    model,
    mask: new PersonalMask(),
  });
  assert.equal(result.plan, undefined);
  assert.equal(result.run.changes.length, 1);
});

test("a GROUPBY that drops its first data row goes straight back to the builder, without a reviewer", async () => {
  const seen: string[] = [];
  const model = async (messages: AgentMessage[]) => {
    const user = lastUser(messages);
    const last = messages[messages.length - 1];
    if (/You are the reviewer/.test(user)) {
      seen.push("review");
      return { content: "VERDICT: OK", tool_calls: [] };
    }
    const revising = /A reviewer checked/.test(user);
    if (revising) seen.push("revise");
    if (last.role === "user")
      return {
        content: "",
        tool_calls: [
          call("g1", "write_formula", {
            sheet: "Data",
            cell: "E2",
            formula: revising
              ? "=GROUPBY(Data!A2:A11,Data!C2:C11,SUM,0,0)"
              : "=GROUPBY(Data!A2:A11,Data!C2:C11,SUM,1,0)",
          }),
        ],
      };
    return { content: "Wrote the summary.", tool_calls: [] };
  };
  const { run, mask } = await planned(model);
  const result = await reviewAndRevise({
    request: "Add a total under Amount",
    run,
    host,
    model,
    mask,
  });
  assert.equal(result.revised, true);
  assert.ok(!seen.includes("review"));
  assert.match(result.review?.issues[0] ?? "", /first data row is dropped/);
  assert.equal(
    (result.run.changes[0].change as any).formula,
    "=GROUPBY(Data!A2:A11,Data!C2:C11,SUM,0,0)",
  );
});

test("the accuracy reviewer is told to run the formulas and compare totals", () => {
  const text = reviewRequest("Summary by region", { reply: "", changes: [] });
  assert.match(text, /run every staged formula through calculate/);
  assert.match(text, /compare it with the sum of the summary/);
});

test("a revision that repeats the known GROUPBY header mistake is repaired, not shown to the person", async () => {
  const bad = "=GROUPBY(TRIM(Data!A2:A11),Data!C2:C11,SUM,1,0)";
  const model = async (messages: AgentMessage[]) => {
    const user = lastUser(messages);
    const last = messages[messages.length - 1];
    if (last.role !== "user") return { content: "Done.", tool_calls: [] };
    return {
      content: "",
      tool_calls: [
        call(/A reviewer checked/.test(user) ? "w2" : "w1", "write_formula", {
          sheet: "Data",
          cell: "F1",
          formula: bad,
        }),
      ],
    };
  };
  const { run, mask } = await planned(model);
  const result = await reviewAndRevise({
    request: "Add a total under Amount",
    run,
    host,
    model,
    mask,
  });
  assert.equal(result.revised, true);
  assert.equal(
    (result.run.changes[0].change as any).formula,
    "=GROUPBY(TRIM(Data!A2:A11),Data!C2:C11,SUM,0,0)",
  );
});
