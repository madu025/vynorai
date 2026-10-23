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

import { PLAN_STEPS_SHOWN, plainStep, stepRange } from "./taskpaneAgentView.js";

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
  assert.equal(PLAN_STEPS_SHOWN, 3);
});
