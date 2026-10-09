---
name: vynor-review-fix
description: Run a code review on recent VynorAI changes and fix every real finding with a regression test. Use after a batch of features, before a release, or when asked to review and fix errors.
---

# Review, then fix

1. Review the range since the last released commit: `/code-review high <from>..HEAD` (or the `code-review` skill with that argument).
2. Triage each finding against the code: confirm it is real (re-read the lines), note the ones that are design trade-offs (say so, do not silently skip).
3. Fix in order of severity (security and data loss first):
   - one root-cause fix per finding, no symptom patches;
   - a regression test that fails before the fix and passes after (put it in a new `*.review.vitest.ts` next to the code if the original test file should stay untouched);
   - never weaken or delete an existing assertion.
4. Run tsc in the four packages and the touched vitest files; compare with the baseline.
5. Search for sibling bugs of the same shape (the review of `permissionRules` found bypasses of one kind; check the other matchers too).
6. If a failure shows up that you did not cause (for example a test that depends on the time of day), prove it (run it on its own, read the failing assertion) and report it instead of changing the test.
7. Then run the `vynor-live-verify` skill on a built VSIX: a review fix is not done until the extension still starts and the E2E tests pass.

Report: finding -> fix (file:line) -> test added -> verification, plus findings left open and why.
