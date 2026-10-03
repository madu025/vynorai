# VynorAI Competitive Roadmap

VynorAI competes with Claude Code and OpenAI Codex for the same developers. This page tracks feature parity with both tools, the gaps users report in them that VynorAI can close, and the build order. Architecture details live in [CODEMAP.md](../CODEMAP.md).

Status legend: **Done** (verified in code), **Partial** (exists but incomplete or unverified end to end), **Missing**.

Last reviewed: 2026-10-03.

## Feature parity

| Capability                                 | Claude Code                  | Codex                   | VynorAI | Where / what is left                                                                                                                                                                                          |
| ------------------------------------------ | ---------------------------- | ----------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Agent with file, search, terminal tools    | Yes                          | Yes                     | Done    | `core/tools/`                                                                                                                                                                                                 |
| Diff-based edits                           | Edit tool                    | Yes                     | Done    | `multi_edit`, `single_find_and_replace`                                                                                                                                                                       |
| Plan mode (read-only before writing)       | Yes                          | Yes                     | Partial | `plan` message mode exists; needs a clear "approve plan → execute" handoff                                                                                                                                    |
| Project memory file                        | `CLAUDE.md`                  | `AGENTS.md`             | Partial | `AGENTS.md` / `CLAUDE.md` are referenced in core; no `/init` that writes one from the repo map                                                                                                                |
| Subagents with isolated context            | Yes                          | Yes                     | Partial | Read-only explore subagent `run_subagent` (parallel, own context, report only): `core/agent/exploreSubagent.ts`. Write-capable implementation subagents (`ImplementationSubagentScheduler`) are not wired yet |
| Todo list the user sees                    | `TodoWrite`                  | Plan updates            | Done    | `update_todo_list` client tool; panel derived from history (`gui/src/redux/selectors/selectTodos.ts`)                                                                                                         |
| Long tasks without a hard stop             | Yes                          | Yes                     | Done    | Per-mode tool round budget (agent 40) ends with a progress summary and a Continue button; 200-action safety net per task                                                                                      |
| Verify before finishing                    | Stop hooks                   | Partial                 | Done    | Verification gate: edits with no test/type check/lint/build after the last edit trigger one automatic check request (`gui/src/redux/util/verificationGate.ts`)                                                |
| Skills                                     | `SKILL.md`                   | Yes                     | Done    | `skills/` with trust and permission manifests                                                                                                                                                                 |
| MCP servers                                | Yes                          | Yes                     | Done    | Inherited from Continue                                                                                                                                                                                       |
| Hooks (pre/post tool, prompt submit, stop) | 25 events                    | Yes                     | Done    | `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `Stop`, Claude Code compatible; see [HOOKS.md](HOOKS.md)                                                                                                     |
| Checkpoints and rewind per prompt          | Yes                          | Partial                 | Done    | "Rewind to here" on each prompt: `gui/src/redux/thunks/rewind.ts`, `AgentCheckpointManager.restoreTasks()`. File changes made by terminal commands are not captured                                           |
| Auto-compaction                            | Yes                          | Yes                     | Done    | `gui/src/util/autoCompaction.ts` (70%) + backend background summaries                                                                                                                                         |
| Permission modes                           | Yes                          | read-only / auto / full | Partial | Per-tool policies exist; no single mode switch                                                                                                                                                                |
| Sandboxed command execution                | Yes                          | Yes                     | Done    | Native OS sandbox, destructive-command interceptor                                                                                                                                                            |
| Code review of a diff                      | Yes                          | `/review`               | Partial | `/review` slash command referenced; not wired to the current git diff with a checklist                                                                                                                        |
| Long-running goal mode                     | Background tasks             | `/goal`                 | Partial | `AgentOrchestrator` resumable tasks; no multi-hour goal loop                                                                                                                                                  |
| Parallel tasks in isolation                | Worktrees                    | Cloud sandboxes         | Missing | No worktree-based parallel tasks                                                                                                                                                                              |
| Browser verification                       | Via MCP                      | Yes                     | Done    | Origin-restricted browser QA tool                                                                                                                                                                             |
| Web search                                 | Yes                          | Yes                     | Done    | `search_web`                                                                                                                                                                                                  |
| Headless CLI / CI                          | Yes                          | Yes                     | Partial | `extensions/cli/`                                                                                                                                                                                             |
| IDE coverage                               | VS Code, JetBrains, terminal | VS Code, terminal, app  | Done    | VS Code, Antigravity, Cursor, Windsurf (Open VSX), JetBrains, CLI                                                                                                                                             |

## Competitor gaps VynorAI closes

These are gaps users publicly report in the other tools. Each row names the VynorAI mechanism that closes it.

| Reported gap                                                                    | VynorAI answer                                                                                                       | Status  |
| ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------- |
| Unpublished 5-hour and weekly caps; a single prompt can consume most of a quota | Monthly credit allowance shown live in the quota bar; credits = tokens × published model weight (`billingPolicy.ts`) | Done    |
| Hard stop when the limit is hit                                                 | Degrade to the light tier and cache-first answers before blocking; warn at 80%                                       | Missing |
| Cost of a task is unknown before it runs                                        | Pre-task credit estimate and a per-task budget cap for heavy turns                                                   | Missing |
| One vendor's models only                                                        | Auto routing across DeepSeek V4.1 Flash / V4 Pro with OpenRouter fallback                                            | Done    |
| USD card billing only                                                           | PayHere, LKR plans and top-ups                                                                                       | Done    |
| English-centric prompting                                                       | Sinhala/Singlish intent recognition; reply-language setting                                                          | Partial |
| Paying for repeated work                                                        | Exact and semantic cache, Golden Vault templates, read dedupe, prefix-cache layout                                   | Done    |
| Agent claims success without proof                                              | Evidence required before mutation completion, verification discovery                                                 | Done    |

## Multi-file agent engine

Compared with Cline and Roo Code (Roo was discontinued in May 2026), the gaps were a 24-action hard stop that ended in an error, a fixed three-step plan, no subagents and no automatic verification. Changes made on 2026-10-03:

| Change                                                                                                                                                                                    | Where                                                                        |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Tool round budget per prompt (chat 12, plan 25, agent 40). At the budget the model writes progress plus remaining steps, then "Continue" starts a new budget as its own rewindable prompt | `gui/src/redux/util/toolRoundBudget.ts`, `ContinueTaskBanner.tsx`            |
| Loop guard returns "already ran 3 times" to the model instead of failing the turn, and resets after every file edit so edit → test → edit → test works                                    | `core/agent/AgentOrchestrator.ts`, `gui/src/redux/thunks/callToolById.ts`    |
| `update_todo_list` tool and live Todos panel                                                                                                                                              | `core/tools/definitions/updateTodoList.ts`, `TodoListPanel.tsx`              |
| `run_subagent`: read-only research loop (max 12 rounds, 5 min) in its own context; several run in parallel; Stop aborts them (`tools/abort`)                                              | `core/agent/exploreSubagent.ts`, `core/tools/implementations/runSubagent.ts` |
| Verification gate, once per prompt                                                                                                                                                        | `gui/src/redux/util/verificationGate.ts`                                     |
| Semantic cache never answers a request that carries tools (agent and subagent turns must act on the workspace)                                                                            | `backend/src/services/semanticCache.ts`                                      |

Next for this area: wire write-capable implementation subagents with file scopes (`ImplementationSubagentScheduler`) as an orchestrator mode, and send subagent requests on the light tier.

## Build order

Each item lists the files it touches and the acceptance check.

### Phase 1 — parity essentials

1. **Rewind per prompt.** (Done 2026-10-03; needs a manual check in the Extension Development Host.) Add "Rewind to here" on each user message that restores files from the checkpoint taken before that prompt and truncates the conversation. Files: `extensions/vscode/src/checkpoints/`, `gui/src/components/StepContainer/`. Check: edit three files across two prompts, rewind the second, only its edits are reverted.
2. **Lifecycle hooks.** (Done 2026-10-03: `~/.vynorai/hooks.json` and `.vynorai/hooks.json` instead of `config.yaml`, so project hooks can be committed and approved per file; see [HOOKS.md](HOOKS.md).) Hooks with `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `Stop`; a command hook can block with a non-zero exit and a message. Files: `core/config/`, `core/tools/callTool.ts`. Check: a `PreToolUse` hook that rejects `rm -rf` blocks the call and shows the hook's message.
3. **`/init` project memory.** Generates `AGENTS.md` (read by Codex and other tools too) from the repo map: stack, commands, conventions, entry points. Files: `core/commands/`, `core/util/generateRepoMap.ts`. Check: running `/init` on this repo produces a file under 150 lines that names the real test and build commands.
4. **One permission-mode switch.** Plan (read-only), Ask (default), Auto-edit, Full (sandboxed) in the input toolbar, mapped onto existing tool policies. Files: `gui/src/components/ModeSelect/`, `core/tools/`. Check: in Plan mode every mutating tool is unavailable to the model.
5. **`/review` on the working diff.** Reviews `git diff` against a correctness and security checklist and returns findings with file and line. Files: `core/commands/`, `core/tools/definitions/viewDiff.ts`. Check: a planted off-by-one in a staged change is reported with its line.

### Phase 2 — VynorAI differentiators

6. **Never hard-stop.** At 80% of the allowance, Auto stays on the light tier and turns thinking off; at 100%, cached and template answers still work and the upgrade prompt explains the remaining options. Files: `backend/src/services/monthlyQuota.ts`, `autoRouter.ts`. Check: a user at 99% gets a light-tier answer, not a 403.
7. **Task cost estimate and cap.** Before a heavy turn, show the estimated credit range; optional per-task cap stops the loop with a summary when reached. Files: `backend/src/routes/proxy.ts` (estimate endpoint), `gui/src/components/StepContainer/TurnStatusLine.tsx`. Check: a capped task stops within 10% of the cap.
8. **Live credits per turn.** Show credits used by the current turn in the status line from the backend's settled usage. Files: `backend/src/services/aiProxy.ts` (usage in the final SSE chunk), `gui/src/components/StepContainer/turnStatus.ts`. Check: the turn total matches `request_economics` for that turn.
9. **Explore subagent.** (Done 2026-10-03 as the `run_subagent` tool; needs a token measurement on a real task.) Project-understanding and search-heavy steps run in a subagent whose result is a summary, keeping the main context small. Files: `core/agent/`. Check: "explain the payment flow" on this repo adds under 2k tokens to the main conversation.
10. **Reply language.** Setting for English / Sinhala / Singlish replies, carried in the stable system prompt. Files: `backend/src/services/agentEngine.ts`, GUI settings. Check: with Sinhala selected, explanations are in Sinhala and code stays unchanged.

### Phase 3 — scale

11. **Off-peak goal mode.** Long-running goals with checkpoints that schedule non-interactive steps into DeepSeek off-peak hours (half price). Files: `core/agent/AgentOrchestrator.ts`, backend scheduler. Check: a queued goal resumes after an IDE restart.
12. **Parallel tasks in git worktrees.** Run up to three tasks in separate local worktrees and present each as a reviewable diff. Files: `core/agent/`, `extensions/vscode/src/`. Check: two tasks editing the same file produce two independent diffs.
13. **Pull request handoff.** Create a branch, commit, and PR description from a finished task. Files: `core/tools/`. Check: the PR body lists the changed files and the verification run.
