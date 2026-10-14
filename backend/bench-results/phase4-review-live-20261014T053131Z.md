# Phase 4 independent-review live measurement

Date: 2026-10-14T05:31:31.916Z
Model: deepseek-v4-pro
Backend: https://vynor.lk
Repository commit: d4face0203272eae8c08275776436af97e9235d7

This report retains digests and aggregate reviewer outcomes only; review text and fixture source are not stored.

| Fixture                        | Family     | Expected finding | Finding | Classification |  Latency | Total tokens |
| ------------------------------ | ---------- | ---------------: | ------: | -------------- | -------: | -----------: |
| clean-validation               | clean      |               no |      no | true_negative  |  5047 ms |          457 |
| clean-api-export               | clean      |               no |      no | true_negative  |  1937 ms |          339 |
| clean-auth-tests               | clean      |               no |     yes | false_positive |  4052 ms |          458 |
| clean-checkout-tests           | clean      |               no |     yes | false_positive | 15028 ms |         1252 |
| security-missing-authorization | security   |              yes |     yes | true_positive  |  2907 ms |          361 |
| security-secret-logging        | security   |              yes |      no | review_failure |   436 ms |            0 |
| functional-negative-quantity   | functional |              yes |      no | false_negative |  2076 ms |          276 |
| functional-stale-consumer      | functional |              yes |     yes | true_positive  |  3311 ms |          401 |
| evidence-missing-test          | evidence   |              yes |      no | false_negative |  3012 ms |          350 |
| evidence-misleading-green      | evidence   |              yes |     yes | true_positive  | 15960 ms |         1168 |
| style-warning-only             | style      |               no |      no | true_negative  |  1539 ms |          231 |
| clean-documentation            | clean      |               no |     yes | false_positive |  3324 ms |          361 |

Blocking-defect recall: 50.0%
Clean/control false-block rate: 50.0%
Reviewer failures/unreliable outputs: 1
Mean latency: 4886 ms
Total tokens: 5654

This run is a measurement gate, not automatic rollout approval. Phase 4 promotion still requires the predeclared recall, false-block, warning-inflation and overhead ceilings to be met on a larger repeated set.
