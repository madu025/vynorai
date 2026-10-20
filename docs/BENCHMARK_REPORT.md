# Copilot-parity benchmark

Business requests over the five benchmark workbooks, run end to end (reader, plan, apply) into an in-memory workbook and graded cell by cell. Headless: it proves what the add-in writes, not how real Excel draws it. Regenerate with `npx tsx test/batch/benchmark.ts --write` in `extensions/m365`.

Overall: **318/318 checks (100%)** over 30 runs.

| Dimension | Passed | Score |
| --- | --- | --- |
| understanding | 30/30 | 100% |
| business meaning | 73/73 | 100% |
| safety | 55/55 | 100% |
| layout | 130/130 | 100% |
| fallback | 15/15 | 100% |
| duplicates | 15/15 | 100% |

| Scenario | Workbook | Host | Passed | Failed checks |
| --- | --- | --- | --- | --- |
| dash-management | retail | desktop | 14/14 | none |
| dash-management | retail | web | 15/15 | none |
| dash-target | retail | desktop | 14/14 | none |
| dash-operations | retail | desktop | 13/13 | none |
| duplicates | retail | desktop | 4/4 | none |
| quality | retail | desktop | 4/4 | none |
| dash-management | hr | desktop | 14/14 | none |
| dash-management | hr | web | 15/15 | none |
| dash-target | hr | desktop | 14/14 | none |
| dash-operations | hr | desktop | 13/13 | none |
| duplicates | hr | desktop | 4/4 | none |
| quality | hr | desktop | 4/4 | none |
| dash-management | finance | desktop | 15/15 | none |
| dash-management | finance | web | 16/16 | none |
| dash-target | finance | desktop | 14/14 | none |
| dash-operations | finance | desktop | 13/13 | none |
| duplicates | finance | desktop | 4/4 | none |
| quality | finance | desktop | 4/4 | none |
| dash-management | inventory | desktop | 13/13 | none |
| dash-management | inventory | web | 14/14 | none |
| dash-target | inventory | desktop | 14/14 | none |
| dash-operations | inventory | desktop | 13/13 | none |
| duplicates | inventory | desktop | 4/4 | none |
| quality | inventory | desktop | 4/4 | none |
| dash-management | support | desktop | 13/13 | none |
| dash-management | support | web | 14/14 | none |
| dash-target | support | desktop | 14/14 | none |
| dash-operations | support | desktop | 13/13 | none |
| duplicates | support | desktop | 4/4 | none |
| quality | support | desktop | 4/4 | none |

Not covered here: real Excel Desktop and Excel on the web (chart drawing, slicer placement, calculated values) and the AI model path. Those need a live run on a machine with Excel.
