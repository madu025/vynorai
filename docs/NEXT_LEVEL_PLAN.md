# Next level plan

Goal: give a developer who is not the author a reason to install VynorAI, and make that reason provable.
The reason is: agent quality close to Claude Code, at a published low cost, paid in LKR, usable in Sinhala.

Facts in this file were checked in code on 2026-10-10. "Not verified" means not seen running.

## What already exists

| Area                 | State                                                                                                                                                                                                 | Evidence                                                                                          |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Feedback             | Wired end to end: thumbs up/down in the chat reach `routing_feedback`. Stores a prompt fingerprint and `helpful`/`unhelpful` only.                                                                    | `gui/src/components/FeedbackButtons.tsx`, `core/core.ts:573`, `backend/src/routes/proxy.ts`       |
| Error reports        | Wired end to end into `error_reports`, shown in the admin panel.                                                                                                                                      | `gui/src/pages/gui/Chat.tsx:570`, `core/core.ts:597`, `admin/errors`                              |
| Cost before a task   | `TaskCreditHint` shows the median and p90 credits of the user's own last 30 days. A new user has no history. The exact estimate and cap exist for background tasks only.                              | `gui/src/components/mainInput/TaskCreditHint.tsx`, `backend/src/routes/background.ts:113`         |
| Model evaluation     | Five separate scripts, each with its own fixture, scoring and key variable: `live-audit.mjs`, `liveE2E.ts`, `liveQualityAB.ts`, `judgmentEval.ts`, `routerBacktest.ts`. No shared task set or report. | `backend/scripts/`, `backend/src/scripts/`                                                        |
| Sinhala              | Routing protects Sinhala, Tamil and Singlish prompts from the cheap tier. There is no reply-language setting in the GUI or core.                                                                      | `backend/src/services/localSlmRouter.ts:59`, no match for a language setting in `gui/src`, `core` |
| Parallel subagents   | `ImplementationSubagentScheduler` and six `agent/subagent/*` handlers exist. Nothing calls them. `setActiveImplementationSubagentId` is never dispatched.                                             | `core/agent/ImplementationSubagentScheduler.ts`, `core/core.ts:414`                               |
| Compaction summaries | Kept in process memory. A restart or rolling deploy changes the summary block once, which misses the prompt cache.                                                                                    | `docs/ARCHITECTURE_DECISIONS.md`                                                                  |
| Roadmap document     | Lists as done: reply-language setting, `/goal` in the IDE, parallel worktree tasks, maintenance swarm. None of these is reachable from the IDE today.                                                 | `docs/VYNORAI_COMPETITIVE_ROADMAP.md`                                                             |

Two earlier claims were wrong and are corrected here: feedback and error telemetry are not missing, and a pre-task cost hint already exists.

## Order of work

Each step ends with a check that must pass before the next step starts.

### 1. Correct the roadmap document

Change every "Done" in `docs/VYNORAI_COMPETITIVE_ROADMAP.md` that is not reachable from the IDE to "Partial" or "Not wired", with the file that holds the unused code. Update the progress line in `docs/CLAUDE_CODE_PARITY.md` (it still names G16b as next).

Check: every "Done" row names a command, tool or UI element that a user can reach.

Size: hours.

### 2. One benchmark, one report

Build `backend/scripts/bench/` on top of the `live-audit.mjs` loop (production proxy, real model, real tool calls on a fixture).

- Task set: 40 tasks in a versioned folder, each with a fixture, a prompt and a scorer that reads the result from disk. Mix: bug fix, add a function with a test, rename across files, explain code, find a missing file, refuse an unsafe request. Ten prompts in Sinhala or Singlish.
- Scorer: deterministic. Tests pass, file contents match, cited paths exist or were read (the rule fixed in `live-audit.mjs` on 2026-10-10). No model-graded scores.
- Report: pass rate, credits per task, cache-hit share, tool rounds, median and p90 time, per category and per language. Written as JSON and Markdown under `backend/bench-results/`.
- One key variable for all scripts: `VYNORAI_E2E_API_KEY`. The old scripts keep working or are folded in.

Check: two runs of the full set on the same build differ by at most 3 tasks. The report is committed as the baseline.

Size: 3 to 5 days. Each full run costs real credits; record the cost in the report.

This step comes before any change that claims a quality gain. From here on, a change to prompts, tools or routing is accepted only with a before and after report.

### 3. Outcome signal, not only thumbs

Thumbs measure opinion on one answer. Add what happened to the task, from data the client already has:

- task finished with the verification gate passed, finished without verification, stopped by the user, hit the tool round budget, ended in an error;
- whether the user rewound the turn;
- tool rounds and credits for the task.

Send one event per finished agent turn to a new `task_outcomes` table (SQLite schema and PostgreSQL migration, both, checked with the `vynor-postgres-check` skill). No prompt text, no file paths, no code. Add a row to the admin panel: outcome rates per day and per plan.

Check: a finished, a stopped and a failed turn in the E2E profile each produce the right row; the row holds no prompt or path.

Size: 2 to 3 days.

### 4. First run

Measure before changing anything: install the VSIX into a clean profile and record every screen until the first agent answer. Not verified today: what the onboarding card shows (the component still has Continue's local-model and provider tabs).

Then fix what the recording shows. Known gaps:

- `TaskCreditHint` is empty for a new user. Show the plan's remaining credits and a typical cost from the benchmark report until the user has history.
- Sign-in is offered from the quota bar and from a stream error. Offer it as the first screen when no key is present.
- Remove onboarding paths that lead to local models or other providers if they are still reachable.

Check: an E2E test goes from a clean profile to a first answer with no manual configuration, and a new `FirstRun.test.ts` covers it.

Size: 3 to 4 days.

### 5. Reply language

Add a `replyLanguage` setting (auto, English, Sinhala, Tamil). Auto follows the language of the user's message. The instruction goes into the per-conversation part of the prompt, not the stable prefix (see the `vynor-prompt-cache` skill). Code, commands, paths and identifiers stay in English.

Check: benchmark Sinhala tasks pass at the same rate with the setting on; the cache-hit share does not drop.

Size: 2 days. Do this only after step 2, so the effect is measured.

### 6. Finish the half-built agent parts

- Persist compaction summaries (table with scope and dropped-block hash as key, both databases), so a deploy no longer changes the block.
- Wire `ImplementationSubagentScheduler` into the plan flow, or delete it and the six unused handlers. Decide with a benchmark run of multi-file tasks: keep it only if it raises the pass rate or cuts time without raising credits per task.

Check: summary survives a backend restart in a test; scheduler decision recorded in `docs/ARCHITECTURE_DECISIONS.md` with the benchmark numbers.

Size: 1 to 2 weeks.

## Rules for the whole plan

- No quality claim without a benchmark report. No "works" without the E2E run named in the `vynor-live-verify` skill.
- A new tool adds its schema to every request. Add one only when the benchmark shows a gain.
- Ask before push, publish and deploy.
- Release 1.2.58 after steps 1 to 3, with the baseline report.

## Not planned

Side-by-side diff review, session tabs, more hook events, IntelliJ. They do not change why a new user would install the extension.
