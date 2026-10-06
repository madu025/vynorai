import * as crypto from "crypto";
/**
 * Real-model helpers for the smart E2E suite: an AI judge for answers that
 * cannot be checked byte-for-byte, and a classifier that explains failures.
 * Both call the production API with the dedicated E2E account.
 */

const API_BASE = process.env.VYNOR_E2E_API_BASE || "https://vynor.lk";

function e2eApiKey() {
  return process.env.VYNORAI_E2E_API_KEY || process.env.VYNOR_E2E_API_KEY || "";
}

function apiKey(): string {
  const key = e2eApiKey();
  if (!/^vynor_live_[a-f0-9]{32}$/i.test(key))
    throw new Error("VYNORAI_E2E_API_KEY is missing or malformed");
  return key;
}

async function askJson<T>(system: string, user: string): Promise<T> {
  const response = await fetch(`${API_BASE}/v1/chat/completions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey()}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "deepseek/deepseek-flash",
      stream: false,
      temperature: 0,
      max_tokens: 400,
      response_format: { type: "json_object" },
      // Every grading is a new question: a nonce defeats the exact cache and
      // the code fence opts out of the semantic cache, which otherwise
      // returned a cached verdict for a similar but different answer.
      messages: [
        { role: "system", content: system },
        {
          role: "user",
          content: `${user}

Request ${crypto.randomUUID()}
\`\`\`
end
\`\`\``,
        },
      ],
    }),
  });
  if (!response.ok)
    throw new Error(`model call failed: HTTP ${response.status}`);
  const data: any = await response.json();
  const text = String(data?.choices?.[0]?.message?.content ?? "");
  return JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
}

export interface Verdict {
  pass: boolean;
  reason: string;
}

/**
 * Grade an answer against explicit criteria. The judge sees only the task,
 * the answer and the criteria, and must name the criterion that failed.
 */
export async function judge(args: {
  task: string;
  answer: string;
  criteria: string[];
}): Promise<Verdict> {
  const result = await askJson<{ pass?: boolean; reason?: string }>(
    "You grade answers from a coding assistant. Decide only from the criteria. " +
      "Wording, length and style do not matter; correctness does. " +
      'Reply as JSON: {"pass": true|false, "reason": "<which criterion failed, or why all pass>"}.',
    `Task given to the assistant:\n${args.task}\n\n` +
      `Assistant answer:\n${args.answer.slice(0, 6000)}\n\n` +
      `Criteria (all must hold):\n${args.criteria.map((c, i) => `${i + 1}. ${c}`).join("\n")}`,
  );
  return { pass: result.pass === true, reason: String(result.reason ?? "") };
}

export type FailureCategory = "PRODUCT_BUG" | "MODEL_VARIANCE" | "INFRA";

/**
 * Sort a failure: a product bug blocks the release; model variance (the
 * model solved it another acceptable way) is reported but does not block;
 * infra (network, timeouts, the test harness) is retried and then blocks.
 */
export async function classifyFailure(args: {
  scenario: string;
  expectation: string;
  error: string;
  evidence: string;
}): Promise<{ category: FailureCategory; explanation: string }> {
  try {
    const result = await askJson<{ category?: string; explanation?: string }>(
      "You triage failed end-to-end tests of a VS Code coding assistant. " +
        "PRODUCT_BUG: the extension or backend misbehaved (wrong state, missing UI, " +
        "wrong file change, approval shown or missing wrongly, crash, stuck busy). " +
        "MODEL_VARIANCE: the product behaved correctly but the AI chose a different " +
        "valid approach or wording than the check expected. " +
        "INFRA: network errors, HTTP 5xx, timeouts before any response, or test " +
        "harness/selector problems. When unsure, choose PRODUCT_BUG. " +
        'Reply as JSON: {"category": "...", "explanation": "<one sentence>"}.',
      `Scenario: ${args.scenario}\nExpected: ${args.expectation}\n` +
        `Error: ${args.error.slice(0, 2000)}\nEvidence:\n${args.evidence.slice(0, 6000)}`,
    );
    const category = ["PRODUCT_BUG", "MODEL_VARIANCE", "INFRA"].includes(
      String(result.category),
    )
      ? (result.category as FailureCategory)
      : "PRODUCT_BUG";
    return { category, explanation: String(result.explanation ?? "") };
  } catch (error) {
    return {
      category: "INFRA",
      explanation: `classifier unavailable: ${(error as Error).message}`,
    };
  }
}
