# Copilot-parity benchmark

Business requests over the five benchmark workbooks, run end to end (reader, plan, apply) into an in-memory workbook and graded cell by cell. Headless: it proves what the add-in writes, not how real Excel draws it. Regenerate with `npx tsx test/batch/benchmark.ts --write` in `extensions/m365`.

Overall: **348/348 checks (100%)** over 30 runs.

| Dimension | Passed | Score |
| --- | --- | --- |
| understanding | 30/30 | 100% |
| business meaning | 73/73 | 100% |
| safety | 55/55 | 100% |
| layout | 130/130 | 100% |
| backend parity | 30/30 | 100% |
| fallback | 15/15 | 100% |
| duplicates | 15/15 | 100% |

| Scenario | Workbook | Host | Passed | Failed checks |
| --- | --- | --- | --- | --- |
| dash-management | retail | desktop | 15/15 | none |
| dash-management | retail | web | 16/16 | none |
| dash-target | retail | desktop | 15/15 | none |
| dash-operations | retail | desktop | 14/14 | none |
| duplicates | retail | desktop | 5/5 | none |
| quality | retail | desktop | 5/5 | none |
| dash-management | hr | desktop | 15/15 | none |
| dash-management | hr | web | 16/16 | none |
| dash-target | hr | desktop | 15/15 | none |
| dash-operations | hr | desktop | 14/14 | none |
| duplicates | hr | desktop | 5/5 | none |
| quality | hr | desktop | 5/5 | none |
| dash-management | finance | desktop | 16/16 | none |
| dash-management | finance | web | 17/17 | none |
| dash-target | finance | desktop | 15/15 | none |
| dash-operations | finance | desktop | 14/14 | none |
| duplicates | finance | desktop | 5/5 | none |
| quality | finance | desktop | 5/5 | none |
| dash-management | inventory | desktop | 14/14 | none |
| dash-management | inventory | web | 15/15 | none |
| dash-target | inventory | desktop | 15/15 | none |
| dash-operations | inventory | desktop | 14/14 | none |
| duplicates | inventory | desktop | 5/5 | none |
| quality | inventory | desktop | 5/5 | none |
| dash-management | support | desktop | 14/14 | none |
| dash-management | support | web | 15/15 | none |
| dash-target | support | desktop | 15/15 | none |
| dash-operations | support | desktop | 14/14 | none |
| duplicates | support | desktop | 5/5 | none |
| quality | support | desktop | 5/5 | none |

Not covered here: real Excel Desktop and Excel on the web (chart drawing, slicer placement, calculated values) and the AI model path. Those need a live run on a machine with Excel.
