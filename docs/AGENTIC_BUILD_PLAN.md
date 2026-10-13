# Agentic build plan

Goal: the user gives one job and the agent finishes it. Example: "build a complete e-commerce app" must end
with a designed, written, connected and running system (API, database, pages, tests), not a start.

Every item in this file is tied to a measurement. Nothing is built before its cause is seen.

## How it is measured

`backend/scripts/bench/build.ts`, task `shop`: the agent gets an empty folder and a product brief (stack rules,
an API contract, a web page, a README). When the agent stops, the project is checked from outside:

- `npm install`, then `npm start` on a free port;
- 39 checks over HTTP: register and login, admin product create, update and delete, search and filter, cart,
  checkout, stock going down, two buyers for the last item, order ownership, the page calling the API;
- a restart, then the same user, orders and stock must still be there;
- `npm test` passes, README lists the API.

The scorer is checked itself: a reference solution (`build-reference/shop`) passes 39 of 39, an empty folder
fails. Runs go through the real extension (VSIX in the isolated E2E profile, Agent mode, real `VynorAI Auto`),
with the answering provider read from the extension's own log.

Recorded per run: checks passed, files and lines written, model calls, tools used, seconds, quota tokens,
tool approvals clicked, "Continue" clicks, and how the turn ended.

## Runs so far, 2026-10-12

Only runs confirmed to be in Agent mode count. Three early runs (2 of 39 checks, 3 to 5 model calls, code
pasted into the chat) were not in Agent mode: the test driver did not check the mode it had selected. They are
discarded, and the driver now refuses to start a run unless Agent mode is confirmed.

| Build                | Checks   | Model calls | Seconds | Quota tokens | How it ended                                                                              |
| -------------------- | -------- | ----------- | ------- | ------------ | ----------------------------------------------------------------------------------------- |
| 1.2.59               | 37 of 39 | 23          | 217     | 112,577      | round count bug (C1): todo list 0 of 9 closed, README missing                             |
| 1.2.60 with C1 to C4 | 35 of 39 | 27          | 254     | 154,195      | task marked failed (C5): 10 tool calls refused, tests left failing                        |
| 1.2.60 with C1 to C6 | 39 of 39 | 62          | 1502    | 589,232      | driver time limit (25 min): the last cleanup command never returned (C7), no final report |
| 1.2.60 with C1 to C8 | 39 of 39 | 32          | 731     | 411,587      | ended by itself with a final report; no empty answer, no reminder needed                  |
| 1.2.60 with C1 to C8 | 39 of 39 | 53          | 870     | 331,989      | ended by itself with a final report                                                       |
| 1.2.60 with C1 to C8 | 39 of 39 | 78          | 650     | 594,582      | ended by itself with a final report                                                       |

Three runs on the build with C1 to C8 (2026-10-12): 39 of 39 each, every run ended by itself, no "Continue"
click. Median 53 model calls, 731 s and 411,587 quota tokens; the spread in quota tokens is wide (332K to 595K).
The step 1 target (no run ends before the todo list is closed; median checks at least 37 of 39) is met.

Two scorer checks were too literal and are corrected; the reference solution still passes 39 of 39 and an empty
folder still fails. "frontend page talks to the API" wanted the literal `/api/products`, and pages keep `/api` in
one constant and call `api("/products")` (two runs showed 38 of 39 for it). "README.md lists the API" wanted the
literal `/api/orders`, and one README gives the base path once and lists `/orders` in a table (one run).

The first two runs show the model can build the system and the harness stopping the work before it is finished.
The third run (2026-10-12, 15 source files, 1,847 lines, README present) got through the whole build: the todo
list was written and updated three times, and the empty-answer reminder (C6) fired once and the agent carried on.
It cost about four times the quota tokens and six times the seconds of the earlier runs, and it did not end by
itself. The fourth run, with the output limit (C8) and the terminal fix (C7), needed half the model calls and
half the time, and ended by itself: 13 source files, 1,793 lines, todo list updated four times.

### Build with the fixes of the afternoon of 2026-10-12 (runs s, t, u)

Three runs, Agent mode, one build, the same driver. Before each run the installed extension was compared byte for
byte with the built VSIX (see "The runs that tested the wrong build" below).

| Run | Checks   | Seconds | Model calls | Approvals | Continue | Quota tokens | System message changes | End state |
| --- | -------- | ------- | ----------- | --------- | -------- | ------------ | ---------------------- | --------- |
| s   | 39 of 39 | 444     | 46          | 4         | 0        | 176,459      | 0                      | completed |
| t   | 39 of 39 | 478     | 48          | 5         | 0        | 226,752      | 0                      | completed |
| u   | 39 of 39 | 487     | 47          | 5         | 0        | 192,336      | 1 (index became ready) | completed |

Against the 14 runs of the older build read by the inspector: the system message changed 11 to 19 times per run
there (133 in all) and 0 to 1 times here; quota tokens were 205K to 595K there and 176K to 227K here; a command
joined with `&&` was rejected in 11 of 14 runs and in none here; files were written to `project/project/` in 5 of
14 runs and in none here. Three runs on one task: the token figures are a first reading, not a result.

Still seen on this build: `multi_edit` failing with "string not found" (2 of 3 runs); `create_new_file` called
without `contents` (1 run); the result of a background command changing in the history after it was sent
("running in the background" replaced by its exit status, 2 times in run t), which re-bills what follows it.

Released as 1.2.61 on 2026-10-12. 1.2.60 had already been published earlier that day from the 13:12 build, and
the updater installs only a higher version, so the fixes needed a new number. The 1.2.61 VSIX differs from the
benchmarked build in the version and the build time only (GUI bundle identical, `extension.js` one line).

### The runs that tested the wrong build

Runs a to r of 2026-10-12 did not test that day's changes. `npm run e2e:install-vsix` (extest) passes the folders
to VS Code unquoted; with the space in `D:\My Project\...` the extension went to `D:\My` and the command reported
success. The E2E profile kept a build from 13:12, and the marker file named the new VSIX, so `run-e2e.js` did not
object. Found by the inspector: the system message still changed 18 times a run after the fix for it.
`scripts/sync-vsix.js` now removes the same-version folder and its registry entry and installs through the E2E VS
Code's own CLI with quoted arguments. Before a run, compare the installed `out/extension.js` and
`gui/assets/index.js` with the VSIX.

What those runs are still good for: they are real runs of the older build, and the inspector's counts above come
from them. Their scores (39 of 39 in g, h, i, j, l, m, p, q) say nothing about the fixes.

### Run inspector

`backend/scripts/bench/inspect.ts` reads the saved session and the task journal of a run and lists every anomaly:
tool calls that failed and why, files written outside the workspace root, a check that failed but was read as
passed, commands the shell rejected, repeated calls, automatic prompts, pauses, where the prompt prefix changed
between two rounds, calls left pending at the end, the todo list at the end, the task's final state. It calls no
model. Run it after every real run; a score alone found 2 faults in 18 runs.

Faults found on the older build, all fixed:

- `argsOf` in `agentProgress.ts` built a call's signature from `processedArgs`, which for `create_new_file` is
  `{ resolvedPath: null }` while the file does not exist. Eleven new files in a row counted as one repeated edit
  and a build was paused as "stalled" (run a). The signature now merges `parsedArgs` and `processedArgs`.
- A pause round sent no tools; the backend then offered its own 12 (`VYNORAI_AGENT_TOOLS`) and the model called
  `edit_file`, which no client can run. The backend now sends the caller's tools or none, and the pause is told as
  the last message with the system message and tool list unchanged. A tool call on a paused round is answered,
  not run.
- The driver closed three runs (b, c, d) while an approval was pending or a command was running: 8 s without
  streaming counted as the end. It now ends a run on the task journal's own `completed`/`verifying`/`failed`
  transition, and reports "stuck" only after 180 s with no journal event and nothing on screen.
- The system message changed on most rounds of a build: the index state went ready, indexing, ready after every
  written file, and the manifest list grew when `package.json` was created. `groundingFreeze.ts` now lets the index
  state move once, to "ready", and keeps the manifest and instruction lists the conversation began with.
- In an empty folder the file tree was the single line `project/`, and the model wrote every file to
  `project/project/`. The tree now says its first line is the workspace root and shows `(empty)`.
- `view_repo_map` failed with a SQL syntax error in an empty workspace (`CodeSnippetsIndex.getPathsAndSignatures`).
- The terminal tool named the shell but the model still joined commands with `&&`; on win32 the tool now says
  that Windows PowerShell 5.1 rejects it.

Open, found by the inspector: `npm test 2>&1 | tail -n 60` printed `not ok 1` and the tool reported "Command
completed" (run p): a pipe hides the exit code, so a failing check is read as passed. A privacy placeholder was
written into a test file (run q). A task stays in `verifying` after its checks passed when the agent's last command
(stopping its own server) counts as a mutation (3 of 14 runs).

Harness faults found on the way, none of them counted as runs: an `npm start` server left running by the agent held
the E2E profile's log files, so the next run failed with `EBUSY` before it started (the run script now stops it); the
profile had `TEST LLM` selected again after
`SlashCommands` (and `VynorAI Auto` is only in the profile config after a sign-in); the sign-in does not survive
a VS Code session, so each run signs in (`LARGE_TASK_SIGNIN=1`); the driver took 8 s without streaming for the
end of the turn while `npm install` was running (`LargeTask.test.ts` now waits for a running command).

## Causes found

| #   | Cause                                                                                                                                                                                                                                                                                                                                                                                            | Evidence                                                                                                                        | State                                                                                                                                                                |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1  | The round budget counted history items, not model answers. A reasoning model leaves an empty assistant item before each thinking block, so 23 answers counted as 42 rounds. Past 40 the turn threw and ended without a message.                                                                                                                                                                  | session file of run 2: 23 prompt logs, 42 assistant items, 19 of them empty, `roundsSincePrompt` 42                             | Fixed: the round cap is removed; a turn pauses only when it is stuck or at the credit cap (step 3)                                                                   |
| C2  | The privacy shield replaces emails with `__PII_EMAIL_1__` before the model sees them. The model took the placeholder for corruption and spent rounds building emails from parts.                                                                                                                                                                                                                 | the model's own text in run 2 ("the environment redacted email literals"); `backend/src/services/piiShield.ts`                  | Fixed in the agent prompt: one rule says what a placeholder is                                                                                                       |
| C3  | Nothing checks the agent's own todo list. Run 2 ended with 0 of 9 items closed.                                                                                                                                                                                                                                                                                                                  | end state of run 2                                                                                                              | Fixed: a reminder with the open items, at most 3 per prompt                                                                                                          |
| C4  | The agent prompt is written for small edits ("make the smallest change", "report in 1-3 sentences"). It says nothing about building a whole system.                                                                                                                                                                                                                                              | `core/llm/vynorai-system-prompt.ts`                                                                                             | Fixed: one sentence for build tasks                                                                                                                                  |
| C5  | A failed tool call failed the task's plan step. The step allows 2 attempts, so the second tool error of a task ended it; every later tool call was refused with "Task is terminal" and the agent could not repair its failing tests.                                                                                                                                                             | task journal of the 1.2.60 run: `plan.step.failed` twice (an edit with no `filepath`), then 10 refused calls; `callToolById.ts` | Fixed: a tool error goes back to the model and the task stays open                                                                                                   |
| C6  | An answer with no text and no tool call ended the turn. A reasoning model can spend a whole answer thinking; with no edit and no todo list yet, no gate fired.                                                                                                                                                                                                                                   | run of 2026-10-12: 3 model calls, 61 s, no file written, third completion empty in `chatInteraction.jsonl`                      | Fixed: `gui/src/redux/util/emptyAnswerGate.ts` sends the model back, at most twice per prompt                                                                        |
| C7  | A terminal command that never returns holds the turn. The last cleanup command (stop the server, delete the probe database) showed "Running" from about 1,080 s to the 1,502 s limit. The tool waited for the "close" event only: a process that inherited the output pipes keeps them open after the shell exits, and the 2 minute timeout did nothing because the shell was no longer running. | progress log of the 38 of 39 run; a real PowerShell command that leaves a 9 s process behind: exit at 0.7 s, close at 9.6 s     | Fixed in `core/tools/implementations/runTerminalCommand.ts`: return 2 s after exit, and always after the timeout. Not yet confirmed as the cause of that run's hang. |

C8, the cause behind C6: the sign-in wrote `VynorAI Auto` into `config.json` without limits, so the client asked
for the 4,096 token default (and a 32,768 context) instead of the 16,384 and 256,000 that `config.yaml` and
`docs/ARCHITECTURE_DECISIONS.md` give. Reasoning counts as output: two runs stopped with about 3,970 thinking
tokens and an answer cut before its tool call (one empty, one ending in "Let me plan the build. <"). Fixed in
`extensions/vscode/src/util/vynorAuth.ts`; the E2E profile uses `config.json`, so every run so far had this cap.

## Order of work

Each step ends with the same measurement, three runs, compared with the baseline.

1. C1 to C8 (done in code, with tests, built into the local VSIX 1.2.60). Three runs done, 39 of 39 each.
   Target: no run ends before the todo list is closed; median checks at least 37 of 39. Met.
2. Read the three runs for the next stop and fix that cause, again with three runs.
3. No round cap (done in code, with tests; `gui/src/redux/util/agentProgress.ts`). A turn ends for one of
   three reasons, and the number of rounds is none of them:

   - done: the todo list is closed and the checks pass (the gates above);
   - stuck, read from what the tool calls did:
     - 8 tool-calling answers in a row whose calls all failed or repeated an earlier call;
     - 30 in a row that changed nothing in the project (no new edit, no check going from failing to passing,
       no todo item closed), so reading without end is bounded;
     - one check failing the same way 10 times in a row. At 5 the model is told once, at the end of the
       history, and may change approach; a build can fail the same way while a part is still unwritten;
   - out of budget: the user presses Stop, or the task credit cap is reached.

   An answer with no tool call counts for nothing: it ends the turn unless a gate sends the model back, and
   every gate is bounded (todo 3, verification 3, repair 3 per failing check, pre-mortem 1). The 200 action
   net per task in the core stays as a guard against a runaway loop; reaching it pauses the turn once with a
   summary. To measure: a build longer than 40 rounds finishes without a pause.

4. Approvals. Count the clicks a build needs. If installs and test runs stop the work waiting for a click,
   make the choice visible up front ("let this task install packages and run commands in this folder").
5. A second, larger task (for example the same shop with payments webhook, admin pages and pagination) to see
   where a longer build stops: context, compaction, or the model.
6. Speed. One file is written per model call today (12 `create_new_file` calls for 11 files). Measure the
   share of time spent in those calls before deciding on a multi-file write tool or parallel subagents.

## Review of 2026-10-12

An independent review of steps 1 and 3 found the "stuck" signals wrong in both directions. Fixed, with tests:

- A passing check was read as failed when its output held the word "failed" ("5 passed, 0 failed", a test
  named "... when payment failed"). The result is now read only from the status line the terminal tool sets,
  by one function used by the repair gate, the task evidence and the progress pause.
- The repair prompt was sent for failures that had already been fixed, once per failure of the turn. It now
  looks only at checks whose latest run failed, sends one prompt per new failure, and ends with one blocker
  report.
- The same-failure count was one counter that any other check reset. It is kept per command, and line and
  column numbers, addresses, process ids and ports no longer make two equal failures look different.
- The verification gate was switched off for the rest of a turn by any earlier automatic prompt. It now asks
  whenever there are edits with no check and no question after them.
- The todo gate repeated a reminder that had been answered in words. It no longer does.
- Expert roles and memories were chosen from the latest automatic prompt, which changed the system message in
  the round after a gate. They are chosen from the user's own request.
- A paused turn was reported twice (as completed, then as paused). The credit cap was skipped when the usage
  request failed; it is now judged on the last known spend.

Open after the review:

- The pause round empties the tool list and adds to the system message, so that one request is billed with no
  cache hit. The fix is to send the pause text at the end of the history with `tool_choice: "none"`; the GUI
  does not pass `toolChoice` today.
- The pause reason (stalled, no change, same failure, actions) is not sent to `POST /v1/task-outcomes`; all
  four arrive as `budget`. It needs a field in the backend schema.
- The 200 action net is the last count-based stop. A build larger than the benchmark can reach it. Replacing
  it as the usual stop with a default task credit cap is a pricing decision and is not made here.
- If `agent/task/start` fails, the turn runs with no task. It no longer reuses the task of the prompt before,
  and the GUI counts the prompt's tool calls to the same 200 itself. The core's repeat guard (the same call 3
  times with no edit in between) is still off for that prompt; the stall rule is what bounds repeats there.
- Each round awaits the next inside its own call, so a turn of several hundred rounds holds every round's
  compiled messages until it ends. Not measured.
- Edits that undo each other with small differences are not seen as a loop.

## Follow-up audit of 2026-10-13

The saved-session inspector covered 14 recent runs. It confirmed four execution defects and two evidence or
recovery gaps; the fixes below have focused regression tests but have not yet been measured by another paid
large-task run:

- PowerShell and POSIX pipelines now preserve a failing upstream exit code. Run p had printed `not ok 1` for
  `npm test 2>&1 | tail -n 60` while reporting completion.
- Late output from a background command is sent as a session-scoped event and appended as a new automatic
  history message before the next model round; if the turn is already idle, that one continuation starts
  immediately. The old tool result is never rewritten. Thirteen of the inspected sessions had changed prompt
  prefixes; run B showed the background status replacement directly.
- An unresolved `__PII_*` value is refused before a tool can write or execute it, and the prompt tells the
  model to re-read and retry. Run q had passed email placeholders into `multi_edit` before later correcting
  them.
- Verification freshness is based on workspace edit tools, not every R3 approval. A server-stop command no
  longer makes the immediately preceding passing checks stale.
- Failed edits now say whether the multi-edit was applied and tell the agent to re-read and retry the one edit;
  attempts to create an existing file direct it to `multi_edit`.
- Verification evidence recognizes PowerShell script blocks and `python -m build`.

The no-task path remains bounded by the GUI's failed-call, no-change, same-failure and 200-action guards, so
the disabled core repeat guard is defense in depth rather than an unbounded path. The E2E exit-127 cause was
not present in retained evidence and was not guessed. Local editor logs show that Antigravity installed 1.2.60
successfully and later uninstalled it; the retained VSIX download is not evidence that this update failed.

## Semantic scope preflight, 2026-10-13

Prompt-only scope instructions were not reliable enough: the first 20-case production run classified 9 of 20
correctly (124,175 tokens), and a stronger prompt reached 18 of 20 (133,257 tokens). The agent now makes one
short semantic assessment before an Agent-mode task, with one independent retry only for invalid or
low-confidence output. The result is appended after the user request, so the provider prompt prefix and tool
list remain stable during the task. Complex work is prevented from using any other tool until it creates its
todo list; simple work is told to skip todo and repository-map overhead unless repository evidence expands the
scope.

`backend/scripts/bench/scope-live.ts` calls the production proxy with the same prompt and parser. Its 20 English,
Sinhala and Singlish cases passed 20 of 20 (20 calls, 25,445 total tokens, 9,344 provider cache-hit tokens). An
earlier 19 of 20 run exposed the proxy's deterministic scaffold engine intercepting the internal classifier;
the preflight now sends an explicit `request_kind: task_scope` and `cache_policy: bypass` contract, which keeps it
out of that engine and the semantic response cache. This suite demonstrates semantic generalization across the covered outcome classes;
it is not evidence that 10,000 labelled prompts were executed. A versioned large labelled corpus is required
before claiming a measured 10,000-prompt accuracy rate.

### Stage 1 evidence dashboard, pending production measurement

The extension reports only the scope class with opt-in task outcomes, and the proxy records the same class on request
economics. Admin can compare simple, medium, complex and unknown aggregates for requests, tokens, credits, cost,
rounds and verification outcomes. This is observability, not an orchestration policy change: no token-saving claim or
conditional gate may be promoted until a baseline versus candidate A/B benchmark preserves completion and verification
quality.

## Not planned yet

Parallel implementation subagents, worktree isolation and a planner model. Each needs a measured gain on this
benchmark first (see `ARCHITECTURE_DECISIONS.md`).

## Limits

- One task, a Node.js back end with one page. Other stacks and a real multi-page front end are not measured.
- The brief names every route. A vague request ("build a shop") is not scored, because nothing objective says
  what passing means; it needs a different check (does it install, start, serve a page, pass its own tests).
- Runs differ from one to the next. Results are reported as three runs, never as one.
- The task's token budget in `TaskRuntime` (200,000 input, 32,000 output) is passed after about six model
  calls of a build. Nothing enforces it today (the error is ignored), so it only stops the accounting.
