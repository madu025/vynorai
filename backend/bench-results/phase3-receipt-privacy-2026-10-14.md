# Phase 3 receipt, privacy and truthful-completion evidence

Date: 2026-10-14
Candidate: local VSIX 1.2.66
Candidate SHA-256: `1b31585a78cee9b57604cb1be8ed978070608b92286af83da7c2a60f9b093379`

## Gate result

Phase 3 is complete for progression to the independent-review work in Phase 4. The
receipt path was exercised through the real VS Code extension and the production model
endpoint. The test matrix below keeps product failures as failures; it does not turn a
blocked or skipped criterion into a green completion.

## Real VS Code evidence

| Path                | Evidence                                                                                                  | Result                                                                                                                       |
| ------------------- | --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Pass                | 12-fixture live sample, including simple/medium and successful changed-file tasks                         | Passed rows retain fresh evidence and scorer outcome                                                                         |
| Failed / blocked    | Browser-unavailable, no-test and independent-review failure fixtures                                      | Remained `verifying`/blocked; no false green completion                                                                      |
| Stale               | Live stale-edit fixture plus TaskRuntime generation tests                                                 | Old evidence rejected after mutation                                                                                         |
| Explicit skip       | `extensions/vscode/e2e/tests/ReceiptDecision.test.ts`, production key/model, `ev-browser-blocked` fixture | 1 passing; all 3 criteria recorded `user_skipped`; task remained `verifying`                                                 |
| Cancel              | `extensions/vscode/e2e/tests/Smart.test.ts` stop path                                                     | Real VS Code stop/cancel passed; cancellation receipt was not treated as success                                             |
| Restart / rewind    | `extensions/vscode/e2e/tests/ContractLifecycle.test.ts`                                                   | Contract survived compaction, Developer Reload Window and `/rewind chat`                                                     |
| Offline / reconnect | `extensions/vscode/e2e/tests/OfflineRecovery.test.ts`                                                     | 1 passing; loopback failure showed a network error with no receipt, production endpoint then recovered with a fresh response |

The explicit-skip run used the normal Agent Control Center controls, approved the
real tool calls, waited for the stream to stop, and then recorded each user decision
through the existing IPC request. The browser confirmation was answered explicitly by
the test so that a native-dialog default dismissal could not create a false negative.

## Privacy and egress review

- `TaskRuntime.vitest.ts` verifies journal redaction and that receipt/decision data is
  local task state; raw prompts and tool arguments are not persisted as receipt content.
- `AgentControlCenter.test.tsx` verifies receipt rendering, cancellation error handling,
  and confirmation before `user_skipped` is recorded.
- The task-outcome/analytics paths use counts and stable enums. Receipt criteria,
  statements, tool output and changed-file content are not sent as outcome telemetry.
- No production deployment, release, push, or external receipt export was performed.

## Remaining boundary

This is a VS Code/local-profile privacy proof plus deterministic redaction/egress
assertions; it is not a packet-capture audit of every provider request. Phase 4 still
needs blinded seeded review precision/recall evidence, and Phase 5 still needs the
paired A/B rollout audit and explicit release approval.
