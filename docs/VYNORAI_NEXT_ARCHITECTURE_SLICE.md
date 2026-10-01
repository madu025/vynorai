# VynorAI Next Architecture Slice

Status: implementation guide  
Target: VS Code-compatible hosts first (VS Code, Cursor, Antigravity)  
Release train: `1.1.x` foundation, `1.2.x` agent runtime, `1.3.x` enterprise hardening

## 1. Outcome

The next slice must make VynorAI feel like a workspace-native engineering agent rather than a chat panel with optional context.

A new session must know which workspace it belongs to, show what it can currently inspect, gather evidence before answering project questions, plan and execute through a visible state machine, protect user data and destructive actions, and prove completion with tests or other evidence.

The product promise is:

> Open a repository, ask a question in normal language, and receive a grounded answer or a safely executed change without manually attaching basic project context.

### Immediate operational prerequisite

Before starting this release train, revoke and rotate the Coolify API credential previously shared through a chat channel. Review Coolify access and deployment logs from the exposure time onward, replace the credential in the deployment secret store, and verify that no repository file, build artifact, extension state, diagnostic bundle or application log contains the old value. Treat this as a release blocker, not a backlog item.

## 2. Current baseline

The repository already contains useful foundations that should be extended rather than replaced:

| Capability        | Current implementation                               | Main limitation                                                                       |
| ----------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Workspace context | `resolveEditorContent.ts`, tree/codebase providers   | Context is assembled per prompt; no durable workspace handshake or freshness contract |
| Modes             | `sessionSlice.ts`, `selectActiveTools.ts`            | Mode controls tool availability but is not a full task state machine                  |
| Agent tools       | `streamNormalInput.ts`, `callTool.ts`                | Recursive model/tool loop is UI-thunk driven and difficult to resume or audit         |
| Tool security     | `evaluateToolPolicies.ts`, terminal security package | Edit tools bypass permission evaluation; no unified risk receipt                      |
| Indexing          | `CodebaseIndexer.ts`, indexing Redux slice           | Status exists but is not presented as a first-class workspace readiness signal        |
| Expert council    | `subagentOrchestrator.ts`, `ExpertTeamPanel.tsx`     | Subagents share one pre-gathered context and return free-form summaries               |
| Memory            | `projectMemory.ts`, local storage                    | User-entered facts are not provenance-aware, scoped rules with lifecycle controls     |
| Checkpoints       | `AgentCheckpointManager.ts`                          | Primarily file-level; no task-wide transaction/checkpoint manifest                    |
| Queue             | `Chat.tsx`, `queuedInputs`                           | Queue is tied to UI streaming rather than durable task execution                      |
| Repository rules  | `loadMarkdownRules.ts`                               | Root rules load, but active-rule diagnostics and nested scope transitions are limited |

## 3. Non-negotiable product behaviours

### 3.1 Workspace handshake

Before the first model request, create a `WorkspaceSnapshot` containing:

- stable workspace ID derived from normalized roots, without sending absolute local paths to the cloud;
- root display names and active root;
- active file and language;
- Git branch, dirty state and HEAD when available;
- detected manifests and stack signals;
- active repository instruction files;
- index state and freshness per root;
- workspace trust state;
- available read, write, terminal, browser and MCP capabilities.

The handshake must complete locally. A model request may start with partial context, but the UI must show that state and the prompt must label it as partial.

### 3.2 Grounding contract

Every response concerning the repository must be in one of these evidence states:

- `grounded`: source files or verified tool output support the answer;
- `partial`: some workspace evidence is available but retrieval is incomplete;
- `unavailable`: no workspace is open or a required provider failed;
- `general`: the request does not depend on the workspace.

The assistant must never imply that it inspected the project while in `unavailable` state. File claims must include a real URI or tool result ID.

### 3.3 One task state machine

Replace inferred UI stages with an explicit task state:

```text
idle
  -> discovering
  -> planning
  -> awaiting_approval (only when required)
  -> executing
  -> verifying
  -> completed
  -> failed | canceled | blocked
```

Transitions must be event-driven and persisted. UI components render the state; they must not infer it from history length or the presence of tool calls.

### 3.4 Safe autonomy

Read-only discovery should proceed automatically inside trusted workspaces. Writes, commands and network access must use explicit policy classes:

| Risk class | Examples                                                              | Default                             |
| ---------- | --------------------------------------------------------------------- | ----------------------------------- |
| R0         | tree, search, read, diagnostics                                       | automatic                           |
| R1         | local test/build, non-secret metadata                                 | automatic with visible receipt      |
| R2         | workspace edits, package install, browser navigation                  | preview or user-configured approval |
| R3         | delete, credentials, deployment, external writes, privileged commands | explicit per-action approval        |

Repository text, command output, web pages and MCP responses are untrusted data. They can supply evidence, never policy or authority.

## 4. Target architecture

```text
IDE adapter
  -> WorkspaceSessionService
      -> WorkspaceSnapshotStore
      -> RepositoryInstructionResolver
      -> IndexReadinessService
  -> TaskRuntime
      -> ContextPlanner
      -> PlanGraph
      -> ToolBroker -> PolicyEngine -> Tool adapters
      -> VerificationEngine
      -> CheckpointService
  -> Event journal
  -> Redux/UI projections
  -> Vynor API/model router
```

Core owns session and task truth. Redux stores a projection for rendering. The backend model is a planner/reasoner, not the authority for filesystem scope, permissions, quota or task completion.

## 5. Required contracts

Add these shared contracts under `core/agent/` and expose them through the typed protocols.

```ts
type EvidenceState = "grounded" | "partial" | "unavailable" | "general";

interface WorkspaceSnapshot {
  id: string;
  revision: number;
  roots: Array<{ id: string; name: string; branch?: string; head?: string }>;
  activeRootId?: string;
  activeFile?: { uri: string; languageId?: string };
  manifests: Array<{ uri: string; kind: string; digest: string }>;
  instructions: Array<{ uri: string; digest: string; scope: string }>;
  index: Array<{ rootId: string; status: string; revision?: string }>;
  trusted: boolean;
  capabilities: string[];
  createdAt: number;
}

interface AgentTask {
  id: string;
  sessionId: string;
  workspaceId: string;
  workspaceRevision: number;
  state: TaskState;
  goal: string;
  plan: PlanStep[];
  evidence: EvidenceRef[];
  approvals: ApprovalReceipt[];
  checkpoints: string[];
  verification: VerificationResult[];
  budget: { inputTokens: number; outputTokens: number; costUsd: number };
}
```

Every tool result must return structured metadata: `toolCallId`, status, affected URIs, truncation flag, sensitivity classification, duration and evidence digest.

## 6. Implementation phases

### Phase 0 — Stabilize the workspace foundation

Goal: make project identity deterministic before expanding autonomy.

Work:

1. Complete the exposed deployment-credential rotation and access-log audit described above.
2. Create `core/workspace/WorkspaceSessionService.ts`.
3. Add protocol methods:
   - `workspace/getSnapshot`
   - `workspace/refreshSnapshot`
   - `workspace/statusUpdate`
   - `workspace/setActiveRoot`
4. Select the active root using the active file; fall back to the only root, then require selection for ambiguous multi-root sessions.
5. Detect manifests locally with a strict file and byte budget.
6. Preserve instruction-file source paths and scope. Resolve relative references from the instruction file's own directory.
7. Invalidate the snapshot on folder, branch, active-file, trust, manifest or instruction changes.
8. Add a workspace chip above the composer: root, branch, index state and evidence state.

Primary files:

- `extensions/vscode/src/VsCodeIde.ts`
- `extensions/vscode/src/extension/VsCodeMessenger.ts`
- `core/protocol/core.ts`
- `core/protocol/ideWebview.ts`
- `core/config/markdown/loadMarkdownRules.ts`
- `gui/src/redux/slices/sessionSlice.ts`
- new `gui/src/components/WorkspaceStatus/`

Exit criteria:

- The exposed credential is invalid, its replacement exists only in the deployment secret store, and an access-log review is recorded.
- A fresh chat displays the correct repository name before the first prompt.
- Active-file root selection works in a two-root workspace.
- No absolute local path is sent unless required by an approved tool operation.
- Closing all folders produces a visible `No workspace` state and a grounded recovery message.

### Phase 1 — Context planner and retrieval health

Goal: remove prompt-specific context guesses and silent retrieval failures.

Work:

1. Move automatic context decisions out of `resolveEditorContent.ts` into `core/agent/ContextPlanner.ts`.
2. Classify requests as `general`, `file`, `project`, `diagnostic`, `change`, or `verification` using deterministic rules first and an optional small local model second.
3. Build a context budget with reserved sections for instructions, current task, source evidence and tool output.
4. Use hybrid retrieval: exact symbol/text search, recent/open files, semantic index and bounded repo map.
5. Return retrieval diagnostics: requested sources, successful sources, failures, stale index and truncation.
6. Allow useful fallback while indexing: tree, manifests, open files and text search.
7. Surface per-root indexing state beside the workspace chip, not only in settings.

Exit criteria:

- Project questions produce real file evidence even before embeddings finish.
- An empty retrieval result is visible and cannot produce invented paths.
- Retrieval p95 is measured separately for warm and cold workspaces.
- Context assembly has a deterministic token ceiling.

### Phase 2 — Durable task runtime

Goal: turn the existing recursive chat/tool flow into a resumable agent.

Work:

1. Create `core/agent/TaskRuntime.ts` and `core/agent/TaskEventJournal.ts`.
2. Move orchestration responsibility from `streamNormalInput.ts` into the runtime.
3. Represent plans as steps with dependencies, status, expected evidence and verification commands.
4. Persist task events locally using append-only records; redact secrets before persistence.
5. Resume interrupted tasks only after validating workspace ID, revision and pending approvals.
6. Add bounded loops: maximum tool calls, maximum repeated identical calls, wall-clock timeout and budget ceiling.
7. Change queued prompts into `steer`, `queue` and `replace` semantics.

Exit criteria:

- Reloading the IDE can resume a safe interrupted task.
- Cancellation stops model streams, subagents and child processes.
- A repeated-tool loop terminates with a useful diagnostic.
- Task completion requires verification evidence or an explicit unverified label.

### Phase 3 — Plan and Agent experience

Goal: provide a simple interface while keeping execution transparent.

Work:

1. Keep three user-facing modes:
   - Ask: read-only, workspace-aware;
   - Plan: read-only investigation plus editable plan;
   - Agent: plan, execute and verify.
2. Replace the large permanent Expert Team panel with a compact task timeline that expands on demand.
3. Show actions as cards: `Read`, `Search`, `Edit`, `Run`, `Verify`, with duration and status.
4. Present a concise plan approval only when policy requires it; do not ask approval for safe reads.
5. Add commands equivalent to:
   - `/status` — workspace, index, model, budget and permissions;
   - `/plan` — enter planning state;
   - `/review` — inspect current diff and risks;
   - `/compact` — compact history while retaining task state;
   - `/init` — generate repository instructions after inspection.
6. Keep the composer responsive from narrow sidebar widths through full-screen mode.

Exit criteria:

- A first-time user can ask, plan and execute without learning context-provider syntax.
- The UI always shows which root and task state are active.
- No stage is inferred from chat history.
- Keyboard-only operation and screen-reader labels pass accessibility tests.

### Phase 4 — Tool broker, approvals and transactional edits

Goal: make autonomy safe enough for real projects and enterprise use.

Work:

1. Centralize all tool execution in `core/agent/ToolBroker.ts`.
2. Remove the unconditional edit-tool approval in `evaluateToolPolicies.ts`; evaluate edits using workspace trust, scope and user policy.
3. Canonicalize and validate paths after symlink resolution. Deny writes outside authorized roots.
4. Attach an approval receipt to every R2/R3 operation; bind it to normalized arguments and expiration.
5. Group a task's file edits into a checkpoint manifest, not isolated single-file checkpoints.
6. Before apply, check the file digest captured during planning to prevent stale-write races.
7. Make rollback atomic where possible and report partial rollback explicitly.
8. Redact `.env`, credentials, key material and configured secret patterns before model or telemetry boundaries.

Exit criteria:

- Prompt injection in repository files cannot enable tools or broaden scope.
- Symlink/path traversal tests cannot escape the workspace.
- Concurrent file changes trigger a re-read instead of overwriting user work.
- A multi-file task can be reviewed and restored as one checkpoint.

### Phase 5 — Expert agents and verification

Goal: use specialist models only where they improve quality enough to justify cost.

Work:

1. Replace shared free-form subagent context with task-specific evidence requests.
2. Give each specialist a typed output schema with findings, severity, evidence references and confidence.
3. Keep specialists read-only. The primary runtime alone may request mutations.
4. Route specialists by risk:
   - security for auth, secrets, network and dependency changes;
   - QA for user-visible or behavior-changing work;
   - architecture for cross-module changes;
   - performance only when relevant.
5. Deduplicate findings and require evidence references before merging them into the main plan.
6. Build a `VerificationEngine` that detects project commands from manifests and repository rules, then proposes the smallest relevant checks.

Exit criteria:

- Specialist calls remain within configured cost and concurrency limits.
- Findings without evidence are labelled as hypotheses.
- The completion summary lists changed files, checks run, failures and remaining risk.

### Phase 6 — Privacy, enterprise controls and observability

Goal: make behaviour administrable and auditable without collecting source code.

Work:

1. Add organization policy for models, retention, allowed network origins, MCP servers, tools and maximum autonomy.
2. Store credentials only in IDE secret storage; migrate and delete legacy plaintext/global-state values.
3. Default telemetry to metadata only: timings, counts, status codes, model IDs and token/cost totals.
4. Never log prompts, source, tool output or secrets unless an explicit local diagnostic export is requested.
5. Add an audit event schema for task transitions, approvals, tool calls and quota decisions.
6. Sign policy bundles and reject stale or invalid versions.
7. Provide a local diagnostic bundle with automatic secret scanning and user preview.

Exit criteria:

- Enterprise administrators can enforce read-only mode and approved providers.
- Diagnostic exports pass seeded-secret leak tests.
- Every mutation can be traced to task, user approval/policy and checkpoint.

## 7. API and cost controls

The client must not be trusted for billing. For every cloud request:

1. create an idempotency key from user, session, request and attempt IDs;
2. reserve quota atomically before provider dispatch;
3. record provider/model, estimated input tokens and maximum output exposure;
4. reconcile actual usage after streaming completes or fails;
5. release unused reservation exactly once;
6. cache only privacy-safe deterministic results under tenant-scoped keys;
7. reject retries that reuse an idempotency key with a different payload digest.

Model routing should use task class, context requirement, latency target and cost ceiling. Cheap/local models may classify, summarize and rank context; code generation and high-risk reasoning use stronger cloud models. Never compress repository instructions, security findings or exact code needed for an edit.

Required business metrics:

- successful grounded answers per dollar;
- accepted edits per dollar;
- time to first useful evidence;
- retrieval-empty and hallucinated-path rates;
- tool retry/loop rate;
- verification pass rate;
- day-7 and day-30 active developer retention.

## 8. Data and privacy rules

- Keep workspace snapshots, task journals, checkpoints and memories local by default.
- Store relative URIs and content digests where full content is unnecessary.
- Treat repository memory as user-approved facts with source, scope, created time and delete control.
- Do not upload entire trees or files when bounded snippets are sufficient.
- Apply ignore/security rules consistently to indexing, reads, file pickers, repo maps and diagnostics.
- Display the model/provider and whether source leaves the device.
- Provide `Local only`, `Cloud allowed`, and enterprise-enforced privacy modes.

## 9. Test strategy

### Unit

- workspace root selection and normalized IDs;
- context classification and token budgets;
- state transition validity;
- policy monotonicity and approval receipt binding;
- path, symlink and secret-redaction rules;
- plan graph dependency and retry limits.

### Integration

- zero-, single- and multi-root workspaces;
- index ready, indexing, stale, failed and disabled states;
- branch switches and active-file root changes;
- native and system-message tool calling;
- cancellation, reload and task resume;
- concurrent user edits during agent execution;
- provider timeout, malformed tool call and partial stream failure.

### Adversarial

- instruction files containing prompt injection;
- source comments requesting credential access or policy changes;
- malicious MCP/tool output;
- path traversal, symlink escape and terminal command injection;
- quota retry races and duplicated stream reconciliation;
- secret canaries in files, logs and diagnostic exports.

### Product evaluation set

Maintain representative repositories and fixed tasks:

- identify the stack and architecture;
- locate a real symbol without inventing a path;
- fix a scoped bug and run the relevant test;
- make a multi-file feature with rollback;
- refuse an out-of-workspace destructive request;
- resume after IDE reload;
- operate while semantic indexing is unavailable.

## 10. Release gates

No phase ships based only on compilation.

| Gate                            | Required threshold                                                  |
| ------------------------------- | ------------------------------------------------------------------- |
| Grounded project identification | 100% on evaluation repositories                                     |
| Invented file paths             | 0 in deterministic evaluation set                                   |
| Workspace escape                | 0 successful adversarial attempts                                   |
| Secret leakage                  | 0 seeded canaries across model/log/export boundaries                |
| Cancellation                    | all model, subagent and process work stops within defined timeout   |
| Resume correctness              | no action executes against a changed workspace without revalidation |
| Billing idempotency             | exactly-once reservation/reconciliation under concurrent retries    |
| Accessibility                   | keyboard and screen-reader critical paths pass                      |

Roll out each phase behind a feature flag to internal users, then 5%, 25%, 50% and 100%. Automatically pause rollout when crash, retrieval-empty, policy-denial or billing-reconciliation rates exceed thresholds.

## 11. File-level delivery order

1. `core/workspace/*` and workspace protocols.
2. `gui/src/redux/slices/workspaceSlice.ts` and compact status UI.
3. `core/agent/ContextPlanner.ts` and retrieval diagnostics.
4. `core/agent/TaskRuntime.ts`, event journal and state protocols.
5. Refactor `streamResponse.ts` and `streamNormalInput.ts` into thin UI adapters.
6. `core/agent/ToolBroker.ts` and unified policy receipts.
7. Task-wide checkpoint manifests in the VS Code extension.
8. Typed specialist reports and verification engine.
9. Enterprise policy, audit events and privacy controls.
10. Evaluation harness, staged rollout and product metrics.

## 12. Recommended first implementation sprint

Keep the first sprint narrow enough to prove the architecture:

1. Implement `WorkspaceSnapshot` and active-root selection.
2. Add `workspace/getSnapshot` and status events.
3. Render a compact workspace/index/evidence chip.
4. Move project-query classification into a small `ContextPlanner` interface.
5. Add retrieval diagnostics to context results.
6. Create tests for no workspace, one root, active-file multi-root selection, index failure and prompt-injection content.

Definition of done:

- opening VynorAI immediately shows `VynorAI · main · indexing/ready`;
- asking “Do you understand this project?” lists only observed stack/files with evidence;
- a failed context source is visible to both user and model;
- no manual `@codebase` action is required;
- behavior survives reload and is covered by integration tests.

## 13. Explicitly defer

Do not mix these into the foundation sprint:

- unrestricted autonomous deployment;
- arbitrary plugin marketplace execution;
- large on-device generation models;
- organization-wide shared memory;
- automatic fine-tuning from raw user prompts;
- fully parallel write-capable agents.

Those features depend on the workspace, task, policy, evidence and audit contracts defined above.

## 14. Live backend rollout runbook

The public `/health` endpoint reports the currently deployed storage modes. Do
not consider the PostgreSQL cutover complete while `billing.mode` is `sqlite`.

1. Revoke the Coolify API token that was exposed in chat/history and create a
   replacement with access limited to the VynorAI resource.
2. Provision PostgreSQL and Redis on a private Coolify network. Do not publish
   their ports to the internet.
3. Take a recoverable snapshot of the existing `/app/data` volume.
4. Configure `BILLING_DB_MODE=postgres`, `DATABASE_URL`, `REDIS_URL`,
   `IDE_AUTH_REQUIRE_REDIS=true`, `DATA_ENCRYPTION_KEY`, `JWT_SECRET`, and
   `ADMIN_SECRET` as Coolify secrets. Never place their values in Git or build
   arguments.
5. Deploy one backend replica. Startup performs the idempotent SQLite-to-
   PostgreSQL backfill and refuses to become ready if table parity fails.
6. Require Coolify to probe `GET /ready`, not only `GET /health`. Readiness must
   return HTTP 200 with PostgreSQL ready and Redis ready before traffic shifts.
7. Run `SMOKE_BASE_URL=https://vynor.lk npm run smoke:release` from `backend/`.
   This checks liveness, readiness, invalid IDE-code handling, and `no-store`
   response headers without using a customer credential.
8. Verify `/health` reports `billing.mode=postgres`, then test one disposable
   account through login, single-use IDE exchange, quota reservation, streamed
   completion, usage reconciliation, and replay rejection.
9. Increase replicas only after Redis-backed rate limiting and IDE-code exchange
   are confirmed. Monitor 5xx, quota reconciliation, provider cost, and gross
   margin during the staged rollout.

Rollback: route traffic to the previous image and restore the SQLite volume only
if no post-cutover writes were accepted. Once PostgreSQL accepts production
writes, treat it as authoritative and use a forward repair rather than silently
reverting to a stale SQLite copy.
