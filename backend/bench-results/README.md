# Benchmark results

`node scripts/bench/run.mjs --suite=evidence --selfcheck` validates the 12-task
completion-evidence pilot without a model call. Live evidence runs write a schema-versioned manifest
with fixture/scorer hashes and classify invalid harness/provider runs separately from product failures.
The pilot validates the scorer only; it is not a quality or rollout result.

`evidence-live-baseline-2026-10-13.md` records the first paired real-VSIX
current-control pilot: 12/12 primary, 12/12 repeat, zero paired flips, and
response-level provider/model provenance. The larger 52-task decision corpus
and a dedicated high-risk approval scenario remain promotion work.

`evidence-live-contract-2026-10-14.md` records the first packaged completion-
contract smoke proof: one fresh-profile simple edit, 2/2 fresh criterion
receipts, and a completed task on the real model. It is lifecycle evidence,
not a promotion benchmark.

`evidence-live-lifecycle-2026-10-14.md` records released `1.2.61` startup,
upgrade to the local `1.2.66` candidate, and downgrade back to `1.2.61` in
real VS Code sessions. Offline behavior and a released `1.2.66` contract run
remain separate gates.

`evidence-live-contract-quality-2026-10-14.md` records the real
simple/medium/complex scope and evidence-floor sample, including the corrected
authorization-scope case.

`verification-planner-2026-10-14.md` records the deterministic planner matrix
and the individual live scope runs; it is not a population benchmark.

For a real-VSIX control run, prepare one isolated fixture with
`node scripts/bench/evidence-live.mjs prepare <task-id> <run-dir>`, run the
packaged `LargeTask.test.js` against that directory, then run
`node scripts/bench/evidence-live.mjs score <run-dir>`. The score stores only
an answer digest, not model reply text. A driver crash or missing result is
`invalid_run`; a completed driver time limit is `budget_or_timeout` rather
than a product failure.

`baseline-2026-10-10.*`: first full run of `vynorai-bench-v1` (40 tasks, 2 runs each) against the production proxy before the Sinhala edit-tool fix and the scorer fix for "næthæ".

Re-run with `node scripts/bench/run.mjs --runs=2` (key in `VYNORAI_E2E_API_KEY`). A change to prompts, tools or routing is accepted with a before and after report.

`after-fix-2026-10-11.*`: the same suite against the deployed backend (f47bc87), 78 of 80 runs. Sinhala 7 of 8 (was 4 of 8). The 2 failures were scorer misses ("නොමැත", "na"). Reading the answers, both were correct (the file does not exist / the section is absent), so they were scorer misses; the scorer now accepts those wordings. A fresh run has not yet confirmed 80 of 80.
