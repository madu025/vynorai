# Live extension lifecycle proof — 2026-10-14

This report covers compatibility behavior only. It is separate from the
quality benchmark and does not claim that the local candidate was published.
All runs used real VS Code, real workspace files, and the production model
where a task was executed.

| Transition                    | Artifact evidence                                                                                                                    | Result                                                                                                                                                                       |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Released old artifact startup | `1.2.61` downloaded from the production release endpoint; SHA-256 `02ca9f01606cbbf6644bfc072eb089745ab2ba006b28ec7ebd3eca478a6e5693` | `VSIXLifecycle.test.ts` passed after window reload and extension-host restart                                                                                                |
| Upgrade                       | local canonical `1.2.66` candidate; SHA-256 `1b31585a78cee9b57604cb1be8ed978070608b92286af83da7c2a60f9b093379`                       | `ContractLifecycle.test.ts` passed in the same external profile; contract survived compaction, reload and rewind                                                             |
| Downgrade                     | released old `1.2.61` installed again over the profile containing the new task journal                                               | `VSIXLifecycle.test.ts` passed after window reload and extension-host restart                                                                                                |
| Released current artifact     | production `1.2.66` downloaded from the release endpoint; SHA-256 `709b21a1e438af26a2748e4c2c59df7ceaacb04680dea409d8663c1ae03cc638` | `ContractLifecycle.test.ts` did not find a completion contract; this is the expected pre-feature release result, not a pass for the candidate                                |
| Offline/reconnect             | canonical local `1.2.66` candidate, fresh profile, production key, endpoint changed to loopback `127.0.0.1:1` and then restored      | `OfflineRecovery.test.ts` passed in real VS Code (`1 passing`, 71 s); UI showed `ECONNREFUSED` with no completed receipt, then a fresh online probe received a real response |

The old artifact did not claim or produce a new completion contract; the
compatibility assertion is that it starts, reloads, and does not crash when the
new journal/profile exists. The released `1.2.66` run confirms that the
production artifact predates the local contract implementation; it cannot be
used as evidence for the candidate feature. The client-level offline probe and
the full VS Code offline failure path both confirmed bounded retries and a
truthful `ECONNREFUSED` failure, followed by a fresh real response after the
production endpoint was restored. The candidate has not been published or
deployed.
