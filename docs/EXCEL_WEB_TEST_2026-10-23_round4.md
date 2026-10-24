# Excel on the web test, round 4, 2026-10-23

Build under test: Build 20261022.07 (main 2e6d452, published after pulling the Explore, share-style and time-saved features). Step 0: /ready and /health 200; bundle has map*relationships (6), 'saved this month (estimate)', share_style*_ and explore\__ keys. Workbooks: A = vynor-test-retail.xlsx, B = vynor-relational-10-sheet.xlsx. Both left as found (applied changes undone, staged plans discarded, scratch cells cleared). Details per batch: docs/EXCEL_WEB_TEST_PROGRESS_R4.md.

| #   | Item                                | Result            | Evidence                                                                                                                  | Suspected file                  |
| --- | ----------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| 1.1 | Explore tab, no result yet          | PASS              | 4th tab enabled; request box and starter chips hidden                                                                     | -                               |
| 1.2 | Template chips follow the selection | PASS (notes)      | chips change with the range; money column picked is Unit Price, not Net Amount                                            | src/exploreChips                |
| 1.3 | Ask-your-sheet chip                 | PASS              | sentence to request box, pane to Work, run answers, nothing staged                                                        | -                               |
| 1.4 | Month-end card                      | NOT RUN           | no employee sheet                                                                                                         | -                               |
| 1.5 | Sinhala and Tamil Explore           | PASS              | translated, 4 tabs fit, no horizontal scroll                                                                              | -                               |
| 2.1 | Noticed tiles correct               | PASS              | 12 duplicate rows and 6 blank Qty match scratch formulas (2 tiles, not 3)                                                 | -                               |
| 2.2 | Tile tap                            | PASS              | request text only, no change                                                                                              | -                               |
| 2.3 | Blank selection                     | PASS (note)       | no tiles; quality suggestion still offered                                                                                | src/suggestions                 |
| 2.4 | Sinhala tiles                       | PASS              | -                                                                                                                         | -                               |
| 3.1 | KPI tiles                           | PASS (notes)      | only in Local preview, not Agent plan; Total 7.46M matches; top group counts untrimmed labels                             | src/previewKpis.ts              |
| 3.2 | Chart tweaks                        | NEW ISSUE         | Average gives 'Unrecognized key: aggregation' (backend not deployed with 6f754cd)                                         | backend deploy                  |
| 3.3 | Apply and Undo                      | PASS (defaults)   | sheet + chart created, Undo restored                                                                                      | -                               |
| 3.4 | Data quality KPIs                   | NOT RUN           | blocked                                                                                                                   | -                               |
| 3.5 | Applied wording                     | FAIL              | 'Applied. Undo puts everything back.' never shown; header still 'No changes yet'                                          | src/taskpane.ts                 |
| 4.1 | Share style picker                  | PARTIAL           | picker and 3 styles render; 'Latest result' fails when the table is at A20; Central 27% vs KPI 24.8%; persistence NOT RUN | src/taskpane.ts shareFromResult |
| 4.2 | WhatsApp text and Copy              | PASS              | 'Text copied.', nothing sent; e-mail card English in Sinhala                                                              | src/i18n.ts                     |
| 4.3 | Time-saved footer                   | PASS (partial)    | appears after apply, unchanged by Undo                                                                                    | -                               |
| 5.1 | Top customers                       | PARTIAL           | answer right (verified); relationship role stays pending, no evidence, overview has no join                               | src/agent.ts, taskpane.ts       |
| 5.2 | Add customer region                 | FAIL (serious)    | applied sheet has #SPILL! and every row 'Not found'; reviewers passed it                                                  | m365Agent.ts, agentReview.ts    |
| 5.3 | Orphan rows                         | PASS              | 21 rows, all CUST-9999                                                                                                    | -                               |
| 5.4 | Missing column                      | FAIL              | staged a write to Orders!M2 instead of saying the column does not exist                                                   | m365Agent.ts                    |
| 5.5 | Reviewer evidence                   | NOT RUN / PARTIAL | roles stay 'pending'                                                                                                      | src/taskpane.ts                 |
| 6.1 | Regression                          | PARTIAL           | see progress file                                                                                                         | -                               |
| 6.2 | Console / 4xx                       | PARTIAL           | iframe not capturable; backend rejection seen in 3.2                                                                      | backend deploy                  |
| 6.3 | Freeze test                         | PASS              | no freeze with the pane open (2x) or closed (1x) on 3,000 rows                                                            | -                               |
| 6.4 | Offline                             | NOT RUN           | not requested                                                                                                             | -                               |

Long requests: agent write requests took about 95 s to 3.5 min; read-only answers about 45 s.

## Top 5 remaining problems

1. A join request can be applied as an all-'Not found' column with #SPILL! (5.2): the accuracy review must evaluate the result (errors, share of not-found) and the plan should use the Customers sheet's own region.
2. Backend on vynor.lk is older than 6f754cd (3.2): deploy it, then retest chart tweaks 3.2 to 3.5.
3. A request for a column that does not exist stages a write instead of saying so (5.4).
4. Relationship mapper and reviewer roles show 'pending' with no evidence, and the Workbook overview shows no join (5.1, 5.5).
5. The pane scroll area is about 200 px while a plan or preview is open, share-from-latest-result fails when the result table is not at A1, and several strings are still English in Sinhala.

FIXED vs still failing (Sinhala): Explore tab, Noticed card numbers, KPI total, share card styles, WhatsApp copy, time-saved footer, orphan-row question and Undo work. Still failing: join correctness, backend aggregation field, missing-column handling, role evidence, applied wording.
