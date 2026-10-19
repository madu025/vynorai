# Excel agent backlog

The 500 things a person can ask the Excel agent (`extensions/m365/src/agent.ts`, `backend/src/services/m365Agent.ts`)
to do, grouped by area, with what the agent can do today. The target is Copilot in Excel at any data size
(tested on 520,125 rows). Decisions behind the agent are in `docs/ARCHITECTURE_DECISIONS.md`, "Excel agent".

Status:

- **E**: the agent can do it now, through a tool (`calculate`, `write_formula`, `write_values`, `create_sheet`,
  `sort_range`, `format_range`, `create_chart`) or a built-in step (`vynor_step`).
- **P**: partly: only on a copy or a new sheet, only some variants, or not fast enough at 500k rows.
- **N**: needs a new tool.
- **X**: not supported on purpose (safety).

Unless a line says "live", an E item is checked by unit tests or the real-model harness
(`extensions/m365/test/batch/agent-prompts.ts`), not yet in Excel for the web.

## Workbook understanding

1. **E** List the sheets with their used ranges and row counts.
2. **E** Find the header row and column letters of the data on the active sheet.
3. **E** Tell the type of each column (number, date, text).
4. **E** Show the first rows of a range.
5. **E** Read the formulas of a range.
6. **E** Describe what the workbook contains in a few sentences.
7. **E** Count rows and columns of the data.
8. **P** List the Excel Tables (names only; not their columns).
9. **N** List the named ranges and what they refer to.
10. **N** List the charts and PivotTables on each sheet.
11. **N** List hidden sheets, rows and columns.
12. **N** Find merged cells in the data.
13. **E** Find the last filled row of a column.
14. **N** Detect several tables on one sheet and their ranges.
15. **N** Read cell comments and notes.

## Questions and answers

16. **E** Total of a column.
17. **E** Average, largest, smallest value of a column.
18. **E** Count of rows.
19. **E** Count of rows that meet a condition ("Status S").
20. **E** Count with several conditions.
21. **E** Total with a condition (SUMIFS).
22. **E** Total with several conditions.
23. **E** Average with a condition.
24. **E** Number of distinct values in a column.
25. **E** Which category has the largest total ("top RTOM").
26. **E** Top N categories by total.
27. **E** Bottom N categories by total.
28. **E** Share of the total for one category.
29. **E** Earliest and latest date.
30. **E** Total for a date range ("March 2025").
31. **E** Month with the highest total.
32. **E** Difference between two columns in total ("requested minus issued").
33. **E** Rows where one column is larger than another, counted.
34. **E** Duplicate values in an ID column, counted.
35. **E** Blank cells per column.
36. **E** Median and standard deviation.
37. **E** Percentage of rows with a value ("how many are km").
38. **E** Compare two categories ("R-HK vs R-GP").
39. **E** Answer in Sinhala, Tamil or English, with the real numbers.
40. **P** Explain why a figure changed (trend between months, top contributors); needs several calculations, not yet guided.

## Math and statistics formulas

41. **E** SUM, AVERAGE, MIN, MAX, COUNT, COUNTA over whole columns.
42. **E** SUMIFS, COUNTIFS, AVERAGEIFS, MAXIFS, MINIFS.
43. **E** SUMPRODUCT for weighted totals.
44. **E** ROUND, ROUNDUP, ROUNDDOWN, MROUND, INT, TRUNC.
45. **E** ABS, SIGN, MOD, POWER, SQRT.
46. **E** MEDIAN, MODE.SNGL, PERCENTILE.INC, QUARTILE.INC.
47. **E** STDEV.S, STDEV.P, VAR.S.
48. **E** RANK.EQ and RANK.AVG.
49. **E** LARGE and SMALL (the k-th value).
50. **E** CORREL and PEARSON.
51. **E** SLOPE, INTERCEPT, RSQ, FORECAST.LINEAR.
52. **E** LINEST for a linear regression table.
53. **E** GROWTH and TREND.
54. **E** AGGREGATE that ignores errors and hidden rows.
55. **E** SUBTOTAL for filtered totals.
56. **E** Percentage of total column.
57. **E** Percentage change between two columns.
58. **E** Compound growth rate (CAGR).
59. **E** Running total.
60. **E** Moving average.
61. **E** Weighted average.
62. **E** Z-score per row.
63. **E** Frequency bins (FREQUENCY or COUNTIFS bins).
64. **E** Random sample of rows (RANDARRAY with SORTBY).
65. **E** Financial: PMT, NPV, IRR, FV, PV.

## Lookup and reference formulas

66. **E** XLOOKUP from another sheet.
67. **E** XLOOKUP with a default when not found.
68. **E** Approximate match lookup (price bands).
69. **E** Two-key lookup (Circuit ID and Item Code).
70. **E** INDEX/MATCH for older workbooks.
71. **E** VLOOKUP/HLOOKUP when the person asks for it.
72. **E** XMATCH position of a value.
73. **E** Return several columns in one lookup.
74. **E** Last matching value (XLOOKUP search from the end).
75. **E** Lookup across two sheets and flag missing keys.
76. **E** CHOOSECOLS and CHOOSEROWS.
77. **E** OFFSET for a moving window (volatile; warned).
78. **P** INDIRECT to a sheet named in a cell (works, volatile and slow at 500k rows).
79. **E** ROW, COLUMN, ROWS, COLUMNS.
80. **E** Find which sheet a key appears in (several lookups).
81. **E** Reverse lookup (value to header).
82. **E** Lookup a value in a 2D table (row and column match).
83. **E** Count of matches from a list (COUNTIFS with a list).
84. **E** Lookup into an Excel Table by structured reference.
85. **P** The built-in lookup step (`lookup-columns`) from another sheet; the agent uses `write_formula` with XLOOKUP instead.

## Text formulas

86. **E** LEFT, RIGHT, MID, LEN.
87. **E** TRIM and CLEAN.
88. **E** UPPER, LOWER, PROPER.
89. **E** CONCAT, TEXTJOIN, the & operator.
90. **E** TEXTSPLIT into columns.
91. **E** TEXTBEFORE, TEXTAFTER.
92. **E** SUBSTITUTE and REPLACE.
93. **E** FIND and SEARCH.
94. **E** TEXT to format numbers and dates as text.
95. **E** VALUE and NUMBERVALUE to turn text into numbers.
96. **E** Extract digits from a code.
97. **E** Pad IDs with leading zeros (TEXT with "0000000000").
98. **E** Split a full name into first and last name.
99. **E** Extract the domain of an e-mail (masked values stay masked in replies).
100.  **E** Check whether text contains a word (ISNUMBER(SEARCH())).
101.  **E** Count words in a cell.
102.  **E** Join all values of a group into one cell (TEXTJOIN with FILTER).
103.  **E** EXACT for case-sensitive compare.
104.  **N** Regular expression functions (REGEXTEST, REGEXEXTRACT) where the Excel version has them; needs a capability check.
105.  **E** Remove a prefix or suffix from codes.

## Date and time formulas

106. **E** YEAR, MONTH, DAY, WEEKDAY, WEEKNUM.
107. **E** First day of the month (EOMONTH(d,-1)+1).
108. **E** End of month.
109. **E** Quarter of a date.
110. **E** Financial year starting in April.
111. **E** Days between two dates (DAYS, DATEDIF).
112. **E** Working days between two dates (NETWORKDAYS).
113. **E** Add working days (WORKDAY).
114. **E** Age or months since a date.
115. **E** TODAY and NOW based columns (volatile; warned).
116. **E** Turn text dates into real dates (DATEVALUE).
117. **E** Month name from a date.
118. **E** Week start date.
119. **E** Hours between two times.
120. **E** Combine date and time columns.
121. **E** Group dates by month in a summary (GROUPBY on the month).
122. **E** Rows older than N days, counted or listed.
123. **E** Overdue flag (date before today and status not done).
124. **P** Day-level date pivot on 500k rows (pivot groups by day; month grouping needs a formula table).
125. **N** Holiday list for Sri Lanka in NETWORKDAYS (needs a holiday table).

## Logic and error formulas

126. **E** IF and nested IF.
127. **E** IFS and SWITCH.
128. **E** AND, OR, NOT, XOR.
129. **E** IFERROR and IFNA.
130. **E** ISBLANK, ISNUMBER, ISTEXT, ISERROR.
131. **E** Flag column with a rule ("High" if above average).
132. **E** Band values into ranges (IFS or XLOOKUP approximate).
133. **E** Check two columns match.
134. **E** Mark the first occurrence of a duplicate.
135. **E** Mark the largest value in each group.
136. **E** Pass/fail against a target.
137. **E** Status from several conditions.
138. **E** Replace errors with blank or zero.
139. **E** Count errors in a range.
140. **E** LET to name parts of a long formula.

## Dynamic arrays and LAMBDA

141. **E** UNIQUE list of a column.
142. **E** SORT and SORTBY.
143. **E** FILTER rows by one or several conditions.
144. **E** GROUPBY summary table.
145. **E** PIVOTBY cross table.
146. **E** TAKE and DROP for top or bottom rows.
147. **E** HSTACK and VSTACK to combine ranges.
148. **E** SEQUENCE and RANDARRAY.
149. **E** MAP, BYROW, BYCOL, SCAN, REDUCE.
150. **E** LAMBDA in a formula.
151. **N** Named LAMBDA functions saved in the workbook (needs a names tool).
152. **E** Spilled computed column over 520k rows (one formula, no fill).
153. **E** Per-group figure without slow per-row SUMIFS (GROUPBY plus binary-search XLOOKUP).
154. **E** Top N per group.
155. **E** Distinct count per group.
156. **E** Combine two sheets with the same columns (VSTACK).
157. **E** Unpivot with a formula (TOCOL and HSTACK).
158. **E** Transpose a table (TRANSPOSE).
159. **E** EXPAND and WRAPROWS for layouts.
160. **P** Spill conflicts: the agent sees #SPILL! after apply and can stage a fix; it does not yet pick an empty area itself.

## Formula help

161. **E** Explain a formula in plain words.
162. **E** Explain a formula in Sinhala.
163. **E** Find formulas that show errors in a range.
164. **E** Fix a broken formula (stage the corrected one).
165. **E** Rewrite VLOOKUP as XLOOKUP.
166. **E** Simplify a long nested IF into IFS or a lookup.
167. **E** Turn a fill-down formula into one spilled formula.
168. **E** Suggest a formula for a described result.
169. **E** Test a formula with `calculate` before writing it.
170. **P** Find circular references (the local inspector does; not yet an agent tool).
171. **P** Trace precedents of a cell (needs a tool).
172. **N** Trace dependents of a cell.
173. **E** Explain #N/A, #VALUE!, #DIV/0!, #SPILL!, #CALC! for a cell.
174. **E** Check that a total formula covers every row.
175. **E** Make references absolute where needed.
176. **E** Convert hard-coded numbers in a formula to cell references.
177. **P** Find inconsistent formulas in a column (needs reading many cells; bounded to 500 per read).
178. **N** Replace formulas with their values (paste values).
179. **E** Document what each formula column does (written to a new sheet).
180. **N** Evaluate a formula step by step.

## Computed columns

181. **E** A minus B, A plus B, A times B, A divided by B.
182. **E** Share of total per row.
183. **E** Share of the row's group total.
184. **E** Gap from the average.
185. **E** Above/below average label.
186. **E** Rank per row.
187. **E** Rank within a group.
188. **E** Running total.
189. **E** Running total within a group.
190. **E** Percent change from the previous row.
191. **E** Year-over-year change.
192. **E** Moving average.
193. **E** Year, month, quarter columns from a date.
194. **E** Combined key column (Circuit ID - Item Code).
195. **E** Lines per Circuit ID (count of the row's group).
196. **E** Total of the row's group.
197. **E** Flag duplicates.
198. **E** Category band (small, medium, large).
199. **E** Lookup column from another sheet.
200. **E** Cleaned copy of a text column (TRIM, PROPER).
201. **E** Days between two dates.
202. **E** Overdue flag.
203. **E** Conditional value (IF).
204. **E** Header written above the new column.
205. **P** Insert the new column between existing columns (written to the first empty column; insert needs a tool).

## Data cleaning

206. **E** Trim extra spaces (built-in clean step, on a copy).
207. **E** Convert text to numbers.
208. **E** Convert text to dates.
209. **E** Remove duplicate rows (on a copy).
210. **E** Fill blank cells with 0 or a value.
211. **E** Fill blanks with the value above.
212. **E** Data quality report (blanks, duplicates, types).
213. **E** Find outliers.
214. **E** Standardise case.
215. **E** Split a column into several.
216. **E** Combine columns.
217. **E** Unpivot columns into rows.
218. **P** Clean in place on the original sheet (today a cleaned copy; in-place needs write-back with a backup).
219. **N** Remove blank rows in place.
220. **N** Remove duplicate rows in place.
221. **E** Find rows with missing required values (listed on a new sheet).
222. **E** Find invalid codes against a list.
223. **E** Find dates in the future or far past.
224. **E** Find negative quantities.
225. **E** Normalise phone numbers (formula; values are masked to the model).
226. **E** Remove non-printing characters (CLEAN).
227. **E** Replace a value across a column (SUBSTITUTE column, then copy).
228. **N** Find and replace in place across a sheet.
229. **P** Fix numbers stored as text in place (copy today).
230. **E** Detect mixed types in one column.

## Rows and columns

231. **N** Delete rows that match a condition, in place (with backup and undo).
232. **P** Delete rows as a copy without them (works today through a filtered copy).
233. **N** Delete blank rows.
234. **N** Insert rows.
235. **N** Insert a column at a position.
236. **N** Delete a column.
237. **N** Move a column.
238. **N** Hide and unhide rows.
239. **N** Hide and unhide columns.
240. **N** Group and outline rows.
241. **N** Group and outline columns.
242. **E** Autofit column widths.
243. **N** Set a column width.
244. **N** Set a row height.
245. **E** Write a header row.
246. **E** Rename a header in place (write_values on the header cell).
247. **E** Add totals row under the data.
248. **N** Transpose rows and columns in place.
249. **E** Copy rows that match a condition to a new sheet.
250. **E** Copy the first N rows to a new sheet.
251. **N** Clear contents of a range.
252. **N** Clear formats of a range.
253. **E** Fill a series (SEQUENCE formula).
254. **N** Fill down in place for a selection.
255. **N** Merge and unmerge cells.

## Sort and filter

256. **E** Sort by one column in place (live check pending).
257. **N** Sort by several columns in place.
258. **E** Sort as a copy (built-in view step).
259. **N** Custom sort order (list order).
260. **N** Sort left to right.
261. **N** Turn on AutoFilter.
262. **N** Filter in place by a value.
263. **N** Filter in place by several conditions.
264. **N** Filter by top 10.
265. **N** Filter by date (this month, last quarter).
266. **N** Filter by colour.
267. **N** Clear filters.
268. **E** Filtered copy by a value (built-in view step).
269. **E** Filtered copy by several conditions or a test between columns.
270. **E** Filtered list with FILTER on a new sheet.
271. **E** Top N rows by a measure.
272. **E** Show rows above a value.
273. **E** Show rows containing a text.
274. **E** Show rows not equal to a value.
275. **E** Show rows in a date range.
276. **N** Advanced filter with a criteria range.
277. **E** Count of filtered rows.
278. **E** Unique filtered list.
279. **N** Save a filter view.
280. **P** Filter IDs with leading zeros (works in the view step; the agent must quote them).

## Sheets and workbook

281. **E** Add a new sheet.
282. **N** Rename a sheet.
283. **N** Delete a sheet the agent did not create (with confirmation and undo).
284. **N** Hide and unhide a sheet.
285. **N** Move or reorder sheets.
286. **N** Copy a sheet.
287. **N** Change the tab colour.
288. **N** Freeze panes on any sheet.
289. **N** Unfreeze panes.
290. **N** Activate a sheet and select a range for the person.
291. **N** Gridlines on or off.
292. **N** Zoom level.
293. **N** Split the sheet window.
294. **N** Page setup: orientation, margins, fit to page.
295. **N** Print area.
296. **N** Headers and footers for print.
297. **E** Index sheet with links to every sheet (HYPERLINK is blocked; plain list only).
298. **N** Workbook calculation mode (manual or automatic).
299. **N** Recalculate now.
300. **N** Protect and unprotect a sheet (no passwords handled by the agent).

## Tables and named ranges

301. **E** Turn the data into an Excel Table (built-in step).
302. **N** Rename a Table.
303. **N** Change the Table style.
304. **N** Add a total row to a Table.
305. **N** Add a column to a Table.
306. **N** Resize a Table.
307. **E** Convert a Table back to a range (undo does this for its own Tables).
308. **E** Slicer for a Table (built-in step).
309. **E** Create a named range (built-in step).
310. **N** Rename or delete a named range.
311. **N** Named constant (a tax rate).
312. **E** Use structured references in formulas.
313. **N** List Table columns and sizes.
314. **N** Sort and filter inside a Table.
315. **N** Dynamic named range over a spill (#).

## PivotTables

316. **E** PivotTable of a total by a category (520k rows, live).
317. **E** Average, count, max, min instead of sum.
318. **E** Two measures in one PivotTable.
319. **E** Category in rows and another in columns.
320. **E** Nested rows (Circuit ID then Item Code, live).
321. **E** Top N categories.
322. **E** Bottom N categories.
323. **E** Show values as percent of total.
324. **N** Show values as percent of row or column.
325. **N** Running total in a PivotTable.
326. **P** Group dates by month or quarter in a PivotTable (day level today).
327. **N** Add a filter field.
328. **N** Change the layout (tabular, outline, compact).
329. **N** Show or hide subtotals and grand totals.
330. **N** Sort a PivotTable by value or label (top/bottom N sorts already).
331. **N** Add a field to an existing PivotTable.
332. **N** Remove a field from an existing PivotTable.
333. **N** Change the summary function of an existing PivotTable.
334. **N** Refresh a PivotTable.
335. **N** Change the source range of a PivotTable.
336. **E** PivotChart from a PivotTable (chart with the pivot, live).
337. **N** Number format of PivotTable values.
338. **N** Calculated field.
339. **E** Formula pivot instead (GROUPBY/PIVOTBY) when a live table is better.
340. **E** Slicer for a PivotTable.

## Charts

341. **E** Column chart of a total by category.
342. **E** Bar chart.
343. **E** Line chart over time.
344. **E** Pie chart.
345. **E** Area chart.
346. **E** Scatter chart of two measures.
347. **E** Stacked column by a second category.
348. **E** Histogram of a measure (built-in step).
349. **E** Chart of a summary the agent built on a new sheet (create_chart).
350. **E** Chart title.
351. **N** Axis titles.
352. **N** Data labels.
353. **N** Legend position.
354. **N** Chart colours.
355. **N** Combo chart (column and line).
356. **N** Secondary axis.
357. **N** Trendline.
358. **N** Change the type of an existing chart.
359. **N** Move or resize a chart.
360. **N** Delete a chart the agent did not create.
361. **N** Sparklines in cells.
362. **N** Waterfall chart.
363. **N** Treemap and sunburst.
364. **N** Box and whisker.
365. **N** Map chart.

## Conditional formatting

366. **P** Colour scale on a measure (built-in step; on a copy).
367. **P** Data bars (on a copy).
368. **P** Icon sets (on a copy).
369. **P** Highlight values above a number (on a copy).
370. **P** Highlight above or below average (on a copy).
371. **P** Highlight duplicates (on a copy).
372. **N** Conditional formatting in place on the original sheet.
373. **N** Highlight whole rows by a rule (formula rule).
374. **N** Highlight blanks.
375. **N** Highlight errors.
376. **N** Highlight dates before today.
377. **N** Highlight text that contains a word.
378. **N** Top 10 or bottom 10 rule.
379. **N** Unique values rule.
380. **N** Highlight rows where two columns differ.
381. **N** Remove conditional formatting from a range.
382. **N** List the rules on a sheet.
383. **N** Edit an existing rule.
384. **N** Stop-if-true order of rules.
385. **E** Fill colour by a rule written as static colours (format_range on a computed range; not dynamic).

## Cell formatting and layout

386. **E** Number format (thousands, decimals).
387. **E** Percentage format.
388. **E** Date format.
389. **N** Currency format with LKR.
390. **E** Bold.
391. **E** Fill colour.
392. **E** Font colour.
393. **N** Font name and size.
394. **N** Italic and underline.
395. **N** Borders.
396. **N** Alignment (left, centre, right, wrap).
397. **N** Indent.
398. **N** Text rotation.
399. **E** Autofit columns.
400. **E** Format the data nicely: bold header, banded rows (built-in step, on a copy).
401. **N** Cell styles (Good, Bad, Heading 1).
402. **N** Format painter (copy the format of one range to another).
403. **N** Clear formatting.
404. **N** Wrap text.
405. **N** Merge and centre a title.
406. **E** Header row formatting in place (format_range; live check pending).
407. **N** Banded rows in place.
408. **N** Custom number formats with colours ([Red]).
409. **N** Show negative numbers in brackets.
410. **N** Hide zero values.

## Data validation

411. **E** Dropdown list from the values of a column (built-in step).
412. **E** Only dates allowed.
413. **E** Only numbers between two values.
414. **N** Only whole numbers.
415. **N** Text length limit.
416. **N** Dropdown from a list on another sheet.
417. **N** Dependent dropdowns.
418. **N** Custom formula rule.
419. **N** Input message.
420. **N** Error alert text.
421. **N** Circle invalid data.
422. **N** Remove validation.
423. **N** List validation rules on a sheet.
424. **P** Validation on a whole column of 520k rows (built-in step; live check of the "from X to Y" form pending).
425. **N** Copy validation to another range.

## Analysis and statistics

426. **E** Describe a measure (count, mean, median, spread).
427. **E** Describe two measures in one step.
428. **E** Correlation between two measures.
429. **E** Outliers in a measure.
430. **E** Trend of a measure over time.
431. **E** Insights: the largest categories, changes and shares (built-in step).
432. **E** Pareto: which categories make 80% of the total.
433. **E** Concentration: share of the top 5.
434. **E** Distribution by bins.
435. **E** Cross table of two categories.
436. **E** Month-on-month growth table.
437. **E** Cohort-style table by first month.
438. **E** Compare this period with the previous one.
439. **E** Find categories with no rows in a period.
440. **E** Requested vs issued gap per group.
441. **E** Fill rate (issued / requested) per group.
442. **P** Linear regression summary (LINEST works; no plain-language report yet).
443. **N** ANOVA and t-test reports (formulas exist; no guided report).
444. **N** Clustering or segmentation beyond rules.
445. **X** Running Python or other code.

## Forecast and what-if

446. **E** Forecast a measure for the next periods (built-in step).
447. **E** FORECAST.LINEAR in a formula.
448. **N** FORECAST.ETS with seasonality.
449. **E** What-if: change a percentage and show the new totals (formula on a new sheet).
450. **N** Goal seek.
451. **N** Data tables for two inputs.
452. **N** Scenario manager.
453. **E** Break-even calculation.
454. **E** Target vs actual table.
455. **N** Solver-style optimisation.

## Dashboards and reports

456. **E** Dashboard: total by category with a chart (built-in step).
457. **E** Summary sheet with key figures (formulas on a new sheet).
458. **E** Several summary tables on one new sheet.
459. **P** Several charts on one sheet laid out in a grid (create_chart places at "Auto"; no positioning).
460. **N** KPI cards with large numbers and labels (needs fonts and sizes).
461. **E** Monthly report table.
462. **N** Report that refreshes from a slicer for several charts.
463. **E** Export the result as CSV (built-in step).
464. **E** Export as PDF for printing (built-in step).
465. **N** Print-ready layout (page setup tools).

## Multi-sheet and combining data

466. **E** Lookup a column from another sheet.
467. **E** Append two sheets with the same columns.
468. **E** Compare two sheets and list differences (FILTER with COUNTIFS).
469. **E** Keys in one sheet missing in the other.
470. **E** Summary across several sheets (formula per sheet).
471. **N** Combine all sheets of the workbook automatically.
472. **N** Read another workbook (blocked for formulas on purpose; needs a file picker tool).
473. **E** Join two tables on a key into a new sheet.
474. **N** Split one sheet into a sheet per category.
475. **E** Consolidate monthly sheets into one table.

## Comments, protection and other

476. **N** Add a comment to a cell.
477. **N** Reply to or resolve a comment.
478. **N** Add a note.
479. **N** Insert an image.
480. **X** Hyperlinks to web addresses.
481. **X** WEBSERVICE, external data calls.
482. **X** Macros and VBA.
483. **N** Office Scripts generated for the person to review (not run by the agent).
484. **X** Sending e-mail from Excel.
485. **N** Lock cells that hold formulas.

## Agent behaviour

486. **E** Personal data replaced by tokens before anything leaves the device.
487. **E** Every write shown and approved before it runs.
488. **E** Undo of everything applied, including in-place sorts.
489. **E** After apply, reads back what was written and fixes errors (after approval).
490. **E** Says plainly what it cannot do and offers the closest thing.
491. **E** Remembers the conversation in a chat until New chat.
492. **P** Stop button during a long run (stops between model turns, not inside a slow Excel step).
493. **N** Progress for steps that take long on 520k rows (time per step shown).
494. **N** Ask a short clarifying question when a request is ambiguous, with options.
495. **N** Suggest follow-up actions after an answer.
496. **N** Use the person's selection as the range when they say "this".
497. **N** Remember preferred formats and sheets per workbook.
498. **P** Cost per request shown in credits (counted by the gateway; not shown in the pane).
499. **N** Work on Excel desktop for Windows and Mac (built for Excel for the web; desktop not checked).
500. **N** Compare its answers with Copilot on a held-out set of real requests.
