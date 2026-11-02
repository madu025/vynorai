import assert from "node:assert/strict";
import { test } from "node:test";
import {
  agentToolLabel,
  relocalizeView,
  setAgentRoleView,
  setAgentViewLocalizer,
  setLocalizedParts,
  setLocalizedText,
  settleActiveRolesView,
} from "./taskpaneAgentView.js";

const ROLES = [
  "planner",
  "relationships",
  "builder",
  "accuracy",
  "safety",
  "verification",
];

/** A stand-in for the role rows of the agent card: state in dataset, text in the status span. */
function fakeRoles(states: Record<string, string>) {
  const rows = ROLES.map((role) => {
    const status: any = { textContent: "", dataset: {} };
    const name = { textContent: role, title: "" };
    return {
      dataset: { agentRole: role, state: states[role] ?? "pending" } as Record<
        string,
        string
      >,
      status,
      querySelector: (selector: string) =>
        selector === ".agent-role-status" ? status : name,
    };
  });
  const document: any = {
    querySelector: (selector: string) => {
      const role = /data-agent-role="(\w+)"/.exec(selector)?.[1];
      return rows.find((row) => row.dataset.agentRole === role) ?? null;
    },
    querySelectorAll: () => rows,
  };
  return { document, rows };
}

test("a request that ends early leaves no role pending or spinning", () => {
  const { document, rows } = fakeRoles({
    planner: "done",
    relationships: "skipped",
    builder: "active",
    accuracy: "pending",
    safety: "pending",
    verification: "pending",
  });
  settleActiveRolesView(document, "did not finish");
  assert.deepEqual(
    rows.map((row) => row.dataset.state),
    ["done", "skipped", "skipped", "skipped", "skipped", "skipped"],
  );
  assert.equal(rows[2].status.textContent, "did not finish");
  assert.equal(rows[5].status.textContent, "did not finish");
});

test("roles that finished keep their state and evidence", () => {
  const { document, rows } = fakeRoles({ planner: "done", builder: "done" });
  setAgentRoleView(document, "planner", "done", "2 plan step(s)");
  settleActiveRolesView(document, "did not finish");
  assert.equal(rows[0].dataset.state, "done");
  assert.equal(rows[0].status.textContent, "2 plan step(s)");
  assert.equal(rows[2].dataset.state, "done");
});

test("a language switch writes the agent card's run-time text again in the new language", () => {
  const dictionary: Record<string, Record<string, string>> = {
    si: {
      "2 plan step(s)": "සැලසුම් පියවර 2ක්",
      "Waiting for approval": "අනුමැතිය බලාපොරොත්තුවෙන්",
      pending: "පොරොත්තුවේ",
    },
    ta: {
      "2 plan step(s)": "2 திட்டப் படிகள்",
      "Waiting for approval": "ஒப்புதலுக்காகக் காத்திருக்கிறது",
      pending: "நிலுவையில்",
    },
  };
  let language = "si";
  setAgentViewLocalizer((text) => dictionary[language]?.[text] ?? text);
  const { document, rows } = fakeRoles({});
  const badge: any = { textContent: "", dataset: {} };
  const progress: any = { textContent: "", dataset: {} };
  setAgentRoleView(document, "planner", "done", "2 plan step(s)");
  setLocalizedText(badge, "Waiting for approval");
  setLocalizedParts(progress, ["Waiting for approval", "pending"]);
  assert.equal(rows[0].status.textContent, "සැලසුම් පියවර 2ක්");
  assert.equal(badge.textContent, "අනුමැතිය බලාපොරොත්තුවෙන්");
  assert.equal(progress.textContent, "අනුමැතිය බලාපොරොත්තුවෙන් පොරොත්තුවේ");

  language = "ta";
  const names = rows.map((row) => row.querySelector("strong"));
  const root: any = {
    querySelectorAll: (selector: string) =>
      selector === "[data-en]"
        ? [rows[0].status, badge]
        : selector === "[data-en-parts]"
          ? [progress]
          : names,
  };
  relocalizeView(root);
  assert.equal(rows[0].status.textContent, "2 திட்டப் படிகள்");
  assert.equal(badge.textContent, "ஒப்புதலுக்காகக் காத்திருக்கிறது");
  assert.equal(
    progress.textContent,
    "ஒப்புதலுக்காகக் காத்திருக்கிறது நிலுவையில்",
  );
  assert.equal(names[0].title, names[0].textContent);
  setAgentViewLocalizer((text) => text);
});

test("a tooltip set with setLocalizedTitle follows a language switch", () => {
  let language = "si";
  setAgentViewLocalizer((text) =>
    language === "si" && text === "Add a new sheet"
      ? "නව පත්‍රයක් එක් කරන්න"
      : text,
  );
  const item: any = { title: "", dataset: {} };
  setLocalizedTitle(item, "Add a new sheet");
  assert.equal(item.title, "නව පත්‍රයක් එක් කරන්න");
  language = "en";
  relocalizeView({
    querySelectorAll: (selector: string) =>
      selector === "[data-en-title]" ? [item] : [],
  } as any);
  assert.equal(item.title, "Add a new sheet");
  setAgentViewLocalizer((text) => text);
});

import {
  plainStep,
  setLocalizedTitle,
  stepRange,
} from "./taskpaneAgentView.js";

test("the live progress line never shows formulas, ranges or tool names", () => {
  assert.equal(
    agentToolLabel("calculate", { formula: "=LET(a,1,a)" }),
    "Calculating…",
  );
  assert.equal(
    agentToolLabel("read_range", { sheet: "Orders", address: "A1:L3001" }),
    "Reading Orders",
  );
  assert.equal(
    agentToolLabel("run_code", { sheet: "Orders", address: "A1" }),
    "Analysing Orders",
  );
  assert.equal(
    agentToolLabel("vynor_step", { instruction: "chart of x" }),
    "Checking a step",
  );
  assert.equal(agentToolLabel("write_formula", {}), "Preparing a change");
  assert.equal(agentToolLabel("get_workbook", {}), "Reading workbook");
});

test("plan steps lose ranges for display and keep them for click-to-select", () => {
  const step = "Add a line chart of 'Orders Summary'!L1:M25 titled Net";
  assert.equal(plainStep(step), "Add a line chart of titled Net");
  assert.deepEqual(stepRange(step), {
    sheet: "Orders Summary",
    address: "L1:M25",
  });
  assert.deepEqual(stepRange("Fill Orders!N2:N3001 with a lookup"), {
    sheet: "Orders",
    address: "N2:N3001",
  });
  assert.equal(stepRange("Sort the data"), undefined);
});

test("shortChange gives plain lines and keeps formulas out of them", async () => {
  const { shortChange } = await import("./taskpaneAgentView.js");
  const full =
    "Write in 'Net Amount by Channel'!A2: =GROUPBY('Orders'!H2:H3001,'Orders'!L2:L3001,SUM,0,0)";
  const formula = {
    kind: "write_formula",
    sheet: "Net Amount by Channel",
    cell: "A2",
    formula: "=GROUPBY(Orders!H2:H3001,Orders!L2:L3001,SUM,0,0)",
    header: "Channel",
  } as any;
  assert.equal(
    shortChange(formula, full),
    "Fill the Net Amount by Channel table",
  );
  assert.equal(
    shortChange(
      { kind: "create_sheet", name: "Summary" } as any,
      "Add a new sheet",
    ),
    "Create sheet Summary",
  );
  assert.equal(
    shortChange(
      { kind: "format_range", sheet: "S", address: "A1:B1", bold: true } as any,
      "Format",
    ),
    "Format the header",
  );
  assert.ok(!shortChange(formula, full).includes("="));
});

test("plan steps and applied lines keep formulas out", async () => {
  const { plainStep, shortResult } = await import("./taskpaneAgentView.js");
  const step =
    'On "Sales Summary" A10: "Net Amount by Region" with GROUPBY LET(n,XLOOKUP(a,b,c),t,GROUPBY(n,x,SUM,0,0),HSTACK(t,TAKE(t,,-1)))';
  assert.ok(
    !/LET|GROUPBY\(|XLOOKUP/.test(plainStep(step).replace("with GROUPBY", "")),
  );
  assert.equal(
    shortResult("Write in 'Sales Summary'!A10: =LET(n,SUM(A1:A2),n)"),
    "Write in Sales Summary",
  );
  assert.equal(
    shortResult("Format 'Sales Summary'!C3:C6: number format 0.0%"),
    "Format Sales Summary: number format 0.0%",
  );
});

test("collapseAppliedList hides all but the first three, never a failed one", async () => {
  const { collapseAppliedList } = await import("./taskpaneAgentView.js");
  const { JSDOM } = await import("jsdom").catch(() => ({ JSDOM: undefined }));
  if (!JSDOM) return;
  const dom = new JSDOM("<ul id=l></ul>");
  const doc = dom.window.document;
  const list = doc.getElementById("l")!;
  for (let i = 0; i < 6; i++) {
    const li = doc.createElement("li");
    li.dataset.status = i === 5 ? "failed" : "applied";
    list.append(li);
  }
  collapseAppliedList(doc, list);
  const hidden = [...list.children].map((li) => (li as HTMLElement).hidden);
  assert.deepEqual(hidden, [false, false, false, true, true, false]);
  assert.match(doc.getElementById("agent-changes-more")!.textContent!, /6/);
});

test("plainStep turns copied tool names into words", async () => {
  const { plainStep } = await import("./taskpaneAgentView.js");
  assert.equal(
    plainStep('create_sheet "Sales Summary" (source stays untouched).'),
    'Create sheet "Sales Summary" (source stays untouched).',
  );
  assert.equal(
    plainStep("write_formula in 'Sales Summary' column C: share of total"),
    "Write formula in 'Sales Summary' column C: share of total",
  );
});

test("the agent plan is folded under its heading with the step count", async () => {
  // Live run 2026-11-02: four plan steps filled the card above the changes to approve.
  const { showAgentPlanView } = await import("./taskpaneAgentView.js");
  const items: any[] = [];
  const plan: any = { hidden: true, open: true };
  const count: any = { textContent: "" };
  const steps: any = {
    replaceChildren: (...children: any[]) =>
      items.splice(0, items.length, ...children),
  };
  const document: any = {
    querySelector: (selector: string) =>
      ({
        "#agent-plan": plan,
        "#agent-plan-steps": steps,
        "#agent-plan-count": count,
      })[selector],
    createElement: () => ({
      hidden: false,
      textContent: "",
      title: "",
      addEventListener() {},
    }),
  };
  showAgentPlanView(document, [
    "Note the column",
    "Add a header",
    "Highlight rows",
    "Leave the rest",
  ]);
  assert.equal(plan.hidden, false);
  assert.equal(plan.open, false, "the plan starts folded");
  assert.equal(count.textContent, "(4)");
  assert.equal(items.length, 4);
  assert.ok(
    items.every((item) => !item.hidden),
    "every step shows once the plan is opened",
  );
  showAgentPlanView(document, []);
  assert.equal(plan.hidden, true);
});

test("a plan waiting for approval adds no reply to the chat; answers still do", async () => {
  const { agentChatReply } = await import("./taskpaneAgentView.js");
  assert.equal(
    agentChatReply({
      reply:
        "Staged highlighting on rows A2:I11 wherever the margin is under 10%.",
      changes: [{ kind: "conditional_format" }],
    }),
    "",
  );
  assert.equal(
    agentChatReply({ reply: "Laptop 43,200 and Phone 40,000.", changes: [] }),
    "Laptop 43,200 and Phone 40,000.",
  );
  assert.equal(agentChatReply({ changes: [] }), "");
});
