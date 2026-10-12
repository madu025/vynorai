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

| Build                | Checks   | Model calls | Seconds | Quota tokens | How it ended                                                       |
| -------------------- | -------- | ----------- | ------- | ------------ | ------------------------------------------------------------------ |
| 1.2.59               | 37 of 39 | 23          | 217     | 112,577      | round count bug (C1): todo list 0 of 9 closed, README missing      |
| 1.2.60 with C1 to C4 | 35 of 39 | 27          | 254     | 154,195      | task marked failed (C5): 10 tool calls refused, tests left failing |

Both runs show the model can build the system and the harness stopping the work before it is finished. One
run per build is not a result: the fix for C5 still needs three runs.

## Causes found

| #   | Cause                                                                                                                                                                                                                                | Evidence                                                                                                                        | State                                                                                              |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| C1  | The round budget counted history items, not model answers. A reasoning model leaves an empty assistant item before each thinking block, so 23 answers counted as 42 rounds. Past 40 the turn threw and ended without a message.      | session file of run 2: 23 prompt logs, 42 assistant items, 19 of them empty, `roundsSincePrompt` 42                             | Fixed: the round cap is removed; a turn pauses only when it is stuck or at the credit cap (step 3) |
| C2  | The privacy shield replaces emails with `__PII_EMAIL_1__` before the model sees them. The model took the placeholder for corruption and spent rounds building emails from parts.                                                     | the model's own text in run 2 ("the environment redacted email literals"); `backend/src/services/piiShield.ts`                  | Fixed in the agent prompt: one rule says what a placeholder is                                     |
| C3  | Nothing checks the agent's own todo list. Run 2 ended with 0 of 9 items closed.                                                                                                                                                      | end state of run 2                                                                                                              | Fixed: a reminder with the open items, at most 3 per prompt                                        |
| C4  | The agent prompt is written for small edits ("make the smallest change", "report in 1-3 sentences"). It says nothing about building a whole system.                                                                                  | `core/llm/vynorai-system-prompt.ts`                                                                                             | Fixed: one sentence for build tasks                                                                |
| C5  | A failed tool call failed the task's plan step. The step allows 2 attempts, so the second tool error of a task ended it; every later tool call was refused with "Task is terminal" and the agent could not repair its failing tests. | task journal of the 1.2.60 run: `plan.step.failed` twice (an edit with no `filepath`), then 10 refused calls; `callToolById.ts` | Fixed: a tool error goes back to the model and the task stays open                                 |

## Order of work

Each step ends with the same measurement, three runs, compared with the baseline.

1. C1 to C5 (done in code, with tests, built into the local VSIX 1.2.60). Three runs are still to be done.
   Target: no run ends before the todo list is closed; median checks at least 37 of 39.
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
- If `agent/task/start` fails, the turn runs with no task, so the action net and the repeat guard are off.
  Read from the code, not reproduced.
- Each round awaits the next inside its own call, so a turn of several hundred rounds holds every round's
  compiled messages until it ends. Not measured.
- Edits that undo each other with small differences are not seen as a loop.

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
