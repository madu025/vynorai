/**
 * Judgment eval: does the extension's judgment process (the <judgment> prompt
 * block and the pre-mortem round) make DeepSeek catch more hidden impact?
 *
 * A small agent loop with read/search/edit/check tools runs each scenario in a
 * virtual repo. Every scenario hides a trap the visible check does not cover
 * (an un-updated caller, stored data, a cache, an unrelated failing test...).
 * Conditions mirror the GUI: baseline = verification gate only (before the
 * upgrade); careful / max = judgment block + pre-mortem per level.
 *
 *   DEEPSEEK_API_KEY=sk-... npx tsx src/scripts/judgmentEval.ts [runs]
 */
const API = "https://api.deepseek.com/chat/completions";
const KEY = process.env.DEEPSEEK_API_KEY;
const RUNS = Number(process.argv[2] ?? 3);
const MAX_ROUNDS = 20;

type Files = Record<string, string>;
interface Scenario {
  id: string;
  task: string;
  files: Files;
  visible: (f: Files) => { pass: boolean; output: string };
  hidden: (f: Files, report: string) => boolean;
}

const has = (f: Files, path: string, re: RegExp) => re.test(f[path] ?? "");

const SCENARIOS: Scenario[] = [
  {
    id: "rename-config-key",
    task: "In src/config.ts, rename the maxRetries setting to retryLimit.",
    files: {
      "src/config.ts": `export const config = {\n  maxRetries: 3,\n  timeoutMs: 5000,\n};\n`,
      "src/client.ts": `import { config } from "./config";\n\nexport async function fetchWithRetry(url: string) {\n  for (let i = 0; i < config.maxRetries; i++) {\n    try {\n      return await fetch(url);\n    } catch {}\n  }\n  throw new Error("failed");\n}\n`,
      "src/worker.ts": `import { config } from "./config";\n\nexport function shouldRetry(attempt: number) {\n  return attempt < config.maxRetries;\n}\n`,
    },
    visible: (f) => {
      const pass = has(f, "src/config.ts", /retryLimit/);
      return {
        pass,
        output: pass
          ? "config.test.ts: 1 passed"
          : "config.test.ts: expected retryLimit in config",
      };
    },
    hidden: (f) =>
      !/maxRetries/.test(f["src/client.ts"] + f["src/worker.ts"]) &&
      has(f, "src/client.ts", /retryLimit/) &&
      has(f, "src/worker.ts", /retryLimit/),
  },
  {
    id: "signature-change",
    task: "Change formatPrice in src/utils/money.ts to take a second required parameter currency: 'LKR' | 'USD'. LKR stays 'Rs 1,000', USD should look like '$12.50'.",
    files: {
      "src/utils/money.ts": `export function formatPrice(amount: number): string {\n  return "Rs " + amount.toLocaleString("en-LK");\n}\n`,
      "src/cart.ts": `import { formatPrice } from "./utils/money";\n\nexport function cartLine(name: string, price: number) {\n  return name + " - " + formatPrice(price);\n}\n`,
      "src/invoice.ts": `import { formatPrice } from "./utils/money";\n\nexport function invoiceTotal(total: number) {\n  return "Total: " + formatPrice(total);\n}\n`,
      "src/email.ts": `import { formatPrice } from "./utils/money";\n\nexport function receipt(amount: number) {\n  return \`Thanks! You paid \${formatPrice(amount)}.\`;\n}\n`,
    },
    visible: (f) => {
      const pass = has(f, "src/utils/money.ts", /currency/);
      return {
        pass,
        output: pass
          ? "money.test.ts: 2 passed"
          : "money.test.ts: formatPrice has no currency parameter",
      };
    },
    hidden: (f) =>
      ["src/cart.ts", "src/invoice.ts", "src/email.ts"].every((p) => {
        const calls =
          (f[p] ?? "").match(/formatPrice\(([^()]|\([^()]*\))*\)/g) ?? [];
        return calls.length > 0 && calls.every((c) => c.includes(","));
      }),
  },
  {
    id: "unit-change",
    task: "Change sessionTimeout in src/config.ts to be expressed in minutes (30) instead of milliseconds. It's easier to read.",
    files: {
      "src/config.ts": `export const config = {\n  // session lifetime in milliseconds\n  sessionTimeout: 1_800_000,\n};\n`,
      "src/auth.ts": `import { config } from "./config";\n\nexport function newSession(userId: string) {\n  return { userId, expiresAt: Date.now() + config.sessionTimeout };\n}\n`,
      "src/cleanup.ts": `import { config } from "./config";\n\nexport function startCleanup(purge: () => void) {\n  return setInterval(purge, config.sessionTimeout);\n}\n`,
    },
    visible: (f) => {
      const pass = has(f, "src/config.ts", /sessionTimeout\w*:\s*30\b/);
      return {
        pass,
        output: pass
          ? "config.test.ts: 1 passed"
          : "config.test.ts: expected sessionTimeout of 30",
      };
    },
    hidden: (f) => {
      const converts = (s: string) =>
        /60\s*\*\s*1000|60_?000|\*\s*60\s*\*|minutesToMs|sessionTimeoutMs|MS_PER_MINUTE/i.test(
          s,
        );
      const usesMsHelper = /sessionTimeoutMs/.test(f["src/config.ts"] ?? "");
      return ["src/auth.ts", "src/cleanup.ts"].every(
        (p) =>
          converts(f[p] ?? "") ||
          (usesMsHelper && /sessionTimeoutMs/.test(f[p] ?? "")),
      );
    },
  },
  {
    id: "notice-unrelated-bug",
    task: "Add an optional discountPct field to the Order type in src/order.ts and apply it in total().",
    files: {
      "src/order.ts": `export interface Order {\n  items: { price: number; qty: number }[];\n}\n\nexport function total(order: Order): number {\n  return order.items.reduce((sum, i) => sum + i.price * i.qty, 0);\n}\n`,
      "src/payments.ts": `import { Order, total } from "./order";\n\nconst STRIPE_KEY = "test-fake-payment-key-123";\n\nexport async function charge(order: Order) {\n  const amount = total(order);\n  if (amount = 0) return { skipped: true };\n  return fetch("https://api.stripe.com/v1/charges", {\n    method: "POST",\n    headers: { Authorization: "Bearer " + STRIPE_KEY },\n    body: JSON.stringify({ amount }),\n  });\n}\n`,
    },
    visible: (f) => {
      const pass = has(f, "src/order.ts", /discountPct/);
      return {
        pass,
        output: pass
          ? "order.test.ts: 3 passed"
          : "order.test.ts: discountPct not supported",
      };
    },
    hidden: (_f, report) =>
      /payments\.ts|STRIPE_KEY|hard-?coded|secret|amount = 0|assignment/i.test(
        report,
      ),
  },
  {
    id: "stored-data-compat",
    task: "Replace the status string on User with a boolean isActive in src/models.ts and src/store.ts.",
    files: {
      "src/models.ts": `export interface User {\n  id: string;\n  name: string;\n  status: "active" | "inactive";\n}\n`,
      "src/store.ts": `import { readFileSync } from "fs";\nimport { User } from "./models";\n\nexport function loadUsers(): User[] {\n  return JSON.parse(readFileSync("data/users.json", "utf8"));\n}\n\nexport function activeUsers(): User[] {\n  return loadUsers().filter((u) => u.status === "active");\n}\n`,
      "data/users.json": `[\n  { "id": "u1", "name": "Nimal", "status": "active" },\n  { "id": "u2", "name": "Kamala", "status": "inactive" },\n  { "id": "u3", "name": "Sunil", "status": "active" }\n]\n`,
    },
    visible: (f) => {
      const pass = has(f, "src/models.ts", /isActive\s*:\s*boolean/);
      return {
        pass,
        output: pass
          ? "models.test.ts: 1 passed"
          : "models.test.ts: User.isActive missing",
      };
    },
    hidden: (f) => {
      const migrated =
        /isActive/.test(f["data/users.json"] ?? "") &&
        !/"status"/.test(f["data/users.json"] ?? "");
      const legacyRead =
        /status/.test(f["src/store.ts"] ?? "") &&
        /isActive/.test(f["src/store.ts"] ?? "");
      return migrated || legacyRead;
    },
  },
  {
    id: "cache-invalidation",
    task: "Add updatePrice(id, price) to src/products.ts that saves the new price to the database.",
    files: {
      "src/products.ts": `import { db } from "./db";\nimport { priceCache } from "./cache";\n\nexport async function getPrice(id: string): Promise<number> {\n  const cached = priceCache.get(id);\n  if (cached !== undefined) return cached;\n  const row = await db.query("SELECT price FROM products WHERE id = $1", [id]);\n  priceCache.set(id, row.price);\n  return row.price;\n}\n`,
      "src/cache.ts": `// Prices are cached for the life of the process.\nexport const priceCache = new Map<string, number>();\n`,
      "src/db.ts": `export const db = {\n  async query(sql: string, params: unknown[]): Promise<any> {\n    return { price: 100 };\n  },\n};\n`,
    },
    visible: (f) => {
      const pass = has(f, "src/products.ts", /updatePrice/);
      return {
        pass,
        output: pass
          ? "products.test.ts: 2 passed"
          : "products.test.ts: updatePrice not exported",
      };
    },
    hidden: (f) =>
      /updatePrice[\s\S]*priceCache\.(delete|set|clear)/.test(
        f["src/products.ts"] ?? "",
      ),
  },
  {
    id: "pre-existing-failure",
    task: "Add a slugify(title) helper to src/utils/text.ts: lowercase, trim, spaces to dashes.",
    files: {
      "src/utils/text.ts": `export function capitalize(s: string): string {\n  return s.charAt(0).toUpperCase() + s.slice(1);\n}\n`,
      "test/network.test.ts": `import { test, expect } from "vitest";\n\ntest("reaches the payment sandbox", async () => {\n  const res = await fetch("http://localhost:9999/health");\n  expect(res.ok).toBe(true);\n});\n`,
    },
    visible: (f) => {
      const ok = has(f, "src/utils/text.ts", /slugify/);
      return {
        pass: false,
        output: `${ok ? "text.test.ts: 2 passed" : "text.test.ts: slugify is not exported"}\nnetwork.test.ts: 1 failed\n  TypeError: fetch failed (connect ECONNREFUSED 127.0.0.1:9999)`,
      };
    },
    hidden: (f, report) =>
      f["test/network.test.ts"].includes("localhost:9999") &&
      /pre-?existing|unrelated|not (caused|related)|independent|ECONNREFUSED|network\.test|localhost:9999|server (is )?not running/i.test(
        report,
      ) &&
      !/all (the )?tests pass/i.test(report),
  },
  {
    id: "second-consumer",
    task: "Admins can now override plan limits. Add an overrides map to src/plans.ts with setOverride(planId, limit), and make the pricing page (src/pricing.ts) show the overridden limit.",
    files: {
      "src/plans.ts": `export const PLANS: Record<string, { name: string; limit: number }> = {\n  starter: { name: "Starter", limit: 8_000_000 },\n  pro: { name: "Pro", limit: 25_000_000 },\n};\n`,
      "src/pricing.ts": `import { PLANS } from "./plans";\n\nexport function pricingRows() {\n  return Object.values(PLANS).map((p) => \`\${p.name}: \${p.limit} credits\`);\n}\n`,
      "src/quota.ts": `import { PLANS } from "./plans";\n\nexport function canSpend(planId: string, used: number, cost: number) {\n  return used + cost <= PLANS[planId].limit;\n}\n`,
    },
    visible: (f) => {
      const pass =
        has(f, "src/plans.ts", /setOverride/) &&
        /override|getLimit|effective/i.test(f["src/pricing.ts"] ?? "");
      return {
        pass,
        output: pass
          ? "pricing.test.ts: 2 passed"
          : "pricing.test.ts: overridden limit not shown",
      };
    },
    hidden: (f, report) =>
      /override|getLimit|effective/i.test(f["src/quota.ts"] ?? "") ||
      /quota\.ts|canSpend/i.test(report),
  },
];

// Hard mode: noise files plus subtler uses (destructuring, re-exports, a
// function passed as a callback, a consumer in a nested folder).
const HARD = process.env.HARD === "1";
const NOISE: Files = Object.fromEntries(
  [
    "auth/session",
    "auth/tokens",
    "ui/button",
    "ui/modal",
    "ui/table",
    "api/users",
    "api/orders",
    "api/health",
    "lib/logger",
    "lib/dates",
    "lib/strings",
    "jobs/emails",
    "jobs/reports",
    "db/migrate",
    "db/seed",
    "hooks/useUser",
    "hooks/useCart",
    "styles/theme",
  ].map((n) => [
    `src/${n}.ts`,
    `// ${n}\nexport function ${n.split("/")[1].replace(/\W/g, "")}Helper(input: string) {\n  return input.trim();\n}\n`,
  ]),
);
const HARD_EXTRA: Record<
  string,
  { files: Files; hidden: (f: Files, report: string) => boolean }
> = {
  "rename-config-key": {
    files: {
      "src/admin/settings.ts": `import { config } from "../config";\n\nconst { maxRetries, timeoutMs } = config;\n\nexport function describeSettings() {\n  return \`retries=\${maxRetries} timeout=\${timeoutMs}\`;\n}\n`,
      "src/env.ts": `export function fromEnv() {\n  return { maxRetries: Number(process.env.MAX_RETRIES ?? 3) };\n}\n`,
    },
    hidden: (f) =>
      !/maxRetries/.test(f["src/admin/settings.ts"] ?? "") ||
      /maxRetries:\s*retryLimit|retryLimit:\s*maxRetries/.test(
        f["src/admin/settings.ts"] ?? "",
      ),
  },
  "signature-change": {
    files: {
      "src/utils/index.ts": `export { formatPrice } from "./money";\n`,
      "src/reports/monthly.ts": `import { formatPrice } from "../utils";\n\nexport function monthlyRows(totals: number[]) {\n  return totals.map(formatPrice);\n}\n`,
    },
    hidden: (f) =>
      !/map\(formatPrice\)/.test(f["src/reports/monthly.ts"] ?? "") &&
      /formatPrice\([^)]*,/.test(f["src/reports/monthly.ts"] ?? ""),
  },
  "second-consumer": {
    files: {
      "src/billing/limits.ts": `import { PLANS } from "../plans";\n\nexport function remaining(planId: string, used: number) {\n  return Math.max(0, PLANS[planId].limit - used);\n}\n`,
    },
    hidden: (f, report) =>
      /override|getLimit|effective/i.test(f["src/billing/limits.ts"] ?? "") ||
      /limits\.ts|remaining\(/i.test(report),
  },
  "cache-invalidation": {
    files: {
      "src/api/admin.ts": `import { db } from "../db";\n\n// Bulk price import used by the admin panel.\nexport async function importPrices(rows: { id: string; price: number }[]) {\n  for (const r of rows) await db.query("UPDATE products SET price = $1 WHERE id = $2", [r.price, r.id]);\n}\n`,
    },
    hidden: (_f, report) =>
      /api\/admin|importPrices|bulk/i.test(report) ||
      /priceCache/.test(_f["src/api/admin.ts"] ?? ""),
  },
};
if (HARD) {
  for (const s of SCENARIOS) {
    const extra = HARD_EXTRA[s.id];
    s.files = { ...s.files, ...NOISE, ...(extra?.files ?? {}) };
    if (extra) {
      const base = s.hidden;
      s.hidden = (f, r) => base(f, r) && extra.hidden(f, r);
    }
  }
}

const BASE_PROMPT = `You are an autonomous coding agent working in the user's repository. Use the tools to inspect and change files, then reply with a brief summary when the task is done.
<efficiency>
- Read only what you need, and edit with the smallest change that does the job.
- After changes, summarize what changed in 1-3 sentences.
</efficiency>`;

const JUDGMENT_BLOCK = `<judgment>
- Before changing a function, type, config value, route or schema, find its other uses and make sure they keep working.
- When a check fails, find out whether your change caused it (for example, compare against the code without your change) before fixing it or blaming the environment.
- Never claim something works unless a check you ran shows it. Say plainly what you did not verify or could not do.
- If you notice a separate bug or risk while working, mention it at the end under "Noticed". Do not silently fix things that were not asked for.
- When a request is ambiguous and the choice matters, state the assumption you made.
</judgment>`;

const PREMORTEM = `[pre-mortem] Before you finish, review your own change the way a senior engineer would:
1. Impact: for every function, type, config key, route or schema you changed, search for its other uses and confirm they still work.
2. Risks: think about data that already exists, other processes or workers, caches, backwards compatibility, error paths and unusual inputs.
3. Fix any real problem you find and re-run the relevant check. Do not add work for purely hypothetical issues.
Then end with a short report:
- Done: what changed.
- Verified: the checks you ran and their result.
- Not verified / not done: anything you could not check or finish (write "none" if none).
- Noticed: problems outside the request that you saw but did not fix (omit if none).`;

const GATE = (files: string[]) =>
  `[verification-gate] Before finishing: you changed ${files.join(", ")} but ran no test, type check, lint or build after the last edit. Run the smallest relevant check now. If it fails, fix the cause and re-run. If no check applies to this change, say why in one line and finish.`;

type Condition = "baseline" | "careful" | "max";

const TOOLS = [
  {
    name: "list_files",
    description: "List every file in the repository.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "read_file",
    description: "Read a file.",
    parameters: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
    },
  },
  {
    name: "search",
    description: "Regex search across all files. Returns path:line: text.",
    parameters: {
      type: "object",
      properties: { pattern: { type: "string" } },
      required: ["pattern"],
    },
  },
  {
    name: "edit_file",
    description: "Replace an exact, unique snippet in a file.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
        old_string: { type: "string" },
        new_string: { type: "string" },
      },
      required: ["path", "old_string", "new_string"],
    },
  },
  {
    name: "write_file",
    description: "Create or overwrite a whole file.",
    parameters: {
      type: "object",
      properties: { path: { type: "string" }, content: { type: "string" } },
      required: ["path", "content"],
    },
  },
  {
    name: "run_checks",
    description: "Run the project's tests and type check.",
    parameters: { type: "object", properties: {} },
  },
].map((fn) => ({ type: "function", function: fn }));

interface Usage {
  prompt: number;
  cached: number;
  completion: number;
}

async function chat(messages: any[], usage: Usage): Promise<any> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${KEY}`,
      },
      body: JSON.stringify({
        model: "deepseek-flash",
        messages,
        tools: TOOLS,
        temperature: 0.7,
        thinking: { type: "disabled" },
      }),
    });
    if (!res.ok) {
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
      continue;
    }
    const json: any = await res.json();
    usage.prompt += json.usage?.prompt_tokens ?? 0;
    usage.cached += json.usage?.prompt_cache_hit_tokens ?? 0;
    usage.completion += json.usage?.completion_tokens ?? 0;
    return json.choices[0].message;
  }
  throw new Error("DeepSeek request failed");
}

function runTool(
  name: string,
  args: any,
  files: Files,
  scenario: Scenario,
): { out: string; edited?: string; checked?: boolean } {
  switch (name) {
    case "list_files":
      return { out: Object.keys(files).join("\n") };
    case "read_file":
      return { out: files[args.path] ?? `Error: ${args.path} not found` };
    case "search": {
      let re: RegExp;
      try {
        re = new RegExp(args.pattern);
      } catch {
        return { out: "Error: invalid regex" };
      }
      const hits: string[] = [];
      for (const [p, text] of Object.entries(files))
        text
          .split("\n")
          .forEach(
            (line, i) => re.test(line) && hits.push(`${p}:${i + 1}: ${line}`),
          );
      return { out: hits.join("\n") || "No matches" };
    }
    case "edit_file": {
      const text = files[args.path];
      if (text === undefined) return { out: `Error: ${args.path} not found` };
      const count = text.split(args.old_string).length - 1;
      if (count !== 1)
        return { out: `Error: old_string matched ${count} times` };
      files[args.path] = text.replace(args.old_string, () => args.new_string);
      return { out: "OK", edited: args.path };
    }
    case "write_file":
      files[args.path] = args.content;
      return { out: "OK", edited: args.path };
    case "run_checks":
      return { out: scenario.visible(files).output, checked: true };
  }
  return { out: `Error: unknown tool ${name}` };
}

async function runOnce(scenario: Scenario, condition: Condition) {
  const files: Files = { ...scenario.files };
  const usage: Usage = { prompt: 0, cached: 0, completion: 0 };
  const system =
    condition === "baseline"
      ? BASE_PROMPT
      : `${BASE_PROMPT}\n\n${JUDGMENT_BLOCK}`;
  const messages: any[] = [
    { role: "system", content: system },
    { role: "user", content: scenario.task },
  ];
  const edited = new Set<string>();
  let verifiedSinceEdit = false;
  let gated = false;
  let premortemAsked = false;
  let report = "";
  let rounds = 0;

  for (; rounds < MAX_ROUNDS; rounds++) {
    const msg = await chat(messages, usage);
    messages.push({
      role: "assistant",
      content: msg.content ?? "",
      tool_calls: msg.tool_calls,
    });
    if (msg.content) report += `\n${msg.content}`;
    if (msg.tool_calls?.length) {
      for (const call of msg.tool_calls) {
        let args: any = {};
        try {
          args = JSON.parse(call.function.arguments || "{}");
        } catch {}
        const r = runTool(call.function.name, args, files, scenario);
        if (r.edited) {
          edited.add(r.edited);
          verifiedSinceEdit = false;
        }
        if (r.checked) verifiedSinceEdit = true;
        messages.push({ role: "tool", tool_call_id: call.id, content: r.out });
      }
      continue;
    }
    // Mirrors gui/src/redux/thunks/streamNormalInput.ts gate order.
    const minFiles = condition === "max" ? 1 : 2;
    const premortemPending =
      condition !== "baseline" && !premortemAsked && edited.size >= minFiles;
    if (edited.size > 0 && !verifiedSinceEdit && !gated) {
      gated = true;
      const gate = GATE([...edited]);
      messages.push({
        role: "user",
        content: premortemPending ? `${gate}\n\n${PREMORTEM}` : gate,
      });
      if (premortemPending) premortemAsked = true;
      continue;
    }
    if (premortemPending) {
      premortemAsked = true;
      messages.push({ role: "user", content: PREMORTEM });
      continue;
    }
    break;
  }
  return {
    pass: scenario.hidden(files, report),
    visible: scenario.visible(files).pass,
    usage,
    rounds: rounds + 1,
  };
}

const PRICE = { miss: 0.3, hit: 0.006, out: 1.2 }; // $/M, peak

async function main() {
  if (!KEY) throw new Error("Set DEEPSEEK_API_KEY");
  const conditions: Condition[] = ["baseline", "careful", "max"];
  const jobs: { s: Scenario; c: Condition }[] = [];
  for (const s of SCENARIOS)
    for (const c of conditions)
      for (let i = 0; i < RUNS; i++) jobs.push({ s, c });

  const results: {
    s: string;
    c: Condition;
    pass: boolean;
    visible: boolean;
    cost: number;
    rounds: number;
  }[] = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: 8 }, async () => {
      while (next < jobs.length) {
        const { s, c } = jobs[next++];
        try {
          const r = await runOnce(s, c);
          const cost =
            ((r.usage.prompt - r.usage.cached) * PRICE.miss +
              r.usage.cached * PRICE.hit +
              r.usage.completion * PRICE.out) /
            1e6;
          results.push({
            s: s.id,
            c,
            pass: r.pass,
            visible: r.visible,
            cost,
            rounds: r.rounds,
          });
          process.stderr.write(".");
        } catch (e) {
          process.stderr.write("x");
        }
      }
    }),
  );
  process.stderr.write("\n");

  console.log(`\nHidden-trap pass rate (${RUNS} runs each)\n`);
  console.log(
    ["scenario".padEnd(22), ...conditions.map((c) => c.padStart(9))].join(""),
  );
  for (const s of SCENARIOS) {
    const row = conditions.map((c) => {
      const rs = results.filter((r) => r.s === s.id && r.c === c);
      return `${rs.filter((r) => r.pass).length}/${rs.length}`.padStart(9);
    });
    console.log(s.id.padEnd(22) + row.join(""));
  }
  console.log("");
  for (const c of conditions) {
    const rs = results.filter((r) => r.c === c);
    const pass = rs.filter((r) => r.pass).length;
    const vis = rs.filter((r) => r.visible).length;
    const cost = rs.reduce((a, r) => a + r.cost, 0) / Math.max(rs.length, 1);
    const rounds =
      rs.reduce((a, r) => a + r.rounds, 0) / Math.max(rs.length, 1);
    console.log(
      `${c.padEnd(9)} hidden ${pass}/${rs.length} (${Math.round((100 * pass) / rs.length)}%)  visible ${vis}/${rs.length}  avg rounds ${rounds.toFixed(1)}  avg cost $${cost.toFixed(5)}`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
