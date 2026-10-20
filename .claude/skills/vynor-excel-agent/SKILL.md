---
name: vynor-excel-agent
description: Improve the M365 Excel add-in and its agent (dashboards, business meaning, duplicate keys, agent loop) without regressions. Use for any Excel add-in or Excel agent change, and for "beat Copilot in Excel" work.
---

# Excel agent work

Code: `extensions/m365/src/` (reader `intent.ts`, plan `excel.ts`, writer `officeExcel.ts`, business meaning
`businessContext.ts`, dashboard `dashboardLayout.ts`, device agent loop `agent.ts`, server agent
`backend/src/services/m365Agent.ts`). Read `CODEMAP.md` first; extend, do not rebuild.

## Gates (run all, before and after; never below baseline)

In `extensions/m365`:

1. `npx tsx --test src/*.test.ts` (includes `parityBenchmark.test.ts`, which must stay 100%).
2. `npx tsc --noEmit -p .`. Its `include` is an explicit list: files in `test/batch/` and newly added
   files are not type-checked unless you add them. Check new files with a temporary tsconfig that
   extends this one.
3. `npx tsx test/batch/benchmark.ts` (Copilot-parity scorecard). Use `--write` to refresh
   `docs/BENCHMARK_REPORT.md`.
4. `npx tsx test/batch/run.ts --all` and `npx tsx test/batch/fuzz.ts`. `run.ts` rewrites
   `docs/BATCH_REPORT.md`; restore it with `git checkout` unless the change is intended.

If `typescript` is missing: `npm i --no-save --no-package-lock typescript@5.6.3`. Prettier: the repo
config needs a Tailwind plugin that may be missing. Use a scratch config without it, and format only
the files you changed.

## Lessons from past bugs (each has a test now; do not reintroduce)

- With no column named, a dashboard must group by a business category (region, department, cost
  centre, status) and add up measures. Never an ID, a date, a name, a percentage or a per-unit price.
  This is `suggestDashboardColumns`.
- A master list's own ID (SKU, Employee ID, Customer ID with ≥95% distinct values) is its business
  key. Names, phone numbers and emails never are.
- A Currency column with more than one code means the rows are in mixed currencies. Never format or
  total them as one currency; name the column in a note.
- Regexes: write `\s`, `\d` and `\b`, never `s`, `d` or `b`. Test with a header containing the letter,
  as in "Sales" and "Status".
- Excel reads an empty cell back as `""`, never `null`. Fixtures that feed the fingerprint must
  match, or every apply fails with `source_changed_since_preview`.
- "Cost Centre" and "Profit Center" are groups, not money, even though they contain "cost".
- After an apply, the add-in's own report comes back to `runAgent` as the request. Checks on the
  person's words (multi-step coverage, target, audience) must skip it.
- Agent steps (`vynor_step`) must pass `warnings` and `notes` on to the agent, and pass the request to
  apply, or the agent never hears about fallbacks or lost leading zeros.
- A refused PivotTable (Excel on the web) must leave no half-made pivot. Write the formula fallback
  and add a `notes` entry.

## Adding a capability

1. Add a benchmark scenario or check for it in `test/batch/benchmark.ts` first, and watch it fail.
2. Make the smallest change. Keep pure logic (cell plans, inference) out of Office.js writers, so it
   can be tested without Excel.
3. Mutation check: break the new code on purpose, confirm the benchmark drops, then restore it
   (compare with `cmp` against a backup).
4. Update `CODEMAP.md` (and `AGENTS.md` if a capability moved) and run
   `node scripts/check-doc-links.mjs`.

## Live model runs

`npx tsx --env-file=../../.env.e2e test/batch/agent-prompts.ts` (41 agent tasks) and `test/batch/ai500.ts`
(500 prompts) call the real gateway with the testing key. In a cloud session behind a proxy, set
`NODE_USE_ENV_PROXY=1`, or Node's fetch fails with "fetch failed" (ai500 then reports 0 tokens). Run
the two one after the other: run together, they hit the gateway's rate limit (429). A failure is a
regression only if it also passes on the old code; rerun it twice first, since the model varies.

## Agent behaviour (agent.ts / m365Agent.ts)

- The system prompt and tool list are a fixed prefix: follow the `vynor-prompt-cache` skill. Put
  per-request facts (business context, key, currency) in a later message, never in the prefix.
- Limits (`AGENT_MAX_TURNS`, `AGENT_MAX_CHANGES`, `READ_MAX_*`) are never lowered.
- Every write stays staged: preview, approval, apply, undo. The agent never writes without approval,
  and never sends cell data off the device without consent.

## Honesty

Headless tests prove what the add-in writes, not how Excel draws or calculates it. Say "not verified
in real Excel" until `vynor-live-verify` or a manual run on a machine with Excel has been done.
