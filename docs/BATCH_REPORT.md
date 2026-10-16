# Batch report

## Phase 2 - offline batch

proven and skipped: 0; ran: 87; pass 79, fail 0, skipped 8

| id               | variant | size  | status | detail                                                                                   |
| ---------------- | ------- | ----- | ------ | ---------------------------------------------------------------------------------------- |
| q-top            | en      | small | pass   | R-KL has the highest Requested Quantity: 161.                                            |
| q-top            | si      | small | pass   | Requested Quantity by RTOM: R-KL 161, R-HK 160, R-WT 159, R-GP 158, R-HT 156.            |
| q-large          | en      | 520k  | skip   | live only                                                                                |
| q-count          | en      | small | pass   | There are 200 data rows.                                                                 |
| q-avg            | en      | small | pass   | Average Requested Quantity: 3.97.                                                        |
| q-sum            | en      | small | pass   | Total Issued Quantity: 545.                                                              |
| q-lowest         | en      | small | pass   | X has the lowest Requested Quantity: 263.                                                |
| f-sum            | en      | 520k  | pass   | add-column plan ok                                                                       |
| f-ratio          | en      | 50k   | pass   | add-column plan ok                                                                       |
| f-if             | en      | small | pass   | add-column plan ok                                                                       |
| f-text           | en      | small | pass   | add-column plan ok                                                                       |
| f-year           | en      | small | pass   | add-column plan ok                                                                       |
| f-explain        | en      | small | skip   | live only                                                                                |
| p-one            | en      | 520k  | pass   | pivot-table plan ok                                                                      |
| p-one            | si      | 520k  | pass   | pivot-table plan ok                                                                      |
| p-two            | en      | 520k  | pass   | pivot-table plan ok                                                                      |
| p-top            | en      | 520k  | pass   | pivot-table plan ok                                                                      |
| p-cols           | en      | small | pass   | pivot-table plan ok                                                                      |
| p-avg            | en      | small | pass   | pivot-table plan ok                                                                      |
| p-count          | en      | 520k  | pass   | pivot-table plan ok                                                                      |
| p-pct            | en      | small | pass   | pivot-table plan ok                                                                      |
| p-singlish       | en      | small | pass   | pivot-table plan ok                                                                      |
| p-sinhala-status | en      | small | pass   | pivot-table plan ok                                                                      |
| p-sinhala-status | si      | small | pass   | pivot-table plan ok                                                                      |
| c-column         | en      | 520k  | pass   | chart+pivot-table plan ok                                                                |
| c-line           | en      | 520k  | pass   | chart+pivot-table plan ok                                                                |
| c-bar            | en      | small | pass   | chart plan ok                                                                            |
| c-pie            | en      | small | pass   | chart plan ok                                                                            |
| c-hist           | en      | 520k  | pass   | chart plan ok                                                                            |
| c-stacked        | en      | small | pass   | chart plan ok                                                                            |
| c-combo          | en      | small | pass   | chart plan ok                                                                            |
| s-summary        | en      | 520k  | pass   | pivot-table plan ok                                                                      |
| st-describe      | en      | 520k  | pass   | statistics plan ok                                                                       |
| st-corr          | en      | small | pass   | statistics plan ok                                                                       |
| st-forecast      | en      | 520k  | pass   | statistics plan ok                                                                       |
| st-insights      | en      | 520k  | pass   | statistics plan ok                                                                       |
| v-top            | en      | 520k  | pass   | view plan ok                                                                             |
| v-filter         | en      | 520k  | pass   | view plan ok                                                                             |
| v-sort           | en      | small | pass   | view plan ok                                                                             |
| cl-trim          | en      | 520k  | pass   | clean plan ok                                                                            |
| cl-num           | en      | small | pass   | clean plan ok                                                                            |
| cl-date          | en      | small | pass   | clean plan ok                                                                            |
| cl-dupe          | en      | small | pass   | clean plan ok                                                                            |
| cl-fill          | en      | small | pass   | clean plan ok                                                                            |
| cl-zero-id       | en      | 50k   | pass   | clean plan ok                                                                            |
| fm-format        | en      | 520k  | pass   | format plan ok                                                                           |
| cf-scale         | en      | 520k  | pass   | format plan ok                                                                           |
| cf-icons         | en      | small | pass   | format plan ok                                                                           |
| cf-neg           | en      | small | pass   | format plan ok                                                                           |
| cf-topn          | en      | small | pass   | view plan ok                                                                             |
| cf-contains      | en      | small | pass   | format plan ok                                                                           |
| cf-dupes         | en      | small | pass   | format+view plan ok                                                                      |
| cf-above         | en      | small | pass   | format plan ok                                                                           |
| cf-dates         | en      | small | pass   | format plan ok                                                                           |
| val-list         | en      | 50k   | pass   | format plan ok                                                                           |
| val-range        | en      | small | pass   | format plan ok                                                                           |
| val-date         | en      | small | pass   | format plan ok                                                                           |
| val-dependent    | en      | small | pass   | format plan ok                                                                           |
| ql-data          | en      | 520k  | pass   | quality plan ok                                                                          |
| ql-formula       | en      | small | pass   | quality plan ok                                                                          |
| ql-repair        | en      | small | pass   | quality plan ok                                                                          |
| d-dash           | en      | 520k  | pass   | dashboard plan ok                                                                        |
| nr-name          | en      | small | pass   | named-range plan ok                                                                      |
| ex-csv           | en      | small | pass   | export-csv plan ok                                                                       |
| ex-pdf           | en      | small | pass   | dashboard+export-pdf plan ok                                                             |
| lk-lookup        | en      | small | pass   | add-column plan ok                                                                       |
| sp-name          | en      | 520k  | pass   | split-column plan ok                                                                     |
| un-unpivot       | en      | small | pass   | unpivot plan ok                                                                          |
| r-table          | en      | 520k  | pass   | refused: This data is too large to read in full. A PivotTable works on every row; select |
| r-slicer         | en      | small | pass   | slicer plan ok                                                                           |
| r-newsheet       | en      | 520k  | pass   | view plan ok                                                                             |
| si-clean         | en      | small | pass   | clean plan ok                                                                            |
| si-clean         | si      | small | pass   | clean plan ok                                                                            |
| si-chart         | en      | small | pass   | chart plan ok                                                                            |
| si-chart         | si      | small | pass   | chart plan ok                                                                            |
| si-pivot         | en      | 520k  | pass   | pivot-table plan ok                                                                      |
| si-pivot         | si      | 520k  | pass   | pivot-table plan ok                                                                      |
| si-question      | en      | small | pass   | R-KL has the highest Requested Quantity: 161.                                            |
| si-question      | si      | small | pass   | Requested Quantity by RTOM: R-KL 161, R-HK 160, R-WT 159, R-GP 158, R-HT 156.            |
| e-spaced         | en      | 520k  | pass   | pivot-table plan ok                                                                      |
| e-blank          | en      | small | pass   | statistics plan ok                                                                       |
| ui-undo          | en      | small | skip   | live only                                                                                |
| ui-newchat       | en      | small | skip   | live only                                                                                |
| ui-session       | en      | small | skip   | live only                                                                                |
| ui-ai            | en      | small | skip   | live only                                                                                |
| g-script         | en      | small | skip   | known gap: not implemented                                                               |
| g-vba            | en      | small | skip   | known gap: not implemented                                                               |

Phase 8 (odd calculations): computed-column expressions now accept whole-column figures COLSUM, COLAVG, COLMAX, COLMIN, COLCOUNT, COLSTDEV of one column (share of total, above or below average, distance from average, z-score), on small data and on very large data (a full-column reference inside the MAP). The AI planner prompt teaches them; planner steps may contain < and > (markup is still refused). ai-interpret: 13/13 with the real model. Live check on the 520k workbook still to do.

Found live (20261016.41): a whole-column figure inside a per-row MAP (SUM of 520k cells for each of 520k rows) never finished. Fixed in 20261016.42: the figure is bound once in a LET outside the MAP (`=LET(_k0,SUM(col),MAP(...))`), with a unit test that the SUM appears once. Lesson: any new formula over a very large range needs a performance look, not only a correctness test.
