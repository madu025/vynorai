# Live-proven cases

Format: `case id | date | git commit | dependent files`. A case is proven only while
`git diff <commit> HEAD -- <files>` is empty. Only a live pass in Excel counts.

question-large | 2026-10-16 | 8c6315f | extensions/m365/src/intent.ts, extensions/m365/src/taskpane.ts
add-column | 2026-10-16 | 8c6315f | extensions/m365/src/intent.ts, extensions/m365/src/excel.ts, backend/src/services/m365ExcelPlan.ts, extensions/m365/src/officeExcel.ts, extensions/m365/src/largeRange.ts
pivot-1 | 2026-10-16 | 8c6315f | extensions/m365/src/intent.ts, extensions/m365/src/excel.ts, backend/src/services/m365ExcelPlan.ts, extensions/m365/src/officeExcel.ts
pivot-2 | 2026-10-16 | 8c6315f | extensions/m365/src/intent.ts, extensions/m365/src/excel.ts, backend/src/services/m365ExcelPlan.ts, extensions/m365/src/officeExcel.ts
pivot-topn | 2026-10-16 | 8c6315f | extensions/m365/src/intent.ts, extensions/m365/src/excel.ts, backend/src/services/m365ExcelPlan.ts, extensions/m365/src/officeExcel.ts
chart-pivot | 2026-10-16 | 8c6315f | extensions/m365/src/intent.ts, extensions/m365/src/excel.ts, backend/src/services/m365ExcelPlan.ts, extensions/m365/src/officeExcel.ts
summary | 2026-10-16 | 8c6315f | extensions/m365/src/intent.ts, extensions/m365/src/excel.ts, backend/src/services/m365ExcelPlan.ts, extensions/m365/src/officeExcel.ts
stats-describe | 2026-10-16 | 8c6315f | extensions/m365/src/intent.ts, extensions/m365/src/excel.ts, backend/src/services/m365ExcelPlan.ts, extensions/m365/src/officeExcel.ts, extensions/m365/src/statistics.ts
forecast | 2026-10-16 | 8c6315f | extensions/m365/src/intent.ts, extensions/m365/src/excel.ts, backend/src/services/m365ExcelPlan.ts, extensions/m365/src/officeExcel.ts, extensions/m365/src/statistics.ts
view | 2026-10-16 | 8c6315f | extensions/m365/src/intent.ts, extensions/m365/src/excel.ts, backend/src/services/m365ExcelPlan.ts, extensions/m365/src/officeExcel.ts, extensions/m365/src/largeRange.ts
clean-bounded | 2026-10-16 | 8c6315f | extensions/m365/src/intent.ts, extensions/m365/src/excel.ts, backend/src/services/m365ExcelPlan.ts, extensions/m365/src/officeExcel.ts, extensions/m365/src/largeRange.ts, extensions/m365/src/transform.ts
format | 2026-10-16 | 8c6315f | extensions/m365/src/intent.ts, extensions/m365/src/excel.ts, backend/src/services/m365ExcelPlan.ts, extensions/m365/src/officeExcel.ts
cf-scale-bars | 2026-10-16 | 8c6315f | extensions/m365/src/intent.ts, extensions/m365/src/excel.ts, backend/src/services/m365ExcelPlan.ts, extensions/m365/src/officeExcel.ts
val-dropdown | 2026-10-16 | 8c6315f | extensions/m365/src/intent.ts, extensions/m365/src/excel.ts, backend/src/services/m365ExcelPlan.ts, extensions/m365/src/officeExcel.ts
quality-data | 2026-10-16 | 8c6315f | extensions/m365/src/intent.ts, extensions/m365/src/excel.ts, backend/src/services/m365ExcelPlan.ts, extensions/m365/src/officeExcel.ts, extensions/m365/src/largeRange.ts
dashboard | 2026-10-16 | 8c6315f | extensions/m365/src/intent.ts, extensions/m365/src/excel.ts, backend/src/services/m365ExcelPlan.ts, extensions/m365/src/officeExcel.ts
split | 2026-10-16 | 8c6315f | extensions/m365/src/intent.ts, extensions/m365/src/excel.ts, backend/src/services/m365ExcelPlan.ts, extensions/m365/src/officeExcel.ts
si-pivot | 2026-10-16 | 8c6315f | extensions/m365/src/intent.ts, extensions/m365/src/excel.ts, backend/src/services/m365ExcelPlan.ts, extensions/m365/src/officeExcel.ts
new-chat | 2026-10-16 | 8c6315f | extensions/m365/src/taskpane.ts, extensions/m365/src/chatSessions.ts
session | 2026-10-16 | 8c6315f | extensions/m365/src/taskpane.ts, backend/src/services/m365Policy.ts
ai-analysis | 2026-10-16 | 8c6315f | extensions/m365/src/taskpane.ts, extensions/m365/src/analysis.ts, backend/src/services/m365Analysis.ts
p-cols | 2026-10-16 | b2f795b | extensions/m365/src/intent.ts, extensions/m365/src/excel.ts, backend/src/services/m365ExcelPlan.ts, extensions/m365/src/officeExcel.ts
c-pie | 2026-10-16 | b2f795b | extensions/m365/src/intent.ts, extensions/m365/src/excel.ts, backend/src/services/m365ExcelPlan.ts, extensions/m365/src/officeExcel.ts
c-hist | 2026-10-16 | b2f795b | extensions/m365/src/intent.ts, extensions/m365/src/excel.ts, backend/src/services/m365ExcelPlan.ts, extensions/m365/src/officeExcel.ts, extensions/m365/src/largeRange.ts
st-corr | 2026-10-16 | b2f795b | extensions/m365/src/intent.ts, extensions/m365/src/excel.ts, backend/src/services/m365ExcelPlan.ts, extensions/m365/src/officeExcel.ts, extensions/m365/src/statistics.ts
v-sort | 2026-10-16 | b2f795b | extensions/m365/src/intent.ts, extensions/m365/src/excel.ts, backend/src/services/m365ExcelPlan.ts, extensions/m365/src/officeExcel.ts, extensions/m365/src/largeRange.ts
cl-dupe | 2026-10-16 | b2f795b | extensions/m365/src/intent.ts, extensions/m365/src/excel.ts, backend/src/services/m365ExcelPlan.ts, extensions/m365/src/officeExcel.ts, extensions/m365/src/transform.ts
cl-fill | 2026-10-16 | b2f795b | extensions/m365/src/intent.ts, extensions/m365/src/excel.ts, backend/src/services/m365ExcelPlan.ts, extensions/m365/src/officeExcel.ts, extensions/m365/src/transform.ts
cf-icons | 2026-10-16 | b2f795b | extensions/m365/src/intent.ts, extensions/m365/src/excel.ts, backend/src/services/m365ExcelPlan.ts, extensions/m365/src/officeExcel.ts
p-count | 2026-10-16 | b2f795b | extensions/m365/src/intent.ts, extensions/m365/src/excel.ts, backend/src/services/m365ExcelPlan.ts, extensions/m365/src/officeExcel.ts
cf-above | 2026-10-16 | 377383c | extensions/m365/src/intent.ts, extensions/m365/src/excel.ts, backend/src/services/m365ExcelPlan.ts, extensions/m365/src/officeExcel.ts
val-date | 2026-10-16 | 377383c | extensions/m365/src/intent.ts, extensions/m365/src/excel.ts, backend/src/services/m365ExcelPlan.ts, extensions/m365/src/officeExcel.ts
nr-name | 2026-10-16 | 377383c | extensions/m365/src/intent.ts, extensions/m365/src/excel.ts, backend/src/services/m365ExcelPlan.ts, extensions/m365/src/officeExcel.ts
f-year | 2026-10-16 | 377383c | extensions/m365/src/intent.ts, extensions/m365/src/excel.ts, backend/src/services/m365ExcelPlan.ts, extensions/m365/src/officeExcel.ts
r-newsheet | 2026-10-16 | 08a0440 | extensions/m365/src/intent.ts, extensions/m365/src/excel.ts, backend/src/services/m365ExcelPlan.ts, extensions/m365/src/officeExcel.ts
