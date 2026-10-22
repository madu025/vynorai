import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildDashboardLayout,
  type DashboardLayoutInput,
} from "./dashboardLayout.js";
import { interpretInstruction, normalizeInstruction } from "./intent.js";
import { audienceWithPreference } from "./preferences.js";
import {
  didYouMean,
  doneSentence,
  samplePreviewNote,
  usingRowsSummary,
  willBeCreatedOn,
} from "./paneText.js";
import { localizeMessage, responseLanguage } from "./i18n.js";
import { whatsappSummary } from "./whatsappSummary.js";
import { workbookText } from "./workbookText.js";

const SINHALA = /[඀-෿]/;
const TAMIL = /[஀-௿]/;

const base = (
  over: Partial<DashboardLayoutInput> = {},
): DashboardLayoutInput => ({
  categoryName: "Region",
  categoryRef: "'Data'!$A$2:$A$7",
  values: [
    { name: "Sales", ref: "'Data'!$B$2:$B$7" },
    { name: "Qty", ref: "'Data'!$C$2:$C$7" },
  ],
  aggregation: "sum",
  categories: ["North", "South", "East"],
  totalCategories: 3,
  sampled: false,
  money: [true, false],
  audience: "management",
  target: { label: "target", value: 5000000, column: 0 } as any,
  sourceLabel: "'Data'!A1:C7",
  ...over,
});

const cells = (layout: ReturnType<typeof buildDashboardLayout>) =>
  layout.blocks.flatMap((block) =>
    block.cells.flatMap((row, r) =>
      row.map((cell, c) => ({
        at: `${block.row + r},${block.col + c}`,
        style: block.style,
        text:
          typeof cell === "object" && cell
            ? (cell as { f: string }).f
            : String(cell),
      })),
    ),
  );

test("an English dashboard keeps its original words", () => {
  const layout = buildDashboardLayout(base());
  const all = cells(layout).map((cell) => cell.text);
  assert.equal(layout.title, "Sales, Qty by Region");
  for (const word of [
    "RECORDS",
    "TOTAL SALES",
    "% OF TARGET",
    "GAP TO TARGET",
    "TOP REGION",
    "BREAKDOWN BY REGION",
    "Chart data (live formulas)",
    "Total of Sales",
  ])
    assert.ok(all.includes(word), word);
  assert.equal(layout.charts[0].title, "Total of Sales by Region");
  assert.ok(
    all.some((text) => text.startsWith('="Average "&TEXT(')),
    "average line",
  );
});

for (const [language, script] of [
  ["si", SINHALA],
  ["ta", TAMIL],
] as const) {
  test(`a ${language} dashboard writes its words in that script and keeps every number`, () => {
    const english = cells(buildDashboardLayout(base()));
    const local = buildDashboardLayout(base({ language }));
    const localCells = cells(local);
    assert.match(local.title, script);
    assert.match(local.charts[0].title, script);
    for (const cell of localCells.filter(
      (entry) => entry.style === "kpi-label" || entry.style === "section",
    ))
      assert.match(cell.text, script, cell.text);
    assert.match(
      localCells.find((cell) => cell.style === "subtitle")!.text,
      script,
    );
    // Every formula without text in it is the same: the language changes words, never numbers.
    const numbers = (list: typeof english) =>
      list
        .filter((cell) => cell.text.startsWith("=") && !cell.text.includes('"'))
        .map((cell) => `${cell.at}:${cell.text}`);
    assert.deepEqual(numbers(localCells), numbers(english));
    assert.equal(localCells.length, english.length);
    // Column names stay as the person wrote them.
    assert.ok(local.title.includes("Sales") && local.title.includes("Region"));
  });
}

test("text in a dashboard formula never breaks the formula", () => {
  for (const language of ["en", "si", "ta"] as const) {
    const layout = buildDashboardLayout(
      base({
        language,
        categoryName: 'Region "A"',
        sampled: true,
        categories: [],
      }),
    );
    for (const cell of cells(layout).filter((entry) =>
      entry.text.startsWith("="),
    ))
      assert.equal(
        (cell.text.match(/"/g) ?? []).length % 2,
        0,
        `${language}: ${cell.text}`,
      );
  }
});

test("chart titles on the sheet follow the language", () => {
  assert.equal(
    workbookText("en").chartBy(["Net Amount"], "Region"),
    "Net Amount by Region",
  );
  assert.equal(
    workbookText("si").chartBy(["Net Amount"], "Region"),
    "Region අනුව Net Amount",
  );
  assert.equal(
    workbookText("ta").chartBy(["Net Amount"], "Region"),
    "Region வாரியாக Net Amount",
  );
  assert.equal(
    workbookText("en").pivotChart("Sales", "Region"),
    "PivotTable result: Sales by Region",
  );
  assert.equal(workbookText("en").forecast("Sales"), "Sales forecast");
  assert.equal(workbookText("en").distribution("Age"), "Age distribution");
  for (const language of ["si", "ta"] as const) {
    const words = workbookText(language);
    const script = language === "si" ? SINHALA : TAMIL;
    for (const title of [
      words.pivotChart("Sales", "Region"),
      words.forecast("Sales"),
      words.distribution("Age"),
      words.pivotFallback("not supported"),
      words.slicerFailed("Region"),
      words.slicerNeedsVersion("Region"),
    ])
      assert.match(title, script);
  }
});

test("the WhatsApp summary reads Sinhala and Tamil KPI cards", () => {
  for (const language of ["si", "ta"] as const) {
    const words = workbookText(language);
    const values = [
      [words.valuesBy(["Sales"], "Region").toUpperCase()],
      ["subtitle"],
      [],
      [
        words.records,
        words.valueCard(words.aggregate("sum"), "SALES"),
        words.top("REGION"),
      ],
      [120, 4500000, "North"],
      ["3 Region values", "", ""],
    ];
    const message = whatsappSummary(values, {
      sheet: "Dashboard",
      symbol: "Rs",
      date: new Date(2026, 9, 20),
    });
    assert.match(message, /: \*120\*/, message);
    assert.match(message, /: \*Rs 4,500,000\*/, message);
    assert.match(message, /: \*North\*/, message);
  }
});

test("a Sinhala or Tamil title over a text line is not taken for a KPI card", () => {
  const message = whatsappSummary(
    [
      ["Region අනුව SALES", "", "ප්‍රස්තාර දත්ත (සජීවී සූත්‍ර)"],
      ["subtitle", "", "Region"],
      ["", "", "උතුර"],
      ["", "", "දකුණ"],
    ],
    { sheet: "Dashboard", date: new Date(2026, 9, 20) },
  );
  assert.doesNotMatch(message, /\*subtitle\*|\*Region\*|\*දකුණ\*/, message);
});

test("pane sentences are written in English, Sinhala and Tamil", () => {
  assert.equal(didYouMean(["Region"], "en"), ' Did you mean "Region" ?');
  assert.match(didYouMean(["Region"], "si"), /ඔබ අදහස් කළේ “Region” ද\?/);
  assert.match(didYouMean(["Region"], "ta"), /“Region”/);
  assert.match(didYouMean(["Region"], "ta"), TAMIL);
  assert.equal(
    usingRowsSummary(
      { rows: 10, columns: 3, from: " (A1:C11)", warnings: [] },
      "en",
    ),
    "Using 10 rows and 3 columns (A1:C11). Your source data stays unchanged.",
  );
  for (const [language, script] of [
    ["si", SINHALA],
    ["ta", TAMIL],
  ] as const) {
    const summary = usingRowsSummary(
      { rows: 10, columns: 3, from: " (A1:C11)", warnings: ["Check Qty."] },
      language,
    );
    assert.match(summary, script);
    assert.match(summary, /10/);
    assert.match(summary, /Check Qty\.$/);
    assert.match(willBeCreatedOn("Summary", language), script);
    assert.match(samplePreviewNote(500, 12000, language), /12,000/);
    assert.match(samplePreviewNote(500, 12000, language), script);
    const done = doneSentence(
      [
        { kind: "chart", targetSheet: "Summary", status: "created" },
        { kind: "table", targetSheet: "Summary", status: "exists" },
      ],
      true,
      language,
    );
    assert.match(done, script);
    assert.match(done, /Summary/);
  }
  assert.equal(
    doneSentence(
      [{ kind: "chart", targetSheet: "Summary", status: "created" }],
      true,
      "en",
    ),
    "Done. Chart created on sheet Summary. Your original data was not changed.",
  );
});

test("Tamil, Sinhala and Singlish requests read like their English twins", () => {
  const headers = ["Order No", "Region", "Net Amount"];
  const rows = [
    ["A1", "North", 100],
    ["A2", "South", 200],
    ["A3", "North", 300],
  ];
  const read = (text: string) => {
    const result: any = interpretInstruction(text, headers, rows as any);
    return JSON.stringify([result.actions, result.specs]);
  };
  const chart = read("chart of total Net Amount by Region");
  assert.equal(read("Region வாரியாக மொத்த Net Amount வரைபடம்"), chart);
  assert.equal(read("Region අනුව මුළු Net Amount ප්‍රස්තාරයක්"), chart);
  const duplicates = read("find duplicate transactions");
  for (const text of [
    "අනුපිටපත් ගනුදෙනු සොයන්න",
    "duplicate ganudenu hoyanna",
    "நகல் பரிவர்த்தனைகளைக் கண்டுபிடி",
  ])
    assert.equal(read(text), duplicates, text);
  // English requests are not touched by the Sinhala and Tamil words.
  assert.equal(
    normalizeInstruction("find duplicate rows in Region"),
    "find duplicate rows in Region",
  );
});

test("a management or daily request in Tamil or Singlish sets the audience", () => {
  assert.equal(
    audienceWithPreference("நிர்வாகத்திற்கு ஒரு பக்க dashboard", {}),
    "management",
  );
  assert.equal(
    audienceWithPreference("kalamanakaranayata dashboard ekak", {}),
    "management",
  );
  assert.equal(
    audienceWithPreference("தினசரி பின்தொடர dashboard", {}),
    "operational",
  );
});

test("run-time messages are shown in Tamil when the pane or the request is Tamil", () => {
  const text =
    "Preview ready. Nothing has changed yet. Review it before applying.";
  assert.match(localizeMessage("ta", text), TAMIL);
  assert.match(localizeMessage("si", text), SINHALA);
  assert.equal(localizeMessage("en", text), text);
  assert.equal(localizeMessage("ta", "Some new message."), "Some new message.");
  assert.equal(responseLanguage("Region வாரியாக மொத்தம்", "en"), "ta");
  assert.equal(responseLanguage("Region අනුව එකතුව", "ta"), "si");
  assert.equal(responseLanguage("total by Region", "ta"), "ta");
});
