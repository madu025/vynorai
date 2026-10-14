# Background hardening evidence — 2026-10-14

This is a real production smoke record. No mock model, local proxy, or skipped
production run was used.

## Environment

- Endpoint: `https://vynor.lk`
- Backend commit: `005985f`
- Runner: gVisor `runsc`, production `vynor-background-runner:local`
- Account: the git-ignored E2E testing account (`VYNORAI_E2E_API_KEY`)

## Results

| Check                                   | Result       | Evidence                                                                                                               |
| --------------------------------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------- |
| Real single background task             | Passed       | Task reached `completed`; Proof Pack present; model and compute credits recorded                                       |
| Staging deletion after terminal task    | Passed       | VPS staging root contained zero entries after completion                                                               |
| Real model relay through sandbox egress | Passed       | The completed Proof Pack recorded model credits; task events were `created`, `queued`, `running`, `completed`          |
| Plan concurrency guard                  | Passed       | A second real task creation returned `BACKGROUND_CONCURRENCY_LIMIT`; the first task was canceled by test cleanup       |
| Two-task host load                      | Not promoted | The E2E account is limited to one concurrent background task; a second entitled real account is required for this gate |

The concurrency rejection is expected entitlement behavior, not a sandbox
failure. The two-task host-load gate remains open until an approved test account
with a two-task entitlement is available.
