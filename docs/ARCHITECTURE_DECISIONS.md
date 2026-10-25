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

## M365 tenant subscriptions and Entra organization boundary (2026-10-24)

- Entra identifies the organization by `{tenantId, objectId}`; it is not the billing system. VynorAI's existing PayHere and subscription records remain the source of payment and user-level plans.
- An administrator may configure an explicit tenant plan, expiry and seat limit in the existing M365 tenant registry. That tenant plan wins for linked identities while it is active; tenants without one continue using the existing user subscription fallback, so existing add-in customers are not changed silently.
- Identity linking checks the tenant seat limit. Diagnostics and `/excel/capabilities` expose only plan name/source, seat counts and expiry; they never expose tokens, mailbox data or secrets.
- **Quota ledgers are separate.** An M365 request is billed on the organisation seat, never on the person's VS Code allowance. The tenant plan only selects limits and the model plan for that request (`req.user.subscriptionPlan` is request-local and never written back). Credits and holds live in `m365_tenant_usage` and `m365_quota_reservations` (migration 039, SQLite and PostgreSQL), keyed by `(tenant_id, object_id, period_start)`, with the real `users.id` stored only for audit and economics linkage (no synthetic user ids). `QuotaReservation.scope` (`personal` or `m365_tenant`) makes reserve, top-up, settle, release and stale-hold recovery scope-aware in `backend/src/services/monthlyQuota.ts`, delegating to `backend/src/services/m365QuotaLedger.ts`. M365 code never reads or writes `subscriptions`, `monthly_usage` or `quota_reservations`; a request without its tenant seat is refused (`M365_QUOTA_SCOPE_MISSING`) rather than falling back to the personal quota. The tables are additive and unused by older code, so rolling back leaves VS Code billing untouched. Tests: `backend/test/m365QuotaIsolation.test.ts`.
- A tenant plan does not grant Microsoft Graph permissions. Entra consent and the VynorAI tenant scope policy remain separate gates. Payment checkout for tenant plans is a later phase and must reuse the existing billing service rather than introduce a second billing system.

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

## Security review of the capability, sandbox and companion work

- A job past its expiry never becomes a result: a late worker result expires the job, and a stored result is unreadable after expiry even before the sweep clears it. `sweepSandboxJobs` runs from `scheduleSandboxSweep()` at start-up (first run after 60 s, then every 5 minutes; failures are swallowed).
- The sandbox route checks the parsed body size as well as `content-length`, so a chunked request cannot exceed the cap. Access tokens, bearer values, JWTs and `client_secret`/`api_key` assignments in the script, purpose, headers or cells are rejected before preview and dispatch, never forwarded to a worker.
- `=PY(` (Python in Excel, which sends cell data to a Microsoft cloud runtime) is a blocked formula function for the agent. Singlish ("python eken") and Sinhala/Tamil Python wording route to the honest `python-sandbox` refusal; a data value such as "Skill is Python" is not refused.
- Known limit: an add-in report (message starting `[Report from the add-in`) is not screened for native-feature wording, because reports carry workbook text. The model has no Python or VBA tool, so a spoofed prefix cannot run anything.
- The prompt prefix (system prompt and tool definitions) is unchanged: `AI_TEXT_FEATURES` has the same three values, and the refusal runs before any model call.

## Identifier security

- Every identifier or token that reaches the database or an API is minted by `backend/src/services/secureId.ts` (CSPRNG, at least 128 bits for new ids). A clock, a counter, `Math.random()` or user input never builds an id. Tables keep their existing id columns; only newly minted ids change, so no migration and no rewrite of stored data.
- Ids received from a client are validated (`idParam`: `[A-Za-z0-9_-]{1,128}`; `nameParam` also allows `. : /` for model and provider names) and every read or write of a user's row is scoped by `user_id` (or tenant and object) in the `WHERE` clause. A row owned by someone else answers "not found", never "forbidden".
- SQL text is a constant. The only splices allowed are module constants, placeholder lists, a clamped number, a literal-union column or an allow-listed column set (`PLAN_OVERRIDE_COLUMNS`). `identifierSecurity.test.ts` fails when a new splice appears, so each one needs a security review and an entry in its list.
- Secrets, signatures and nonces are compared with `safeEqual` (hash then `timingSafeEqual`). Public ids are not logged next to secrets.
- Known limits: the Redux tab ids and other purely local UI ids in `gui/` still use `Date.now()` plus `Math.random()`; they never reach a database or an API. Integer rowids (SQLite) and `seq` (PostgreSQL) of audit tables are returned only to admin routes.

## Admin access, sessions and audit (security hardening, phase 2-A)

- The admin portal never trusts the `Cf-Access-Authenticated-User-Email` header alone. It is believed only when `Cf-Access-Jwt-Assertion` verifies in `services/cfAccess.ts` (RS256 against the team JWKS, `aud`, `iss`, `exp`, and an email claim equal to the header). Configure `CF_ACCESS_TEAM_DOMAIN` (for example `vynor.cloudflareaccess.com`) and `CF_ACCESS_AUD` (the Access application's AUD tag). Without both, the Cloudflare path is disabled (fail closed; only `NODE_ENV=test` accepts the bare header) and `x-admin-secret` (constant-time, 32+ characters in production) remains the way in. `deploy/Caddyfile` also drops the `Cf-Access-*` headers from any request whose source address is not a Cloudflare edge range (that list needs a manual re-check when Cloudflare changes it).
- `adminActor(req)` (verified Access email, or `admin-secret`) is the audit actor for every admin action; plan edits, plan override clears, model upsert/enable/disable, provider keys, grants, top-ups, key rotation, suspension, identity links and tenant changes each write a metadata-only event (ids and changed field names, no values). User emails are not written into audit `details`.
- User session tokens come from `services/userSession.ts`: a key derived per purpose from `JWT_SECRET`, `kind: user_session`, a password fingerprint (`pv`) so a password change or reset ends every older session (`/change-password` returns a fresh token), HS256 only. Tokens issued before this change (no `kind`, raw secret) still verify until they expire (at most 30 days); a token that carries another token's claims (`scope`, `taskId`, `jti`) is never accepted as a session.
- `JWT_SECRET` has no public default: only `NODE_ENV=test` uses the old value; elsewhere a missing secret gives a random per-process secret (production refuses to boot without one). `isDevelopmentBuild()` is true only for an explicit `NODE_ENV` of `development` or `test`, so a host that forgot `NODE_ENV` fails closed.
- Audit text is cleaned and capped (`cleanAuditField`); failed logins for unknown addresses store a short SHA-256 prefix, not the address. Audit actors are user ids (the email is never the actor). Account deletion scrubs `details`, deletes holds and sandbox jobs by user id and pseudonymises `m365_tenant_usage.user_id`. `m365_tenant_usage` is kept 395 days. `zk_compliance_audit_logs` is a hash chain and is deliberately not purged (accepted exception: surrogate ids and fingerprints only).
- API keys are never stored in plaintext: registration, Google sign-up and both key rotations refuse (503 `ENCRYPTION_UNAVAILABLE`) when encryption is unavailable. Admin error responses carry stable codes, not `err.message`. Global error handlers log the error class and message only (never `err.body`). CORS uses an explicit origin list. The admin secret lives in `sessionStorage` only.

## Schema hardening and migration parity (migrations 040 and 041)

- **040_security_hardening** (SQLite and PostgreSQL, additive, idempotent): CHECK-equivalent guards on `m365_tenant_usage`, `m365_quota_reservations` and `m365_tenants.seat_limit` (PostgreSQL `CHECK ... NOT VALID` then `VALIDATE`, left NOT VALID with a warning if old rows violate it; SQLite triggers, because SQLite cannot add a CHECK without a table rebuild); unique indexes on `users.api_key_hash` and on digit-only (real PayHere) `subscriptions.payment_id`, each created only when no duplicates exist (otherwise skipped with a metadata-only warning). Admin grants and test activations reuse fixed labels such as `ADMIN_MANUAL_GRANT`, so those payment ids are deliberately not unique. A nullable `period_start` is added to `quota_reservations` and `m365_quota_reservations`. Lookup indexes were added on the owner columns the delete-account scrub and the stale sweeps use.
- **041_monthly_usage_conflict_target**: legacy SQLite files can lack `UNIQUE(user_id, period_start)` on `monthly_usage` (migration 011 reused the name of a plain index), which breaks `ON CONFLICT(user_id, period_start)`. SQLite gets a guarded unique index; PostgreSQL always has the constraint, so its twin is a no-op.
- **Runner safety**: on SQLite each migration step and its `schema_migrations` row commit in one transaction (`BEGIN IMMEDIATE`/`ROLLBACK`); a step that opens its own transaction is flagged `ownTransaction`. `execSchema` and `addColumnIfNotExists` skip only "already exists/duplicate column" (and a table another service creates later); any other failure now stops the migration instead of being recorded as applied.
- **PostgreSQL driver**: TLS is required for any host that is not loopback or the private container network (`PG_SSL=disable` is the explicit opt-out); `int8` above 2^53 stays an exact string; `timestamptz` is returned as an ISO string.
- **Backups**: `deploy/offsite-backup.sh` keeps 14 days (the privacy policy), passes secrets by environment rather than on a command line, and seals each new `.enc2` backup with a SHA-256 digest encrypted inside the stream, so tampering fails the restore check. Legacy `.enc` backups restore with a warning.
- **Accepted remaining risks**: no foreign key from the `m365_*` ledger tables to `m365_tenants`/`users` (SQLite cannot add one without a rebuild; rows are tenant-scoped in every query and removed by delete-account); the `ON DELETE` rules cannot be exercised on PostgreSQL here because no PostgreSQL is available in the test environment. `backend/test/schemaParity.test.ts` compares the PostgreSQL migration SQL with the schema SQLite builds and lists every reviewed difference.

## Typed PostgreSQL schema (production baseline)

- **Why.** The production schema stored nearly every date as text (about 70 columns), every flag as a 0/1 integer and every price as a float. Text dates compare as strings, so a malformed `valid_until` once sorted after every real date and looked "not expired"; nothing in the database could reject it. The decision (made with the owner) is a new database with real types, not an in-place conversion.
- **Baseline, not a ladder.** `services/postgresSchema.ts` now holds one consolidated baseline, `pg_baseline_2026_10_typed`, and later changes are appended as new versions after it. Instants are `TIMESTAMPTZ` (`DEFAULT now()`, `NOT NULL` for `created_at`/`updated_at`), billing days (`period_start`, `period_end`) are `DATE`, money is `NUMERIC` (`subscriptions.amount`, plan prices, balances, per-request costs), identifiers use the `vynor_id` domain (`VARCHAR(128)`, `^[A-Za-z0-9_.:-]{1,128}$`), and enums, counters (`>= 0`), billing periods (`period_end >= period_start`) and the e-mail shape carry CHECK constraints. Two unique partial indexes back the application's assumptions (one API-key hash per user, one order per PayHere payment id).
- **Flags and JSON stay as they are on purpose.** Flags remain `SMALLINT` 0/1 with a CHECK because application SQL is shared with SQLite (`enabled = 1`, `COALESCE(x, 0)`, positional literals in INSERTs) and a `BOOLEAN` would need a SQL rewriter whose failure mode is silently letting a suspended user in. JSON-ish text (`details`, `metadata`, `transitions`) stays `TEXT` because the code stores and parses strings, not `jsonb` objects.
- **SQLite is unchanged.** It stays text-based for local development and tests (SQLite has no real date type). `test/schemaParity.test.ts` compares the two schemas and lists every reviewed difference; the baseline records `PG_BASELINE_COVERS_SQLITE_THROUGH`, and any later SQLite migration needs a PostgreSQL twin.
- **Same values on both engines.** `pgDriver.ts` returns `timestamptz` as ISO-8601 UTC strings (`parseTimestamptz`), `DATE` as `YYYY-MM-DD`, `numeric` and safe `int8` as numbers, runs every session in UTC (`-c timezone=UTC`) and translates `CURRENT_TIMESTAMP` to `now()`. Date arithmetic and comparisons therefore happen in the database on real types; the only SQL that had to change was `SUBSTR(created_at, ...)`, now `SUBSTR(CAST(created_at AS TEXT), ...)`.
- **Fail closed on a legacy database.** `applyPostgresMigrations` refuses (`LegacyPostgresSchemaError`, code `PG_LEGACY_SCHEMA`) when `schema_migrations` lists any of the retired ladder's versions (`LEGACY_PG_VERSIONS`) or application tables exist without the baseline version. It never alters such a database.
- **Carry-over.** `services/pgCarryOver.ts` (CLI `src/scripts/carryOver.ts`, operator helper `deploy/typed-db-cutover.sh`, runbook `docs/DB_CUTOVER_RUNBOOK.md`) copies only the kept test account, its active subscriptions and M365 links, the M365 tenants they name and the configuration tables (`provider_api_keys`, `provider_credentials`, `model_registry`, `plan_overrides`, `admin_staff`). The old database is read in a `READ ONLY` transaction, the new one is written in one transaction and must hold no other user data, every conversion is strict (an unreadable date is NULL or drops the row, never guessed), encrypted values are copied byte for byte and the report holds names and counts only.
- **Verification.** The whole backend suite passes on SQLite and on real PostgreSQL 16 (`NODE_ENV=test`, one database per worker, `--test-force-exit`; see the `vynor-postgres-check` skill). Accepted remaining risks: no foreign keys from the `m365_*` ledger tables (rows are tenant-scoped in every query and removed by account deletion), `m365_quota_reservations`/`quota_reservations` have no FK to `users`, JSON text columns are not validated by the database, and `gitWorktreeSandbox.test.ts` needs `git`, which the PostgreSQL test container does not have (it passes locally).

## M365 identity linking and tenant onboarding (2026-10-24)

- Excel proves the Microsoft identity with a validated Entra access token; the VynorAI account is proved separately in a browser session. A short-lived, hashed one-time code joins the two proofs. The code is carried in a URL fragment and session storage so it is not sent in HTTP query logs.
- A disabled or unknown tenant is never auto-created or auto-enabled by a user. The request is recorded as metadata-only `M365_TENANT_ACCESS_REQUESTED`; an administrator must review it, configure consent/scopes, plan and seats, then enable the tenant.
- Admin relinking or disabling an identity changes `linked_via` to `admin`, so self-service ownership history is not misrepresented after an administrative override. Self-service unlinking cannot remove an administrator-disabled link.
- The browser handoff preserves the code through both sign-in and registration. The Excel pane polls only for the bounded lifetime of the code and gives an actionable retry message when the user takes longer.
- **Threat model (self-service linking).** Email is never used to match a Microsoft account to a VynorAI account; the key is the Entra `(tenant id, object id)` pair. The code is 8 symbols from a 32-symbol alphabet without look-alikes (40 bits, CSPRNG), valid 10 minutes, single use, stored only as an HMAC under a key derived from `JWT_SECRET`, so a database copy cannot recover or forge one; a new request replaces the previous code. Whoever redeems a code links the Microsoft account it was created for, so an attacker who sends a victim a code of their own makes the victim link the ATTACKER's Microsoft account to the victim's plan: the confirm step therefore shows the masked name and address of that Microsoft account (`Prasad P. (p***@slts.lk)`, never the raw values) and requires an explicit `confirm: true`. Wrong codes lock the account (5 failures per 15 minutes per account, 20 per address, shared through Redis when available), a code can be previewed 10 times, and every answer for an unknown, malformed or expired code is identical. Only an enabled tenant with a free seat can be joined; an identity linked to another account, or disabled by an administrator, is never re-pointed or re-enabled, and a person can remove only their own enabled link. One VynorAI account may hold at most 3 Microsoft identities (`MAX_IDENTITY_LINKS_PER_USER`) so a single subscription cannot be shared across many people. `/link/start` and `/link/status` accept only an Entra RS256 token (a session token never proves a Microsoft account); the web endpoints accept only a signed-in session, never an API key, and require a verified email. Audit events (`M365_IDENTITY_SELF_LINKED`, `M365_IDENTITY_SELF_UNLINKED`) carry the user id, tenant id and a 16-character hash of the object id, never an email, code or label. Table `m365_link_codes` (migration 042, SQLite and the typed PostgreSQL schema) and `m365_identity_links.linked_via` are additive; expired and consumed codes are swept by the retention job. Tests: `backend/test/m365Linking.test.ts`, `backend/test/m365LinkPage.test.ts`.
- Production verification still requires one real Desktop and one real Web run with the configured Entra tenant, admin consent, tenant policy, seat plan and a verified VynorAI account. Automated tests do not substitute for that tenant-specific smoke test.
