/**
 * Builds the synthetic dataset the request-tier classifier is trained on.
 *
 * No customer data: DeepSeek writes realistic IDE coding-assistant messages
 * for a list of scenarios, then labels every message again on its own with
 * the routing rubric. Only messages where both labels agree are kept.
 *
 *   DEEPSEEK_API_KEY=sk-... npx tsx src/scripts/buildTierDataset.ts [perScenario]
 *
 * Writes ml/tier-dataset.jsonl ({ text, label } per line, label L | N | H).
 */
import fs from "fs";
import path from "path";

const API = "https://api.deepseek.com/chat/completions";
const KEY = process.env.DEEPSEEK_API_KEY;
const PER_SCENARIO = Number(process.argv[2] ?? 60);
const OUT = path.resolve("ml/tier-dataset.jsonl"); // run from backend/

export const TIER_RUBRIC = `L = quick question, explanation, greeting, opinion, or a tiny change (one line, rename, typo, import)
N = normal coding work: write or edit a function, component, endpoint, query, config or script; fix an ordinary bug; write tests, docs or types; small refactor of one file
H = needs deep reasoning before coding: architecture or design across many files or services, large multi-file refactor, concurrency or race conditions, security analysis, performance optimisation with trade-offs, tricky algorithms, debugging an intermittent or hard-to-reproduce problem`;

const SCENARIOS = [
  "React / Next.js frontend work",
  "Node.js / Express REST API backend",
  "Python data scripts and FastAPI",
  "SQL and PostgreSQL schema / queries",
  "Docker, CI/CD and deployment",
  "Mobile apps with Flutter or React Native",
  "TypeScript types and refactoring",
  "Unit and integration testing",
  "Debugging runtime errors pasted from a terminal",
  "Short follow-up messages in an ongoing chat (e.g. 'now add tests', 'why?', 'make it async')",
  "Very short, terse requests ('fix it', 'explain', 'optimize this')",
  "Long, detailed multi-paragraph feature requests",
  "Sri Lankan apps: PayHere payments, NIC / phone validation, LKR formatting",
  "Messages written in Singlish (Sinhala in Latin letters mixed with English), e.g. 'meka fix karanna', 'login page ekak hadanna'",
  "Laravel / PHP and WordPress sites",
  "Java / Spring Boot and Kotlin services",
  "Go and Rust systems code",
  "Security reviews, auth, JWT and permissions",
  "Performance problems, memory leaks and slow queries",
  "Concurrency, queues, background jobs and race conditions",
  "System design and architecture decisions",
  "Algorithms and data-structure problems",
  "CSS, Tailwind and UI layout fixes",
  "Git, npm, build tooling and config files",
  "Questions about what a piece of code does",
];

async function chat(body: any, attempt = 0): Promise<string> {
  const res = await fetch(API, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: "deepseek-flash", ...body }),
  });
  if (!res.ok) {
    if (attempt < 3) {
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
      return chat(body, attempt + 1);
    }
    throw new Error(`DeepSeek ${res.status}: ${await res.text()}`);
  }
  const data: any = await res.json();
  return String(data.choices?.[0]?.message?.content ?? "");
}

function parseJsonArray(text: string): any[] {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start < 0 || end <= start) return [];
  try {
    const parsed = JSON.parse(text.slice(start, end + 1));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function generate(
  scenario: string,
): Promise<{ text: string; label: string }[]> {
  const content = await chat({
    temperature: 1.0,
    max_tokens: 8000,
    thinking: { type: "disabled" },
    messages: [
      {
        role: "user",
        content: `Write ${PER_SCENARIO} different messages a developer might type to an AI coding agent inside their IDE, about: ${scenario}.
Vary length (from 2 words to several sentences), tone, and skill level. Do not number them. Do not include code blocks longer than 3 lines.
Label each with how much reasoning it needs:
${TIER_RUBRIC}
Aim for roughly 35% L, 45% N, 20% H.
Return ONLY a JSON array: [{"text": "...", "label": "L|N|H"}]`,
      },
    ],
  });
  return parseJsonArray(content).filter(
    (x) => typeof x?.text === "string" && /^[LNH]$/.test(x?.label),
  );
}

async function relabel(texts: string[]): Promise<string[]> {
  const content = await chat({
    temperature: 0,
    max_tokens: 4000,
    thinking: { type: "enabled" },
    reasoning_effort: "low",
    messages: [
      {
        role: "user",
        content: `Classify each developer message by how much reasoning an AI coding agent needs to handle it well.
${TIER_RUBRIC}
Return ONLY a JSON array of letters in the same order, e.g. ["N","L","H"].

${texts.map((t, i) => `${i + 1}. ${JSON.stringify(t)}`).join("\n")}`,
      },
    ],
  });
  return parseJsonArray(content).map((x) => String(x));
}

async function processScenario(scenario: string, seen: Set<string>) {
  const fresh = (await generate(scenario)).filter((x) => {
    const k = x.text.trim().toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const chunks: (typeof fresh)[] = [];
  for (let j = 0; j < fresh.length; j += 30)
    chunks.push(fresh.slice(j, j + 30));
  const labels = await Promise.all(
    chunks.map((c) => relabel(c.map((x) => x.text))),
  );
  const kept: { text: string; label: string }[] = [];
  chunks.forEach((chunk, ci) => {
    if (labels[ci].length !== chunk.length) return;
    chunk.forEach((x, k) => {
      if (labels[ci][k] === x.label)
        kept.push({ text: x.text.trim(), label: x.label });
    });
  });
  return { generated: fresh.length, kept };
}

async function main() {
  if (!KEY) throw new Error("Set DEEPSEEK_API_KEY");
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, "");
  const seen = new Set<string>();
  let generated = 0;
  let kept = 0;
  const counts: Record<string, number> = {};

  // Five scenarios at a time; each one is written as soon as it finishes.
  const queue = [...SCENARIOS];
  await Promise.all(
    Array.from({ length: 5 }, async () => {
      for (let s = queue.shift(); s; s = queue.shift()) {
        try {
          const r = await processScenario(s, seen);
          generated += r.generated;
          kept += r.kept.length;
          for (const x of r.kept) counts[x.label] = (counts[x.label] ?? 0) + 1;
          if (r.kept.length)
            fs.appendFileSync(
              OUT,
              r.kept.map((x) => JSON.stringify(x)).join("\n") + "\n",
            );
          console.log(
            `done "${s}": kept ${r.kept.length}/${r.generated} (total ${kept}/${generated})`,
          );
        } catch (err) {
          console.warn(`skipped "${s}":`, (err as Error).message);
        }
      }
    }),
  );
  console.log(`wrote ${kept} examples to ${OUT}`, counts);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
