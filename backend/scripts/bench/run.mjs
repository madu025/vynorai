/**
 * VynorAI benchmark: real model through the production proxy, real tool calls
 * on throwaway fixtures, deterministic scoring.
 *
 *   node scripts/bench/run.mjs --selfcheck                    no model call, validates every task
 *   VYNORAI_E2E_API_KEY=vynor_live_... node scripts/bench/run.mjs [--runs=1] [--filter=bugfix,si] [--ids=a,b] [--concurrency=2] [--out=bench-results]
 *
 * The key is read from the environment only and is never printed or written.
 * Every full run spends real credits; the report records how many.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BASE, cleanup, evaluate, makeFixture, runAgent } from "./lib.mjs";
import { TASKS } from "./tasks.mjs";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? "true"];
  }),
);
const here = path.dirname(fileURLToPath(import.meta.url));

function selected() {
  let list = TASKS;
  if (args.ids) {
    const ids = args.ids.split(",");
    list = list.filter((t) => ids.includes(t.id));
  }
  if (args.filter) {
    const terms = args.filter.split(",");
    list = list.filter((t) =>
      terms.some((x) => t.category === x || t.lang === x || (x === "nonenglish" && t.lang !== "en")),
    );
  }
  return list;
}

// ─── Selfcheck ───────────────────────────────────────────────────────────────
function selfcheck() {
  const problems = [];
  const ids = new Set();
  for (const task of TASKS) {
    if (ids.has(task.id)) problems.push(`${task.id}: duplicate id`);
    ids.add(task.id);
    const tools = ["ls", "read_file", "grep_search", "run_command"];
    const emptyResult = { answer: "", log: { tools, commands: [], toolErrors: 0 } };
    // 1. Untouched fixture must fail.
    let fx = makeFixture(task);
    const before = evaluate(task, fx, task.fixed || task.check.answerAll ? emptyResult : emptyResult);
    cleanup(fx);
    const isAnswerOnly = !task.fixed && !task.check.tests;
    const mustFailBefore = !task.check.intact && !task.check.outsideUnchanged;
    if (mustFailBefore && before.ok) problems.push(`${task.id}: passes before any work`);
    // 2. A correct result must pass.
    fx = makeFixture(task);
    for (const [rel, content] of Object.entries(task.fixed ?? {})) {
      fs.mkdirSync(path.dirname(path.join(fx.dir, rel)), { recursive: true });
      fs.writeFileSync(path.join(fx.dir, rel), content, "utf8");
    }
    // Renames that move a file: drop the old file.
    if (task.id === "rn-class") fs.rmSync(path.join(fx.dir, "src/userRepo.mjs"), { force: true });
    const good = evaluate(task, fx, {
      answer: task.goodAnswer ?? "",
      log: { tools, commands: [], toolErrors: 0 },
    });
    if (!good.ok) problems.push(`${task.id}: correct result fails: ${good.why}`);
    cleanup(fx);
    // 3. A wrong answer must fail.
    if (task.badAnswer !== undefined) {
      fx = makeFixture(task);
      const bad = evaluate(task, fx, { answer: task.badAnswer, log: { tools, commands: [], toolErrors: 0 } });
      if (bad.ok) problems.push(`${task.id}: wrong answer passes`);
      cleanup(fx);
    }
    void isAnswerOnly;
  }
  const byCat = {};
  for (const t of TASKS) byCat[t.category] = (byCat[t.category] ?? 0) + 1;
  const nonEnglish = TASKS.filter((t) => t.lang !== "en").length;
  console.log(`tasks: ${TASKS.length} ${JSON.stringify(byCat)} non-English: ${nonEnglish}`);
  if (problems.length) {
    console.error(problems.join("\n"));
    process.exit(1);
  }
  console.log("selfcheck ok");
}

// ─── Live run ────────────────────────────────────────────────────────────────
function pct(sorted, p) {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

async function usedTokens(key) {
  try {
    const res = await fetch(`${BASE}/api/auth/me`, { headers: { Authorization: `Bearer ${key}` } });
    const json = await res.json();
    return Number(json?.monthlyUsage?.used_tokens ?? NaN);
  } catch {
    return NaN;
  }
}

async function live() {
  const key = process.env.VYNORAI_E2E_API_KEY || process.env.VYNOR_E2E_API_KEY || "";
  if (!/^vynor_live_[a-f0-9]{32}$/i.test(key)) {
    console.error("Set VYNORAI_E2E_API_KEY (vynor_live_ + 32 hex).");
    process.exit(2);
  }
  const tasks = selected();
  const runs = Number(args.runs || 1);
  const concurrency = Math.max(1, Number(args.concurrency || 2));
  const jobs = tasks.flatMap((t) => Array.from({ length: runs }, (_, i) => ({ task: t, n: i + 1 })));
  const startedAt = new Date();
  const creditsBefore = await usedTokens(key);
  const results = [];
  let next = 0;

  async function worker() {
    while (next < jobs.length) {
      const job = jobs[next++];
      const fx = makeFixture(job.task);
      let r;
      try {
        const run = await runAgent(key, job.task, fx);
        const verdict = evaluate(job.task, fx, run);
        r = {
          id: job.task.id,
          category: job.task.category,
          lang: job.task.lang,
          n: job.n,
          ok: verdict.ok,
          why: verdict.why,
          rounds: run.rounds,
          tokens: run.tokens,
          cacheHit: run.cacheHit,
          ms: run.ms,
          toolCalls: run.log.tools.length,
          toolErrors: run.log.toolErrors,
          answer: verdict.ok ? undefined : String(run.answer ?? '').slice(0, 500),
          tier: run.tier ?? null,
          model: run.model ?? null,
        };
      } catch (err) {
        r = { id: job.task.id, category: job.task.category, lang: job.task.lang, n: job.n, ok: false, why: `harness error: ${err.message}`, rounds: 0, tokens: 0, cacheHit: 0, ms: 0, toolCalls: 0, toolErrors: 0 };
      } finally {
        cleanup(fx);
      }
      results.push(r);
      console.log(`${r.ok ? "PASS" : "FAIL"} ${r.id}#${r.n} rounds=${r.rounds} tokens=${r.tokens}${r.ok ? "" : " | " + r.why.slice(0, 140)}`);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  const creditsAfter = await usedTokens(key);

  const summarize = (rows) => {
    const times = rows.map((r) => r.ms).sort((a, b) => a - b);
    const tokens = rows.reduce((s, r) => s + r.tokens, 0);
    const cache = rows.reduce((s, r) => s + r.cacheHit, 0);
    return {
      runs: rows.length,
      passed: rows.filter((r) => r.ok).length,
      passRate: rows.length ? Math.round((1000 * rows.filter((r) => r.ok).length) / rows.length) / 10 : 0,
      tokensPerTask: rows.length ? Math.round(tokens / rows.length) : 0,
      cacheHitShare: tokens ? Math.round((1000 * cache) / tokens) / 10 : 0,
      medianRounds: pct(rows.map((r) => r.rounds).sort((a, b) => a - b), 50),
      medianSeconds: Math.round(pct(times, 50) / 100) / 10,
      p90Seconds: Math.round(pct(times, 90) / 100) / 10,
    };
  };
  const group = (key) => {
    const out = {};
    for (const r of results) (out[r[key]] ??= []).push(r);
    return Object.fromEntries(Object.entries(out).map(([k, rows]) => [k, summarize(rows)]));
  };
  const report = {
    suite: "vynorai-bench-v1",
    startedAt: startedAt.toISOString(),
    base: BASE,
    extensionBuild: args.build ?? null,
    overall: summarize(results),
    byCategory: group("category"),
    byLanguage: group("lang"),
    creditsDelta: Number.isNaN(creditsBefore) || Number.isNaN(creditsAfter) ? null : creditsAfter - creditsBefore,
    results: results.sort((a, b) => a.id.localeCompare(b.id) || a.n - b.n),
  };
  const outDir = path.resolve(here, "..", "..", args.out || "bench-results");
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = startedAt.toISOString().replace(/[:.]/g, "-");
  fs.writeFileSync(path.join(outDir, `${stamp}.json`), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(outDir, `${stamp}.md`), markdown(report));
  console.log("\n" + markdown(report));
  process.exit(report.overall.passed === report.overall.runs ? 0 : 1);
}

function markdown(r) {
  const row = (name, s) =>
    `| ${name} | ${s.passed}/${s.runs} | ${s.passRate}% | ${s.tokensPerTask} | ${s.cacheHitShare}% | ${s.medianRounds} | ${s.medianSeconds}s | ${s.p90Seconds}s |`;
  const head = "| Group | Passed | Rate | Tokens per task | Cache hit | Median rounds | Median time | p90 time |\n| --- | --- | --- | --- | --- | --- | --- | --- |";
  return [
    `# ${r.suite}`,
    "",
    `Run: ${r.startedAt}, ${r.base}${r.extensionBuild ? `, build ${r.extensionBuild}` : ""}`,
    `Monthly usage delta during the run: ${r.creditsDelta ?? "unavailable"} tokens`,
    "",
    head,
    row("**All**", r.overall),
    ...Object.entries(r.byCategory).map(([k, s]) => row(k, s)),
    ...Object.entries(r.byLanguage).map(([k, s]) => row(`lang: ${k}`, s)),
    "",
    "## Failures",
    "",
    ...r.results.filter((x) => !x.ok).flatMap((x) => [`- ${x.id}#${x.n}: ${x.why}`, ...(x.answer ? [`  answer: ${JSON.stringify(x.answer)}`] : [])]),
    "",
  ].join("\n");
}

if (args.selfcheck) selfcheck();
else await live();
