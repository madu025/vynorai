# Phase 4 independent-review live measurement

Date: 2026-10-14T05:27:29.723Z
Model: vynor-auto
Backend: https://vynor.lk
Repository commit: f64ffe6589ee6ccddd25c741613b76d52fde2d6d

This report retains digests and aggregate reviewer outcomes only; review text and fixture source are not stored.

| Fixture                        | Family     | Expected finding | Finding | Classification | Latency | Total tokens |
| ------------------------------ | ---------- | ---------------: | ------: | -------------- | ------: | -----------: |
| clean-validation               | clean      |               no |      no | true_negative  | 1234 ms |            0 |
| clean-api-export               | clean      |               no |      no | true_negative  | 1108 ms |            0 |
| clean-auth-tests               | clean      |               no |      no | true_negative  |  367 ms |            0 |
| clean-checkout-tests           | clean      |               no |     yes | false_positive |  314 ms |            0 |
| security-missing-authorization | security   |              yes |     yes | true_positive  |  335 ms |            0 |
| security-secret-logging        | security   |              yes |      no | review_failure |  362 ms |            0 |
| functional-negative-quantity   | functional |              yes |     yes | true_positive  |  346 ms |            0 |
| functional-stale-consumer      | functional |              yes |     yes | true_positive  |  313 ms |            0 |
| evidence-missing-test          | evidence   |              yes |     yes | true_positive  |  326 ms |            0 |
| evidence-misleading-green      | evidence   |              yes |     yes | true_positive  |  340 ms |            0 |
| style-warning-only             | style      |               no |      no | true_negative  |  326 ms |            0 |
| clean-documentation            | clean      |               no |      no | true_negative  |  303 ms |            0 |

Blocking-defect recall: 83.3%
Clean/control false-block rate: 16.7%
Reviewer failures/unreliable outputs: 1
Mean latency: 473 ms
Total tokens: 0

This run is a measurement gate, not automatic rollout approval. Phase 4 promotion still requires the predeclared recall, false-block, warning-inflation and overhead ceilings to be met on a larger repeated set.
