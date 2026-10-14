# Phase 4 independent-review live measurement

Date: 2026-10-14T05:26:35.038Z
Model: vynor-auto
Backend: https://vynor.lk
Repository commit: f64ffe6589ee6ccddd25c741613b76d52fde2d6d

This report retains digests and aggregate reviewer outcomes only; review text and fixture source are not stored.

| Fixture                        | Family     | Expected finding | Finding | Classification |  Latency | Total tokens |
| ------------------------------ | ---------- | ---------------: | ------: | -------------- | -------: | -----------: |
| clean-validation               | clean      |               no |      no | true_negative  |  3073 ms |          377 |
| clean-api-export               | clean      |               no |      no | true_negative  |  1838 ms |          353 |
| clean-auth-tests               | clean      |               no |      no | true_negative  |  2491 ms |          499 |
| clean-checkout-tests           | clean      |               no |     yes | false_positive | 17407 ms |         3045 |
| security-missing-authorization | security   |              yes |     yes | true_positive  |  1985 ms |          350 |
| security-secret-logging        | security   |              yes |      no | false_negative |   406 ms |            0 |
| functional-negative-quantity   | functional |              yes |     yes | true_positive  |  2655 ms |          431 |
| functional-stale-consumer      | functional |              yes |     yes | true_positive  |  1790 ms |          381 |
| evidence-missing-test          | evidence   |              yes |     yes | true_positive  |  2739 ms |          509 |
| evidence-misleading-green      | evidence   |              yes |     yes | true_positive  |  9310 ms |         1411 |
| style-warning-only             | style      |               no |      no | true_negative  |  1360 ms |          232 |
| clean-documentation            | clean      |               no |      no | true_negative  |  2031 ms |          365 |

Blocking-defect recall: 83.3%
Clean/control false-block rate: 16.7%
Mean latency: 3924 ms
Total tokens: 7953

This run is a measurement gate, not automatic rollout approval. Phase 4 promotion still requires the predeclared recall, false-block, warning-inflation and overhead ceilings to be met on a larger repeated set.
