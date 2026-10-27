import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import { interpretInstruction } from "./intent.js";

test("CSV export is an explicit, fully served action", () => {
  const interpreted = interpretInstruction(
    "Export this result to CSV",
    HEADERS,
    ROWS,
  );
  assert.deepEqual(interpreted.actions, ["export-csv"]);
  assert.deepEqual(interpreted.problems, []);
});

test("PDF export is an explicit, fully served action", () => {
  const interpreted = interpretInstruction(
    "Export the dashboard to PDF",
    HEADERS,
    ROWS,
  );
  assert.deepEqual(interpreted.actions, ["dashboard", "export-pdf"]);
  assert.deepEqual(interpreted.problems, []);
});

test("Sparkline requests use the real chart fallback", () => {
  const interpreted = interpretInstruction(
    "Add sparklines for monthly Sales",
    HEADERS,
    ROWS,
  );
  assert.deepEqual(interpreted.actions, ["chart"]);
  assert.deepEqual(interpreted.problems, []);
  assert.equal(interpreted.specs.chart?.chartType, "line");
});

test("scheduled refresh is recorded while email remains approval-gated", () => {
  const schedule = interpretInstruction(
    "Create a sales report and refresh this result every Monday",
    HEADERS,
    ROWS,
  );
  assert.ok(schedule.specs.scheduleRefresh);
  assert.equal(schedule.specs.scheduleRefresh?.frequency, "weekly");
  assert.equal(schedule.specs.scheduleRefresh?.weekday, 1);

  const email = interpretInstruction(
    "Email the result sheet to the finance team",
    HEADERS,
    ROWS,
  );
  assert.deepEqual(email.actions, []);
  assert.equal(email.problems.length, 1);
  assert.match(email.problems[0], /recipient|not available|not enabled/i);
});

type CataloguePrompt = {
  category: string;
  expectedActions: string[];
  prompt: string;
};

const HEADERS = [
  "Date",
  "Region",
  "Sales",
  "Cost",
  "Quantity",
  "Customer",
  "Status",
  "Order ID",
  "Name",
];
const ROWS = [
  ["2026-01-01", "North", 1200, 700, 4, "Asha", "Open", "O-001", "Asha"],
  ["2026-02-01", "South", 900, 540, 3, "Bimal", "Closed", "O-002", "Bimal"],
  ["2026-03-01", "North", 1500, 860, 5, "Chitra", "Open", "O-003", "Chitra"],
] as any;

/** Stored floor, not an aspirational target: this test only fails on coverage regressions. */
const BASELINE = { parsedPercent: 93.9, fullyServedPercent: 92.9 };

function loadCatalogue(): CataloguePrompt[] {
  const filename = new URL("../test-data/copilot-prompts.txt", import.meta.url);
  const lines = fs
    .readFileSync(filename, "utf8")
    .split(/\r?\n/)
    .filter(Boolean);
  return lines.map((line, index) => {
    const [category, expected, prompt, ...unexpected] = line.split("\t");
    assert.equal(unexpected.length, 0, `line ${index + 1} has too many fields`);
    assert.ok(
      category && expected !== undefined && prompt,
      `invalid line ${index + 1}`,
    );
    return {
      category,
      expectedActions: expected === "-" ? [] : expected.split(","),
      prompt,
    };
  });
}

test("Excel Copilot catalogue KPI does not regress", () => {
  const prompts = loadCatalogue();
  assert.equal(
    prompts.length,
    98,
    "keep the acceptance prompt catalogue count explicit",
  );
  const rows = new Map<
    string,
    { prompts: number; parsed: number; fullyServed: number }
  >();
  let parsed = 0;
  let fullyServed = 0;

  for (const entry of prompts) {
    const interpreted = interpretInstruction(entry.prompt, HEADERS, ROWS);
    const hasAction = interpreted.actions.length > 0;
    const matchesExpected =
      entry.expectedActions.length > 0 &&
      entry.expectedActions.every((action) =>
        interpreted.actions.includes(action),
      );
    const complete = matchesExpected && interpreted.problems.length === 0;
    const bucket = rows.get(entry.category) ?? {
      prompts: 0,
      parsed: 0,
      fullyServed: 0,
    };
    bucket.prompts += 1;
    bucket.parsed += Number(hasAction);
    bucket.fullyServed += Number(complete);
    rows.set(entry.category, bucket);
    parsed += Number(hasAction);
    fullyServed += Number(complete);
  }

  const percent = (value: number, total: number) =>
    Number(((100 * value) / total).toFixed(1));
  const table = [...rows.entries()].map(([category, row]) => ({
    category,
    prompts: row.prompts,
    parsed: `${percent(row.parsed, row.prompts)}%`,
    fullyServed: `${percent(row.fullyServed, row.prompts)}%`,
  }));
  const actual = {
    parsedPercent: percent(parsed, prompts.length),
    fullyServedPercent: percent(fullyServed, prompts.length),
  };
  assert.equal(
    rows.size,
    20,
    "the catalogue starts with all 20 task categories",
  );
  assert.ok(
    [...rows.values()].every((row) => row.prompts >= 4),
    "every category needs at least four acceptance prompts",
  );
  console.table(table);
  console.log("Catalogue KPI", actual);
  assert.ok(
    actual.parsedPercent >= BASELINE.parsedPercent,
    `parsed coverage regressed below ${BASELINE.parsedPercent}%`,
  );
  assert.ok(
    actual.fullyServedPercent >= BASELINE.fullyServedPercent,
    `fully served coverage regressed below ${BASELINE.fullyServedPercent}%`,
  );
});
