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

## Phase 4 - fixes (build 20261016.30, commits 5e207be, b2f795b)

| root cause                                                                                               | cases                        | fix                                                |
| -------------------------------------------------------------------------------------------------------- | ---------------------------- | -------------------------------------------------- |
| a date column was "numeric" so it could not be a pivot or chart category                                 | e-spaced, c-line             | header named like a date is a category (intent.ts) |
| a pivot could not count a text column                                                                    | p-count                      | count uses a text column as the value              |
| "where X is Y" was not a filter                                                                          | v-filter                     | `is` is an equality word                           |
| histogram refused on very large data                                                                     | c-hist                       | ten COUNTIFS bins over every row (largeRange.ts)   |
| insights refused on very large data                                                                      | st-insights                  | allowed; ran live                                  |
| LET names `q1`, `q3`, `c` are invalid in Excel (insights and percent-change/YoY/moving-average formulas) | st-insights, derived columns | renamed; unit test now scans for invalid LET names |

## Phase 4 - live re-test

| id          | result                                                                           |
| ----------- | -------------------------------------------------------------------------------- |
| c-hist      | pass (10 bins, 520k rows)                                                        |
| st-insights | pass, but category is Status although "by RTOM" was asked (open bug)             |
| e-spaced    | partial: groups by exact timestamp, not by day (open bug)                        |
| p-count     | pass (E/S/X, total 520,125)                                                      |
| v-filter    | not valid: a leftover pivot sheet made the active sheet wrong; retest next batch |

## Open items for the next batch

- insights ignores the requested category column (uses Status for "by RTOM").
- date pivots do not group by day/month (timestamps stay distinct).
- not understood: computed columns with IF / text / year, "highlight above N", date validation, "repair the data", name a column, "copy to a new sheet".
- formula audit is refused on very large data.
- Office Script / VBA writing does not exist (gap).
- Left in the workbook by the test run: sheet "Pivot - Service ID by Status" (the pane keeps the latest result and cannot remove it; delete the tab by hand).
