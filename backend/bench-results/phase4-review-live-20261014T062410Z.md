# Phase 4 independent-review live measurement

Date: 2026-10-14T06:24:10.007Z
Model: vynor-auto
Backend: https://vynor.lk
Repository commit: fc102ec9bc7e65b8d15d1e702313c395172f7aea
Fixture digest: 5d0784d6e2fba8a722b8025ea4bfd2053b94c8442e65894ba82cbc7d1ac0ee45

This report retains digests and aggregate reviewer outcomes only; review text and fixture source are not stored.

| Fixture                        | Family     | Expected finding | Finding | Classification |  Latency | Total tokens |
| ------------------------------ | ---------- | ---------------: | ------: | -------------- | -------: | -----------: |
| clean-validation               | clean      |               no |      no | true_negative  | 46340 ms |         3018 |
| clean-api-export               | clean      |               no |      no | true_negative  |  2450 ms |          557 |
| clean-auth-tests               | clean      |               no |      no | true_negative  |  2555 ms |          499 |
| clean-checkout-tests           | clean      |               no |      no | true_negative  | 40514 ms |         2671 |
| security-missing-authorization | security   |              yes |     yes | true_positive  |  2802 ms |          499 |
| security-secret-logging        | security   |              yes |     yes | true_positive  |  2586 ms |          454 |
| functional-negative-quantity   | functional |              yes |     yes | true_positive  |  2421 ms |          551 |
| functional-stale-consumer      | functional |              yes |     yes | true_positive  |  2369 ms |          517 |
| evidence-missing-test          | evidence   |              yes |     yes | true_positive  |  1780 ms |          500 |
| evidence-misleading-green      | evidence   |              yes |     yes | true_positive  | 21853 ms |         1539 |
| style-warning-only             | style      |               no |      no | true_negative  |  2082 ms |          397 |
| clean-documentation            | clean      |               no |      no | true_negative  | 26147 ms |         1830 |

Blocking-defect recall: 100.0%
Clean/control false-block rate: 0.0%
Reviewer failures/unreliable outputs: 0
Mean latency: 12825 ms
Total tokens: 13032

This run is a measurement gate, not automatic rollout approval. Phase 4 promotion still requires the predeclared recall, false-block, warning-inflation and overhead ceilings to be met on a larger repeated set.
