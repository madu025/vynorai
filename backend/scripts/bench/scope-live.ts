/**
 * Real-model scope-routing benchmark. It measures whether the agent infers
 * simple versus complex work from the requested outcome, rather than matching
 * a fixed keyword list. It calls the same preflight prompt/parser used by the
 * GUI; this is a routing test, not twenty full application builds.
 *
 * node --env-file='../.env.e2e' --import tsx scripts/bench/scope-live.ts
 */
import {
  resolveTaskScope,
  type TaskScopeAssessment,
} from "../../../gui/src/redux/util/taskScope";
// @ts-expect-error plain JS modules
import { BASE } from "./lib.mjs";

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

async function main() {
  let failed = 0;
  let totalTokens = 0;
  let cacheHitTokens = 0;
  let calls = 0;
  const selectedCases = process.env.SCOPE_CASE
    ? cases.filter((c) => c.name.includes(process.env.SCOPE_CASE!))
    : cases;
  for (const c of selectedCases) {
    const rawResponses: string[] = [];
    const complete = async (prompt: string): Promise<string> => {
      calls++;
      const response = await fetch(`${BASE}/v1/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
          model: "vynor-auto",
          stream: false,
          temperature: 0,
          max_tokens: 400,
          request_kind: "task_scope",
          cache_policy: "bypass",
          messages: [
            {
              role: "system",
              content:
                "You are an internal task-scope service. Follow the user's output contract exactly.",
            },
            { role: "user", content: prompt },
          ],
        }),
      });
      const body: any = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          `HTTP ${response.status}: ${JSON.stringify(body).slice(0, 180)}`,
        );
      }
      totalTokens += Number(body?.usage?.total_tokens ?? 0);
      cacheHitTokens += Number(body?.usage?.prompt_cache_hit_tokens ?? 0);
      const content = String(body?.choices?.[0]?.message?.content ?? "");
      rawResponses.push(content);
      return content;
    };

    let assessment: TaskScopeAssessment;
    try {
      assessment = await resolveTaskScope(c.prompt, complete);
    } catch (error) {
      failed++;
      console.log(
        `FAIL ${c.scope} | ${c.name} | ${String(error).slice(0, 180)}`,
      );
      continue;
    }
    const ok = assessment.scope === c.scope;
    if (!ok) failed++;
    console.log(
      `${ok ? "PASS" : "FAIL"} expected=${c.scope} actual=${assessment.scope} confidence=${assessment.confidence.toFixed(2)} | ${c.name}`,
    );
    if (!ok) {
      console.log(
        `  raw=${rawResponses.map((text) => JSON.stringify(text.slice(0, 500))).join(" | ")}`,
      );
    }
  }
  console.log(
    `\n${selectedCases.length - failed}/${selectedCases.length} passed | calls=${calls} tokens=${totalTokens} cache_hit_tokens=${cacheHitTokens}`,
  );
  process.exit(failed ? 1 : 0);
}

void main();
