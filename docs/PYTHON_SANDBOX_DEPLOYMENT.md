# Python sandbox deployment requirements

Status: **no live sandbox exists.** The repository contains the job contract, the API, the ledger and the fail-closed dispatch boundary only. Until an administrator provisions the worker below and registers its adapter (`registerSandboxWorker` in `backend/src/services/m365Sandbox.ts`), every Python request returns `SANDBOX_UNAVAILABLE` and nothing runs. Formulas, PivotTables and the built-in local analytics remain the supported path.

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
| Separate worker host            | A dedicated VPS or container host with no shared filesystem, database or secrets with the API. The API reaches it only through the adapter.                                          |
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

The adapter implements `SandboxWorker.dispatch(job)` and `SandboxWorker.cancel(jobId)`. A result is accepted only in the strict result-only shape: up to five tables of 1,000 rows by 50 columns, scalar metrics and short notes, within 1 MB. Anything else fails the job with `SANDBOX_RUN_FAILED`.

## Not yet provided

- The worker, the queue and the adapter.
- A worker-authenticated callback endpoint. Results currently enter only through the in-process functions above, so a remote worker needs its own authenticated channel before it can be wired in.
- A scheduled call to `sweepSandboxJobs`.
- A pane flow for approving a Python job.
