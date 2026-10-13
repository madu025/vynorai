/**
 * Real-model scope-routing benchmark. It measures whether the agent infers
 * simple versus complex work from the requested outcome, rather than matching
 * a fixed keyword list. It intentionally stops after two tool rounds: this is
 * a routing test, not a benchmark that asks the model to build twenty apps.
 *
 * node --env-file='../.env.e2e' --import tsx scripts/bench/scope-live.ts
 */
import { DEFAULT_AGENT_SYSTEM_MESSAGE } from "../../../core/llm/defaultSystemMessages";
import { updateTodoListTool } from "../../../core/tools/definitions/updateTodoList";
import { viewRepoMapTool } from "../../../core/tools/definitions/viewRepoMap";
// @ts-expect-error plain JS modules
import { cleanup, makeFixture, runAgent } from "./lib.mjs";

const key = process.env.VYNORAI_E2E_API_KEY ?? "";
if (!/^vynor_live_[a-f0-9]{32}$/i.test(key)) {
  console.error("Set VYNORAI_E2E_API_KEY");
  process.exit(2);
}

type Scope = "simple" | "complex";
interface ScopeCase {
  name: string;
  scope: Scope;
  prompt: string;
}

const cases: ScopeCase[] = [
  {
    name: "single typo",
    scope: "simple",
    prompt: "Fix the spelling mistake in src/math.mjs only, then run its test.",
  },
  {
    name: "bounded explanation",
    scope: "simple",
    prompt:
      "Explain what the calculateTotal function in src/math.mjs does. Do not change files.",
  },
  {
    name: "single function bug",
    scope: "simple",
    prompt: "Fix the off-by-one bug in src/math.mjs and run test.mjs.",
  },
  {
    name: "single-file comment",
    scope: "simple",
    prompt:
      "Add a concise comment above calculateTotal in src/math.mjs. Do not change behaviour.",
  },
  {
    name: "focused test reading",
    scope: "simple",
    prompt:
      "Read test.mjs and tell me which calculateTotal edge case is missing. Do not edit.",
  },
  {
    name: "named CSS-like change",
    scope: "simple",
    prompt:
      "In src/math.mjs, rename the user-visible label 'Total' to 'Order total' only.",
  },
  {
    name: "one-file formatting",
    scope: "simple",
    prompt:
      "Format only src/math.mjs consistently; do not change its behaviour.",
  },
  {
    name: "small explicit change",
    scope: "simple",
    prompt:
      "Change the default tax rate in src/math.mjs from 0.1 to 0.12 and run test.mjs.",
  },
  {
    name: "Sinhala bounded request",
    scope: "simple",
    prompt: "src/math.mjs eke typo eka hadanna. wena files wenas karanna epa.",
  },
  {
    name: "Singlish explanation",
    scope: "simple",
    prompt:
      "src/math.mjs eke calculateTotal function eka explain karanna. files edit karanna epa.",
  },
  {
    name: "clothing ecommerce outcome",
    scope: "complex",
    prompt: "Build a complete e-commerce website for my clothing shop.",
  },
  {
    name: "restaurant ordering outcome",
    scope: "complex",
    prompt:
      "Create a complete online food ordering web application for my restaurant.",
  },
  {
    name: "booking product",
    scope: "complex",
    prompt:
      "I need a full hotel booking platform with customer and admin experiences.",
  },
  {
    name: "marketplace outcome",
    scope: "complex",
    prompt:
      "Build a marketplace where sellers list products and buyers pay for orders.",
  },
  {
    name: "school system",
    scope: "complex",
    prompt:
      "Create a school management web application for students, teachers and administrators.",
  },
  {
    name: "Sinhala shop outcome",
    scope: "complex",
    prompt:
      "මගේ ඇඳුම් කඩයට products, cart, checkout සහ orders තියෙන complete online shop එකක් හදන්න.",
  },
  {
    name: "Singlish ecommerce outcome",
    scope: "complex",
    prompt:
      "Mage clothing shop ekata complete ecommerce web app ekak hadanna: products, cart, checkout saha admin orders.",
  },
  {
    name: "cross-cutting refactor",
    scope: "complex",
    prompt:
      "Redesign the application's authentication and permissions across the whole project.",
  },
  {
    name: "subscription product",
    scope: "complex",
    prompt:
      "Build a SaaS dashboard with login, subscriptions, billing and an admin area.",
  },
  {
    name: "delivery platform",
    scope: "complex",
    prompt:
      "Create a complete delivery tracking app for customers, drivers and administrators.",
  },
];

const fixture = {
  id: "scope-routing",
  prompt: "",
  files: {
    "src/math.mjs":
      "export function calculateTotal(items, tax = 0.1) { return items.reduce((sum, item) => sum + item, 0) * (1 + tax); }\n",
    "test.mjs":
      "import assert from 'node:assert/strict';\nimport { calculateTotal } from './src/math.mjs';\nassert.equal(calculateTotal([10]), 11);\nconsole.log('PASS');\n",
  },
};

async function main() {
  let failed = 0;
  let totalTokens = 0;
  for (const c of cases) {
    const task = { ...fixture, prompt: c.prompt };
    const fx = makeFixture(task);
    try {
      const run = await runAgent(key, task, fx, {
        maxTurns: 3,
        systemExtra: `\n\n${DEFAULT_AGENT_SYSTEM_MESSAGE}`,
        tools: [
          { type: "function", function: updateTodoListTool.function },
          { type: "function", function: viewRepoMapTool.function },
        ],
        impl: {
          update_todo_list: async () => "Todo list saved.",
          view_repo_map: async () =>
            "Repository map:\n- src/math.mjs: calculateTotal(items, tax)\n- test.mjs: calculateTotal test",
        },
      });
      totalTokens += run.tokens;
      const tools = new Set(run.log.tools);
      const hasTodo = tools.has("update_todo_list");
      const hasMap = tools.has("view_repo_map");
      const ok = c.scope === "simple" ? !hasTodo && !hasMap : hasTodo && hasMap;
      if (!ok) failed++;
      console.log(
        `${ok ? "PASS" : "FAIL"} ${c.scope} | ${c.name} | rounds=${run.rounds} tokens=${run.tokens} tools=${[...tools].join(",") || "none"}`,
      );
    } finally {
      cleanup(fx);
    }
  }
  console.log(
    `\n${cases.length - failed}/${cases.length} passed | tokens=${totalTokens}`,
  );
  process.exit(failed ? 1 : 0);
}

void main();
