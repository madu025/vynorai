# Copilot-parity benchmark

Business requests over the five benchmark workbooks, run end to end (reader, plan, apply) into an in-memory workbook and graded cell by cell. Headless: it proves what the add-in writes, not how real Excel draws it. Regenerate with `npx tsx test/batch/benchmark.ts --write` in `extensions/m365`.

Overall: **860/860 checks (100%)** over 67 runs.

| Dimension | Passed | Score |
| --- | --- | --- |
| understanding | 104/104 | 100% |
| business meaning | 151/151 | 100% |
| safety | 127/127 | 100% |
| layout | 250/250 | 100% |
| backend parity | 67/67 | 100% |
| fallback | 45/45 | 100% |
| duplicates | 30/30 | 100% |
| language | 86/86 | 100% |

| Scenario | Workbook | Host | Passed | Failed checks |
| --- | --- | --- | --- | --- |
| dash-management | retail | desktop | 15/15 | none |
| dash-management | retail | web | 16/16 | none |
| dash-target | retail | desktop | 15/15 | none |
| dash-operations | retail | desktop | 14/14 | none |
| duplicates | retail | desktop | 5/5 | none |
| quality | retail | desktop | 5/5 | none |
| si-dash-management | retail | desktop | 20/20 | none |
| si-dash-management | retail | web | 21/21 | none |
| ta-dash-management | retail | desktop | 20/20 | none |
| ta-dash-management | retail | web | 21/21 | none |
| si-chart | retail | desktop | 8/8 | none |
| ta-chart | retail | desktop | 8/8 | none |
| si-duplicates | retail | desktop | 6/6 | none |
| ta-duplicates | retail | desktop | 6/6 | none |
| singlish-duplicates | retail | desktop | 6/6 | none |
| dash-management | hr | desktop | 15/15 | none |
| dash-management | hr | web | 16/16 | none |
| dash-target | hr | desktop | 15/15 | none |
| dash-operations | hr | desktop | 14/14 | none |
| duplicates | hr | desktop | 5/5 | none |
| quality | hr | desktop | 5/5 | none |
| si-dash-management | hr | desktop | 20/20 | none |
| si-dash-management | hr | web | 21/21 | none |
| ta-dash-management | hr | desktop | 20/20 | none |
| ta-dash-management | hr | web | 21/21 | none |
| si-duplicates | hr | desktop | 6/6 | none |
| ta-duplicates | hr | desktop | 6/6 | none |
| singlish-duplicates | hr | desktop | 6/6 | none |
| dash-management | finance | desktop | 16/16 | none |
| dash-management | finance | web | 17/17 | none |
| dash-target | finance | desktop | 15/15 | none |
| dash-operations | finance | desktop | 14/14 | none |
| duplicates | finance | desktop | 5/5 | none |
| quality | finance | desktop | 5/5 | none |
| si-dash-management | finance | desktop | 21/21 | none |
| si-dash-management | finance | web | 22/22 | none |
| ta-dash-management | finance | desktop | 21/21 | none |
| ta-dash-management | finance | web | 22/22 | none |
| si-duplicates | finance | desktop | 6/6 | none |
| ta-duplicates | finance | desktop | 6/6 | none |
| singlish-duplicates | finance | desktop | 6/6 | none |
| dash-management | inventory | desktop | 14/14 | none |
| dash-management | inventory | web | 15/15 | none |
| dash-target | inventory | desktop | 15/15 | none |
| dash-operations | inventory | desktop | 14/14 | none |
| duplicates | inventory | desktop | 5/5 | none |
| quality | inventory | desktop | 5/5 | none |
| si-dash-management | inventory | desktop | 19/19 | none |
| si-dash-management | inventory | web | 20/20 | none |
| ta-dash-management | inventory | desktop | 19/19 | none |
| ta-dash-management | inventory | web | 20/20 | none |
| si-duplicates | inventory | desktop | 6/6 | none |
| ta-duplicates | inventory | desktop | 6/6 | none |
| singlish-duplicates | inventory | desktop | 6/6 | none |
| dash-management | support | desktop | 14/14 | none |
| dash-management | support | web | 15/15 | none |
| dash-target | support | desktop | 15/15 | none |
| dash-operations | support | desktop | 14/14 | none |
| duplicates | support | desktop | 5/5 | none |
| quality | support | desktop | 5/5 | none |
| si-dash-management | support | desktop | 19/19 | none |
| si-dash-management | support | web | 20/20 | none |
| ta-dash-management | support | desktop | 19/19 | none |
| ta-dash-management | support | web | 20/20 | none |
| si-duplicates | support | desktop | 6/6 | none |
| ta-duplicates | support | desktop | 6/6 | none |
| singlish-duplicates | support | desktop | 6/6 | none |

Not covered here: real Excel Desktop and Excel on the web (chart drawing, slicer placement, calculated values) and the AI model path. Those need a live run on a machine with Excel.
