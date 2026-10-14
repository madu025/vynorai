# Verification planner gate evidence — 2026-10-14

The deterministic planner suite passed 8 tests, including repository-declared
script selection, malformed manifests, distinct multi-root IDs, adversarial
script filtering, criterion linking, no-command blocking, UI/high-risk impact
floors and unresolved independent review. No command is invented from script
bodies, and every selected command remains approval-required.

The same canonical local VSIX was exercised against the production model in
the 12-fixture contract-quality sample. For the corrected final labels, the
individual finished-run envelopes were:

| Scope   | Finished runs | Median wall time / credits | Maximum wall time / credits | Outcome note                                              |
| ------- | ------------: | -------------------------: | --------------------------: | --------------------------------------------------------- |
| simple  |             7 |               29 s / 4,255 |               44 s / 10,972 | Five green, two truthful blocked/product-failure receipts |
| medium  |             3 |              46 s / 10,890 |               58 s / 16,081 | Three green                                               |
| complex |             2 |              54 s / 14,907 |               58 s / 21,951 | Both held in `verifying` after independent-review failure |

The corrected candidate's paired simple/medium/complex repeat (boundary,
API, auth) held the selected scope stable in 3/3 runs. The simple/medium
successful runs linked fresh evidence; complex runs did not become green. The
live `ev-medium-stale-test` and `ev-rewind-stale` cases also exercised a final
mutation followed by fresh verification, while the deterministic TaskRuntime
stale-generation tests reject old evidence. These are measured pilot
envelopes, not rollout savings claims.

Phase 2 gate status: the policy matrix, multi-root/cwd and adversarial script
tests passed; no command was invented; stale evidence was rejected after
mutation; and scope-specific individual/max ceilings are recorded above.
Broader decision-corpus A/B measurement belongs to Phase 5, not this planner
gate.
