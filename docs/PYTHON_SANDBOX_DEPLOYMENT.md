# Python sandbox deployment requirements

Status: **adapter implemented; worker infrastructure remains external.** The repository contains the job contract,
API, ledger, fail-closed dispatch boundary and an HTTPS worker adapter
(`backend/src/services/m365SandboxWorker.ts`). It registers automatically only when
`M365_SANDBOX_WORKER_URL` and `M365_SANDBOX_WORKER_SECRET` are both configured. Without both, every Python
request returns `SANDBOX_UNAVAILABLE` and nothing runs. Formulas, PivotTables and the built-in local analytics
remain the supported path.

## What the API guarantees today

- A job holds a masked, bounded table copy and a script. It holds no workbook handle, no Microsoft Graph or Entra token, no shell command and no network switch (`network` must be `false`).
- Dispatch needs a single-use approval bound to the exact input, tenant and user. No approval, no dispatch.
- Jobs are owned by tenant and user. Another tenant or user sees `404`.
- Per user: one active job and 20 jobs per hour. Per tenant: five active jobs. Jobs expire after 15 minutes.
- The database stores job metadata and, for a finished job, the bounded result until it expires. It never stores the script or the input table.
- Audit events record codes, states and counts only.

## Components an administrator must provide

| Requirement                     | Detail                                                                                                                                                                               |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Separate worker host            | A dedicated VPS or container host with no shared filesystem, database or secrets with the API. The API reaches it only through the HTTPS adapter.                                    |
| Per-job ephemeral isolation     | A fresh container or microVM per job, destroyed after the job, with a read-only root filesystem and a small tmpfs scratch area.                                                      |
| Non-root execution              | Unprivileged user, all capabilities dropped, `no-new-privileges`, a seccomp profile, no privileged mode.                                                                             |
| No host mounts                  | No bind mounts, no Docker socket, no cloud metadata endpoint reachable.                                                                                                              |
| Network off by default          | No network namespace connectivity during execution. Package installation never happens at run time.                                                                                  |
| Resource limits                 | CPU, memory, disk, process count and wall-clock time per job, at or below the contract limits (60 s). Killed on breach.                                                              |
| Encrypted short-lived artifacts | Job input and result are encrypted at rest and in transit, kept only until the job's expiry, then deleted.                                                                           |
| Image pinning and scanning      | A pinned image digest with a fixed library set (for example pandas, numpy, statsmodels), rebuilt on a schedule and scanned for vulnerabilities before use.                           |
| Queue isolation                 | A queue authenticated per environment; one tenant's jobs are never visible to another. The worker reports results only for jobs it was handed.                                       |
| Audit, cancellation and cleanup | The adapter implements `cancel(jobId)`, reports `running` and the result through `markSandboxJobRunning` and `completeSandboxJob`, and runs a periodic cleanup (`sweepSandboxJobs`). |

## Adapter contract

The adapter implements `SandboxWorker.dispatch(job)` and `SandboxWorker.cancel(jobId)`. It sends a JSON envelope to
the configured HTTPS URL with the contract version, job id, tenant/object binding, masked bounded rows, script and
`network:false`. The body is authenticated with `HMAC-SHA256(timestamp + "." + body)` in
`x-vynorai-worker-signature`; the worker must reject timestamps older than 90 seconds, invalid HMACs, replayed job
ids and any request that tries to enable networking. The worker must authenticate its response with the same
timestamp/HMAC headers; the API rejects an unsigned, stale or mismatched response before parsing it. No Microsoft
token is sent. The API bounds the response body before parsing it and accepts only a matching job id and the strict result-only shape: up to five tables of 1,000
rows by 50 columns, scalar metrics and short notes, within 1 MB. Anything else fails the job with
`SANDBOX_RUN_FAILED`.

Each dispatch also contains a fresh adapter-generated `requestId`, which the worker must echo in its response
alongside the job id. This prevents a valid response for an earlier dispatch from being accepted for a later
attempt on the same job.

Cancellation uses the same authenticated endpoint with a separate
`{ type: "cancel", requestId, jobId, requestedAt }` envelope. It contains no script, rows, workbook handle or token.
The worker must return an authenticated `cancel-result` for the same job id with `accepted`,
`already_finished` or `not_found`. Local cancellation remains authoritative if the worker is unreachable;
the worker's own wall-clock limit remains the final safety boundary.

## Not yet provided

- The isolated worker, queue, image, deployment and secret rotation. The API adapter is present but remains
  unavailable until the endpoint is provisioned.
- A separate callback/queue mode. The first adapter intentionally waits for the bounded worker response, so it does
  not invent asynchronous completion semantics.
- A pane flow for approving a Python job.
