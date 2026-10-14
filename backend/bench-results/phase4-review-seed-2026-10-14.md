# Phase 4 independent-review seed measurement

Date: 2026-10-14
Candidate: local VSIX 1.2.66
Model path: production proxy and real routed model through VS Code

This is an initial seeded measurement, not yet the Phase 4 promotion gate. The
reviewer is the existing separate read-only side-review call; no implementation
or merge authority is granted to it.

| Seed                      | Expected review                          | Real result                                                                                          | Receipt/result                                     |
| ------------------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `ev-complex-auth`         | blocking auth/API boundary defects       | Reviewer identified authorization ambiguity, missing happy-path coverage and malformed-role coverage | `verifying`, review `failed`                       |
| `ev-complex-cross-file`   | blocking quantity/atomicity/test defects | Reviewer identified negative-quantity, concurrency and missing-test gaps                             | `verifying`, review `failed`                       |
| `phase4-clean-auth-tests` | clean patch should be clear              | Reviewer returned no blocking finding after focused auth tests were added                            | `completed`, review `passed`; real E2E `1 passing` |

The clean control used a fresh temporary workspace and a real Agent-mode run. It
was classified `complex`, changed the implementation/test surface, ran the
existing `node test.mjs` command, and produced a passed review receipt for every
criterion. The two defect seeds remained unverified instead of receiving a green
completion, showing the intended safety direction.

Observed live cost/latency samples were retained only in local run journals:
clean control 51,515 credits / 85 seconds; auth defect 16,176 credits / 56
seconds; cross-file defect 21,951 credits / 54 seconds. These are seed-run
observations, not rollout savings or population estimates.

## Remaining Phase 4 gate work

The current seed count is 2/2 known blocking defects caught and 1/1 clean control
clear. A larger blinded balanced set is still required to measure recall, clean
false-block rate, warning inflation, reviewer failure/timeout and incremental
cost/latency before Phase 4 can be marked complete. No release, push or deploy was
performed.
