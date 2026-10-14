# Live completion-contract proof — 2026-10-14

This is a focused Phase 1 smoke proof, not the 52-task promotion benchmark.
It used the canonical local VSIX, a fresh isolated VS Code profile, the
production proxy, and the real responding model. No prompt text, file path or
API key is stored here.

| Item                | Result                                                                             |
| ------------------- | ---------------------------------------------------------------------------------- |
| Task                | `ev-simple-boundary`                                                               |
| Scope               | `simple`                                                                           |
| Driver              | finished in 33s; 4,459 credits; 0 approvals                                        |
| Contract            | present; scope matched; 2 required criteria                                        |
| Evidence            | 2/2 fresh passed test receipts; coverage 1.0                                       |
| Mutation generation | 1                                                                                  |
| Final task state    | `completed`                                                                        |
| Scorer              | `pass`                                                                             |
| Provider/model      | `deepseek/deepseek-flash` (heavy tier)                                             |
| VSIX                | 1.2.66; SHA-256 `e5ea0f962f0aa8b1890cd3295e421414eaf47bdc4802f29b982abe316d253475` |
| Installed bundle    | SHA-256 `dd95cb1393bf7c84b5708abe043a6e34c7d0e93dcd8577b17c3293e006032ef6`         |

The run proves the packaged contract wiring and simple-task evidence policy on
one real task. It does not close Phase 1: compaction/rewind, upgrade or
downgrade, offline behavior, and measured contract recall/precision remain
open.
