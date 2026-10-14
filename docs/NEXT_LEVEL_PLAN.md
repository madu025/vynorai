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
- Historical release gate: steps 1 to 3 shipped in 1.2.58. New releases follow
  the evidence-driven plan and the current release procedures.

## Not planned

Side-by-side diff review, session tabs, more hook events, IntelliJ. They do not change why a new user would install the extension.

## Status, 2026-10-10

| Step                | State                   | Evidence and what is not verified                                                                                                                                                                                                                                                                                                                          |
| ------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 Roadmap corrected | Done                    | `VYNORAI_COMPETITIVE_ROADMAP.md`, `CLAUDE_CODE_PARITY.md`                                                                                                                                                                                                                                                                                                  |
| 2 Benchmark         | Done, baseline recorded | 40 tasks, 14 non-English, `backend/scripts/bench/`; baseline 75 of 80 runs (93.8%), `backend/bench-results/baseline-2026-10-10.md`. The first run was before the fixes below. Two runs of the same build differed by 5 failed runs, all explained by the two causes below; a clean repeat after deploy is still needed to meet the "within 3 tasks" check. |
| 3 Outcome signal    | Done                    | `task_outcomes` (both databases), `POST /v1/task-outcomes`, admin table, GUI reports; 1 backend test, 3 GUI tests. Opt-in, so it only counts users who turned it on. Not verified: a row written by a real extension session.                                                                                                                              |
| 4 First run         | Partly done             | New users see a labelled estimate in `TaskCreditHint` (3 tests). The Continue onboarding card is not mounted anywhere, so its local-model and provider tabs are not reachable. Not done: a `FirstRun` E2E; it needs a real browser sign-in. Not measured: the screens of a clean install.                                                                  |
| 5 Reply language    | Done in code            | `replyLanguage` setting, one block in the system message, "auto" adds nothing (3 tests). Not measured: Sinhala pass rate with the setting on, because the benchmark calls the proxy directly and does not build the extension's system message.                                                                                                            |
| 6 Agent parts       | Decided, not wired      | Summaries stay in memory and the scheduler stays unwired; reasons in `ARCHITECTURE_DECISIONS.md`.                                                                                                                                                                                                                                                          |

Found by the benchmark and fixed in code, not yet deployed:

- Sinhala and Tamil script edit requests matched no mutation verb, so the proxy removed the edit tools and the agent
  could only paste code into the chat. All 4 such runs failed (`ft-word-count`, `rn-property`). `isMutationRequest`
  now knows the verbs. Takes effect after the next backend deploy; the benchmark must be re-run then.
- The scorer did not accept "næthæ" as "does not exist" (`ms-singlish`). Scorer fixed; the model was right.

Historical next action: the backend was deployed and the benchmark was rerun. The current next action is Phase 0
of the evidence-driven plan below; implementation subagents remain deferred until its benchmark trigger is met.

## Verification, 2026-10-11

Against production (backend f47bc87) with a real key:

| Check                                                                                              | Result                                                                                  |
| -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Benchmark, 40 tasks x 2                                                                            | 78 of 80 (97.5%); Sinhala 7 of 8, was 4 of 8; the 2 failures were scorer wording misses |
| `apply_diff`, `rename_symbol` chosen and working with the model (core schemas and code)            | 2 of 2                                                                                  |
| `/fix` (English, Singlish), `/review`, `/test` prompts from `agentPromptCommands.ts`               | 4 of 4                                                                                  |
| Reply language si / en / auto                                                                      | 3 of 3 (Sinhala when asked, English when asked, Sinhala prompt left alone)              |
| Task outcome: core `postToVynor` to `/v1/task-outcomes` to a PostgreSQL row, admin aggregate query | works; the row was removed afterwards                                                   |
| Real extension, real chat panel, real model prompt, reporting off                                  | answered; no row written (E2E `TaskOutcome`)                                            |
| E2E `VynorOnlyUI`, `VSIXLifecycle`, `SlashCommands` on 1.2.58                                      | pass                                                                                    |

Open, with evidence:

- Window hang after Settings, Ctrl+L or `Set API Key`: cause found on 2026-10-11, fixed in code, verified in the
  live extension (VSIX 1.2.59, not published). One focus or new-session message was answered by several GUI
  listeners; the extension returned the extra answers as errors of the same message type; the listeners handled
  them again, without end. Details and numbers: [LARGE_TASK_BENCHMARK_PLAN.md](LARGE_TASK_BENCHMARK_PLAN.md).
  `Smart.test` and `SignInPanel` still have to be run again.
- Every earlier E2E "answer" in the isolated profile came from the `TEST LLM` echo model (the profile had it
  selected). `TaskOutcome` with reporting on needs a repeat against the real model.
- Reply language through the extension's own system message (the benchmark above uses the same text block).

## Superseded evidence-driven draft (2026-10-13)

This draft is retained only to show why the team-reviewed revision changed. Do not implement from
this section or its handoff prompt. The authoritative implementation plan is the final section of
this document, **Evidence-driven intelligence plan — team-reviewed revision**.

### Objective

Make the agent's completion claim traceable to task-specific evidence without adding mandatory
planning or full verification to a bounded task. The target workflow is:

`request -> semantic scope -> completion contract -> targeted action -> targeted verification -> evidence receipt -> outcome measurement`.

The semantic scope preflight is live: a new Agent-mode task receives `simple`, `medium`, or
`complex`; the control-plane call bypasses response caches, and aggregate scope/cost evidence is
available in admin Economics. This plan extends that work. It does not retain prompt, path, source
code, tool output, or screenshots in backend analytics.

### Existing foundations to reuse

| Need                              | Existing implementation                                                                | Gap to close                                                                  |
| --------------------------------- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Scope                             | `gui/src/redux/util/taskScope.ts`, `streamNormalInput.ts`, economics ledger            | Scope does not yet produce a structured completion contract.                  |
| Completion and verification gates | `gui/src/redux/util/completionGate.ts`, `verificationGate.ts`, `verificationRepair.ts` | Gates infer broad rules; they do not tie evidence to named user outcomes.     |
| Durable task evidence             | `core/agent/TaskRuntime.ts`, `AgentOrchestrator.ts`, `verification.ts`                 | GUI agent turns do not yet show a user-readable per-criterion receipt.        |
| Workspace grounding               | `WorkspaceSessionService`, codebase index, repo map                                    | There is no deterministic changed-surface-to-check selection.                 |
| Safety and review                 | risk policy, checkpoints, Browser QA, `/review` prompt                                 | No independently executed final-review pass for high-risk changes.            |
| Measurement                       | benchmark suite, task outcomes, economics and admin                                    | No one report joins quality, evidence coverage, latency and credits by scope. |

No new autonomous swarm, database retention of user content, or production worker is in this
plan. A component becomes user-visible only after the gate for its phase passes.

### Phase 0: baseline and decision record

1. Add a versioned evidence benchmark category: 12 deterministic tasks, four each for simple,
   medium and complex scope; include one Sinhala/Singlish task in every scope.
2. Each task supplies a small set of externally scored acceptance criteria, a reference solution,
   an untouched failing fixture, and the smallest legitimate verification command.
3. Run the current released workflow twice through the real VSIX. Record pass rate, criterion
   coverage, false-completion rate, tool rounds, latency, credits and cache-hit share.
4. Publish JSON and Markdown baseline results under `backend/bench-results/`. Do not tune prompts
   before the baseline is committed.

Gate: both reference/untouched scorer checks pass; repeat runs differ by no more than three task
results; every failed result has a classified reason. Otherwise fix the benchmark, not the agent.

### Phase 1: completion contract

For a new Agent-mode task, derive a compact local `CompletionContract` after the existing semantic
scope assessment. It contains only:

- 1-3 observable criteria for simple work, 2-5 for medium, and 3-8 for complex;
- change surface hints (code, tests, docs, UI, data) inferred from repository evidence;
- required evidence classes: inspection, test/typecheck/build, browser QA, or explicit user skip;
- risk level and whether independent review is required.

Rules:

- The contract is task-local and travels with the task journal/checkpoint; it is not a backend
  analytics payload.
- The agent may refine it when repository evidence contradicts the initial assessment; every
  refinement has a reason.
- A simple explanation/read-only request gets inspection evidence only. It must not force a todo,
  repo map, or test run.
- An ambiguous requirement with material product, security, payment, or data consequences asks one
  focused user question before mutation. Ordinary uncertainty is handled through targeted inspection.

Likely integration points: `gui/src/redux/util/taskScope.ts`, `streamNormalInput.ts`,
`core/agent/TaskRuntime.ts`, the task journal types, and `gui/src/redux/util/agentProgress.ts`.

Gate: unit tests cover simple, medium, complex, read-only, changed-scope and ambiguous/high-risk
requests. In the benchmark, no simple task gains a compulsory repo-map/todo/full-suite step.

### Phase 2: change impact and verification planner

After the first mutation, create a deterministic `VerificationPlan` from changed paths, language,
package manifests, existing scripts, diagnostics and the completion contract. It chooses the
smallest sufficient checks, for example:

| Changed surface                               | Minimum evidence                                                     |
| --------------------------------------------- | -------------------------------------------------------------------- |
| One source file with an existing focused test | focused test plus diff inspection                                    |
| Type/API change                               | focused test plus package typecheck                                  |
| UI behaviour                                  | targeted UI test or Browser QA when runnable                         |
| Database/schema                               | migration parity check plus relevant backend test                    |
| Auth, billing, permissions, deploy files      | targeted test, typecheck/build as applicable, and independent review |

The planner may escalate when a changed import, public API, migration, security boundary, or failed
check expands the surface. It must never invent a command: commands come from the workspace or a
known VynorAI verification recipe. A missing runnable check becomes an explicit residual risk,
not a fabricated pass.

Gate: deterministic planner tests for every table row; a task that edits after verification is
marked stale; benchmark coverage improves without increasing simple-task median credits by more
than 10% or reducing its pass rate.

### Phase 3: evidence receipt and truthful completion

Show a compact completion receipt in the chat and task history:

- each acceptance criterion: passed, not applicable, blocked, or user-skipped;
- command/tool evidence with exit result and freshness relative to the final edit;
- changed files summary and residual risks;
- scope, rounds and credits already available locally.

`completed` is allowed only if required contract criteria have fresh evidence. `completed_unverified`
is permitted only with an explicit reason; it must never use the green completion language. The
existing task-outcome event adds only counts and stable enums, not receipt content.

Gate: E2E covers successful, failed, stale, no-test, skipped and canceled paths. A privacy review
confirms the receipt remains local unless a user explicitly exports it.

### Phase 4: proportionate independent review

Run a separate review pass only for complex or high-risk work (auth, payments, permissions,
database, deployment, or a broad public API). It reads the final diff and evidence receipt, then
returns structured findings: blocking, warning, or clear. It has read-only authority and cannot
claim that a test passed without receipt evidence.

The first version is sequential, not a fake swarm: it is an actual separately traced model pass.
No auto-merge, push, release, or deploy follows from a clear result.

Gate: seeded review fixtures catch known security/regression issues; benchmark shows fewer
false-completions on high-risk tasks. Keep the pass only when that gain justifies its measured
credits and latency.

### Phase 5: evaluation and controlled rollout

1. Compare baseline versus each phase with the same model, tasks, VSIX and scorer.
2. Require no regression in pass rate, no increase in false completion, and a documented
   cost/latency change by scope.
3. Ship first behind an opt-in extension setting. Aggregate outcome/economics analytics report
   adoption and effects; prompt text remains absent.
4. Expand the default only after two clean benchmark runs and a real VS Code E2E result.
5. Record each accepted/rejected decision in this document and, if it changes a cache, database,
   context, or plan decision, in `docs/ARCHITECTURE_DECISIONS.md`.

### Cross-phase engineering requirements

These requirements apply to every phase. They close failure modes that a happy-path benchmark
cannot expose.

| Area                 | Requirement                                                                                                                                                                                                                                               | Evidence required before advancing                                                                       |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Contract lifecycle   | Version the task-local contract. Preserve it through reload, compaction, resume and rewind; invalidate it when the workspace revision or user goal changes. Older tasks without a contract retain today's behaviour.                                      | Unit and E2E tests for new task, reload, resume, rewind, cancel, workspace change and extension upgrade. |
| User control         | Show the contract only when it adds value: compact by default, expandable for medium/complex work. The user can stop the task, see a blocked criterion, and explicitly approve a verification skip; the model cannot silently lower a required criterion. | Accessibility/UI tests and explicit skip audit tests.                                                    |
| Budget control       | Allocate a small bounded budget to contract generation and independent review. Account for both in task credits and economics. If the budget, provider, or network fails, use the existing safe workflow and report that evidence was unavailable.        | Fault-injection tests and scope-level cost report.                                                       |
| Truthfulness         | A tool timeout, canceled command, stale result, missing local dependency, or unavailable browser is `blocked`/`unverified`, never `passed`. Contract refinements retain the original criterion and reason.                                                | Seeded failure fixtures and receipt assertions.                                                          |
| Compatibility        | Do not change the stable system-prompt prefix. Any persisted type has a schema version and a migration/compatibility test. VS Code is the first supported surface; extension/CLI/JetBrains parity is evaluated before a feature is claimed cross-IDE.     | Prompt-cache check, migration test, and stated support matrix.                                           |
| Rollout and rollback | Default-off feature flag, server-side kill switch where applicable, and a one-release rollback path. No retrospective rewrite of outcome/economics data.                                                                                                  | Canary report, rollback drill, and dashboard separation of enabled/disabled cohorts.                     |

### Plan governance: handling future ideas

This section makes this document the single next-level roadmap rather than creating a competing
plan whenever a new idea appears.

1. Classify a new proposal against the objective and existing phases: **in scope**, **future
   candidate**, or **rejected**.
2. An in-scope proposal is added to the relevant phase only with its measurable hypothesis, privacy
   effect, cost ceiling, tests, and rollback condition.
3. A future candidate is recorded in a short backlog table below; it does not change implementation
   order or prompt/tool behaviour until a benchmark trigger justifies it.
4. A rejected proposal records why (for example: duplicates an existing feature, needs unsafe
   autonomy, or has no measurable user benefit).
5. A plan change that affects database, caching, context retention, model routing, permissions, or
   production rollout also updates `docs/ARCHITECTURE_DECISIONS.md` and requires a new baseline or
   A/B comparison.

| Future candidate                  | Admission trigger                                                                             | State                                       |
| --------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------- |
| Parallel implementation subagents | Complex benchmark shows an evidence bottleneck that sequential execution cannot meet.         | Deferred; existing scheduler stays unwired. |
| Durable content memory            | Measured compaction/restart loss outweighs the privacy and retention cost.                    | Deferred; no content persistence decision.  |
| Cross-IDE evidence receipts       | VS Code rollout passes its quality/cost gates and another IDE has a real integration harness. | Deferred.                                   |
| Automated PR/deploy work          | Isolated sandbox, review, explicit human approval and rollback drill all pass.                | Out of scope for this plan.                 |

### Implementation order and stop rules

| Order | Deliverable                                     | Stop rule                                                        |
| ----- | ----------------------------------------------- | ---------------------------------------------------------------- |
| 0     | Baseline benchmark and report                   | Stop if scorer or repeatability is unsound.                      |
| 1     | Task-local completion contract                  | Stop if simple tasks become materially more expensive.           |
| 2     | Deterministic verification planner              | Stop if it invents commands or misses stale evidence.            |
| 3     | Local evidence receipt and completion semantics | Stop if any receipt content leaks into telemetry.                |
| 4     | High-risk independent review                    | Stop if it does not reduce false completion enough for its cost. |
| 5     | Opt-in rollout and A/B report                   | Stop/roll back on quality, privacy, or cost regression.          |

### New-chat implementation handoff

Start the implementation in a new chat with this request:

> Implement only Phase 0 of the Evidence-driven intelligence plan in `docs/NEXT_LEVEL_PLAN.md`. Read `AGENTS.md`, `docs/ARCHITECTURE_DECISIONS.md`, the existing benchmark code and tests first. Reuse the benchmark harness; do not alter agent prompts, routing, cache policy, production data, or deploy anything. Build deterministic self-checking fixtures and a baseline report format. Verify with focused tests, type checks and `node scripts/check-doc-links.mjs`. Review the diff against the phase gate, report evidence and remaining gaps, then ask before commit, push or deploy.

A new chat does not clear the provider's stable prompt-prefix cache: the stable system prefix remains
cacheable. It starts a fresh task conversation, which is desirable for an isolated benchmark. The
task-scope control call intentionally continues to bypass response caches; that behaviour must not
be changed for this plan.

## Evidence-driven intelligence plan — team-reviewed revision

Status: Phase 0A harness/protocol is implemented locally; Phase 0B has a paired
12-task real-VSIX current-control pilot recorded in
`backend/bench-results/evidence-live-baseline-2026-10-13.md` (12/12 primary,
12/12 repeat, zero flips). This is not yet a rollout or promotion claim: the
larger 52-task decision corpus and a dedicated high-risk approval scenario are
still required before Phase 0 is closed.

Reviewed on 2026-10-13 from three independent roles: agent-systems architecture,
evaluation/reliability, and security/privacy/product economics.

### Authority and objective

This section is the implementation and measurement plan for P0.3, Evidence-backed completion, in
`docs/VYNORAI_PRODUCTION_COMPLETION_PLAN.md`. That production plan remains authoritative for product
invariants, release gates and inter-slice order. `docs/AGENTIC_BUILD_PLAN.md` remains authoritative
for whole-job/long-task measurement. This section is the single implementation backlog for P0.3.

Objective:

`request -> semantic scope -> completion contract -> targeted action -> targeted verification -> evidence receipt -> measured outcome`

The result must improve verified completion and reduce false completion without forcing todo,
repo-map or full-suite work onto bounded tasks. No autonomous swarm, retained backend content or
automatic push/release/deploy is added by this plan.

### Non-negotiable design contracts

#### Core ownership and state

- `TaskRuntime`/`TaskJournal` is the single source of truth for contracts, user decisions,
  mutations and verification evidence. GUI history is a projection, never a second authority.
- Scope is supplied when the task starts or recorded atomically immediately afterward. File
  checkpoints store restoration data and contract IDs, not a second contract copy.
- `completed_unverified` remains an analytics/UI outcome, not a core `AgentTask` terminal state.
  A mutated task stays `verifying` until required evidence passes or a valid user skip is recorded.
- Model output proposes criteria and checks. Deterministic policy owns minimum risk/evidence floors;
  a model may add or escalate them, never silently remove or downgrade them.

#### Versioned contract and evidence

Implement versioned types before enforcing completion:

```text
CompletionContractV1
  id, version, taskId, goalVersion, workspaceId, scope, criteria[]

CompletionCriterionV1
  id, statement, provenance, required, evidencePolicy[], status, reason?

VerificationEvidenceV2
  id, taskId, contractId, contractVersion, criterionIds[], kind,
  toolCallId?, commandDigest?, rootId?, exitCode?, durationMs?, outputDigest?,
  mutationGeneration, status, createdAt

UserDecisionReceiptV1
  id, taskId, contractId, contractVersion, criterionId, decision,
  scopeDigest, workspaceIdentity, createdAt
```

Criterion provenance is `user_explicit`, `inferred`, or `repository_required`. Criterion status is
`pending`, `passed`, `failed`, `blocked`, `user_skipped`, or `stale`. Evidence attaches by stable ID,
never fuzzy text. A model/chat phrase is not approval; skip/correction needs an explicit UI action
and a scoped `UserDecisionReceiptV1`.

#### Freshness and lifecycle

- Contract validity is keyed to task ID, goal version and workspace identity. Normal task-owned
  edits preserve the contract and increment `mutationGeneration`; affected older evidence becomes
  stale. Do not use the broad workspace revision alone to infer an outside edit.
- Detect edit tools, terminal/MCP/git writes, user edits and changed/untracked files. Final evidence
  is bound to the final changed-surface snapshot/hashes.
- Reload/compaction preserves the same task and contract. Resume revalidates workspace identity and
  changed-file hashes. Cancel freezes a canceled receipt.
- Chat/both rewind leaves the old task as immutable history with outcome `rewound`; resubmission
  creates a new task and contract. Code-only restore creates a new task/amendment, so an old green
  receipt never claims the restored workspace is current.
- A goal-changing follow-up increments `goalVersion` and supersedes old criteria. A simple
  clarification that does not change the goal may refine the same version with an audit reason.

#### Trust, privacy and authority

- Treat user text, repository files/scripts, code comments/diffs, terminal output, browser pages and
  tool output as untrusted data in scope, contract and review passes. Use bounded delimited input,
  strict schemas/parsers and seeded prompt-injection tests.
- A discovered workspace command remains untrusted executable content and retains normal terminal
  approval. Contract/planner/reviewer cannot change workspace trust, permission mode, auto-approval
  or tool policy. Review never replaces approval.
- Persist only bounded, sanitized criterion statements, workspace-relative identifiers, digests and
  safe summaries. Do not journal source, diffs or raw tool output. Reject absolute paths. Define
  retention, deletion/export, migration and unknown-schema fail-safe behavior.
- Contracts/receipts must be excluded from backend task outcomes, error reports and configured
  devdata destinations unless the user explicitly exports them. “Local” means persisted local data,
  not ephemeral data.
- Client-reported `task_outcomes` is directional product telemetry only; it is not billing,
  security or authoritative verification evidence.

### Phase 0: evaluation protocol, threat model and current-control baseline

Phase 0 changes no agent prompt, routing, cache policy or completion behavior.

1. Pre-register exact metrics:
   - `task_success`: every external `mustPass` criterion passes;
   - `false_completion`: agent reports completed/green while any `mustPass` criterion fails or is
     unknown;
   - `false_noncompletion`: external scorer passes while the agent ends blocked/unverified;
   - criterion recall/precision; fresh evidence coverage/validity; scope confusion matrix;
   - re-ask/rewind/cancel rate, time and credits/upstream cost per verified completion, and gross
     margin per verified completion.
     Report macro per task and micro per criterion.
2. Define failure taxonomy before running:
   - `invalid_run`: harness/scorer/authentication, wrong/stale VSIX, provider outage/rate limit,
     corrupt fixture or lost telemetry;
   - `valid_product_failure`: scope error, contract omission, wrong impact plan, execution failure,
     missed/stale verification, false receipt, reviewer miss/false block, budget or timeout.
     Record one terminal class plus contributing causes. Only predeclared infrastructure cases may be
     retried; invalid runs never enter the quality denominator.
3. Add 12 deterministic evidence tasks as a scorer/harness pilot, not a rollout sample. Every task
   has stable criterion IDs, must-pass/advisory labels, deterministic oracle, reference solution,
   untouched failure and targeted mutants (partial/hard-coded/regression/stale-test). Prove hidden
   scorer files are absent from agent context and repeat scoring twice on one snapshot.
4. The decision corpus is the existing 40-task suite plus the 12 evidence tasks (52 total), expanded
   where needed for read-only, single/multi-file, ambiguous/no-test, scope escalation, high-risk
   auth/payment/data/deploy, stale edit, cancel/resume/rewind, Sinhala, Singlish, Windows/POSIX and
   monorepo boundaries.
5. Build a reproducibility manifest: suite/schema version, repo commit and dirty digest, VSIX
   version/SHA and installed bundle hashes, backend release/config, feature flags, resolved
   provider/model/tier, Node/VS Code/OS, fixture/scorer hashes, run order/concurrency, timestamps,
   cache condition, invalid reason and randomization seed. Committed artifacts contain only
   synthetic fixture excerpts or redacted diagnostic IDs.
6. Real-VSIX counted runs must prove canonical install hashes, Agent mode, actual responding
   provider/model from logs (never UI label or `TEST LLM`), clean isolated profile/fixture,
   extension-host log review, agent terminal state, receipt state and external score separately.
   CI smoke and paid quality benchmarks remain separate commands. Reconcile the live-verification
   procedure with the current no-fixed-round-cap agent semantics before using it as a Phase 0 oracle.
7. Record the current-control baseline before feature work. The 12-task pilot validates the harness;
   promotion/rejection uses the larger paired decision corpus and predeclared non-inferiority/
   confidence rules. An inconclusive result means increase repeats/tasks, not change thresholds.

Phase 0 gate: scorers and mutants self-check; manifests are complete; invalid/product failures are
separated; real-VSIX provenance is proven; the baseline is repeatable by paired per-task agreement,
flip count and failure-class stability. False verified receipts and approval bypasses have zero
tolerance.

#### Phase 0 gate record (2026-10-13)

The gate passed for the pre-registered 12-task current-control pilot. The paired real-VSIX report is
`backend/bench-results/evidence-live-baseline-2026-10-13.md`: 12/12 primary, 12/12 repeat, zero
paired flips, canonical VSIX/install hashes, response-level `deepseek/deepseek-flash` provenance,
three digest-drift runs excluded as `invalid_run`, and scorer self-check passed. The real-model risky
action approval scenario also passed 1/1. This closes Phase 0 for implementation work; the larger
52-task decision corpus remains the pre-promotion measurement gate and is not represented as a
quality claim by this pilot.

#### Live implementation smoke gate (2026-10-14)

The rebuilt canonical VSIX was reinstalled and the real-model Smart E2E suite ran against the
production proxy with the authenticated E2E account: 7/7 scenarios passed (chat explanation,
feature edit and tests, bug repair, Sinhala request, approval safety, stop behavior, and
server-capability-aligned Background visibility). The extension response metadata identified the
VynorAI Auto route; an earlier profile that selected TEST LLM was excluded from this result. This
is a regression/smoke result, not the larger Phase 5 treatment benchmark.

### Phase 1: canonical contract, mutation and evidence ledger

Implementation status: the core-owned contract protocol slice is now present
(`CompletionContract`, deterministic scope draft, journal migration/fail-safe
schema handling, task/workspace identity binding, mutation generations,
changed-surface digests, criterion evidence, correction/skip decisions,
workspace revalidation, and explicit local deletion). Existing tasks without a
contract retain their behavior. Lifecycle tests now cover restart/resume,
workspace mismatch, external revision staleness, cancellation and deletion.
The live agent completion path now maps fresh verification results to the
contract criteria; complex/high-risk turns also wait for the independent-review
receipt before a green task transition. Full lifecycle coverage below is still
required before this phase is closed.

1. Add the versioned core-owned types, atomic protocol methods and backward-compatible task-journal
   migration. Old tasks without contracts keep current behavior; unknown newer schemas fail safe.
2. Seed a draft from the existing semantic-scope result and `impliedDeliverables`, then apply
   deterministic risk/evidence floors and repository-grounded refinement. Do not add an always-on
   second model call for simple/read-only work unless paired A/B evidence proves value.
3. Implement `mutationGeneration`, changed-surface snapshots and evidence provenance validation.
   Absence of an error is not a pass: captured terminal/browser evidence needs an explicit reliable
   result. Test masked exit codes, timeout/cancel, missing/truncated status, post-test edits, browser
   unavailability and terminal-generated writes.
4. Implement explicit user correction/skip receipts. Failure to persist required evidence or a
   decision prevents a green receipt; it does not undo a completed tool operation or fabricate a
   pass.
5. Apply minimization/redaction/length/retention/export/deletion and egress tests to journal,
   history/export, error reporting and devdata paths.

Phase 1 gate: lifecycle/state-machine tests cover new task, reload, resume,
cancel, external revision, workspace identity mismatch, deletion and unknown
schema fail-safe. The live compaction/rewind and released-artifact
upgrade/downgrade slices are now covered; offline failure and endpoint
reconnect behavior are also covered. The measured live sample and paired
simple/medium/complex repeat are recorded below; broader decision-corpus
precision/recall remains a later rollout gate. Simple
tasks gain no compulsory todo/repo-map/full-suite behavior.

#### Phase 1 live contract proof (2026-10-14)

The freshly rebuilt and canonical-installed VSIX ran `ev-simple-boundary`
against the production proxy and real model in a fresh isolated profile. The
run finished in 33 seconds with a `simple` contract, 2/2 required criteria
passed, fresh test evidence for both criteria, mutation generation 1, and a
`completed` task state. The scorer classified it `pass` with 100% evidence
coverage. This is a focused smoke proof, not the Phase 1 closure: the measured
contract recall/precision gate is still required.

The follow-up real VS Code lifecycle run is recorded by
`extensions/vscode/e2e/tests/ContractLifecycle.test.ts`: with the same
production model and canonical VSIX, a mutating Agent task reached `completed`,
its session summary was persisted by `/compact`, and the task contract remained
identical after session reload, `Developer: Reload Window`, and `/rewind chat`.
This closes the tested reload/compaction/chat-rewind slice. Offline failure
and endpoint reconnect are covered by the lifecycle report; measured
recall/precision remains tracked below.

Released-artifact compatibility evidence is recorded in
`backend/bench-results/evidence-live-lifecycle-2026-10-14.md`: production
`1.2.61` passed startup/reload, the local canonical `1.2.66` candidate passed
the contract lifecycle in the same external profile, and `1.2.61` passed again
after downgrade over that profile. A released production `1.2.66` contract
run was also attempted and correctly showed that the deployed artifact
predates the local contract implementation. A real client-level offline probe
and full VS Code offline/reconnect path confirmed bounded retries, a truthful
connection-refused failure, and a fresh response after endpoint restoration.
No release or deployment was performed.

The measured live sample is recorded in
`backend/bench-results/evidence-live-contract-quality-2026-10-14.md`. It
covered final simple, medium and complex scope cases: the first complex run
exposed a scope misclassification, the semantic-scope prompt correction made
the rerun select `complex`, and a failed independent review correctly blocked
completion. The corrected 12-fixture live sample (18 attempts including oracle
corrections, auth reruns and two invalid stale-storage driver attempts) now
covers semantic simple/medium/complex scope, fresh evidence, no-test handling,
review blocks and an offline/reconnect path. Invalid runs are excluded; valid
product failures remain recorded in the denominator. The paired corrected
simple/medium/complex repeat held scope stable in 3/3 runs. This is gate
evidence, not a rollout claim; broader decision-corpus precision/recall is a
later rollout gate.

#### Phase 1 gate record (2026-10-14)

Phase 1 is complete for progression to planner work. Core lifecycle, migration,
identity, mutation/evidence freshness, deletion/privacy, compaction/reload/
rewind, released-artifact compatibility and offline/reconnect behavior have
real or deterministic evidence. The 12-fixture live quality sample has 18
attempts (two stale-storage attempts classified `invalid_run` and excluded),
and the corrected candidate's simple/medium/complex paired repeat held scope
stable in 3/3 runs. Independent-review, no-test and browser-blocker failures
remain truthful blocked states in the denominator; they are inputs to the
Phase 3/4 gates, not green completions or hidden failures.

### Phase 2: deterministic change-impact and verification planning

Extend `core/agent/VerificationDiscovery.ts`; do not build a parallel discovery subsystem.

Implementation status: changed-surface classification and planner impact output
are present. Type/API/database surfaces receive test/typecheck floors; UI,
migration and high-risk auth/billing/permission/deploy surfaces expose explicit
residual risks, and independent review remains unresolved until a real review
receipt exists. The live agent verification gate now links discovered commands
to contract criteria and emits an explicit blocked warning for unresolved
criteria. The planner still selects only repository-declared commands.

- Derive the smallest sufficient checks from the contract, final changed surface, language,
  package/multi-root cwd, manifests, current-revision scripts, diagnostics, reverse imports/public
  API, migrations, config/lock/generated/untracked files and existing VynorAI recipes.
- Unknown impact becomes residual risk/escalation, never a pass. Commands are never invented and
  still require normal approval. A model can recommend checks but cannot lower policy floors.
- Recalculate after every mutation or blocking review repair. Link each selected check to criterion
  IDs and stale only affected evidence where safe; high-risk uncertainty stales the whole plan.

Minimum policy examples:

| Surface                            | Minimum evidence floor                                                                                  |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------- |
| One source file with focused test  | focused test plus diff inspection                                                                       |
| Type/public API                    | focused test plus package typecheck and caller impact                                                   |
| UI behavior                        | targeted UI test or Browser QA; unavailable UI is blocked/unverified                                    |
| Database/schema                    | migration parity plus relevant backend test                                                             |
| Auth, billing, permissions, deploy | targeted test, applicable type/build check, independent review and unchanged user-approval requirements |

Phase 2 gate: deterministic tests cover the policy matrix, multi-root/cwd and adversarial scripts;
zero invented commands; no stale evidence accepted. Report median, individual pilot runs,
runaways/maximum and absolute credit/time ceilings by scope—not median-only savings.

Current evidence: `backend/bench-results/verification-planner-2026-10-14.md`
records the expanded deterministic matrix, corrected 12-fixture live sample,
paired simple/medium/complex repeat, individual/max ceilings and stale-
evidence mutation cases. Broader decision-corpus A/B measurement is reserved
for Phase 5.

#### Phase 2 gate record (2026-10-14)

Phase 2 is complete for progression to receipt/privacy work. The planner
selects only repository-declared commands, preserves approval requirements,
links checks to criterion IDs, blocks unresolved criteria, separates roots and
cwd, and raises UI/database/high-risk residual risks. Deterministic stale
generation tests and live stale-edit tasks reject old evidence after a later
mutation. Scope-specific median/max wall-time and credit ceilings are recorded
without presenting them as rollout savings.

### Phase 3: local evidence receipt and completion semantics

Implementation status: the Agent Control Center now shows criterion status,
fresh-evidence presence and changed-surface files locally. Core completion
enforcement already rejects missing or stale required evidence. The live
verification path records criterion receipts, and the explicit skip/correction
UI is wired; lifecycle/privacy E2E coverage remains the closure gate.

- Render each criterion as passed, failed, blocked, stale or user-skipped with fresh evidence,
  changed-surface summary, omissions and residual risks. Essential state is not tooltip-only.
- `TaskRuntime` validates the contract and evidence before terminal completion. A user-approved skip
  is visible and scoped; it never appears as an ordinary green pass.
- Accessibility: text plus icon (not color alone), keyboard/focus behavior, screen-reader labels and
  live regions, responsive layout, and Sinhala/English copy tests. Medium/complex contracts are
  correctable before consequential mutation; simple tasks remain compact and non-interrupting.
- Receipt content stays local unless explicitly exported. Aggregate telemetry uses counts/stable
  enums only and separate informed consent.

Phase 3 gate: E2E covers pass, fail, blocked, stale, no-test, explicit skip, cancel, restart and
privacy/egress cases. External scorer and green receipt must agree on every must-pass criterion.

#### Phase 3 gate record (2026-10-14)

Phase 3 is complete for progression to Phase 4. The real VS Code matrix is recorded in
`backend/bench-results/phase3-receipt-privacy-2026-10-14.md`: pass/fail/blocked/stale/no-test
live fixtures, explicit Agent Control Center skip (`1 passing`, three `user_skipped` decisions),
real cancellation, contract restart/compaction/rewind, and offline/reconnect recovery. The
TaskRuntime and GUI privacy tests confirm redacted local receipts and counts/enums-only outcome
telemetry. Receipt content was not exported, deployed, pushed or published. The report records
the remaining boundary: no packet-capture audit of every provider request; Phase 4 seeded review
measurement and Phase 5 paired rollout evidence remain pending.

### Phase 4: upgrade the existing side review

Implementation status: the existing side-review path is now scoped to complex
tasks or deterministic high-risk file surfaces (auth, permissions, billing,
database, deployment and similar). Simple/medium ordinary edits do not spend a
second review call. A required review now runs before completion and persists a
passed, failed or blocked review receipt; seeded recall/precision measurement is
still pending.

Reuse the existing side-review/diff/UI path; it remains a separate read-only model call, while the
new contract-aware path waits for its receipt only when policy requires independent review. Do not
create a duplicate reviewer subsystem.

- Run only for complex or deterministically high-risk surfaces. Enter `verifying`; a blocking
  finding returns to execution, repairs increment mutation generation, targeted checks rerun, and
  review reruns. Warnings do not block. Overriding a security block needs explicit scoped approval.
- Reviewer is a separate read-only inference with no tools/network and no hidden implementation
  conclusion. Validate strict structured output; delimit/redact untrusted diff/evidence; list
  reviewed and omitted files. Truncated/omitted high-risk surface cannot return `clear`.
- Use blinded balanced fixtures: clean patches, security bugs, functional regressions, stale/missing
  evidence, misleading green receipt and non-blocking style concerns. Measure blocking recall,
  precision, clean-patch false-blocks, warning inflation, reviewer timeout/failure, correction
  success and incremental cost/latency. Report correlated-blind-spot risk when reviewer and
  implementer use the same model.

Phase 4 gate: all predeclared seeded blocking defects are caught, clean false-block and overhead
stay below predeclared ceilings, and false completion improves. Otherwise keep review advisory or
remove the change.

#### Real production evidence run (2026-10-14)

The production proxy evidence pilot ran after the sandbox cleanup deployment with the real E2E
account and real routed model: `12/12` deterministic tasks passed, with no invalid runs. The run
covered simple/medium/complex scopes and English, Singlish and Sinhala prompts; cache-hit share was
`77.3%`, median five rounds, p90 `31.3s`, and the recorded usage delta was `53,428` tokens. This is
quality and routing evidence, not the Phase 4 blinded reviewer gate or the Phase 5 paired A/B gate.
The JSON and Markdown report are `backend/bench-results/2026-10-14T04-31-04-191Z.*`.

#### Phase 4 measurement record (2026-10-14)

Initial live seed evidence is in `backend/bench-results/phase4-review-seed-2026-10-14.md`:
two known blocking defect fixtures were caught (`2/2`) and one clean complex control passed
without a blocking finding (`1/1`). The side-review receipt kept both defective tasks in
`verifying`; the clean control completed with review evidence. This is progress, not gate closure:
a larger blinded balanced set and predeclared recall/false-block/overhead ceilings are still
required before Phase 4 is promoted.

#### Phase 4 live protocol measurement (2026-10-14)

The reviewer now has an explicit, fail-closed response protocol: `[block]` findings
can block completion, `[warn]` findings are displayed but do not fail the required
independent-review criterion, and empty or unstructured output is recorded as an
unreliable review and blocks completion. The live blinded corpus runner is
`backend/scripts/bench/phase4-review-live.ts` and retains no review text or source
snippets. The real production run is recorded in
`backend/bench-results/phase4-review-live-20261014T052729Z.md`: 5/6 blocking
defects caught, 5/6 controls clear, and 1 unreliable reviewer output. That is an
implementation and measurement improvement, not a Phase 4 promotion: the recall,
false-block and reviewer-reliability ceilings are not all met yet and repeated
independent runs are still required.

### Phase 5: exact-cost comparison, canary and controlled rollout

1. Add stable request classes and a correlation/task/run ID for scope, optional contract call, main
   agent, repair and review. Attribute input cache-hit/miss, output/reasoning tokens, credits,
   upstream cost and latency components per task. Account-level before/after deltas are secondary
   checks, not exact attribution. Cache-hit rate is cache-hit input / total input.
2. Include all control-plane calls under one user-visible task cap. Check remaining credits before
   optional review and report a truthful fallback. Keep prompt prefixes stable; task/revision-
   specific response caches are bypassed where correctness requires it.
3. Compare treatment off/on in the same candidate VSIX when possible. Otherwise record binary
   hashes proving the treatment patch is the only intended difference. Use paired task/repeat runs,
   balanced randomized `AB/BA` order and interleaving. Pin backend SHA/config, model/provider,
   scorer and feature flags; invalidate comparison blocks when they drift.
4. Separate queue/throttle, provider, time-to-first-token, generation, tool, approval/user wait and
   total wall time. A rate-limited run is infrastructure-affected/invalid by the predeclared rule.
5. Opt-in production rollout is a safety canary, not causal A/B evidence. Default rollout needs a
   predeclared stable randomized holdout, assignment unit, exposure event, minimum window/sample and
   rollback triggers for false completion, failure/cancel/re-ask, cost/latency or privacy incidents.
   Disabled users without consent do not send outcome content.
6. Feature flag ownership, mid-task toggle behavior, offline fallback, old/new extension behavior,
   journal downgrade, client-side kill switch and server-side request-class kill switches are
   explicit. Rollback never rewrites old receipts or economics/outcome history.

Phase 5 gate: no pass-rate regression, zero false-verified/adversarial safety violations, improved or
non-inferior verified completion, and acceptable credits/time/gross margin per verified completion.
An inconclusive result does not ship by default.

### Plan governance and future candidates

Every new idea is classified as `in_scope`, `future_candidate`, or `rejected`. An in-scope change
must name its hypothesis, deterministic checks, privacy effect, cost ceiling and rollback condition.
A database/cache/context/model-routing/permission/production decision also updates
`docs/ARCHITECTURE_DECISIONS.md`. Every phase gate updates this plan and the P0.3 status in
`docs/VYNORAI_PRODUCTION_COMPLETION_PLAN.md`.

| Candidate                         | Admission trigger                                                                                                 | Current decision                   |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| Parallel implementation subagents | Sequential complex tasks show a measured evidence bottleneck.                                                     | Deferred; scheduler stays unwired. |
| Durable content memory            | Measured restart/compaction loss outweighs explicit privacy/retention cost.                                       | Deferred.                          |
| Cross-IDE receipt UI              | VS Code gates pass and the target IDE has a real integration harness. Protocol compatibility is tested meanwhile. | Deferred.                          |
| Automated PR/deploy               | Isolation, review, explicit approval and rollback drill all pass under the production plan.                       | Out of scope.                      |

### Implementation order and stop rules

| Order | Deliverable                                                 | Stop rule                                                             |
| ----- | ----------------------------------------------------------- | --------------------------------------------------------------------- |
| 0A    | Metrics, failure taxonomy, threat model and scorer mutants  | Stop if success/truth cannot be scored deterministically.             |
| 0B    | Reproducible real-VSIX runner and current-control baseline  | Stop if VSIX/model provenance or repeatability is unproven.           |
| 1     | Core-owned contract/evidence schemas, lifecycle and privacy | Stop on evidence-integrity, migration or egress failure.              |
| 2     | Deterministic impact/verification planner                   | Stop on invented commands, stale pass or simple-task regression.      |
| 3     | Receipt UI and enforced truthful completion                 | Stop on receipt/scorer disagreement or accessibility/privacy failure. |
| 4     | Contract-aware existing side review                         | Keep advisory/remove if precision, recall or cost gate fails.         |
| 5     | Paired A/B, safety canary and randomized rollout            | Do not default-enable on inconclusive or regressed results.           |

### New-chat Phase 0 handoff

> Implement only Phase 0A and 0B of the team-reviewed Evidence-driven intelligence plan in `docs/NEXT_LEVEL_PLAN.md`. Treat `docs/VYNORAI_PRODUCTION_COMPLETION_PLAN.md` as authoritative for invariants and release gates. First inspect the existing benchmark/E2E runners and current release-verification procedure. Define metrics, failure classes, threat fixtures, scorer mutants and the reproducibility manifest before model runs. Reuse existing harnesses; do not change agent prompts, routing, cache policy, completion behavior, production data or deploy anything. Prove canonical VSIX and actual provider/model for counted live runs, keep invalid runs out of quality denominators, verify focused tests/typechecks and `node scripts/check-doc-links.mjs`, review the diff against the Phase 0 gate, and ask before commit, push, release or deploy.

A new chat only starts a fresh task conversation. Provider prefix-cache hits remain eligible only when
the stable prefix, model and provider are byte-identical and retained by the provider; hits are not
guaranteed and must be measured. Task-scope control calls remain explicit response-cache bypasses.
