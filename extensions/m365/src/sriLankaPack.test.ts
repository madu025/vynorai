import assert from "node:assert/strict";
import { test } from "node:test";
import {
  excelDateSerial,
  fiscalQuarterFormula,
  fiscalYearFormula,
  fiscalYearLabel,
  formatLakh,
  holidaySheetRows,
  isLakhFormat,
  lakhNumberFormat,
  networkdaysFormula,
  shortAmount,
  styledMoneyFormat,
} from "./sriLanka.js";
import {
  audienceWithPreference,
  describePreferences,
  learnFromRequest,
  parsePreferences,
  preferenceFacts,
  withPreferredCurrency,
} from "./preferences.js";
import { changeLogRows, logTime, plainCell } from "./changeLog.js";
import {
  buildPrivacyReceipt,
  describePrivacyReceipt,
} from "./privacyReceipt.js";
import { whatsappSummary } from "./whatsappSummary.js";
import { PersonalMask } from "./agent.js";
import { inferCurrency } from "./businessContext.js";

test("lakh grouping: Excel format and text", () => {
  assert.equal(
    lakhNumberFormat("Rs"),
    '[>=10000000]"Rs "##\\,##\\,##\\,##0;[>=100000]"Rs "##\\,##\\,##0;"Rs "#,##0',
  );
  assert.ok(isLakhFormat(lakhNumberFormat("", 2)));
  assert.ok(lakhNumberFormat("", 2).endsWith("#,##0.00"));
  assert.equal(formatLakh(12345678), "1,23,45,678");
  assert.equal(formatLakh(100000), "1,00,000");
  assert.equal(formatLakh(99999), "99,999");
  assert.equal(formatLakh(-1234567.5, 2), "-12,34,567.50");
  assert.equal(formatLakh(999), "999");
  assert.equal(shortAmount(1234567, "lakh"), "12.35 lakhs");
  assert.equal(shortAmount(25_000_000, "lakh"), "2.5 crore");
  assert.equal(shortAmount(2_500_000, "million"), "2.5 Mn");
  assert.equal(shortAmount(2500, "plain"), "2,500");
});

test("money format keeps the data's own format unless lakhs were chosen", () => {
  assert.equal(
    styledMoneyFormat('"Rs "#,##0.00', "Rs", undefined),
    '"Rs "#,##0.00',
  );
  assert.equal(
    styledMoneyFormat('"Rs "#,##0.00', "Rs", "million"),
    '"Rs "#,##0.00',
  );
  assert.equal(
    styledMoneyFormat('"Rs "#,##0.00', "Rs", "lakh"),
    lakhNumberFormat("Rs", 2),
  );
  const lakh = lakhNumberFormat("Rs");
  assert.equal(styledMoneyFormat(lakh, "Rs", "lakh"), lakh);
});

test("April-March financial year", () => {
  assert.equal(fiscalYearLabel(new Date(Date.UTC(2026, 4, 1))), "2026/27");
  assert.equal(fiscalYearLabel(new Date(Date.UTC(2026, 2, 31))), "2025/26");
  assert.equal(fiscalYearLabel(new Date(Date.UTC(2026, 3, 1))), "2026/27");
  assert.equal(fiscalYearLabel(new Date(Date.UTC(2099, 11, 1))), "2099/00");
  assert.equal(fiscalYearLabel(new Date(Date.UTC(2026, 2, 1)), 1), "2026");
  assert.equal(
    fiscalYearFormula("A2"),
    '=YEAR(EDATE(A2,-3))&"/"&TEXT(MOD(YEAR(EDATE(A2,-3))+1,100),"00")',
  );
  assert.equal(fiscalYearFormula("A2", 1), "=YEAR(A2)");
  assert.equal(
    fiscalQuarterFormula("B5"),
    '="Q"&ROUNDUP(MONTH(EDATE(B5,-3))/3,0)',
  );
});

test("holiday table: fixed dates only, sorted by year, with a gazette note", () => {
  const plan = holidaySheetRows([2027, 2026, 2026]);
  assert.equal(plan.rows.length, 10);
  assert.equal(plan.rows[0][0], "2026-02-04");
  assert.equal(plan.rows[9][0], "2027-12-25");
  assert.match(plan.note, /gazette/);
  assert.match(plan.note, /LK_Holidays/);
  assert.deepEqual(plan.header, ["Date", "Holiday", "Source"]);
  // No Poya day is guessed: they move every year.
  assert.ok(!plan.rows.some((row) => /poya/i.test(row[1])));
  assert.equal(
    networkdaysFormula("A2", "B2"),
    "=NETWORKDAYS(A2,B2,LK_Holidays)",
  );
  assert.equal(excelDateSerial("2026-01-01"), 46023);
  assert.equal(excelDateSerial("1900-03-01"), 61);
});

test("preferences: only valid fields survive", () => {
  assert.deepEqual(parsePreferences("not json"), {});
  assert.deepEqual(parsePreferences(null), {});
  assert.deepEqual(
    parsePreferences(
      '{"currency":"LKR","numberStyle":"lakh","fiscalYearStart":4,"audience":"management","changeLog":false,"holidays":true,"resultSheetPrefix":"Finance","x":1}',
    ),
    {
      currency: "LKR",
      numberStyle: "lakh",
      fiscalYearStart: 4,
      audience: "management",
      changeLog: false,
      holidays: true,
      resultSheetPrefix: "Finance",
    },
  );
  assert.deepEqual(parsePreferences({ resultSheetPrefix: "bad/name" }), {});
  assert.deepEqual(
    parsePreferences({
      currency: "rupees",
      numberStyle: "big",
      fiscalYearStart: 13,
    }),
    {},
  );
});

test("preferences are learnt from the request's own words", () => {
  assert.deepEqual(
    learnFromRequest({}, "sales dashboard in lakhs, amounts in LKR"),
    {
      currency: "LKR",
      numberStyle: "lakh",
    },
  );
  assert.deepEqual(
    learnFromRequest({ currency: "LKR" }, "total sales in rupees"),
    {},
  );
  assert.deepEqual(learnFromRequest({}, "show revenue in millions"), {
    numberStyle: "million",
  });
  assert.deepEqual(
    learnFromRequest({}, "our financial year is April to March"),
    {
      fiscalYearStart: 4,
    },
  );
  // Nothing is learnt from an ordinary request, and the audience is never learnt.
  assert.deepEqual(
    learnFromRequest({}, "management summary of sales by region"),
    {},
  );
  assert.deepEqual(learnFromRequest({}, "list the users with errors"), {});
});

test("saved currency fills in only when the data names none", () => {
  const prefs = { currency: "LKR", numberStyle: "lakh" as const };
  const fromPref = withPreferredCurrency(undefined, prefs, true);
  assert.equal(fromPref?.code, "LKR");
  assert.equal(fromPref?.source, "preference");
  assert.equal(fromPref?.numberFormat, lakhNumberFormat("Rs", 2));
  assert.equal(withPreferredCurrency(undefined, prefs, false), undefined);
  const usd = inferCurrency({ headers: ["Region", "Sales USD"], columns: [1] });
  assert.equal(withPreferredCurrency(usd, prefs, true)?.code, "USD");
  const mixed = inferCurrency({
    headers: ["Sales LKR", "Sales USD"],
    columns: [0, 1],
  });
  assert.deepEqual(withPreferredCurrency(mixed, prefs, true), mixed);
  // With nothing saved the guess is unchanged.
  assert.deepEqual(withPreferredCurrency(usd, {}, true), usd);
  assert.equal(
    audienceWithPreference("sales by region", { audience: "management" }),
    "management",
  );
  assert.equal(
    audienceWithPreference("daily follow-up list for the team", {
      audience: "management",
    }),
    "operational",
  );
});

test("preference facts for the agent are empty when nothing is saved", () => {
  assert.equal(preferenceFacts({}), "");
  const facts = preferenceFacts({
    currency: "LKR",
    numberStyle: "lakh",
    fiscalYearStart: 4,
    holidays: true,
  });
  assert.match(facts, /^\[Saved preferences of this workbook\]/);
  assert.match(facts, /LKR/);
  assert.match(facts, /YEAR\(EDATE\(d,-3\)\)/);
  assert.match(facts, /April/);
  assert.match(facts, /LK_Holidays/);
  assert.match(describePreferences({}), /Nothing remembered/);
  assert.match(
    describePreferences({
      currency: "LKR",
      numberStyle: "lakh",
      fiscalYearStart: 4,
    }),
    /LKR, lakh grouping, financial year from April/,
  );
});

test("change log rows: plain text, bounded, one per change", () => {
  const at = new Date(2026, 9, 20, 9, 5, 7);
  assert.equal(logTime(at), "2026-10-20 09:05:07");
  assert.equal(plainCell('=HYPERLINK("x")'), '\'=HYPERLINK("x")');
  assert.equal(plainCell("+94 77"), "'+94 77");
  assert.equal(plainCell("a\nb\tc"), "a b c");
  const rows = changeLogRows({
    at,
    action: "applied",
    request: "dashboard of sales by region",
    changes: [
      {
        change: "dashboard: Sales Dashboard",
        sheet: "Dashboard",
        status: "created",
      },
      {
        change: "chart: Sales by Region",
        sheet: "Dashboard",
        status: "created",
      },
    ],
    reference: "plan-1",
  });
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], [
    "2026-10-20 09:05:07",
    "applied",
    "dashboard of sales by region",
    "dashboard: Sales Dashboard",
    "Dashboard",
    "created",
    "plan-1",
  ]);
  const undone = changeLogRows({
    at,
    action: "undone",
    request: "x",
    changes: [],
  });
  assert.equal(undone.length, 1);
  assert.equal(undone[0][5], "undone");
  const many = changeLogRows({
    at,
    action: "applied",
    request: "r".repeat(400),
    changes: Array.from({ length: 60 }, (_, i) => ({
      change: `c${i}`,
      status: "applied",
    })),
  });
  assert.equal(many.length, 51);
  assert.equal(many[0][2].length, 250);
  assert.match(many[50][3], /10 more change/);
});

test("privacy receipt counts masked values and catches anything left unmasked", () => {
  const mask = new PersonalMask();
  const masked = mask.mask(
    "Call 0771234567 or 077-1234567, mail nimal@example.lk, NIC 851234567V",
  );
  const clean = buildPrivacyReceipt([{ role: "user", content: masked }]);
  assert.equal(clean.masked, 4);
  assert.deepEqual(clean.leaks, { emails: 0, phones: 0, nic: 0 });
  assert.match(describePrivacyReceipt(clean), /4 personal value\(s\) replaced/);
  assert.doesNotMatch(describePrivacyReceipt(clean), /Check:/);
  const leaked = buildPrivacyReceipt([
    { role: "user", content: "send to a@b.com" },
    {
      role: "tool",
      content: '{"rows":[["Kamal","+94 77 123 4567","199012345678"]]}',
    },
  ]);
  assert.equal(leaked.leaks.emails, 1);
  assert.equal(leaked.leaks.phones, 1);
  assert.equal(leaked.leaks.nic, 1);
  assert.match(
    describePrivacyReceipt(leaked),
    /Check: 1 e-mail address\(es\), 1 phone number\(s\), 1 NIC number\(s\) went out unmasked/,
  );
  assert.equal(describePrivacyReceipt(buildPrivacyReceipt([])), "");
  // Amounts and dates are not mistaken for phone numbers.
  assert.equal(
    buildPrivacyReceipt([
      { role: "tool", content: '[[1250000.75, 45123, "2026-10-20"]]' },
    ]).leaks.phones,
    0,
  );
});

test("WhatsApp summary of a dashboard sheet", () => {
  const values = [
    ["Sales Dashboard", "", "", "", "", ""],
    ["Source: 'Data'!A1:D500", "", "", "", "", ""],
    ["", "", "", "", "", ""],
    ["TOTAL SALES", "% OF TARGET", "TOP REGION", "", "", ""],
    [12345678, 0.823, "Western", "", "", ""],
    [
      "Average 1,234",
      "Sales target 15,000,000",
      "by total of Sales",
      "",
      "",
      "",
    ],
    ["", "", "", "", "", ""],
    ["", "", "", "", "", ""],
    ["Row Labels", "Sum of Sales", "", "", "", ""],
    ["Central", 2000000, "", "", "", ""],
    ["Western", 8000000, "", "", "", ""],
    ["*Southern*", 2345678, "", "", "", ""],
    ["Grand Total", 12345678, "", "", "", ""],
  ];
  const text = whatsappSummary(values, {
    sheet: "Dashboard",
    symbol: "Rs",
    style: "lakh",
    date: new Date(2026, 9, 20),
  });
  assert.equal(
    text,
    [
      "*Sales Dashboard*",
      "2026-10-20",
      "",
      "Total Sales: *Rs 1.23 crore*",
      "% of Target: *82.3%*",
      "Top Region: *Western*",
      "",
      "Top Row Labels by Sum of Sales:",
      "1. Western: Rs 80 lakhs",
      "2. Southern: Rs 23.46 lakhs",
      "3. Central: Rs 20 lakhs",
      "",
      'From the "Dashboard" sheet (VynorAI)',
    ].join("\n"),
  );
  // A plain sheet: label-value pairs, bounded length.
  const plain = whatsappSummary(
    [
      ["Item", "Qty"],
      ["Rice", 10],
      ["Dhal", 4],
    ],
    { sheet: "Stock", date: new Date(2026, 0, 2) },
  );
  assert.match(
    plain,
    /^\*Stock\*\n2026-01-02\n\nTop Item by Qty:\n1\. Rice: 10\n2\. Dhal: 4/,
  );
  const long = whatsappSummary(
    Array.from({ length: 300 }, (_, i) => [
      `Name ${"x".repeat(40)} ${i}`,
      i + 1,
    ]),
    { sheet: "S" },
  );
  assert.ok(long.length <= 1000);
});
