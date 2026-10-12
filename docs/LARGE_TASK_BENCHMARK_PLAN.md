# Large task benchmark plan

Question to answer: on multi-file work in a large repository, where does VynorAI fail, and is the cause the
model (DeepSeek) or the harness (tools, prompts, routing, compaction, round budget)?

The answer decides what to build next. Nothing in "What to build" below starts before its trigger is measured.

Facts in this file were checked on 2026-10-11 in code or against production. "Not checked" means exactly that.

## What is known

| Fact                                                                                                                                                                                                                                                                   | Evidence                                                                             |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| The benchmark has 40 tasks on fixtures of 1 to 5 small files. Pass rate 78 of 80. It says nothing about large tasks.                                                                                                                                                   | `backend/scripts/bench/tasks.mjs`, `backend/bench-results/after-fix-2026-10-11.md`   |
| The benchmark has its own agent loop and 6 simple tools. It always sends `vynor-auto`, stops at 25 turns and runs only `node <script>`.                                                                                                                                | `backend/scripts/bench/lib.mjs:13`, `:133`, `:217`                                   |
| The extension's agent loop is in the GUI. Its budget is 40 tool rounds in agent mode, then a "Continue" banner.                                                                                                                                                        | `gui/src/redux/thunks/streamNormalInput.ts`, `gui/src/redux/util/toolRoundBudget.ts` |
| The CLI (`extensions/cli`) is a third loop with its own tools and system message. A CLI result is not an extension result.                                                                                                                                             | `extensions/cli/src/stream/streamChatResponse.ts`, `systemMessage.ts`                |
| The test key is on the Pro plan: 128K context, compaction at 85%. 2.56M of 25M tokens used, period ends 2026-11-02.                                                                                                                                                    | `GET /api/auth/me`, `docs/ARCHITECTURE_DECISIONS.md`                                 |
| Pro can call `deepseek-v4-pro` directly. Pro cannot call `claude-sonnet-4-6` (`model_not_allowed`, needs Enterprise).                                                                                                                                                  | one request each to `POST /v1/chat/completions`                                      |
| Auto routing uses one model (V4.1 Flash) for all tiers except "deep", which uses V4 Pro.                                                                                                                                                                               | `backend/src/services/autoRouter.ts:68-96`                                           |
| Real code with tests is in the repo: `packages/openai-adapters` (60 files, 18 test files, vitest), `packages/config-yaml` (70, 15, jest), `packages/fetch` (13, 6, vitest). `node_modules` are installed for `fetch` and `openai-adapters`; `config-yaml` not checked. | `git ls-files`, `package.json`                                                       |
| A plain chat turn through the real extension runs in E2E. Any flow that visits Settings and returns hangs the window.                                                                                                                                                  | `extensions/vscode/e2e/tests/TaskOutcome.test.ts`, `docs/NEXT_LEVEL_PLAN.md`         |
| Claude Code is not installed in this shell (`claude: command not found`).                                                                                                                                                                                              | shell                                                                                |

Not checked: whether the production backend has a working OpenRouter key for Claude models; how many tokens one
large task costs; whether the proxy tells the client that compaction happened on a request.

## What the benchmark must separate

Four arms on the same tasks. Each pair of arms isolates one cause.

| Arm | Harness              | Model               | Compared with | Shows                                   |
| --- | -------------------- | ------------------- | ------------- | --------------------------------------- |
| A   | bench loop           | `vynor-auto`        | baseline      | what users get today                    |
| B   | bench loop           | `deepseek-v4-pro`   | A             | routing: would the stronger tier fix it |
| C   | bench loop           | `claude-sonnet-4-6` | A, B          | model limit, same harness               |
| D   | real extension (E2E) | `vynor-auto`        | A             | harness: does the real loop do better   |

Decision, 2026-10-11: DeepSeek only for now. Arm C is not run until arms A, B and D show a failure that
harness work does not remove; it would then use an OpenRouter key.

Arm C needs one of: the test user moved to Enterprise for the run (admin change in production, ask first), or a
direct Anthropic key used by the bench loop (the proxy's routing and compaction are then not in the path, so the
result is an upper bound). If the OpenRouter key check fails, only the second is possible.

A fifth arm, Claude Code itself on the same fixtures, compares product with product. It needs Claude Code
installed and a subscription. It is optional and comes last.

## Tasks

New category `large`, 12 tasks, three sizes. Scoring stays deterministic: hidden tests, never a model grade.

| Size | Fixture                                                           | Change needed                            | Count |
| ---- | ----------------------------------------------------------------- | ---------------------------------------- | ----- |
| M    | generated project, 30 to 40 files, `node --test`                  | 3 to 5 files                             | 4     |
| L    | copy of `packages/fetch` or `packages/openai-adapters` with tests | 3 to 8 files                             | 6     |
| XL   | L fixture plus a task that needs more than 110K tokens of reading | 5 or more files, compaction must trigger | 2     |

Task types, each at least twice:

- Bug with the cause in another file than the failing test points to.
- Feature that touches a type, its implementation, its callers and a test.
- Rename or signature change with 10 or more call sites.
- Redo a real commit: take a commit from this repo's history that changed 3 or more files in the package and
  added tests, check out its parent, give the commit's intent as the prompt, score with the commit's tests.
  Not possible here: the packages have one commit in this repository (the initial import).

Each task has a hidden test file that the fixture does not contain. The scorer copies it in after the run, then
runs the package's whole test suite. Pass means the hidden tests pass and no earlier test broke.

Four of the 12 prompts are in Sinhala or Singlish.

## Changes to the harness

1. `lib.mjs`: `model` option (now fixed to `vynor-auto`); `maxTurns` option with 40 for `large` to match the
   extension; allow the fixture's own test command (`npx vitest run`, `node --test`) and nothing else.
2. `lib.mjs`: fixture from a directory copy (now only from an inline file map), with `node_modules` linked, not
   copied.
3. `run.mjs`: `--model`, per-arm report, and a failure class per failed run (below).
4. Selfcheck for every new task: the reference solution passes, the untouched fixture fails.
5. Arm D: one E2E file, `LargeTask.test.ts`, that opens the fixture as the workspace, sends the prompt in agent
   mode, clicks "Continue" when the banner shows, and scores from disk. It uses only the chat panel, so the
   Settings hang does not block it. Three tasks, not 12: an E2E run is slow.

## Failure classes

Every failed run gets one class, set by rule from the run log and the disk, not by reading the answer.

| Class        | Rule                                                             |
| ------------ | ---------------------------------------------------------------- |
| `not-found`  | no file of the reference solution was read                       |
| `incomplete` | some reference files edited, others never opened or never edited |
| `wrong-edit` | all reference files edited, hidden tests fail                    |
| `regression` | hidden tests pass, an earlier test fails                         |
| `budget`     | turn limit reached                                               |
| `unverified` | finished without running the tests                               |
| `error`      | HTTP error, tool error loop                                      |

For XL tasks also record whether the failure came after the first compaction (needs a signal from the proxy;
if there is none, add a response header in the same step).

## Order of work

1. Pilot. Harness changes 1 to 4, three L tasks, arm A only, one run. Purpose: measure tokens per task.
   Stop and resize the plan if one task costs more than 600K tokens. Size: 2 to 3 days.
2. Full task set, arms A and B, two runs each. Report under `backend/bench-results/large-<date>.*`.
   Size: 3 to 4 days plus run time.
3. Arm C. Ask first (plan change in production or an Anthropic key). One run.
4. Arm D, three tasks.
5. Write the decision into `docs/ARCHITECTURE_DECISIONS.md` and the status into `docs/NEXT_LEVEL_PLAN.md`.

Token budget: 22.4M left on the test key until 2026-11-02. The pilot sets the real figure. If arms A and B
would use more than 12M, cut to one run per arm.

## What to build, by result

Each row is built only if its trigger is seen. All of these already exist in part; none is a new product area.

| Trigger                                         | Cause            | Work                                                                                                                                                                               |
| ----------------------------------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B passes at least 3 tasks more than A           | routing          | Send multi-file agent work to the "deep" tier (`autoRouter.ts`); measure credits per task before and after.                                                                        |
| C passes at least 3 more than B                 | model            | Offer a Claude tier for large tasks (registry and plans already list it); decide price from measured credits. No harness work fixes this.                                          |
| `incomplete` is the largest class in A, B and C | harness          | A task checklist the agent must close before finishing; then decide `ImplementationSubagentScheduler` (wire or delete) with this benchmark, as step 6 of the next level plan says. |
| `not-found` is the largest class                | harness, context | Indexed search on by default for large workspaces (`codebaseTool` is already gated on `indexingEnabled`); repo map in the first turn.                                              |
| `unverified` or `regression` is common          | harness          | Verification gate runs the workspace's own test command, not only what the model chose.                                                                                            |
| XL fails after compaction, M and L pass         | compaction       | Keep edited-file list and open checklist verbatim across compaction (`hybridContext.ts`); persist summaries.                                                                       |
| `budget` is common in A, rare in D              | bench only       | No product change.                                                                                                                                                                 |
| D passes clearly fewer than A                   | extension loop   | Find the difference (system message, tool set, round handling) and fix it there.                                                                                                   |
| A, B and D pass 10 or more of 12                | none             | Large tasks are not the gap. Go back to first run and the window hang.                                                                                                             |

## Limits of this plan

- 12 tasks give a direction, not a percentage. A difference of 1 or 2 tasks between arms means nothing; the
  triggers above use 3.
- The fixtures are TypeScript packages of 13 to 70 files. A 2,000-file repository is not measured. Arm D on
  this repository itself (3,536 files) can be added as a later step.
- Arms A to C use the bench loop, not the extension. Only arm D speaks for the product, on three tasks.

## Pilot result, 2026-10-11

Harness: `backend/scripts/bench/large.ts` and `large-tasks.ts`. Fixture: a copy of `packages/openai-adapters`
(60 source files, 145 tests) with `node_modules` linked. Tools: the 6 bench tools plus `apply_diff` and
`rename_symbol` from `core`, as the extension has them. Limit 40 turns. Score: hidden tests, the whole suite and
the type check. `--selfcheck` passes: each untouched fixture fails and each reference solution passes.

Arm A (`vynor-auto`, served by `deepseek-flash`, tier heavy), one run:

| Task              | Change                                        | Result | Turns | Tokens  | Cache hit |
| ----------------- | --------------------------------------------- | ------ | ----- | ------- | --------- |
| `lg-add-provider` | new provider: 1 new file, 2 edited            | pass   | 26    | 592,698 | 93%       |
| `lg-rename-fetch` | rename over 17 files, 47 call sites           | pass   | 14    | 120,622 | 87%       |
| `lg-fim-finish`   | same bug in 3 adapters, report names only one | pass   | 13    | 71,930  | 75%       |

All three ran the tests before finishing. Raw rows: `backend/bench-results/large-pilot-auto-2026-10-11.json`.

What this shows, and what it does not:

- A clearly specified change of 3 to 17 files in a 60-file package is inside what V4.1 Flash does with these
  tools. Arm B was not run: there is no failure for a stronger model to remove.
- Three tasks, one run each. It is a direction, not a rate.
- The prompts name the files or the symptom precisely. A vague request is not measured.
- 60 files. Whether any request reached the compaction threshold was not recorded.
- The bench loop, not the extension loop.

The next tasks must be harder in those ways before any product work is chosen from the trigger table:

1. Four tasks on `core` (740 TypeScript files) with a one-sentence prompt that names no file.
2. Two XL tasks that force compaction, with the largest request size recorded per run.
3. Arm D: the three pilot tasks through the real extension.

## Arm D, 2026-10-11

The same three tasks through the real extension (VSIX 1.2.59, isolated E2E profile, Agent mode, tool approvals
clicked by the driver, real model `VynorAI Auto`). The model that answered was read from the extension's own
`chatInteraction` log, not from the model button.

| Task              | Result | Reference files edited | Model calls | Seconds | Bench loop (arm A) |
| ----------------- | ------ | ---------------------- | ----------- | ------- | ------------------ |
| `lg-fim-finish`   | pass   | 3 of 3                 | 22          | 204     | pass, 13 turns     |
| `lg-add-provider` | pass   | 3 of 3                 | 23          | 183     | pass, 26 turns     |
| `lg-rename-fetch` | pass   | 17 of 17               | 20          | 190     | pass, 14 turns     |

One run per task. The extension harness completes all three; the number of model calls is not lower than the
bench loop's, so this does not show a cost gain.

### What the attempt found

Every item below was measured, and each fix has a test.

| Finding                                                                                                                                                                                                                                                                                                         | Evidence                                                                                 | Fix                                                                                                                                                                          |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| One `newSession` / `focusContinueInput` message turned into a storm: 48,094 messages in 28 s, 56 million selector calls. Webview listeners all answered the same request; the extension returned every extra answer as an "unsupported" error of the same message type; the listeners handled that error again. | message counts in the live GUI; code in `webviewProtocol.ts` and `useWebviewListener.ts` | extension drops answers to settled requests; listeners answer a request once and ignore protocol replies. After: 3 commands, 3 messages.                                     |
| Streaming re-parsed all chat markdown on every chunk.                                                                                                                                                                                                                                                           | 1,522 markdown `process` calls and 145 million tokenizer calls in 60 s                   | chunks applied together every 80 ms (`streamBatcher.ts`). After: 6 calls and 1.2 million.                                                                                    |
| `continue.reloadConfig` was called by sign-in and sign-out but never registered; the error was swallowed.                                                                                                                                                                                                       | "command not found" from the live extension host                                         | command registered; a test fails when any `executeCommand("continue.*")` target has no registration.                                                                         |
| `config.json` model with `${{ secrets.NAME }}` sent the reference text as its API key.                                                                                                                                                                                                                          | mock server saw `Bearer ${{ secrets.VYNORAI_API_KEY }}`                                  | `resolveSecretRefs.ts` resolves it from the IDE secret store for config.json.                                                                                                |
| A key was stored without asking the server who owns it, and an old account could stay attached to a new key.                                                                                                                                                                                                    | code                                                                                     | key checked before storing; account bound to the key's fingerprint (`vynorAccount.ts`).                                                                                      |
| Autocomplete counted tokens of the whole file before cutting it.                                                                                                                                                                                                                                                | extension-host profile, 95% in `pruneLinesFromBottom`                                    | stops at the first line that no longer fits; same output as before on 25 random inputs and 8 limits.                                                                         |
| The E2E profile had `TEST LLM` selected, so earlier E2E "answers" came from the echo model.                                                                                                                                                                                                                     | `selectedModelsByProfileId` and the `chatInteraction` log                                | profile corrected; the run script prints which provider answered. Earlier E2E passes (`TaskOutcome`, `SlashCommands`) did not prove a model answered and are to be repeated. |

Not found: a stall caused by the model or by indexing. The 82 CPU seconds of first indexing (local embeddings in
the extension host thread) were measured and are still open.

### Cost through the extension, and one stalled turn

Monthly quota tokens read from `/api/auth/me` before and after one run, no other traffic on the key (Pro plan,
25,000,000 a month). Samples of one or two runs; not an average.

| Task              | Quota tokens | Requests | Model calls | Seconds                                          |
| ----------------- | ------------ | -------- | ----------- | ------------------------------------------------ |
| `lg-rename-fetch` | 92,490       | 23       | 20 to 23    | 181                                              |
| `lg-add-provider` | 166,717      | 36       | 35          | 259 (1 run), 191 to 220 (4 runs), 19 to 23 calls |

Across 8 real runs through the extension, 7 finished normally (183 to 220 s). In one `lg-add-provider` run
the work was finished and passing after 259 s, but the chat stayed in "streaming" for more than 20 minutes with no
model call and a responsive panel. It did not return in 3 further runs, so the cause is not known. The credit read
before every round (`vynor/usage`) had no time limit; it now has 8 s (`turnCredits.ts`), a hardening that is not
shown to be the cause. In two of the runs the agent also edited `src/apis/Bedrock.ts`, a file the task did not
name; the fixture's type check already failed there before the task.

Cost guide from the pilot: 70K to 600K tokens per task, most of it cache hits.
