# Architecture decisions (single source of truth)

Read this before answering or changing anything about the database, caching, context handling or plans.
If a decision changes, update this file in the same commit. Facts below were checked in code on 2026-10-10;
anything about production environment values is marked "not verified".

## Database

- Production uses PostgreSQL 16 (`DATABASE_URL`). `backend/src/services/pgDriver.ts` selects it when
  `DATABASE_URL` is set and `DB_DRIVER` is not `sqlite`.
- SQLite is for local development and the default test run only. Every query must stay portable:
  `?` placeholders and `ON CONFLICT` upserts, no `rowid`, no `INSERT OR REPLACE`.
- New tables need both the SQLite schema (`backend/src/db.ts`) and a PostgreSQL migration
  (`backend/src/services/postgresSchema.ts`). Check with the `vynor-postgres-check` skill.
- Cloud PR/deployment control is server-owned: `cloud_delivery_manifests` stores only immutable
  repository revisions, SHA-256 evidence/approval digests, bounded state transitions and timestamps.
  It never stores prompts, source diffs, provider credentials or GitHub tokens. The default mode is
  `pr_only`; staging/canary/production actions remain blocked unless the manifest is approved and
  advances through the ordered state machine.
- Staging/canary promotion is evidence-driven: readiness and smoke must pass, canary exposure is
  deterministically bounded to 1â€“5%, false-verified results always roll back, and inconclusive
  samples never promote. The deployment gate does not itself hold provider or VPS credentials.
- Non-dry cloud PR workers must mirror each manifest creation, approval and transition through the
  HTTPS server-control client. A missing client is a hard failure; local JSON is only an evidence
  cache and never the authority for push or deployment.
- Deployment artifacts must carry a signature verified by the server-configured public key over the
  pinned SHA-256 artifact digest. Store only the resulting attestation digest and key ID; never store
  the signature, artifact bytes or private key in the delivery manifest.
- Deployment sequencing is provider-neutral in core (`cloudDeploymentExecutor.ts`); only an explicitly
  configured adapter can perform VPS/provider I/O. No model text or request field can become a shell
  command, target, credential or deployment permission.
- The shipped VPS adapter uses an operator-owned HTTPS deployment controller with fixed
  `/v1/cloud-deployments/deploy`, `/v1/cloud-deployments/health` and
  `/v1/cloud-deployments/rollback` endpoints. It validates target and revision
  hashes, requires structured health evidence and fails closed on non-HTTPS or malformed responses.

## Caching: four different things, do not mix them up

| Cache                          | What it is                                                                                                          | State                                                                       |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Provider prompt-prefix cache   | DeepSeek bills a byte-identical repeated prefix at ~2%. Protected by append-only history and frozen volatile state. | Always on; protect it (`vynor-prompt-cache` skill)                          |
| Read dedupe / tool-output trim | `backend/src/services/hybridContext.ts`: later identical reads become a pointer, noisy output is capped.            | Always on in "safe" mode                                                    |
| Semantic response cache        | `backend/src/services/semanticCache.ts`: embedding match, threshold 0.95, scope per user.                           | **Off unless `SEMANTIC_CACHE_ENABLED=true`**. Production value not verified |
| Redis                          | Optional shared store, active only when `REDIS_URL` is set.                                                         | Production value not verified                                               |

- Control-plane task-scope preflights send `request_kind: "task_scope"` and
  `cache_policy: "bypass"`. The proxy skips exact, semantic, deterministic and
  template response paths for them. The economics ledger stores only the request
  class, policy and stable bypass reason; it never stores prompt, path or code.
- Independent side-review calls also send `cache_policy: "bypass"`. They must
  inspect the current diff and must never receive an exact/semantic cache answer
  or a deterministic mutation workflow. They remain `request_kind: "chat"` and
  are recorded with the stable `client_policy` bypass reason; review text is not
  persisted.

## Context and plans

- Credits and requests are two separate monthly limits, and a user is blocked by whichever runs out first
  (`monthlyQuotaGuard` in `backend/src/services/monthlyQuota.ts`). A top-up (`creditTopup`) adds both: a paid pack
  adds one plan allowance of each, and an admin "Add tokens" adds requests at the user's plan ratio
  (`proportionalRequests`, at least 1), so adding credits alone never leaves a user stuck at the request cap.
- Context limit per plan (`backend/src/services/modelRegistry.ts`): free and starter 32K, pro 128K,
  enterprise 256K tokens. Compaction triggers at 85% of the budget and drops about half of it.
- Default optimization mode is "safe" (trim tool output, window, read dedupe, background summary).
  "aggressive" runs only when a client sends `optimization_mode: "aggressive"`; the extension does not.
- The backend owns the real window. The client model `contextLength` is the largest plan window (256000,
  `core/config/default.ts`, `extensions/vscode/src/util/vynorModelMigration.ts`); a smaller client value
  prunes history one message per round before the server can compact. Do not lower it per model.
- When turns are dropped, the user's own requests of the dropped turns are kept verbatim in
  `<earlier-user-requests>` (capped), and an `<earlier-conversation-omitted>` note is added while no summary
  exists (`hybridContext.ts` `applyCompaction`).
- The tool name + target (path, command, query) of dropped assistant tool calls is listed in
  `<earlier-actions>` (deduped, last 40; `hybridContext.ts` `earlierActions`), so the model knows what it ran.
- A failed summary backs off exponentially (30s, 60s, ...) and stops after 4 tries per dropped block, so it no
  longer spends upstream tokens on every request; the verbatim requests and `<earlier-actions>` still carry
  the task. The summary transcript now includes assistant tool calls.
- Known quality risks (not fixed): the compaction summary sees only the last 12,000 characters of the dropped
  block (`localSlmRouter.ts`); summaries live in process memory, so a restart or rolling deploy changes the
  block once.

## Compaction summaries are not persisted

- Summaries stay in process memory (`hybridContext.ts`, 500 entries). A restart or rolling deploy loses them, so
  one prompt per active conversation is sent with the verbatim requests and `<earlier-actions>` block only, and the
  summary is generated again in the background. That costs one provider cache miss per conversation per deploy.
- Decision (2026-10-10): do not write them to the database. A summary is derived from the user's code and
  conversation; storing it would add retained user content to a product that stores only fingerprints and counts
  (`routing_feedback`, `task_outcomes`). Revisit only with an explicit retention period and delete-on-account-delete,
  and only if the deploy cost shows up in the cache-hit share of the benchmark report.

## Implementation subagents

- `core/agent/ImplementationSubagentScheduler.ts` and the `agent/subagent/*` handlers in `core/core.ts` are not
  called by any client. They are kept, not wired and not deleted, because the benchmark has no multi-file category
  yet to show whether parallel implementation agents raise the pass rate. Add that category first, then wire or
  delete.

## Task outcomes

- The GUI reports how a task ended (completed, completed unverified, stopped, budget, credit cap, error, rewound) with
  scope class, round and credit counts to `POST /v1/task-outcomes`, only when the user turned on "Send Error Reports
  and Task Outcomes". Request economics carries the same scope class for aggregate cost comparison. No prompt, path
  or code is sent or stored. Retention 180 days. Admin: `/admin/task-outcomes` and `/admin/economics`.

## Product

- VynorAI: VS Code extension plus a hosted proxy over low-cost models (DeepSeek), no user API key,
  credits priced in LKR, target users in price-sensitive markets (Sri Lanka, South Asia).
- Goal: Claude Code level agent quality at a fraction of the cost. Never trade quality for tokens
  without a measured check.

## Excel agent (Microsoft 365 add-in)

- Decided 2026-10-19 by the owner: the Excel add-in moves from "AI writes sentences, the reader decides" to an
  agent like Copilot in Excel. DeepSeek (through the user's VynorAI key and the normal gateway, credits and
  ledger) runs a tool-calling loop; the add-in executes the tools with Office.js.
- Data sent to the model: the schema summary plus a bounded sample (at most 50 rows per read, 200 cells per
  answer) with personal data masked on the device (`redactPersonalData`) before it leaves. Never the whole sheet.
- Writes: every write tool is staged, not run. The person sees the change list, approves, and only then is it
  applied. In-place edits (sort, delete rows, overwrite cells) are allowed after approval, with undo: a backup copy
  of the edited sheet is made first (hidden, marked `vynorai-backup`) and undo restores from it.
- After apply the agent reads back the written ranges once (errors such as #VALUE!, #SPILL!) and may stage fixes,
  which need approval again. At most 12 model turns per request.
- The proven engine is kept: the reader stays the free fast path, and its builders (pivot, chart, dashboard,
  clean, statistics, views at 520k rows) are one agent tool (`vynor_step`). Formulas the agent writes are checked
  against a blocklist (external links, WEBSERVICE, other files) before staging.
- Gateway surface `m365`: the coding-agent extras (mutation-tool pruning, project memory, RAG, scaffolds) are
  skipped for these requests; the system prompt and tool list are fixed so the provider prefix cache hits.

### Excel advanced analyst safety (2026-10-19)

- Analyst reports use Excel-native formulas first. Forecasting prefers `FORECAST.ETS` and
  `FORECAST.ETS.CONFINT`, with a visible linear fallback and no fabricated values. Financial and
  anomaly reports include their source columns/formulas as evidence; anomaly and fraud-risk outputs
  are screening signals, never claims of fraud or causation.
- Deterministic local analytics (cohorts, sensitivity matrices, fuzzy candidates, structured splits,
  clustering, similarity groups and text helpers) preserve the source range and return reviewable
  candidates. Fuzzy matches and repairs never merge or overwrite rows without a fresh approval.
- Desktop/Web differences are reported before planning. Unsupported Office.js objects return an
  explicit capability/fallback status; they are never silently pretended to work. Slicers and richer
  dashboard objects may fall back to filtered result sheets.
- AI text classification is consent-gated, masked and batch-bounded, and its output must be schema
  validated before staged result columns are offered. Python is deliberately not executable in the
  first production release; any later Python feature requires an isolated, no-network, resource-limited
  sandbox with explicit approval and a result-only boundary.
- Decided 2026-10-20 by the owner: the agent may run analysis code (`run_code`, `extensions/m365/src/codeSandbox.ts`).
  It is JavaScript, not Python, and runs on the device in a Web Worker. Before the code runs, every network and code-loading API
  (fetch, XMLHttpRequest, WebSocket, importScripts, Worker, indexedDB, caches...) is removed from the worker. The
  code gets a copy of at most 2,500,000 cells, has 5 seconds, and returns one JSON value (cut at 6,000 characters).
  That result is masked like any other tool result before it reaches the model. The cells never leave the
  device. `run_code` is a read tool: it cannot write, so it needs no approval click, and anything it finds is
  still written only through staged, approved changes. At most 4 runs per request.
- Excel email delivery is a separate, explicit side effect. It uses a second OAuth consent for delegated Graph
  mail scopes only after the user reviews recipients, format, body, charts, attachment list and confirms Send.
  XLSX/PDF/CSV bytes and bounded result-sheet details are produced locally; raw report bytes never go through the
  VynorAI backend or audit logs. Direct Graph send is used for small messages. Larger attachments use a draft and
  resumable Outlook upload session when `Mail.ReadWrite` is separately configured; Microsoft tenant/message limits
  remain explicit, never silently bypassed. Unsupported Excel host APIs return a fallback/error, and auto-send is
  not allowed.
- The device relationship mapper accepts at most ten sheet-qualified ranges and 20,000 rows per range. It keeps
  relationship output bounded, reports when candidate links were truncated, and never invents a join when a key
  is absent. The existing package contracts remain source-only until the separate backend/add-in build contexts can
  consume one shared package without changing the production deployment boundary.

### Excel capability registry and honest native-feature routing (2026-10-24)

- One registry, one resolver. `packages/m365-contracts/src/capabilities.ts` owns every feature key, its execution layer, host and ExcelApi requirement and fallback. The backend and the add-in build in separate contexts, so each keeps a byte copy that tests compare with the contract; no layer lists feature keys itself. The previous server key `python` is now `python-sandbox`.
- Fail closed. An unknown feature, a missing read or write permission, an unidentified host or a missing optional layer never resolves to `available`. A feature that sends data out (masked AI, Microsoft Graph), writes through a native layer (Windows companion) or runs elsewhere (managed Python sandbox) resolves to `consent_required` at best. A missing host API gives `available_with_fallback` only when a real fallback exists, otherwise `unsupported`.
- Native features are never faked. Power Pivot, the Data Model, OLAP PivotTables, VBA/COM, Solver, Scenario Manager, sparklines and Python are answered before any model call or consent card with a structured refusal and the closest supported alternative (regular PivotTable, formula report, what-if sensitivity table, macro text, chart, local analysis). Python never asks the person to install anything. The companion is exposed only on Windows desktop Excel with a ready, signed companion; the sandbox only when a provisioned isolated worker is reported. Until those exist the pane and the server report them as missing.
- Python-free analytics stay on TypeScript, Excel formulas and Office.js (forecast, anomaly, clustering, cohorts, financial metrics, fuzzy matching, sensitivity, Goal Seek and the what-if grid as the deterministic optimisation fallback, relationships, charts, PivotTables, dashboards, CSV/XLSX/PDF export, Graph mail after approval). A test ties each registry key to its implementation.

## M365 managed Python sandbox (foundation only)

- Python never runs in the API process, the add-in or a shared filesystem. The API only validates, masks, asks for approval, records metadata and hands a job to a `SandboxWorker` adapter. No adapter exists in this repository, so submission returns `SANDBOX_UNAVAILABLE` (HTTP 503) with administrator guidance and stores nothing.
- A job carries a bounded masked table copy and a script: at most 5,000 rows, 50 columns, 100,000 cells, 1 MB of input, 60 s. It has no workbook handle, no Graph or Entra token, no shell and no network (`network` must be `false`). Unknown fields are rejected.
- Approval reuses the existing single-use approval token, bound to the input fingerprint, tenant and user. No approval, no dispatch; a preview is itself refused when no worker exists, so the pane never asks for approval for something that cannot run.
- The database holds job metadata only (owner, state, counts, fingerprint, expiry) plus the bounded result of a finished job until it expires. The script and input table are never stored. Another tenant's or user's job is a 404.
- Limits: one active job per user, five per tenant, 20 jobs per user per hour, 15 minute expiry. Audit events carry codes, states and counts only.
- The worker's own isolation (separate host, ephemeral per-job container, no network, resource limits, encrypted short-lived artifacts) is a deployment requirement listed in `docs/PYTHON_SANDBOX_DEPLOYMENT.md`; it is not claimed by this code.

## Windows companion boundary

- Companion-only Excel features (VBA/COM, Solver, Scenario Manager, Power Pivot authoring, Sparklines authoring) are exposed only on Excel desktop on Windows with a verified, signed, tenant-allowed companion. Web, Mac and every other host never see them, so there is no false parity.
- This repository ships the contract, the pure state function and a transport that always answers `not_installed`; the pane never probes localhost or any network address. The companion, its signing and its update channel are unbuilt (see `docs/WINDOWS_COMPANION_DESIGN.md`).
- Discovery carries no workbook data; `rawWorkbookExport` must be `false` or the reply is rejected.
