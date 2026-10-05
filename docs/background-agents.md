# VynorAI Background Agents

Status: Proposed — owner approval is required before Phase 1  
Last updated: 2026-10-05  
Owners: VynorAI engineering and operations

## 1. Purpose

Background Agents let a user submit a coding task from the IDE, close the IDE,
and return later to a reviewed patch and a Proof Pack. The service does not
require GitHub. It runs an uploaded, filtered workspace in an isolated gVisor
container, enforces the credit cap accepted by the user, and keeps only the
patch and proof for seven days after deleting the working copy.

This document is the Phase 0 design and approval gate. It defines the system
boundaries, API, data model, sandbox, billing rules, failure handling, privacy
model, test plan, and phased delivery. It does not authorize a production
deployment or any VPS change.

## 2. Product invariants

The implementation must preserve these user-visible guarantees:

1. GitHub is optional and is not part of the task lifecycle.
2. The IDE shows the exact upload list, exclusions, total bytes, estimate, and
   hard cap before the user confirms.
3. A task cannot spend more than the accepted cap. Backend state, never client
   state, is authoritative for billing.
4. A qualifying failed task receives a 50% refund of the credits it actually
   used. Unused held credits are always released.
5. Every terminal result has a Proof Pack. Missing verification is stated; it
   is never converted into a success claim.
6. User source, prompts, patches, and proof data stay inside VynorAI-operated
   infrastructure. Telegram remains admin-only and never carries user data.
7. The workspace is deleted after execution. The user receives a deletion
   receipt, while encrypted patch/proof artifacts expire after seven days.
8. Sinhala prompts are accepted. Human-language summaries use the detected
   task language; code, paths, identifiers, and commands remain unchanged.

## 3. Scope and non-goals

### In scope

- VS Code upload preview, confirmation, `/bg`, task list, cancellation, logs,
  Proof Pack display, notifications, and patch review through the existing
  vertical diff Accept/Reject flow.
- Authenticated backend task APIs, entitlements, durable queueing, task-scoped
  model authentication, billing, retention, and optional Web Push.
- A separately deployable worker, gVisor sandbox launcher, stack detection,
  dependency cache, headless reuse of VynorAI's agent runtime, and Proof Pack.
- Dashboard, pricing, admin overlays, privacy consent, and operational alerts.

### Explicitly out of scope

- GitHub App installation, issue assignment, branches, pull requests, or pushes.
- User-provided secrets, deployment credentials, production access, or MCP
  credentials inside a task container.
- Arbitrary Dockerfiles or container images supplied by a repository.
- Deploying an application from a background task.
- More than two concurrent tasks on the current VPS.
- A fallback from gVisor to the default OCI runtime. If `runsc` is unavailable,
  Background Agents are unavailable.

## 4. Existing VynorAI foundations

The design builds on the current code instead of creating parallel systems:

- `core/agent/TaskRuntime.ts` provides durable task state, bounded steps,
  verification evidence, budgets, resumability, and scoped subagent contracts.
- `core/agent/AgentOrchestrator.ts` provides plan DAG transitions, retries,
  approvals, cancellation, and completion gates.
- `core/agent/autoApproval.ts` is the shared Auto permission classifier.
- `core/agent/VerificationDiscovery.ts` detects package test/typecheck/build
  commands and is reused by the headless runner.
- `core/llm/vynorai-system-prompt.ts` exports the canonical agent prompt. The
  worker must import this source; it must not maintain a second prompt.
- `core/indexing/ignore.ts` and `core/indexing/walkDir.ts` provide nested
  `.gitignore`, `.continueignore`, symlink, and security-ignore behavior.
- `backend/src/services/monthlyQuota.ts` has durable quota holds and stale-hold
  reconciliation from commits `e5df0aa` and later.
- `backend/src/routes/auth.ts` exports `requireAuth` for JWT and IDE API-key
  authentication.
- `backend/src/services/planManager.ts` overlays admin-managed plan fields on
  the built-in definitions.
- `extensions/vscode/src/apply/ApplyManager.ts` and the vertical diff manager
  already provide per-file and per-block Accept/Reject.
- Redis uses AOF in `docker-compose.vps.yml`, but the code has no durable queue
  abstraction yet.

Local commits `e5df0aa` and `800d092` are prerequisites. Phase 1 must not
duplicate or revert their quota and hook fixes.

## 5. Trust boundaries and component architecture

```text
VS Code extension / GUI
  | HTTPS, user API key or JWT
  v
Vynor API (two replicas)
  |-- PostgreSQL: task truth, billing, events, consent, push subscriptions
  |-- Redis AOF: priority queue, claims, heartbeats, SSE notification fan-out
  |-- encrypted artifact store: upload, patch, proof, screenshots
  |
  v
Background worker (separate entrypoint/service)
  |-- claims jobs and coordinates billing/proof
  |-- does NOT receive the user's API key
  |-- does NOT receive a raw Docker socket
  |
  v narrow Unix-socket protocol
Host sandbox launcher (root-owned, allowlisted operations only)
  |
  v
runsc task container
  |-- read-only root, non-root runner and separate command UID
  |-- quota'd workspace, bounded CPU/RAM/PIDs/time
  |-- only the dedicated egress network
  v
L7 allowlist proxy
  |-- package-download hosts, GET/HEAD only
  |-- first-party Vynor model relay only
  v
Public internet / https://vynor.lk/v1/chat/completions
```

The API and PostgreSQL form the control plane. The worker is a replaceable
executor. Redis accelerates dispatch but is not the only task record. A worker
on another VynorAI-owned host can use the same API, queue, and encrypted
artifact contracts without changing the IDE protocol.

### 5.1 Why the worker does not mount `/var/run/docker.sock`

A container with a raw Docker socket can request privileged containers, host
mounts, or the host network. That turns a worker compromise into host-root
access and defeats gVisor as a boundary. The production design therefore uses
a small root-owned launcher on the worker host with a narrow Unix-socket API:

- `start(taskId, imageId, workspacePath, limits, networkId)`
- `signal(taskId, TERM|KILL)`
- `inspect(taskId)`
- `delete(taskId)`

The launcher accepts only server-generated task IDs, pinned image IDs, fixed
mount roots, fixed `runsc` runtime, fixed security flags, and bounded numeric
limits. It rejects arbitrary image names, commands, mounts, networks, devices,
environment variables, labels, and privileged options. Requests are signed by
a worker-local key, replay-protected, length-bounded, and audited without user
content. The worker container can access this launcher socket but not Docker.

## 6. Task lifecycle and state machine

```text
draft estimate
  -> awaiting_upload
  -> queued
  -> claimed
  -> preparing
  -> running
  -> verifying
  -> completed | failed | canceled
  -> purged
```

Rules:

- Only the API creates tasks and credit reservations.
- `awaiting_upload` expires after 30 minutes. Expiry releases the full hold and
  deletes partial upload data.
- Upload completion changes the task to `queued` and inserts it into Redis in
  one recoverable operation. A reconciliation job re-enqueues PostgreSQL rows
  that are queued but absent from Redis.
- A worker claim is a lease, not ownership. It sets `worker_id`, `lease_id`,
  `started_at`, and `heartbeat_at` atomically.
- The worker heartbeats at least every 30 seconds. A running task with no
  heartbeat for five minutes is claimed once by the reconciler, terminated,
  finalized as `failed`, and refunded under the system-failure rule.
- Cancellation is idempotent. Queued tasks leave the queue; running tasks get
  TERM, a 20-second grace period, then KILL. The sandbox and workspace are
  deleted in both paths.
- Terminal transitions and billing finalization use compare-and-set conditions
  so retries cannot settle or refund twice.
- `deleted_at` records workspace deletion. `purged_at` records deletion of the
  retained patch/proof artifacts.

## 7. Upload preparation and privacy boundary

### 7.1 IDE manifest

Before any upload, the extension walks each selected workspace root and creates
a deterministic manifest containing only relative POSIX paths, byte sizes, and
SHA-256 digests. It uses the same nested ignore semantics as the indexer and
adds non-overridable upload exclusions:

- `.git/`, `.env*`, key/certificate/keystore files, credential directories,
  database files, archives, backups, IDE secret state, and all paths for which
  `isSecurityConcern()` returns true;
- every `.gitignore` and `.continueignore` exclusion;
- symlinks, sockets, devices, named pipes, and paths outside the chosen roots;
- dependency/build/cache directories such as `node_modules`, `vendor`,
  `.venv`, `dist`, and `build`.

The preview groups exclusions as ignored, secret/security, generated/vendor,
unsupported type, too large, and changed during packaging. It shows included
file count, included bytes, excluded counts, and the 200 MB server limit.

The extension performs a second stat/digest check while streaming the zip. A
file changed after preview is skipped and reported, not silently uploaded under
the old manifest. The archive contains no absolute paths. It has a versioned
manifest as its first entry.

### 7.2 Server upload handling

- `Content-Length` is required and must be at most 200 MB. The streaming byte
  counter independently enforces the limit.
- Uploads are written directly into authenticated encryption; the API does not
  buffer the zip in RAM or create a plaintext temporary copy.
- Each task receives a random 256-bit data-encryption key. Artifacts use
  AES-256-GCM with task ID, artifact type, and format version as associated
  data. The data key is wrapped by a separate `BG_ARTIFACT_MASTER_KEY`; it does
  not reuse provider-credential key material.
- The uploaded manifest digest must match the estimate quote. The server stores
  only ciphertext, digest, size, and object location.
- Extraction happens in a bounded staging sandbox. It rejects absolute paths,
  `..`, duplicate/case-colliding paths, symlinks, hard links, devices, more
  than 100,000 entries, more than the configured uncompressed limit, or an
  excessive compression ratio. A manifest mismatch fails before agent launch.

Prompt text is encrypted at application level in the `prompt` column. Events
contain redacted summaries and status codes, never source, prompt text, command
environment, or full tool output.

## 8. Durable queue and scheduling

PostgreSQL is authoritative; Redis is the durable dispatch index. Redis AOF
must remain enabled. Queue keys are versioned and namespaced.

- A sorted set stores ready task IDs. The score combines plan priority and
  creation sequence while preserving FIFO inside a tier.
- A Lua claim operation atomically removes one eligible ID, records its lease,
  and adds it to a processing sorted set with lease expiry.
- Pro tasks have normal priority. Ultra/Enterprise tasks have priority without
  preempting a running task.
- `BG_MAX_CONCURRENCY` defaults to `2` and cannot exceed `2` on the current VPS.
  Plan concurrency is enforced independently: Starter 0, Pro 1, Ultra 2.
- Admission also checks host health. A second task remains queued when minimum
  free memory or disk thresholds are not met, even if the configured limit is
  two. Concurrency is a ceiling, not a promise.
- Queue position is an estimate computed from eligible tasks ahead of the user,
  plan priority, running slots, and per-user concurrency.

Redis unavailability disables new task creation with HTTP 503. Background
queueing must not use the in-memory fallback used by ordinary rate limits.

### 8.1 Current VPS resource envelope

The initial host has 4 vCPU, 6 GB RAM, and approximately 81 GB free disk while
also running two 768 MB backend replicas, PostgreSQL, Redis, Caddy, the embedding
service, and backup jobs. Two 1536 MB sandboxes are therefore only a hard
ceiling, not guaranteed capacity. Before each claim, admission control reserves
the next sandbox's worst-case memory plus a protected allowance for existing
services; Phase 5 load tests set the concrete memory and disk thresholds.

The optional 3 GB local SLM profile must remain disabled while background agents
share this host. Enabling it requires moving the worker to another host or
reducing background capacity after a new load test. Workspaces, encrypted
artifacts, logs, and the 20 GB dependency cache have separate quotas. Disk
pressure first evicts unused cache entries, then pauses new admissions; it never
deletes active workspaces or retained user artifacts.

## 9. Worker and sandbox

### 9.1 Worker service

`backend/src/worker/` is a separate TypeScript entrypoint and image/service. It
shares backend domain modules for DB, Redis, quota, routing, PII protection,
and artifact encryption. It does not expose a public port. Its readiness check
requires PostgreSQL, Redis, artifact storage, launcher, `runsc`, and enough
host resources.

The worker performs:

1. Claim and lease a task.
2. Download/decrypt and validate the upload.
3. Detect stack and select a pinned Vynor-owned runner image.
4. Prepare a per-task quota directory and same-user dependency cache mount.
5. Mint a task-scoped model token/relay lease.
6. Ask the host launcher to start the fixed gVisor sandbox.
7. Stream sanitized structured events and heartbeats.
8. Collect patch, proof, screenshots, and usage.
9. Finalize billing exactly once.
10. Delete the workspace and record the deletion receipt.

### 9.2 Stack detection and pinned images

Detection is deterministic:

| Evidence            | Package manager      | Install candidate                                 | Runner image        |
| ------------------- | -------------------- | ------------------------------------------------- | ------------------- |
| `pnpm-lock.yaml`    | pnpm                 | `pnpm install --frozen-lockfile`                  | pinned Node image   |
| `yarn.lock`         | yarn                 | `yarn install --immutable` or v1 frozen mode      | pinned Node image   |
| `package-lock.json` | npm                  | `npm ci`                                          | pinned Node image   |
| `package.json` only | npm                  | no automatic install without lockfile             | pinned Node image   |
| `composer.lock`     | Composer             | `composer install --no-interaction --prefer-dist` | pinned PHP image    |
| `requirements.txt`  | pip                  | hash/constraint-aware install                     | pinned Python image |
| `pyproject.toml`    | detected Python tool | lockfile-specific frozen install                  | pinned Python image |

Multi-stack repositories use one approved composite runner image or fail with
an explicit unsupported-stack result. Repository Dockerfiles are evidence only
and are never built. Images are pinned by digest and scanned before rollout.

### 9.3 Required container controls

Every task is launched with all of these controls; missing support fails closed:

- runtime `runsc`;
- `--memory 1536m --memory-swap 1536m --cpus 1 --pids-limit 512`;
- non-root agent runner UID and a different, less-privileged UID for repository
  commands;
- read-only root filesystem, writable quota'd `/workspace` and bounded tmpfs
  only for `/tmp`, `/run`, and tool scratch data;
- all Linux capabilities dropped, `no-new-privileges`, fixed seccomp/AppArmor
  profiles in addition to gVisor, no devices, no host PID/IPC/UTS namespace;
- no Docker socket, host mounts, SSH agent, cloud metadata, production env
  files, or host credentials;
- no attachment to `vynor-net` or any network containing PostgreSQL, Redis,
  backend replicas, Caddy administration, backup, or embedding services;
- 45-minute absolute deadline enforced by both worker lease and host launcher;
- `BG_TASK_DISK_MB` quota (proposed default 2048 MB), inode limit, output/log
  caps, and immediate cleanup after termination.

### 9.4 Egress control

Task containers attach only to a dedicated per-task egress network. The only
reachable peer is an L7 proxy that is not connected to `vynor-net`. Direct DNS,
raw IP connections, private/link-local/metadata addresses, UDP, listening
ports, and peer-to-peer task traffic are denied.

Allowed third-party destinations are limited to:

- `registry.npmjs.org`
- `repo.packagist.org`
- `packagist.org`
- `pypi.org`
- `files.pythonhosted.org`
- `github.com` only for dependency redirects that terminate at approved
  codeload endpoints
- approved codeload hosts for dependency tarballs only

The proxy permits GET/HEAD package downloads, validates redirects at every hop,
pins resolved public IPs per request, blocks request bodies and uploads, limits
response size/rate, and logs only host, status, bytes, task ID, and timing. A
hostname-only CONNECT proxy is insufficient because it cannot prevent source
exfiltration to writable endpoints on an allowed host; the implementation must
enforce method/path policy at layer 7.

The first-party model channel is a separate control-plane exception. It exposes
only the VynorAI chat-completions relay, never the general website or internal
Docker network. This resolves the requirement that all third-party egress use
the package allowlist while model requests still reach VynorAI.

### 9.5 Task-scoped model authentication

The user's API key never enters the worker or sandbox. The API issues a
short-lived token bound to:

- `aud=background-agent`;
- task ID, user ID, plan ID, worker lease ID, and token ID;
- the chat-completions operation only;
- remaining task cap and expiry no later than the task deadline;
- a server-side revocation/usage record.

The token is held by a worker-side relay. The sandbox runner talks through a
task-local socket; user commands run under a different UID and cannot read the
relay credential. The relay adds the scoped token and sends HTTPS requests to
`/v1/chat/completions`. The normal model router, PII shield, provider accounting,
and request economics remain in the path. Cancel/finalize revokes the token.

The background-auth branch in chat completions rejects all other routes,
models outside the task policy, task mismatches, expired leases, and requests
that would exceed the cap. It never returns a user API key.

## 10. Reusing the headless VynorAI agent

The worker must not implement a second model/tool loop. Phase 2 extracts the
runtime-neutral orchestration currently split between `core/agent/*` and the
GUI thunk into a headless adapter with the same contracts:

- canonical `DEFAULT_AGENT_SYSTEM_MESSAGE`/Vynor agent prompt;
- Auto permission classification;
- judgment level `careful`;
- TaskRuntime and AgentOrchestrator state and loop guards;
- existing read, search, edit, terminal, repo-map, browser, and verification
  implementations behind a sandbox IDE adapter;
- the same secret-path denial and output redaction rules.

Background policy differs only where there is no interactive approval:

- workspace reads, edits, tests, builds, and bounded scripts may run;
- package installation is allowed only through detected lockfiles and the
  egress proxy;
- git push/history rewrite, deploy, sudo, system changes, secret paths,
  out-of-workspace paths, arbitrary network access, and unknown MCP tools are
  disabled, not queued for approval;
- deleting inside `/workspace` is allowed and represented in the patch;
- hitting the credit cap or wall-clock limit produces a truthful partial-work
  summary and no further tool/model calls.

Repository files, install scripts, terminal output, package metadata, web
content, and tests are untrusted evidence. They cannot change policy, request
credentials, broaden egress, or instruct the worker/launcher.

## 11. Dependency cache

The cache key is a hash of user ID, project fingerprint, stack, runner image
digest, package manager version, and lockfile bytes. It never contains the raw
user/project name. Cache entries are private to one user and never shared
between tenants.

- Global maximum is `BG_CACHE_MAX_GB`, default 20 GB.
- Entries have size, last-used time, checksum, image digest, and state in a
  cache index. LRU eviction runs before and after tasks.
- A completed install is staged under a temporary key and atomically promoted.
  Failed, canceled, or over-limit installs never populate the cache.
- The sandbox receives a read-only package-download cache where supported and
  a task-local writable dependency tree. It cannot mutate another task's entry.
- Cache deletion is allowed under disk pressure and never changes task truth.
- Source files, prompts, patches, auth tokens, `.npmrc`, Composer auth, pip
  config, and environment variables are forbidden cache content.

## 12. Proof Pack

The Proof Pack is versioned JSON plus separately encrypted screenshot objects.
It is generated from structured runtime events, not from the final model prose.

```ts
interface BackgroundProofPackV1 {
  version: 1;
  taskId: string;
  status: "completed" | "failed" | "canceled";
  language: "si" | "en" | "other";
  summary: string;
  diff: {
    filesChanged: number;
    additions: number;
    deletions: number;
    newFiles: string[];
    deletedFiles: string[];
  };
  verification: Array<{
    command: string;
    cwd: string;
    exitCode: number | null;
    timedOut: boolean;
    durationMs: number;
    stdoutTail: string;
    stderrTail: string;
    classification: "passed" | "failed" | "baseline_failure" | "skipped";
  }>;
  judgmentReview: string;
  risks: Array<{
    category: "dependency" | "secret" | "debug" | "security" | "behavior";
    severity: "low" | "medium" | "high";
    summary: string;
    files: string[];
  }>;
  screenshots: Array<{
    id: string;
    title: string;
    localUrl: string;
    viewport: string;
  }>;
  unverified: string[];
  billing: {
    estimateCredits: number;
    capCredits: number;
    modelCredits: number;
    computeCredits: number;
    grossUsedCredits: number;
    refundCredits: number;
    netChargedCredits: number;
  };
  deletionReceipt: {
    workspaceDeletedAt: string;
    retainedUntil: string;
    artifactIds: string[];
  };
  startedAt: string;
  finishedAt: string;
}
```

Command tails and judgment output pass through secret and PII redaction and are
bounded. Exact commands and exit codes are immutable event-derived fields. If
tests exist and no applicable verification command passes, the task is failed.
UI changes may include browser screenshots only when a local dev server starts
inside the sandbox; browser navigation outside local origins is denied.

The summary language is determined from the submitted task (`si` for Sinhala,
otherwise the detected language). Language detection influences prose only,
never commands, file paths, identifiers, or security policy.

## 13. Patch format and IDE review

The retained result is an encrypted, versioned patch bundle containing:

- a unified diff for display/export;
- a file manifest with relative path, operation (`modify`, `create`, `delete`),
  upload/base SHA-256, result SHA-256, mode, and byte size;
- full content only for new files and bounded binary files explicitly supported
  by the review UI;
- deletion entries with no content;
- Proof Pack digest and task signature.

The extension validates task ownership, bundle signature, paths, size, and base
digests before opening review. If a local file changed since upload, that file
is marked conflicted and is not applied automatically. Each safe file is sent
through the existing `applyToFile`/vertical diff path so current per-file and
per-block Accept/Reject behavior remains authoritative. Reviewing a patch never
writes it silently.

## 14. Billing, estimates, and entitlements

### 14.1 Plan fields

`PlanDefinition` and the admin overlay gain these fields:

```ts
interface BackgroundEntitlement {
  enabled: boolean;
  tasksPerMonth: number;
  maxConcurrency: number;
  priority: "normal" | "high";
}
```

Defaults:

| Plan                       | Tasks/month | Per-user concurrency | Priority |
| -------------------------- | ----------: | -------------------: | -------- |
| Free / Starter             |           0 |                    0 | none     |
| Pro / Pro aliases          |          20 |                    1 | normal   |
| Ultra / Enterprise aliases |          60 |                    2 | high     |

Aliases must resolve to the same effective entitlement. Admin overrides edit
these fields through `plan_overrides`; pricing, checkout-facing APIs, dashboard,
and enforcement all read `getEffectivePlans()`/`getPlan()`.

### 14.2 Estimate and cap

The server returns a signed estimate quote before task creation. The estimate
uses prompt size, upload bytes/file count, detected stacks, expected agent
rounds, plan model weights, and estimated compute minutes. The response exposes
model, compute, total, suggested cap, minimum cap, maximum cap, quote ID, input
digest, and a short expiry. The estimate is not a promise of exact usage; the
accepted cap is absolute.

Compute pricing is `BG_COMPUTE_CREDITS_PER_HOUR`, default 100,000 credits,
charged per started minute:

```text
computeCredits = ceil(runtimeSeconds / 60)
               * ceil(BG_COMPUTE_CREDITS_PER_HOUR / 60)
```

The UI shows this formula and the 45-minute maximum.

### 14.3 Reservation and settlement

- Task creation atomically checks entitlement, monthly task count, per-user
  concurrency, idempotency key, quote digest, consent, and available credits.
- It creates a durable task-linked quota reservation for the estimate. The
  existing reservation implementation is extended with owner type/reference;
  it is not replaced by a second unrelated credit system.
- Background model requests report usage to the task meter. The meter grows the
  hold atomically when cumulative model plus compute exposure exceeds the
  estimate, but never above the accepted cap.
- The task counts once against the background monthly task entitlement.
  Internal model turns do not separately create user-visible background tasks.
- Final settlement is an idempotent DB transaction that records gross model
  credits, compute credits, refund, net charge, reservation closure, task
  status, and an immutable billing-ledger event.
- If the next model request or compute minute would cross the cap, execution
  stops before spending it and the Proof Pack lists completed and remaining
  work. A cap stop is a truthful partial result, not an infrastructure failure.

### 14.4 Refund rules

Qualifying failure reasons are agent/runtime error, sandbox/worker error,
timeout, stale-worker reconciliation, or no passing verification when tests
exist. Refund:

```text
refundCredits = floor(grossUsedCredits * 0.50)
netChargedCredits = grossUsedCredits - refundCredits
```

Upload failure before execution releases 100% because no task work ran. A user
cancellation releases unused held credits but charges actual model and compute
usage; it does not receive the automatic failure refund. Fraud/admin reversals
are separate ledger reasons. Exactly-once finalization prevents duplicate
refunds after retries or worker restarts.

## 15. Database design

Migrations are append-only and idempotent in both `backend/src/db.ts` and
`backend/src/services/postgresSchema.ts`. SQLite remains supported for local
tests; PostgreSQL remains production truth.

### 15.1 `background_tasks`

Required fields plus operational fields:

```text
id TEXT PRIMARY KEY
user_id TEXT NOT NULL
status TEXT NOT NULL CHECK (...state values...)
prompt TEXT                         -- encrypted payload, nullable after purge
language VARCHAR(16) NOT NULL
project_fingerprint VARCHAR(64) NOT NULL
manifest_digest VARCHAR(64) NOT NULL
estimate_credits BIGINT NOT NULL
cap_credits BIGINT NOT NULL
used_credits BIGINT NOT NULL DEFAULT 0
model_credits BIGINT NOT NULL DEFAULT 0
compute_credits BIGINT NOT NULL DEFAULT 0
refund_credits BIGINT NOT NULL DEFAULT 0
quota_reservation_id TEXT
quote_id TEXT NOT NULL
idempotency_key VARCHAR(128) NOT NULL
priority SMALLINT NOT NULL DEFAULT 0
worker_id TEXT
lease_id TEXT
heartbeat_at TIMESTAMP
queued_at TIMESTAMP
started_at TIMESTAMP
ended_at TIMESTAMP
failure_reason VARCHAR(128)
proof JSON/TEXT
upload_artifact_id TEXT
patch_artifact_id TEXT
proof_artifact_id TEXT
workspace_deleted_at TIMESTAMP
deleted_at TIMESTAMP
purge_after TIMESTAMP
purged_at TIMESTAMP
created_at TIMESTAMP NOT NULL
updated_at TIMESTAMP NOT NULL
UNIQUE(user_id, idempotency_key)
```

Indexes cover `(user_id, created_at)`, `(status, priority, queued_at)`,
`heartbeat_at`, `purge_after`, and monthly entitlement queries.

### 15.2 `background_task_events`

Append-only fields: `id`, `task_id`, monotonic `sequence`, `event_type`,
redacted `message`, bounded JSON `data`, and `created_at`; unique
`(task_id, sequence)`. Users can read only their task's sanitized events.

### 15.3 Supporting tables

- `background_artifacts`: encrypted object metadata, digest, bytes, type,
  wrapped key reference, expiry, and deletion time.
- `background_billing_ledger`: idempotent reserve/top-up/settle/refund events.
- `background_consent`: user ID, policy version, accepted time, client, and IP
  digest. This is separate from sign-up consent so the first background run is
  explicit and auditable.
- `web_push_subscriptions`: user-owned endpoint ciphertext, key ciphertext,
  created/last-used/revoked times. Endpoint and keys are never sent to a task.

Foreign keys use cascade only for events/consents that cannot outlive a user;
billing ledger rows remain audit records under the existing retention policy.

## 16. HTTP API

All endpoints use HTTPS, `requireAuth`, per-user Redis rate limits, ownership
checks, `Cache-Control: no-store`, bounded JSON, and uniform error envelopes.
Task IDs are UUIDs and never authorize access by themselves.

### 16.1 Estimate

`POST /v1/background/tasks/estimate`

Request:

```json
{
  "prompt": "Fix the checkout validation and test it",
  "language": "en",
  "projectFingerprint": "sha256",
  "manifestDigest": "sha256",
  "fileCount": 142,
  "uploadBytes": 1842030,
  "stacks": ["node"],
  "requestedCapCredits": 900000
}
```

Response: signed, expiring quote with itemized estimate, accepted cap bounds,
entitlement summary, and whether explicit background privacy consent is needed.

### 16.2 Create

`POST /v1/background/tasks`

Request includes `quoteId`, `quoteSignature`, accepted `capCredits`, prompt,
language, manifest digest, idempotency key, and current privacy-policy version.
The API verifies the quote/input digest and creates the reservation and task.

Response:

```json
{
  "taskId": "uuid",
  "uploadUrl": "/v1/background/tasks/uuid/upload",
  "estimate": {
    "modelCredits": 500000,
    "computeCredits": 50000,
    "totalCredits": 550000,
    "capCredits": 900000
  },
  "uploadExpiresAt": "ISO-8601"
}
```

### 16.3 Upload

`PUT /v1/background/tasks/:id/upload`

Body is `application/zip`. It is accepted only once while the task is
`awaiting_upload`. The response confirms encrypted bytes, digest, queued state,
and estimated queue position. Retry with the same digest is idempotent; a
different digest is rejected.

### 16.4 List and detail

- `GET /v1/background/tasks?cursor=&status=&limit=` returns owner-scoped task
  summaries, queue position, proof headline, billing summary, and expiry.
- `GET /v1/background/tasks/:id?afterSequence=` returns status, queue position,
  bounded log tail/events, proof when terminal, deletion receipt, and patch
  availability.
- `GET /v1/background/tasks/:id/events` is an SSE stream with event IDs and
  heartbeat comments. The IDE reconnects with `Last-Event-ID`; polling detail
  is the fallback.

### 16.5 Cancel, patch, and purge

- `POST /v1/background/tasks/:id/cancel` is idempotent and returns the current
  state plus whether a running sandbox was signaled.
- `GET /v1/background/tasks/:id/patch` streams the encrypted-at-rest patch
  bundle after ownership and expiry checks. It supports ETag/range but never
  shared caching.
- `DELETE /v1/background/tasks/:id` cancels if needed, purges upload/workspace/
  patch/proof/screenshots, redacts prompt/proof columns, records the receipt,
  and retains only minimal billing/audit metadata required by law and fraud
  controls. Repeated deletion returns the same receipt.

### 16.6 Internal worker API

Internal calls use worker identity/mTLS or a rotated worker service token and
are not exposed through the public Caddy route:

- claim/renew/release lease;
- fetch encrypted artifact with one-time capability;
- append bounded events/heartbeat;
- request/revoke task model token;
- report usage and request cap top-up;
- upload patch/proof and finalize task.

## 17. Notifications

### IDE

The extension keeps SSE while open and falls back to bounded polling. A terminal
event triggers a VS Code notification containing status, passed/total checks,
and the highest risk only. `Review Changes` opens the task and downloads the
patch. Notification text contains no source or prompt.

### Dashboard

The authenticated dashboard lists the user's own tasks and provides mobile
status, Proof Pack, billing, deletion receipt, cancel, review/download, and
purge actions. Raw source is never rendered into unauthenticated HTML.

### Web Push

Web Push is opt-in and uses VAPID keys from environment secrets. The payload is
limited to task ID, status, a short generic title, and an authenticated dashboard
link. It contains no source, prompt, paths, logs, diff, test command, or risk
details. Invalid subscriptions are revoked. Telegram is never a user channel.

## 18. Retention and deletion

- Plaintext workspace exists only inside the task quota directory from staging
  through patch creation.
- Workspace and plaintext extraction are deleted immediately after terminal
  handling, including cancel, timeout, launcher failure, and worker restart
  recovery.
- Upload ciphertext is deleted after extraction/terminal handling.
- Patch, Proof Pack, and screenshots are encrypted and retained for seven days
  unless the user purges earlier.
- The daily retention job purges expired artifacts using idempotent claims and
  records `purged_at`. A failed purge is alerted and retried.
- The deletion receipt lists artifact classes and timestamps but no paths or
  source hashes that would expose repository details.
- Logs follow existing operational retention and contain metadata only.

Before Phase 4 release, `backend/public/privacy.html` gains a Background Tasks
section and `PRIVACY_POLICY_VERSION` is bumped. The first run under each new
background-processing policy version requires explicit consent.

## 19. Threat model

| Threat                           | Attack path                                                   | Required mitigation                                                                                                  | Verification                                               |
| -------------------------------- | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Prompt injection from repository | README/comment tells agent to reveal secrets or change policy | Treat repo as data; fixed system policy; no user secrets; unknown/network/admin tools disabled                       | Adversarial repos attempt policy override and exfiltration |
| Source exfiltration              | Test/install script uploads code to an allowed host           | L7 GET/HEAD-only proxy, no request bodies, redirect/IP checks, command UID cannot access model credential            | Attempt POST/PUT/DNS/private-IP and allowed-host upload    |
| Container escape                 | Kernel/runtime exploit or unsafe Docker options               | gVisor required, pinned images, dropped caps, no-new-privileges, fixed profiles, narrow launcher, no Docker socket   | Launcher fuzzing, forbidden option tests, escape checklist |
| Production DB/Redis access       | Sandbox reaches `vynor-net` or host gateway                   | Per-task egress-only network, firewall deny private/link-local ranges, no internal DNS                               | Network scans from real runsc sandbox                      |
| Resource exhaustion              | Fork bomb, disk fill, log flood, decompression bomb           | CPU/RAM/PID/time/disk/inode/output limits; archive preflight; host admission control                                 | Stress fixtures and two-task load test                     |
| Cost abuse                       | Many tasks, replayed create, model loop, token theft          | Plan/month limits, idempotency, durable reservation, cap before dispatch, scoped relay token, repeated-action limits | Concurrent/replay/cap race tests                           |
| Cross-tenant artifact access     | Guess task ID or poison shared cache                          | Ownership checks, encrypted per-task artifacts, user-scoped cache keys, signed bundles                               | Two-user authorization matrix                              |
| Zip slip/archive bomb            | Malicious paths, links, huge ratio                            | Safe extractor, path normalization, entry/uncompressed/ratio limits, no links/devices                                | Malicious archive corpus                                   |
| Secret upload                    | Ignored or disguised key enters archive                       | Non-overridable security ignores, content scanner, manifest preview, server scan; fail/omit before agent             | Seeded secret canary suite                                 |
| Task token theft                 | Repo process reads token and spends elsewhere                 | Worker relay holds token; separate command UID; exact audience/task/route/cap/expiry; revoke on finish               | `/proc`, env, route misuse, replay tests                   |
| Patch overwrite of user work     | Workspace changed while task ran                              | Base digest per file; conflicts require manual resolution; vertical diff review                                      | Modify local file before review                            |
| Billing double settle/refund     | API/worker restart repeats finalization                       | DB transaction, unique ledger idempotency key, compare-and-set terminal transition                                   | Crash at every settlement boundary                         |
| Stale worker                     | Worker dies with a running task                               | 30s heartbeat, 5m reconciler, launcher kill, one-time failure/refund, deletion retry                                 | Kill worker/container during each phase                    |
| Malicious dependency cache       | Failed/poisoned task seeds cache                              | Same-user scope, lock/image/version key, atomic promotion only after successful install                              | Cache collision and partial-write tests                    |
| Sensitive notifications          | Push/Telegram includes code or prompt                         | Fixed metadata-only schemas; Telegram admin alerts contain counts/status only                                        | Payload snapshot and canary tests                          |

Residual risk: gVisor and the launcher reduce but do not eliminate same-host
risk. A separate worker VPS is the preferred production evolution. The
architecture keeps worker state and APIs separable so migration does not alter
the IDE or billing contracts.

## 20. Failure policy

| Failure point                            | Task result                                                 | Billing                                    | Data action                       |
| ---------------------------------------- | ----------------------------------------------------------- | ------------------------------------------ | --------------------------------- |
| Estimate/create rejected                 | no task                                                     | no charge                                  | no artifact                       |
| Upload expires/fails                     | failed before run                                           | full hold release                          | partial ciphertext deleted        |
| Queue/Redis unavailable                  | creation 503 or remains queued                              | hold retained only within upload/queue TTL | reconciler resolves               |
| Install unsupported/fails                | failed                                                      | 50% used-credit refund                     | workspace deleted, proof retained |
| Agent/runtime/launcher error             | failed                                                      | 50% refund                                 | terminate and delete              |
| No passing verification when tests exist | failed                                                      | 50% refund                                 | patch/proof retained for review   |
| Cap reached                              | completed-partial or failed if required verification absent | actual usage, no overspend                 | proof lists remaining work        |
| 45-minute timeout/stale heartbeat        | failed                                                      | 50% refund                                 | kill, delete, reconcile           |
| User cancel                              | canceled                                                    | actual usage, no failure refund            | kill and delete                   |
| Artifact purge failure                   | terminal state unchanged                                    | unchanged                                  | retry and admin alert             |

## 21. Observability and admin-only alerts

Metrics contain IDs/counts/timings, never prompt/source/diff/tool output:

- queue depth/age by tier, claim latency, active slots, heartbeat age;
- sandbox starts/failures/exit reasons and launcher denials;
- task duration, verification pass rate, cap-stop rate, failure/refund rate;
- model/compute/net credits, estimate error, settlement/reconcile count;
- upload bytes, artifact bytes, cache hit/size/evictions, purge lag;
- API latency/error rate and SSE connections.

`deploy/watchdog.sh` Phase 5 checks worker readiness, queue depth threshold,
stale tasks, launcher/runsc errors, disk/cache pressure, and purge backlog.
Telegram messages are fixed templates with service name, counts, status codes,
and task IDs only; they never contain user ID/email, prompt, code, filenames,
logs, proof, or diff.

## 22. Configuration

Proposed environment variables (secrets stay in root-only production env files):

```text
BG_ENABLED=false
BG_MAX_CONCURRENCY=2
BG_TASK_TIMEOUT_MINUTES=45
BG_TASK_MEMORY_MB=1536
BG_TASK_CPUS=1
BG_TASK_PIDS=512
BG_TASK_DISK_MB=2048
BG_UPLOAD_MAX_MB=200
BG_ARTIFACT_RETENTION_DAYS=7
BG_CACHE_MAX_GB=20
BG_COMPUTE_CREDITS_PER_HOUR=100000
BG_STALE_HEARTBEAT_SECONDS=300
BG_ARTIFACT_MASTER_KEY=<secret>
BG_WORKER_SERVICE_TOKEN=<secret or mTLS configuration>
BG_VAPID_PUBLIC_KEY=<phase 4>
BG_VAPID_PRIVATE_KEY=<phase 4 secret>
BG_VAPID_SUBJECT=mailto:support@vynor.lk
```

Resource/security limits are server maxima. Admin plan overlays may only reduce
per-plan access; they cannot raise host safety limits beyond environment policy.

## 23. Delivery phases and gates

### Phase 0 — design

- This document reviewed and approved by the owner.
- Resolve open approval questions in Section 26.
- No production or VPS change.

### Phase 1 — data, API, queue, entitlements, billing

- Non-destructive SQLite/PostgreSQL migrations.
- Estimate/create/upload/list/detail/cancel/patch/delete API contracts.
- Redis durable queue/reconcile, plan overlay, cap accounting, 50% refund.
- Unit, concurrency, auth, idempotency, and migration tests.
- Feature remains disabled by default.

### Phase 2 — worker and sandbox

- Worker entrypoint/image, launcher, runsc profiles, L7 proxy, stack detection,
  user-scoped cache, headless core adapter, Proof Pack, deletion receipt.
- Real runsc integration tests for a sample Node project and sample Laravel
  project. If `runsc` is unavailable in CI/dev, tests are skipped with an
  explicit unverified gate; release requires evidence from the target host.

### Phase 3 — extension and GUI

- Upload manifest preview and confirmation, `/bg`, action beside Send.
- Task states, queue position, SSE/log tail, Cancel/View Proof.
- Signed patch validation and existing vertical diff review.
- Vitest and extension integration coverage.

### Phase 4 — notifications, dashboard, push, privacy, pricing/admin

- IDE completion notifications and Review Changes action.
- Authenticated mobile dashboard task pages.
- Opt-in VAPID Web Push with metadata-only payloads.
- Privacy policy/version/first-run consent.
- Pricing and admin overlay fields kept in sync.

### Phase 5 — hardening and operations

- Admin-only watchdog alerts.
- Security checklist and malicious fixture corpus.
- Two-task load test while both production backend replicas, PostgreSQL, Redis,
  embedding service, backup, and Caddy remain healthy.
- Release requires no OOM and no material p95 backend latency regression. The
  numeric p95 threshold is captured from a pre-test baseline and approved
  before the load test.

Every phase runs the relevant focused tests plus all four TypeScript checks.
Final release gates include GUI Vitest, core agent/tools/indexing/util/llm tests,
backend security tests, archive adversarial tests, billing race tests, and real
gVisor integration tests. Known Windows-only path failures are reported, never
hidden as passes.

## 24. Rollout and rollback

- All paths are behind `BG_ENABLED=false` and an internal-user allowlist.
- Rollout: internal owner account, then 5%, 25%, 50%, 100% of entitled users.
- Auto-pause when worker readiness, stale-task, sandbox-failure, billing
  reconcile, secret-canary, deletion SLA, OOM, or API latency thresholds fail.
- API deploy rollback routes back to the previous image. DB migrations are
  additive and remain compatible.
- Worker rollback stops new claims, lets safe tasks finish within the deadline,
  then starts the prior worker image. Leases make interrupted tasks recoverable.
- Security-policy or runsc failure disables task admission; it never falls back
  to a weaker runtime/network mode.

## 25. Required implementation file map

Expected additions/changes after approval:

```text
backend/src/routes/background.ts
backend/src/services/background/*
backend/src/worker/*
backend/src/db.ts
backend/src/services/postgresSchema.ts
backend/src/config.ts
backend/src/services/planManager.ts
backend/src/services/monthlyQuota.ts
backend/src/routes/proxy.ts
backend/src/index.ts
backend/public/{index,admin,privacy}.html
core/agent/headless/*
core/indexing/ignore.ts
core/protocol/*
gui/src/components/BackgroundMode/*
gui/src/redux/*
extensions/vscode/src/background/*
extensions/vscode/src/extension/VsCodeMessenger.ts
docker-compose.vps.yml
deploy/watchdog.sh
deploy/background/*
```

The exact split may change during implementation, but the trust boundaries and
single-source requirements in this document do not.

## 26. Owner approval decisions

Phase 1 must not start until the owner approves this document and these defaults:

1. Use a root-owned narrow sandbox launcher; never mount the raw Docker socket
   into the worker container.
2. Use a dedicated L7 egress proxy and separate first-party model relay, with
   no sandbox attachment to `vynor-net`.
3. Default per-task disk quota to 2 GB (`BG_TASK_DISK_MB=2048`).
4. Store prompt/upload/patch/proof encrypted at rest under a dedicated
   Background Agents master key and retain patch/proof for seven days.
5. Charge user-canceled tasks for actual usage without the 50% failure refund;
   apply the refund only to the qualifying failures in Section 14.4.
6. Treat a task with detected tests but no passing verification as failed even
   when it produced a reviewable patch.
7. Count one created Background Agent task against the plan's monthly task
   allowance; internal model rounds do not consume extra background-task slots.
8. Add the estimate endpoint before create so the user can confirm an
   authoritative server quote before any upload or reservation.

Approval authorizes Phase 1 repository changes only. Git push, backend deploy,
VPS/runsc/proxy changes, extension build/release, and production DB writes each
remain separate approval gates.
