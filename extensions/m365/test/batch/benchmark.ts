/**
 * Copilot-parity benchmark: business requests over the five benchmark workbooks (retail, HR,
 * finance, inventory, support), each run end to end the way the task pane runs it: reader, plan,
 * approval and apply, into an in-memory workbook (gridWorkbook.ts) that keeps every written cell.
 * Then the result sheet is graded on what a senior analyst would check: did it understand the
 * request, pick business columns (not IDs or dates), use the right currency, lay the page out as
 * a dashboard, fall back cleanly on Excel on the web, find duplicate records by their key, and
 * leave the source untouched. No Excel and no model: a regression guard, not a live benchmark.
 *   npx tsx test/batch/benchmark.ts [--write]   (--write updates docs/BENCHMARK_REPORT.md)
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  createExcelPreviewPlan,
  excelPlansMatch,
  selectExcelActions,
} from "../../src/excel.js";
import { createServerExcelPreviewPlan } from "../../../../backend/src/services/m365ExcelPlan.js";
import { interpretInstruction } from "../../src/intent.js";
import { applyApprovedExcelPlan } from "../../src/officeExcel.js";
import { detectBusinessKey } from "../../src/businessContext.js";
import { responseLanguage } from "../../src/i18n.js";
import { writePayrollSheet } from "../../src/officeSriLanka.js";
import {
  buildPayrollPlan,
  employeesFromSelection,
  isPayrollRequest,
  mapPayrollColumns,
  monthFromRequest,
} from "../../src/payroll.js";
import { DATASETS, type Dataset } from "./datasets500.js";
import {
  cellText,
  columnName,
  filledCells,
  gridWorkbook,
  type GridSheet,
  type HostProfile,
} from "./gridWorkbook.js";

export interface Check {
  name: string;
  dimension:
    | "understanding"
    | "business meaning"
    | "layout"
    | "fallback"
    | "duplicates"
    | "safety"
    | "language"
    | "backend parity";
  pass: boolean;
  detail?: string;
}

export interface ScenarioResult {
  id: string;
  dataset: string;
  host: HostProfile;
  request: string;
  checks: Check[];
}

/** Number formats the benchmark gives the source cells, as a finance team would have them. */
const SOURCE_FORMATS: Record<string, Record<string, string>> = {
  retail: { "Unit Price": "[$LKR] #,##0.00", "Net Amount": "[$LKR] #,##0.00" },
  inventory: { "Unit Cost": '"Rs "#,##0.00' },
};

/** Columns that must never be the dashboard's category or values, per dataset. */
const NOT_BUSINESS =
  /(\bid\b|no\b|code|sku|date|opened|closed|counted|name|customer|agent|manager|approved|narration|%)/i;

interface Scenario {
  id: string;
  request: string;
  hosts: HostProfile[];
  datasets?: string[];
  /** The same request in English: a Sinhala or Tamil run must build the same numbers. */
  english?: string;
  grade: (ctx: GradeContext) => Check[];
}

interface GradeContext {
  dataset: Dataset;
  headers: string[];
  host: HostProfile;
  actions: string[];
  specs: any;
  report?: Awaited<ReturnType<typeof applyApprovedExcelPlan>>;
  error?: string;
  result?: GridSheet;
  sourceBefore: string;
  sourceAfter: string;
  /** The server (backend/src/services/m365ExcelPlan.ts) built the same plan from the same request. */
  backend?: { match: boolean; detail?: string };
  /** The run of the scenario's English request, for a Sinhala or Tamil scenario. */
  english?: GradeContext;
}

const check = (
  dimension: Check["dimension"],
  name: string,
  pass: boolean,
  detail?: string,
): Check => ({ dimension, name, pass, ...(detail && !pass ? { detail } : {}) });

function dashboardChecks(
  ctx: GradeContext,
  extra: (ctx: GradeContext) => Check[] = () => [],
  fallbackNote = /could not create a PivotTable/,
): Check[] {
  const checks: Check[] = [];
  checks.push(
    check(
      "understanding",
      "reads the request as a dashboard",
      ctx.actions.includes("dashboard"),
      ctx.actions.join(","),
    ),
  );
  const spec = ctx.specs.dashboard;
  if (spec) {
    const category = ctx.headers[spec.category];
    const values = (spec.values as number[]).map((index) => ctx.headers[index]);
    checks.push(
      check(
        "business meaning",
        "groups by a business category",
        !NOT_BUSINESS.test(category),
        category,
      ),
      check(
        "business meaning",
        "adds up measures, never IDs, dates or percentages",
        values.every((name) => !NOT_BUSINESS.test(name)),
        values.join(", "),
      ),
    );
  }
  const status = ctx.report?.results[0]?.status;
  checks.push(
    check(
      "safety",
      "result is created",
      status === "created",
      ctx.error ?? status,
    ),
  );
  checks.push(
    check(
      "safety",
      "source is unchanged",
      ctx.sourceBefore === ctx.sourceAfter &&
        ctx.report?.sourceUnchangedAfterApply === true,
    ),
  );
  const sheet = ctx.result;
  if (!sheet) return [...checks, ...extra(ctx)];
  const cards = filledCells(sheet).filter(
    ([row, col, text]) => row === 3 && col < 6 && text,
  );
  checks.push(
    check("layout", "title on the first row", cellText(sheet, 0, 0).length > 0),
    check(
      "layout",
      "at least three KPI cards in one row",
      cards.length >= 3,
      `${cards.length} cards`,
    ),
    check(
      "layout",
      "every KPI card has a live value",
      cards.every(([, col]) => cellText(sheet, 4, col).startsWith("=")),
    ),
    check(
      "layout",
      "at least one chart, placed",
      sheet.charts.length >= 1 &&
        sheet.charts.every((chart) => Boolean(chart.from && chart.to)),
    ),
    check(
      "layout",
      "gridlines off for a clean page",
      sheet.showGridlines === false,
    ),
  );
  if (ctx.host === "desktop") {
    checks.push(
      check(
        "layout",
        "breakdown PivotTable under the cards",
        sheet.pivots.length === 1 && sheet.pivots[0].anchor === "A10",
        JSON.stringify(sheet.pivots),
      ),
      check(
        "layout",
        "slicer beside the PivotTable",
        sheet.slicers.length === 1 &&
          sheet.slicers[0].field === ctx.headers[spec?.category],
      ),
    );
  } else {
    const notes = ctx.report?.results[0]?.notes?.join(" ") ?? "";
    checks.push(
      check("fallback", "no PivotTable left behind", sheet.pivots.length === 0),
      check(
        "fallback",
        "live formula breakdown in the PivotTable's place",
        /^=/.test(cellText(sheet, 10, 1)),
        cellText(sheet, 10, 1),
      ),
      check(
        "fallback",
        "the person is told why",
        fallbackNote.test(notes),
        notes,
      ),
    );
  }
  return [...checks, ...extra(ctx)];
}

const currencyCheck = (ctx: GradeContext): Check[] => {
  const sheet = ctx.result;
  if (!sheet) return [];
  const expected: Record<string, RegExp | "mixed" | null> = {
    retail: /LKR/,
    hr: /Rs/,
    finance: "mixed",
    inventory: null,
    support: null,
  };
  const want = expected[ctx.dataset.id];
  const formats = filledCells(sheet)
    .filter(([row, col]) => row === 4 && col < 6)
    .map(([, , , cell]) => cell.numberFormat ?? "");
  if (want === "mixed") {
    const note = cellText(sheet, 6, 0);
    return [
      check(
        "business meaning",
        "warns that rows are in different currencies",
        // English, or the Sinhala/Tamil note: it names both currency codes.
        /different currencies|mixes currencies/.test(note) ||
          (/[\u0D80-\u0DFF\u0B80-\u0BFF]/.test(note) &&
            /LKR/.test(note) &&
            /USD/.test(note)),
        note,
      ),
      check(
        "business meaning",
        "no single currency on mixed amounts",
        !formats.some((format) => /LKR|USD|Rs|\$/.test(format)),
        formats.join(" | "),
      ),
    ];
  }
  if (want)
    return [
      check(
        "business meaning",
        "money is shown in the workbook's currency",
        formats.some((format) => want.test(format)),
        formats.join(" | "),
      ),
    ];
  return [];
};

const SCRIPTS = {
  si: { name: "Sinhala", re: /[\u0D80-\u0DFF]/ },
  ta: { name: "Tamil", re: /[\u0B80-\u0BFF]/ },
} as const;

/** Words of the English templates that must not be left in a Sinhala or Tamil result. */
const ENGLISH_TEMPLATE =
  /\b(by|of|TOTAL|RECORDS|TOP|GAP TO|BREAKDOWN|Live formulas|Management summary|Operational view|distribution|forecast)\b/;

/** Formula cells without text in them: the numbers, which must not change with the language. */
const numberFormulas = (sheet: GridSheet | undefined) =>
  sheet
    ? filledCells(sheet)
        .filter(([, , text]) => text.startsWith("=") && !text.includes('"'))
        .map(([row, col, text]) => `${row},${col}:${text}`)
        .join("\n")
    : "";

/** A Sinhala or Tamil request reads like its English twin and writes its words in that script. */
function languageChecks(
  ctx: GradeContext,
  language: keyof typeof SCRIPTS,
  {
    cards = false,
    sheetWords = true,
  }: { cards?: boolean; sheetWords?: boolean } = {},
): Check[] {
  const { name, re } = SCRIPTS[language];
  const english = ctx.english;
  const sheet = ctx.result;
  const checks = [
    check(
      "understanding",
      `reads the ${name} request like the English one`,
      Boolean(english) &&
        JSON.stringify([ctx.actions, ctx.specs]) ===
          JSON.stringify([english!.actions, english!.specs]),
      `${JSON.stringify(ctx.actions)} vs ${JSON.stringify(english?.actions)}`,
    ),
  ];
  if (!sheetWords) return checks;
  const titles = sheet?.charts.map((chart) => chart.title ?? "") ?? [];
  const labels =
    cards && sheet
      ? filledCells(sheet)
          .filter(([row, col, text]) => row === 3 && col < 6 && text)
          .map(([, , text]) => text)
      : [];
  const words = [
    ...(cards && sheet ? [cellText(sheet, 0, 0), cellText(sheet, 1, 0)] : []),
    ...labels,
    ...titles,
  ];
  checks.push(
    check(
      "language",
      `chart titles are in ${name}`,
      titles.length > 0 && titles.every((title) => re.test(title)),
      titles.join(" / "),
    ),
    check(
      "language",
      "no English template words left on the sheet",
      words.length > 0 && words.every((text) => !ENGLISH_TEMPLATE.test(text)),
      words.find((text) => ENGLISH_TEMPLATE.test(text)),
    ),
    check(
      "language",
      "the same numbers as the English result",
      Boolean(sheet && english?.result) &&
        numberFormulas(sheet) === numberFormulas(english!.result) &&
        sheet!.charts.length === english!.result!.charts.length &&
        sheet!.pivots.length === english!.result!.pivots.length,
    ),
  );
  if (cards)
    checks.push(
      check(
        "language",
        `title and KPI labels are in ${name}`,
        Boolean(sheet) &&
          re.test(cellText(sheet!, 0, 0)) &&
          labels.length >= 3 &&
          labels.every((label) => re.test(label)),
        labels.join(" / "),
      ),
    );
  return checks;
}

const duplicateChecks = (ctx: GradeContext): Check[] => {
  const key = detectBusinessKey(ctx.headers, ctx.dataset.rows as any);
  const highlight = ctx.specs.view?.highlight;
  return [
    check(
      "understanding",
      "reads it as a duplicate check",
      highlight?.rule === "duplicates",
      JSON.stringify(ctx.specs.view),
    ),
    check(
      "duplicates",
      "checks the record key, not a random column",
      Boolean(key) && highlight?.column === key!.columns[0],
      `${ctx.headers[highlight?.column] ?? "none"} vs ${key?.names.join("+") ?? "no key"}`,
    ),
    check(
      "safety",
      "result is created",
      ctx.report?.results[0]?.status === "created",
      ctx.error,
    ),
    check(
      "safety",
      "source is unchanged",
      ctx.sourceBefore === ctx.sourceAfter,
    ),
  ];
};

const chartChecks = (ctx: GradeContext): Check[] => [
  check(
    "understanding",
    "reads it as a chart of Net Amount by Region",
    ctx.actions.includes("chart") &&
      ctx.headers[ctx.specs.chart?.category] === "Region" &&
      ctx.headers[ctx.specs.chart?.value] === "Net Amount",
    JSON.stringify(ctx.specs.chart),
  ),
  check(
    "business meaning",
    "the chart title names both columns",
    (ctx.result?.charts ?? []).some(
      (chart) =>
        /Net Amount/.test(chart.title ?? "") &&
        /Region/.test(chart.title ?? ""),
    ),
    ctx.result?.charts.map((chart) => chart.title).join(" / "),
  ),
  check("safety", "source is unchanged", ctx.sourceBefore === ctx.sourceAfter),
];

const SCENARIOS: Scenario[] = [
  {
    id: "dash-management",
    request: "make a one-page dashboard for management",
    hosts: ["desktop", "web"],
    grade: (ctx) =>
      dashboardChecks(ctx, (c) => [
        ...currencyCheck(c),
        check(
          "business meaning",
          "says it is a management summary",
          /^Management summary/.test(c.result ? cellText(c.result, 1, 0) : ""),
        ),
      ]),
  },
  {
    id: "dash-target",
    request: "dashboard for the monthly review, target 5M",
    hosts: ["desktop"],
    grade: (ctx) =>
      dashboardChecks(ctx, (c) => {
        const sheet = c.result;
        const labels = sheet
          ? filledCells(sheet)
              .filter(([row, col]) => row === 3 && col < 6)
              .map(([, , text]) => text)
          : [];
        const percent = sheet
          ? filledCells(sheet).find(
              ([row, col, , cell]) =>
                row === 4 && col < 6 && cell.numberFormat === "0.0%",
            )
          : undefined;
        return [
          check(
            "business meaning",
            "shows % of the target",
            labels.includes("% OF TARGET"),
            labels.join(", "),
          ),
          check(
            "business meaning",
            "target formula divides by 5,000,000",
            Boolean(percent && /\/5000000,0\)$/.test(percent[2])),
            percent?.[2],
          ),
        ];
      }),
  },
  {
    id: "dash-operations",
    request: "daily tracking dashboard so the team can follow up",
    hosts: ["desktop"],
    grade: (ctx) =>
      dashboardChecks(ctx, (c) => [
        check(
          "business meaning",
          "says it is an operational view",
          /^Operational view/.test(c.result ? cellText(c.result, 1, 0) : ""),
        ),
      ]),
  },
  {
    id: "duplicates",
    request: "find duplicate transactions",
    hosts: ["desktop"],
    grade: duplicateChecks,
  },
  {
    id: "quality",
    request: "data quality report",
    hosts: ["desktop"],
    grade: (ctx) => {
      const sheet = ctx.result;
      const text = sheet
        ? filledCells(sheet)
            .map(([, , t]) => t)
            .join("\n")
        : "";
      const key = detectBusinessKey(ctx.headers, ctx.dataset.rows as any);
      return [
        check(
          "understanding",
          "reads it as a quality report",
          ctx.actions.includes("quality"),
          ctx.actions.join(","),
        ),
        check(
          "duplicates",
          "names the business key",
          Boolean(key) &&
            text.includes(`Business key\n${key!.names.join(" + ")}`),
          key?.names.join("+"),
        ),
        check(
          "duplicates",
          "reports repeated key values",
          !key ||
            !key.duplicateKeys ||
            text.includes("value(s) are used on more than one row"),
        ),
        check(
          "safety",
          "source is unchanged",
          ctx.sourceBefore === ctx.sourceAfter,
        ),
      ];
    },
  },
  {
    id: "si-dash-management",
    request: "කළමනාකරණයට එක පිටුවක dashboard එකක් හදන්න",
    english: "make a one-page dashboard for management",
    hosts: ["desktop", "web"],
    grade: (ctx) =>
      dashboardChecks(
        ctx,
        (c) => [
          ...currencyCheck(c),
          check(
            "business meaning",
            "says it is a management summary",
            /^කළමනාකරණ සාරාංශය/.test(c.result ? cellText(c.result, 1, 0) : ""),
            c.result ? cellText(c.result, 1, 0) : "",
          ),
          ...languageChecks(c, "si", { cards: true }),
        ],
        /PivotTable එකක් සෑදිය නොහැකි/,
      ),
  },
  {
    id: "ta-dash-management",
    request: "நிர்வாகத்திற்கு ஒரு பக்க dashboard உருவாக்கு",
    english: "make a one-page dashboard for management",
    hosts: ["desktop", "web"],
    grade: (ctx) =>
      dashboardChecks(
        ctx,
        (c) => [
          ...currencyCheck(c),
          check(
            "business meaning",
            "says it is a management summary",
            /^நிர்வாகச் சுருக்கம்/.test(
              c.result ? cellText(c.result, 1, 0) : "",
            ),
            c.result ? cellText(c.result, 1, 0) : "",
          ),
          ...languageChecks(c, "ta", { cards: true }),
        ],
        /PivotTable ஐ உருவாக்க முடியவில்லை/,
      ),
  },
  {
    id: "si-chart",
    request: "Region අනුව මුළු Net Amount ප්‍රස්තාරයක්",
    english: "chart of total Net Amount by Region",
    hosts: ["desktop"],
    datasets: ["retail"],
    grade: (ctx) => [...chartChecks(ctx), ...languageChecks(ctx, "si")],
  },
  {
    id: "ta-chart",
    request: "Region வாரியாக மொத்த Net Amount வரைபடம்",
    english: "chart of total Net Amount by Region",
    hosts: ["desktop"],
    datasets: ["retail"],
    grade: (ctx) => [...chartChecks(ctx), ...languageChecks(ctx, "ta")],
  },
  {
    id: "si-duplicates",
    request: "අනුපිටපත් ගනුදෙනු සොයන්න",
    english: "find duplicate transactions",
    hosts: ["desktop"],
    grade: (ctx) => [
      ...duplicateChecks(ctx),
      ...languageChecks(ctx, "si", { sheetWords: false }),
    ],
  },
  {
    id: "ta-duplicates",
    request: "நகல் பரிவர்த்தனைகளைக் கண்டுபிடி",
    english: "find duplicate transactions",
    hosts: ["desktop"],
    grade: (ctx) => [
      ...duplicateChecks(ctx),
      ...languageChecks(ctx, "ta", { sheetWords: false }),
    ],
  },
  {
    id: "singlish-duplicates",
    request: "duplicate ganudenu hoyanna",
    english: "find duplicate transactions",
    hosts: ["desktop"],
    grade: (ctx) => [
      ...duplicateChecks(ctx),
      ...languageChecks(ctx, "si", { sheetWords: false }),
    ],
  },
];

const snapshot = (sheet: GridSheet | undefined) =>
  sheet ? JSON.stringify(filledCells(sheet).map(([r, c, t]) => [r, c, t])) : "";

/** Runs one request end to end the way the task pane does, into a fresh in-memory workbook. */
async function runRequest(
  dataset: Dataset,
  host: HostProfile,
  request: string,
): Promise<GradeContext> {
  const headers = dataset.columns.map((column) => column.name);
  // Excel reads an empty cell back as "", so the source is given the way the reader sees it.
  const values = [headers, ...dataset.rows].map((row) =>
    row.map((cell) => (cell === null || cell === undefined ? "" : cell)),
  );
  const rows = values.slice(1);
  const formats = headers.map(
    (name) => SOURCE_FORMATS[dataset.id]?.[name] ?? "General",
  );
  const book = gridWorkbook(
    dataset.sheet,
    values.map((row) => [...row]),
    {
      host,
      sourceFormats: formats,
    },
  );
  const interpreted: any = interpretInstruction(request, headers, rows as any);
  const actions = [
    ...new Set([...selectExcelActions(request), ...interpreted.actions]),
  ].filter(
    (kind) => !(kind === "new-sheet" && interpreted.actions.includes("view")),
  ) as any[];
  const specs = interpreted.specs ?? {};
  const ctx: GradeContext = {
    dataset,
    headers,
    host,
    actions,
    specs,
    sourceBefore: snapshot(book.sheets.get(dataset.sheet)),
    sourceAfter: "",
  };
  try {
    const input: any = {
      workbookId: `bench-${dataset.id}`,
      worksheetName: dataset.sheet,
      address: `${dataset.sheet}!A1:${columnName(headers.length - 1)}${values.length}`,
      values,
      hasHeaders: true,
    };
    const plan: any = createExcelPreviewPlan(input, actions, 500, specs);
    try {
      const server = createServerExcelPreviewPlan(input, actions, 500, specs);
      ctx.backend = excelPlansMatch(plan, server)
        ? { match: true }
        : { match: false, detail: "client and server plans differ" };
    } catch (error) {
      ctx.backend = {
        match: false,
        detail: (error as Error).message.slice(0, 160),
      };
    }
    ctx.report = await applyApprovedExcelPlan(
      book.runtime,
      plan,
      true,
      "approval",
      {
        expectedSourceFingerprint: plan.sourceFingerprint,
        supportsExcelApi: book.supportsExcelApi,
        request,
      },
    );
    const failed = ctx.report.results.find(
      (entry) => entry.status === "failed",
    );
    if (failed) ctx.error = failed.error;
    const target = ctx.report.results[0]?.targetSheet;
    ctx.result = target ? book.sheets.get(target) : undefined;
  } catch (error) {
    ctx.error = (error as Error).message;
  }
  ctx.sourceAfter = snapshot(book.sheets.get(dataset.sheet));
  return ctx;
}

export async function runBenchmark(): Promise<ScenarioResult[]> {
  const results: ScenarioResult[] = [];
  for (const dataset of DATASETS) {
    for (const scenario of SCENARIOS) {
      if (scenario.datasets && !scenario.datasets.includes(dataset.id))
        continue;
      for (const host of scenario.hosts) {
        const ctx = await runRequest(dataset, host, scenario.request);
        if (scenario.english)
          ctx.english = await runRequest(dataset, host, scenario.english);
        results.push({
          id: scenario.id,
          dataset: dataset.id,
          host,
          request: scenario.request,
          checks: [
            ...scenario.grade(ctx),
            check(
              "backend parity",
              "the backend builds the same plan",
              ctx.backend?.match === true,
              ctx.backend?.detail ?? ctx.error,
            ),
          ],
        });
      }
    }
  }
  results.push(...(await runTemplateBenchmark()));
  return results;
}

/**
 * One-click templates (payroll.ts): a payroll request in English, Sinhala, Tamil or Singlish over
 * the staff list builds the month's payroll sheet the way the task pane does, and a request about
 * the data that is already there is never taken for one.
 */
const TEMPLATE_SCENARIOS: Array<{
  id: string;
  request: string;
  payroll: boolean;
  language: "en" | "si" | "ta";
}> = [
  {
    id: "payroll-en",
    request: "make the payroll for October 2026",
    payroll: true,
    language: "en",
  },
  {
    id: "payroll-si",
    request: "2026-10 වැටුප් ලේඛනය හදන්න",
    payroll: true,
    language: "si",
  },
  {
    id: "payroll-ta",
    request: "2026-10 சம்பளப் பட்டியல் தயாரி",
    payroll: true,
    language: "ta",
  },
  {
    id: "payroll-singlish",
    request: "October 2026 padi sheet ekak hadanna",
    payroll: true,
    language: "en",
  },
  {
    id: "payroll-epf",
    request: "calculate EPF and ETF for 2026-10",
    payroll: true,
    language: "en",
  },
  {
    id: "not-payroll-chart",
    request: "chart of Salary (LKR) by Department",
    payroll: false,
    language: "en",
  },
  {
    id: "not-payroll-total",
    request: "total Bonus by Location",
    payroll: false,
    language: "en",
  },
  {
    id: "not-payroll-sort",
    request: "sort the payroll by name",
    payroll: false,
    language: "en",
  },
  {
    id: "not-payroll-question",
    request: "what is the total payroll cost?",
    payroll: false,
    language: "en",
  },
  {
    id: "not-payroll-column",
    request: "add an EPF column",
    payroll: false,
    language: "en",
  },
  {
    id: "not-payroll-fix",
    request: "fix the formula in my payroll sheet",
    payroll: false,
    language: "en",
  },
];

const SCRIPT_OF = { si: /[\u0D80-\u0DFF]/, ta: /[\u0B80-\u0BFF]/ } as const;

async function runTemplateBenchmark(): Promise<ScenarioResult[]> {
  const dataset = DATASETS.find((entry) => entry.id === "hr")!;
  const headers = dataset.columns.map((column) => column.name);
  const values = [headers, ...dataset.rows].map((row) =>
    row.map((cell) => (cell === null || cell === undefined ? "" : cell)),
  );
  const results: ScenarioResult[] = [];
  for (const scenario of TEMPLATE_SCENARIOS) {
    const checks: Check[] = [];
    const recognized = isPayrollRequest(scenario.request);
    checks.push(
      check(
        "understanding",
        scenario.payroll
          ? "the request is read as a payroll sheet"
          : "a request about the data is not taken for a payroll sheet",
        recognized === scenario.payroll,
      ),
    );
    if (scenario.payroll) {
      const book = gridWorkbook(
        dataset.sheet,
        values.map((row) => [...row]),
      );
      const before = snapshot(book.sheets.get(dataset.sheet));
      const map = mapPayrollColumns(headers);
      const employees = map ? employeesFromSelection(values.slice(1), map) : [];
      const language = responseLanguage(scenario.request, "en");
      const plan = buildPayrollPlan({
        month: monthFromRequest(scenario.request, new Date(2026, 9, 21)),
        employees,
        language,
      });
      const written = await writePayrollSheet(book.runtime, plan);
      const sheet = book.sheets.get(plan.sheet);
      const cell = (row: number, col: number) =>
        sheet?.cells.get(`${row - 1},${col - 1}`);
      const bodyRows = Array.from(
        { length: employees.length },
        (_, index) => 5 + index,
      );
      checks.push(
        check(
          "understanding",
          "the month comes from the request",
          plan.sheet === "Payroll 2026-10",
          plan.sheet,
        ),
        check(
          "business meaning",
          "every employee in the staff list is copied, salary as basic, and the bonus left for APIT Table 2",
          employees.length ===
            dataset.rows.filter((row) => String(row[5] ?? "").trim() !== "")
              .length &&
            map?.basic === headers.indexOf("Salary (LKR)") &&
            map?.skipped.includes(headers.indexOf("Bonus")) === true &&
            !map?.otherAllowances.includes(headers.indexOf("Bonus")) &&
            map?.id === headers.indexOf("Employee ID"),
          JSON.stringify(map),
        ),
        check(
          "layout",
          "the payroll sheet is added",
          written.ok && Boolean(sheet),
          written.ok ? "" : written.error,
        ),
        check(
          "layout",
          "every row has live EPF, APIT, net pay and employer cost formulas",
          bodyRows.every((row) =>
            [6, 7, 8, 10, 11, 12, 13].every((col) =>
              String(cell(row, col)?.formula ?? "").startsWith("="),
            ),
          ),
        ),
        check(
          "business meaning",
          "EPF, ETF and APIT read the rate cells, not typed numbers",
          bodyRows.every(
            (row) =>
              /\$P\$5/.test(String(cell(row, 7)?.formula)) &&
              /\$O\$13:\$O\$18/.test(String(cell(row, 8)?.formula)) &&
              /\$P\$7/.test(String(cell(row, 12)?.formula)),
          ),
        ),
        check(
          "safety",
          "the staff list is not changed",
          snapshot(book.sheets.get(dataset.sheet)) === before,
        ),
        check(
          "safety",
          "the sheet says the rates need an accountant's check",
          plan.needsReview === false ||
            /accountant|ගණකාධිකාරි|கணக்காளர/.test(String(cell(2, 1)?.value)),
        ),
      );
      if (scenario.language !== "en")
        checks.push(
          check(
            "language",
            "the sheet's headings are in the request's language",
            language === scenario.language &&
              SCRIPT_OF[scenario.language].test(String(cell(4, 3)?.value)) &&
              SCRIPT_OF[scenario.language].test(String(cell(1, 1)?.value)),
          ),
        );
    }
    results.push({
      id: scenario.id,
      dataset: dataset.id,
      host: "desktop",
      request: scenario.request,
      checks,
    });
  }
  return results;
}

export function scoreBoard(results: ScenarioResult[]) {
  const byDimension = new Map<string, { pass: number; total: number }>();
  for (const result of results)
    for (const item of result.checks) {
      const entry = byDimension.get(item.dimension) ?? { pass: 0, total: 0 };
      entry.total += 1;
      if (item.pass) entry.pass += 1;
      byDimension.set(item.dimension, entry);
    }
  const all = [...byDimension.values()].reduce(
    (sum, entry) => ({
      pass: sum.pass + entry.pass,
      total: sum.total + entry.total,
    }),
    { pass: 0, total: 0 },
  );
  return { byDimension, all };
}

export function benchmarkReport(results: ScenarioResult[]): string {
  const { byDimension, all } = scoreBoard(results);
  const pct = (pass: number, total: number) =>
    `${total ? Math.round((pass / total) * 100) : 0}%`;
  const lines = [
    "# Copilot-parity benchmark",
    "",
    "Business requests over the five benchmark workbooks, run end to end (reader, plan, apply) into an in-memory workbook and graded cell by cell. Headless: it proves what the add-in writes, not how real Excel draws it. Regenerate with `npx tsx test/batch/benchmark.ts --write` in `extensions/m365`.",
    "",
    `Overall: **${all.pass}/${all.total} checks (${pct(all.pass, all.total)})** over ${results.length} runs.`,
    "",
    "| Dimension | Passed | Score |",
    "| --- | --- | --- |",
    ...[...byDimension.entries()].map(
      ([name, entry]) =>
        `| ${name} | ${entry.pass}/${entry.total} | ${pct(entry.pass, entry.total)} |`,
    ),
    "",
    "| Scenario | Workbook | Host | Passed | Failed checks |",
    "| --- | --- | --- | --- | --- |",
    ...results.map((result) => {
      const failed = result.checks.filter((item) => !item.pass);
      return `| ${result.id} | ${result.dataset} | ${result.host} | ${result.checks.length - failed.length}/${result.checks.length} | ${
        failed
          .map(
            (item) =>
              `${item.name}${item.detail ? ` (${String(item.detail).replace(/\|/g, "/").slice(0, 80)})` : ""}`,
          )
          .join("; ") || "none"
      } |`;
    }),
    "",
    "Not covered here: real Excel Desktop and Excel on the web (chart drawing, slicer placement, calculated values) and the AI model path. Those need a live run on a machine with Excel.",
    "",
  ];
  return lines.join("\n");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const results = await runBenchmark();
  const report = benchmarkReport(results);
  const { all } = scoreBoard(results);
  // Print the scores and only the runs that failed a check.
  console.log(
    report
      .split("\n")
      .filter((line) => !line.endsWith("| none |"))
      .join("\n"),
  );
  if (process.argv.includes("--write"))
    writeFileSync(
      new URL("../../../../docs/BENCHMARK_REPORT.md", import.meta.url),
      report,
    );
  process.exitCode = all.pass === all.total ? 0 : 1;
}
