# Batch report

## Phase 2 - offline batch

proven and skipped: 21; ran: 64; pass 48, fail 12, skipped 4

| id               | variant | size  | status | detail                                                                                   |
| ---------------- | ------- | ----- | ------ | ---------------------------------------------------------------------------------------- |
| q-top            | en      | small | pass   | R-KL has the highest Requested Quantity: 161.                                            |
| q-top            | si      | small | pass   | Requested Quantity by RTOM: R-KL 161, R-HK 160, R-WT 159, R-GP 158, R-HT 156.            |
| q-count          | en      | small | pass   | There are 200 data rows.                                                                 |
| q-avg            | en      | small | pass   | Average Requested Quantity: 3.97.                                                        |
| q-sum            | en      | small | pass   | Total Issued Quantity: 545.                                                              |
| q-lowest         | en      | small | pass   | X has the lowest Requested Quantity: 263.                                                |
| f-ratio          | en      | 50k   | pass   | add-column plan ok                                                                       |
| f-if             | en      | small | fail   | not understood: no action                                                                |
| f-text           | en      | small | fail   | not understood: no action                                                                |
| f-year           | en      | small | fail   | not understood: no action                                                                |
| f-explain        | en      | small | skip   | live only                                                                                |
| p-cols           | en      | small | pass   | pivot-table plan ok                                                                      |
| p-avg            | en      | small | pass   | pivot-table plan ok                                                                      |
| p-count          | en      | 520k  | pass   | pivot-table plan ok                                                                      |
| p-pct            | en      | small | pass   | pivot-table plan ok                                                                      |
| p-singlish       | en      | small | pass   | pivot-table plan ok                                                                      |
| p-sinhala-status | en      | small | pass   | pivot-table plan ok                                                                      |
| p-sinhala-status | si      | small | pass   | pivot-table plan ok                                                                      |
| c-line           | en      | 520k  | pass   | chart+pivot-table plan ok                                                                |
| c-bar            | en      | small | pass   | chart plan ok                                                                            |
| c-pie            | en      | small | pass   | chart plan ok                                                                            |
| c-hist           | en      | 520k  | pass   | chart plan ok                                                                            |
| c-stacked        | en      | small | pass   | chart plan ok                                                                            |
| c-combo          | en      | small | pass   | chart plan ok                                                                            |
| st-corr          | en      | small | pass   | statistics plan ok                                                                       |
| st-insights      | en      | 520k  | pass   | statistics plan ok                                                                       |
| v-filter         | en      | 520k  | pass   | view plan ok                                                                             |
| v-sort           | en      | small | pass   | view plan ok                                                                             |
| cl-num           | en      | small | pass   | clean plan ok                                                                            |
| cl-date          | en      | small | pass   | clean plan ok                                                                            |
| cl-dupe          | en      | small | pass   | clean plan ok                                                                            |
| cl-fill          | en      | small | pass   | clean plan ok                                                                            |
| cl-zero-id       | en      | 50k   | pass   | clean plan ok                                                                            |
| cf-icons         | en      | small | pass   | format plan ok                                                                           |
| cf-neg           | en      | small | pass   | format plan ok                                                                           |
| cf-topn          | en      | small | fail   | expected format, got view                                                                |
| cf-contains      | en      | small | pass   | format plan ok                                                                           |
| cf-dupes         | en      | small | pass   | format+view plan ok                                                                      |
| cf-above         | en      | small | fail   | not understood: no action                                                                |
| cf-dates         | en      | small | pass   | format plan ok                                                                           |
| val-range        | en      | small | pass   | format plan ok                                                                           |
| val-date         | en      | small | fail   | not understood: no action                                                                |
| val-dependent    | en      | small | pass   | format plan ok                                                                           |
| ql-formula       | en      | small | pass   | quality plan ok                                                                          |
| ql-repair        | en      | small | fail   | not understood: no action                                                                |
| nr-name          | en      | small | fail   | not understood: no action                                                                |
| ex-csv           | en      | small | fail   | expected export, got export-csv                                                          |
| ex-pdf           | en      | small | fail   | expected export, got dashboard+export-pdf                                                |
| lk-lookup        | en      | small | fail   | expected lookup-columns, got add-column                                                  |
| un-unpivot       | en      | small | pass   | unpivot plan ok                                                                          |
| r-table          | en      | 520k  | pass   | refused: This data is too large to read in full. A PivotTable works on every row; select |
| r-slicer         | en      | small | pass   | slicer plan ok                                                                           |
| r-newsheet       | en      | 520k  | fail   | not understood: no action                                                                |
| si-clean         | en      | small | pass   | clean plan ok                                                                            |
| si-clean         | si      | small | pass   | clean plan ok                                                                            |
| si-chart         | en      | small | pass   | chart plan ok                                                                            |
| si-chart         | si      | small | pass   | chart plan ok                                                                            |
| si-question      | en      | small | pass   | R-KL has the highest Requested Quantity: 161.                                            |
| si-question      | si      | small | pass   | Requested Quantity by RTOM: R-KL 161, R-HK 160, R-WT 159, R-GP 158, R-HT 156.            |
| e-spaced         | en      | 520k  | pass   | pivot-table plan ok                                                                      |
| e-blank          | en      | small | pass   | statistics plan ok                                                                       |
| ui-undo          | en      | small | skip   | live only                                                                                |
| g-script         | en      | small | skip   | known gap: not implemented                                                               |
| g-vba            | en      | small | skip   | known gap: not implemented                                                               |
