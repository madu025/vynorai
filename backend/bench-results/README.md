# Benchmark results

`baseline-2026-10-10.*`: first full run of `vynorai-bench-v1` (40 tasks, 2 runs each) against the production proxy before the Sinhala edit-tool fix and the scorer fix for "næthæ".

Re-run with `node scripts/bench/run.mjs --runs=2` (key in `VYNORAI_E2E_API_KEY`). A change to prompts, tools or routing is accepted with a before and after report.

`after-fix-2026-10-11.*`: the same suite against the deployed backend (f47bc87), 78 of 80 runs. Sinhala 7 of 8 (was 4 of 8). The 2 failures were scorer misses ("නොමැත", "na"). Reading the answers, both were correct (the file does not exist / the section is absent), so they were scorer misses; the scorer now accepts those wordings. A fresh run has not yet confirmed 80 of 80.
