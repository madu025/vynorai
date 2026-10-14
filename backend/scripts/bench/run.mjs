/**
 * VynorAI benchmark: real model through the production proxy, real tool calls
 * on throwaway fixtures, deterministic scoring.
 *
 *   node scripts/bench/run.mjs --selfcheck                    no model call, validates every task
 *   VYNORAI_E2E_API_KEY=vynor_live_... node scripts/bench/run.mjs [--suite=all] [--runs=1] [--filter=bugfix,si] [--ids=a,b] [--concurrency=2] [--out=bench-results]
 *
 * The key is read from the environment only and is never printed or written.
 * Every full run spends real credits; the report records how many.
 */
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BASE, cleanup, evaluate, makeFixture, runAgent } from "./lib.mjs";
import { TASKS } from "./tasks.mjs";
import { EVIDENCE_TASKS } from "./evidence-tasks.mjs";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? "true"];
  }),
);
const here = path.dirname(fileURLToPath(import.meta.url));

const digest = (value) =>
  crypto.createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");

function commandText(command) {
  try {
    return execFileSync(command[0], command.slice(1), {
      cwd: path.resolve(here, "..", "..", ".."),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

function fileDigest(filePath) {
  try {
    return digest(fs.readFileSync(path.resolve(filePath)));
  } catch {
    return null;
  }
}

function runManifest(tasks, startedAt) {
  const vsixPath = args.vsix ? path.resolve(args.vsix) : null;
  return {
    schemaVersion: 1,
    suite: args.suite ?? "all",
    startedAt: startedAt.toISOString(),
    repoCommit: commandText(["git", "rev-parse", "HEAD"]),
    dirtyStateDigest: digest(commandText(["git", "status", "--porcelain=v1"]) ?? "unavailable"),
    backendReleaseSha: args.backendSha ?? null,
    backendConfigDigest: args.backendConfigDigest ?? null,
    featureFlags: args.featureFlags ? args.featureFlags.split(",").sort() : [],
    provider: args.provider ?? null,
    model: args.model ?? "vynor-auto",
    base: BASE,
    node: process.version,
    platform: `${process.platform}-${process.arch}`,
    vsix: vsixPath ? { path: path.basename(vsixPath), sha256: fileDigest(vsixPath) } : null,
    taskDigest: digest(tasks.map((task) => ({
      id: task.id,
      scope: task.scope ?? null,
      criteria: task.criteria ?? null,
      prompt: task.prompt,
      files: task.files,
      check: task.check,
    }))),
    scorerDigest: fileDigest(path.join(here, "lib.mjs")),
    taskFileDigest: fileDigest(path.join(here, args.suite === "evidence" ? "evidence-tasks.mjs" : "tasks.mjs")),
    runOrder: args.runOrder ?? "sequential",
    concurrency: Number(args.concurrency || 2),
    randomizationSeed: args.seed ?? null,
    cacheCondition: args.cacheCondition ?? "provider-managed",
  };
}

function classifyFailure(run, verdict) {
  const source = `${run.error ?? ""}; ${verdict.why ?? ""}`;
  if (!source.trim()) return { terminalClass: "success", contributingCauses: [] };
  if (/HTTP (?:401|403|429|5\d\d)|harness error|wrong VSIX|stale VSIX|provider outage|rate limit/i.test(source)) {
    return { terminalClass: "invalid_run", contributingCauses: [source.slice(0, 180)] };
  }
  if (/budget|no final answer|timeout/i.test(source)) return { terminalClass: "budget_or_timeout", contributingCauses: [source.slice(0, 180)] };
  if (/tests fail|missing|still present|protected file changed|file changed/i.test(source)) {
    return { terminalClass: "valid_product_failure", contributingCauses: [source.slice(0, 180)] };
  }
  return { terminalClass: "valid_product_failure", contributingCauses: [source.slice(0, 180)] };
}

function suiteTasks() {
  if ((args.suite ?? "all") === "core") return TASKS;
  if (args.suite === "evidence") return EVIDENCE_TASKS;
  if ((args.suite ?? "all") === "all") return [...TASKS, ...EVIDENCE_TASKS];
  throw new Error(`Unknown suite: ${args.suite}. Use core, evidence, or all.`);
}

function selected() {
  let list = suiteTasks();
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
  const tasks = suiteTasks();
  for (const task of tasks) {
    if (ids.has(task.id)) problems.push(`${task.id}: duplicate id`);
    ids.add(task.id);
    if (args.suite === "evidence") {
      if (!['simple', 'medium', 'complex'].includes(task.scope)) problems.push(`${task.id}: invalid scope`);
      if (!Array.isArray(task.criteria) || task.criteria.length === 0) problems.push(`${task.id}: no criteria`);
      const criterionIds = new Set();
      for (const criterion of task.criteria ?? []) {
        if (!criterion.id || criterionIds.has(criterion.id)) problems.push(`${task.id}: duplicate or missing criterion id`);
        criterionIds.add(criterion.id);
        if (typeof criterion.mustPass !== "boolean" || !criterion.oracle) problems.push(`${task.id}: invalid criterion ${criterion.id ?? "unknown"}`);
      }
      if (!(task.criteria ?? []).some((criterion) => criterion.mustPass)) problems.push(`${task.id}: no mustPass criterion`);
      if (!Array.isArray(task.mutants) || task.mutants.length === 0) problems.push(`${task.id}: no scorer mutant`);
    }
    const tools = ["ls", "read_file", "grep_search", "run_command"];
    const emptyResult = { answer: "", log: { tools, commands: [], toolErrors: 0 } };
    // 1. Untouched fixture must fail.
    let fx = makeFixture(task);
    const before = evaluate(task, fx, task.fixed || task.check.answerAll ? emptyResult : emptyResult);
    cleanup(fx);
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
    // 4. A targeted mutant must fail the same external oracle. Mutants expose
    // scorer false positives that reference/untouched checks cannot catch.
    for (const mutant of task.mutants ?? []) {
      fx = makeFixture(task);
      for (const [rel, content] of Object.entries(mutant.files ?? {})) {
        fs.mkdirSync(path.dirname(path.join(fx.dir, rel)), { recursive: true });
        fs.writeFileSync(path.join(fx.dir, rel), content, "utf8");
      }
      const mutated = evaluate(task, fx, {
        answer: mutant.answer ?? task.goodAnswer ?? "",
        log: { tools, commands: [], toolErrors: 0 },
      });
      if (mutated.ok) problems.push(`${task.id}: mutant ${mutant.name} passes`);
      cleanup(fx);
    }
  }
  const byCat = {};
  for (const t of tasks) byCat[t.category] = (byCat[t.category] ?? 0) + 1;
  const nonEnglish = tasks.filter((t) => t.lang !== "en").length;
  console.log(`suite: ${args.suite ?? "all"} tasks: ${tasks.length} ${JSON.stringify(byCat)} non-English: ${nonEnglish}`);
  if (problems.length) {
    console.error(problems.join("\n"));
    process.exit(1);
  }
  console.log("selfcheck ok");
}

function protocolSelfcheck() {
  const manifest = runManifest(suiteTasks(), new Date("2026-01-01T00:00:00.000Z"));
  const required = ["schemaVersion", "suite", "repoCommit", "dirtyStateDigest", "taskDigest", "scorerDigest", "node", "platform", "concurrency"];
  const absent = required.filter((key) => !(key in manifest));
  if (absent.length) throw new Error(`manifest missing ${absent.join(", ")}`);
  const invalid = classifyFailure({ error: "HTTP 429 rate limit" }, { why: "" });
  const product = classifyFailure({ error: "" }, { why: "tests fail: assertion" });
  if (invalid.terminalClass !== "invalid_run" || product.terminalClass !== "valid_product_failure") {
    throw new Error("failure taxonomy classification is not stable");
  }
  console.log(`protocol selfcheck ok (manifest schema ${manifest.schemaVersion})`);
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
  const manifest = runManifest(tasks, startedAt);
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
        const classification = classifyFailure(run, verdict);
        r = {
          id: job.task.id,
          category: job.task.category,
          lang: job.task.lang,
          scope: job.task.scope ?? "unknown",
          n: job.n,
          ok: verdict.ok,
          why: verdict.why,
          rounds: run.rounds,
          tokens: run.tokens,
          cacheHit: run.cacheHit,
          ms: run.ms,
          toolCalls: run.log.tools.length,
          toolErrors: run.log.toolErrors,
          answerDigest: verdict.ok ? undefined : digest(String(run.answer ?? "")),
          tier: run.tier ?? null,
          model: run.model ?? null,
          terminalClass: classification.terminalClass,
          contributingCauses: classification.contributingCauses,
        };
      } catch (err) {
        r = { id: job.task.id, category: job.task.category, lang: job.task.lang, scope: job.task.scope ?? "unknown", n: job.n, ok: false, why: `harness error: ${err.message}`, rounds: 0, tokens: 0, cacheHit: 0, ms: 0, toolCalls: 0, toolErrors: 0, terminalClass: "invalid_run", contributingCauses: [String(err.message).slice(0, 180)] };
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
    const valid = rows.filter((r) => r.terminalClass !== "invalid_run");
    const times = valid.map((r) => r.ms).sort((a, b) => a - b);
    const tokens = valid.reduce((s, r) => s + r.tokens, 0);
    const cache = valid.reduce((s, r) => s + r.cacheHit, 0);
    return {
      runs: valid.length,
      invalidRuns: rows.length - valid.length,
      passed: valid.filter((r) => r.ok).length,
      passRate: valid.length ? Math.round((1000 * valid.filter((r) => r.ok).length) / valid.length) / 10 : 0,
      tokensPerTask: valid.length ? Math.round(tokens / valid.length) : 0,
      cacheHitShare: tokens ? Math.round((1000 * cache) / tokens) / 10 : 0,
      medianRounds: pct(rows.map((r) => r.rounds).sort((a, b) => a - b), 50),
      medianSeconds: Math.round(pct(times, 50) / 100) / 10,
      p90Seconds: Math.round(pct(times, 90) / 100) / 10,
      maxSeconds: Math.round((times.at(-1) ?? 0) / 100) / 10,
    };
  };
  const group = (key) => {
    const out = {};
    for (const r of results) (out[r[key]] ??= []).push(r);
    return Object.fromEntries(Object.entries(out).map(([k, rows]) => [k, summarize(rows)]));
  };
  const report = {
    suite: args.suite === "evidence" ? "vynorai-evidence-pilot-v1" : "vynorai-bench-v1",
    startedAt: startedAt.toISOString(),
    base: BASE,
    extensionBuild: args.build ?? null,
    overall: summarize(results),
    byCategory: group("category"),
    byLanguage: group("lang"),
    byScope: group("scope"),
    creditsDelta: Number.isNaN(creditsBefore) || Number.isNaN(creditsAfter) ? null : creditsAfter - creditsBefore,
    manifest,
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
    `| ${name} | ${s.passed}/${s.runs} | ${s.invalidRuns} | ${s.passRate}% | ${s.tokensPerTask} | ${s.cacheHitShare}% | ${s.medianRounds} | ${s.medianSeconds}s | ${s.p90Seconds}s | ${s.maxSeconds}s |`;
  const head = "| Group | Passed | Invalid | Rate | Tokens per task | Cache hit | Median rounds | Median time | p90 time | Max time |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |";
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
    ...Object.entries(r.byScope).map(([k, s]) => row(`scope: ${k}`, s)),
    "",
    "## Failures",
    "",
    ...r.results.filter((x) => !x.ok).flatMap((x) => [`- ${x.id}#${x.n} [${x.terminalClass}]: ${x.why}`, ...(x.answerDigest ? [`  answer digest: ${x.answerDigest}`] : [])]),
    "",
  ].join("\n");
}

if (args.selfcheck) selfcheck();
else if (args["protocol-selfcheck"]) protocolSelfcheck();
else await live();
