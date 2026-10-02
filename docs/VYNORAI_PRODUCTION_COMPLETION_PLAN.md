# VynorAI Production Completion Plan

Status: Active engineering plan

Baseline: extension v1.1.7

Principle: no capability is complete until its acceptance gates are backed by automated evidence.

## Product objective

Deliver a managed, cost-efficient AI software engineering product that can understand a workspace, plan safely, implement scoped changes, verify them, recover from mistakes, and provide enterprise-grade control without requiring customers to manage provider APIs.

## Non-negotiable invariants

1. Chat and Plan modes cannot mutate the workspace.
2. Repository, terminal, browser, MCP, and model output are untrusted data.
3. Every mutation is recoverable and attributable to one task and tool call.
4. A model statement is never verification evidence.
5. Completion requires acceptance-criteria and verification evidence.
6. Secrets are never placed in prompts, logs, telemetry, checkpoints, or provider errors.
7. Missing isolation or distributed coordination fails closed in production.
8. Existing user edits are preserved unless the user explicitly authorizes replacement.

## Delivery slices

### P0.1 — Workspace identity and grounding

- Stable multi-root workspace identity and revision.
- Index status, file counts, ignored paths, last refresh, and rebuild controls.
- Canonical URI/path handling across Windows, WSL, SSH, containers, Cursor, VS Code, and Antigravity.
- Explain which context was selected and why.

Acceptance gates: workspace restart, multi-root, empty workspace, remote URI, renamed root, index corruption, and large repository tests.

### P0.2 — Transactional checkpoints and restore

- Task checkpoint before the first mutation.
- Mutation checkpoint before every file batch.
- Group checkpoints by task and tool call.
- Restore one file, one mutation batch, or the whole task.
- Restore files only or files plus conversation/task state.
- Preserve newer user edits through hash conflict detection and explicit confirmation.
- Retention and storage limits with binary/large-file policy.

Acceptance gates: create/edit/delete/rename, multi-file partial failure, unsaved document, conflicting user edit, extension crash, and restore-after-restart tests.

### P0.3 — Evidence-backed completion

- Derive acceptance criteria and verification requirements from the request and changed surface.
- Discover project-native lint, typecheck, unit, integration, build, and security commands.
- Capture command, root, exit code, duration, bounded output digest, and affected revision.
- Prevent successful completion after mutation without passed non-response verification or an explicit user-approved skip.
- Inspect final diff and report changed files and residual risks.

Acceptance gates: successful run, failed test, stale verification after another edit, no test command, user-approved skip, timeout, and canceled command tests.

### P0.4 — Real sandbox boundary

- One execution gateway for streaming, non-streaming, background, and remote commands.
- Windows restricted token/AppContainer or isolated VM boundary; Linux bwrap namespaces/seccomp; macOS hardened profile.
- Canonical workspace filesystem allowlist, symlink/junction escape protection, sanitized environment, secret allowlist, network policy, and process/resource limits.
- No silent host fallback in production.

Acceptance gates: filesystem escape, secret exfiltration, encoded command, nested shell, network denial, fork/process escape, timeout, and child cleanup tests.

### P1.1 — Durable autonomous agent

- Task-specific DAG rather than fixed understand/act/verify labels.
- File ownership/locks for parallel edits.
- Repeated-action semantic circuit breaker.
- Cost, token, wall-clock, command, and mutation budgets.
- Crash-safe resume with workspace-revision validation.
- Structured blocked state and safe rollback.

### P1.2 — Implementation subagents

- Parent orchestrator delegates isolated, scoped subtasks.
- Read/write/command/network authority is explicit per subtask.
- Separate context and budgets; structured handoff only.
- Architect, frontend, backend, database, security, performance, DevOps, QA, and verifier roles.
- Conflict detection and deterministic merge ownership.

### P1.3 — Browser and visual QA

- User-approved origins only.
- Local server lifecycle, browser actions, screenshots, console/network diagnostics, responsive viewports, and accessibility checks.
- Credential and cross-origin protections.
- Visual evidence attached to verification receipts.

### P1.4 — Context economy and memory

- Decision, file-inspection, failed-approach, acceptance-criteria, and verification ledgers.
- Evidence-preserving conversation compaction.
- Relevance scoring, deduplication, context budget allocation, and cache reuse.
- Explicit user-approved project memory with expiration and deletion.

### P2.1 — Extensibility

- Signed skills, custom modes, MCP permission manifests, publisher verification, project/global scope, and marketplace review.
- Capability-scoped secrets and per-tool audit history.

### P2.2 — Enterprise control plane

- SSO/OIDC/SAML, RBAC, teams, repository policies, regional routing, retention and zero-retention options.
- Central model/tool policies, private endpoints, immutable audit exports, budgets, chargeback, and incident controls.

### P2.3 — Commercial reliability

- Atomic quota reservation/finalization, idempotent usage ledger, provider failover, margin-aware routing, latency/error SLOs, and customer-visible usage evidence.
- Canary releases, rollback, signed artifacts, update compatibility tests, and support diagnostics bundle.

## Release gates

Each slice must pass:

1. Threat model and abuse cases.
2. Unit and protocol-contract tests.
3. Cross-IDE integration tests.
4. Crash/restart and partial-failure tests.
5. Performance and token-cost budgets.
6. Privacy/logging review.
7. Built webview smoke test and signed VSIX installation test.
8. Documented rollback procedure.

## Recommended order

P0.2 → P0.3 → P0.4 → P0.1 → P1.1 → P1.2 → P1.3 → P1.4 → P2.1 → P2.2 → P2.3.

Checkpoint recovery and truthful verification precede greater autonomy. Sandbox hardening precedes unattended terminal execution. Enterprise and marketplace work begins only after those safety foundations are measurable.

## Implemented production evidence

- v1.1.7: mutation completion requires passed non-response verification evidence; automatic tool actions are journaled.
- v1.1.8: task-scoped multi-file checkpoints and conflict-aware whole-task restore.
- Current sandbox slice: unified local foreground/background execution gateway, workspace-root validation, credential environment redaction, and optional strict fail-closed execution. Native Windows OS isolation, remote containment, and network namespaces remain open and must not be represented as complete.
- v1.2.0: origin-restricted Browser QA with bounded click/type/select/wait/press workflows, responsive viewport presets, console/page/network findings, accessibility metadata, screenshots, and local deterministic screenshot-baseline fingerprints. Pixel-tolerant visual diffs, managed local-server lifecycle, and authenticated test-session handling remain open.
- Current implementation-subagent foundation: durable role/objective records, explicit read/write/command/network authority, canonical workspace-relative file scopes, exclusive overlapping-write ownership, aggregate parent/child token and cost budgets, cancellation propagation, and evidence-gated structured handoffs. Model-turn delegation and tool-dispatch binding must be completed before implementation subagents are user-visible or described as autonomous workers.
- Current delegated tool-dispatch slice: implementation-subagent identity can be propagated through GUI edit tools, core tools, and MCP-app secondary calls; file and network capabilities fail closed against the durable scope contract. Workspace-wide retrieval requires explicit whole-workspace scope, unknown/MCP tools are denied, and delegated terminal execution remains disabled until native scoped process isolation exists. Automated model-turn creation and deterministic merge orchestration remain open.
- Current crash-recovery hardening: journal event sequence numbers remain monotonic across core restarts, persisted active plan steps return to pending on safe resume, and interrupted implementation subagents release write ownership by returning to queued before execution can restart. Multi-process journal locking and corruption repair remain open.
- Current deterministic handoff layer: subagent dependencies form an ordered execution contract, start/completion reject stale workspace revisions, independent overlapping changed-file handoffs fail closed, and verified handoffs expose a stable topological merge queue. Content-hash rebasing and automated patch application remain open.
- Current implementation-turn scheduler: a bounded (1-5 worker) scheduler launches dependency-ready model-turn adapters, atomically charges child and parent budgets, persists verified handoffs, isolates failures, reports blocked dependents, and releases workers on cancellation. The IDE LLM/tool-loop adapter is still required before this scheduler becomes a user-facing autonomous implementation team.
