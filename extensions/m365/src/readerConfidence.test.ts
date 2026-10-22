import assert from "node:assert/strict";
import { test } from "node:test";
import { selectExcelActions } from "./excel.js";
import { interpretInstruction, normalizeInstruction } from "./intent.js";
import { mentionedColumns, weakReading } from "./readerConfidence.js";

const HEADERS = [
  "Service ID",
  "RTOM",
  "LEA",
  "PAT Complete Date",
  "Status",
  "Item Code",
  "Requested Quantity",
  "Issued Quantity",
  "UoM",
  "Circuit ID",
];
const ROWS = Array.from({ length: 30 }, (_, i) => [
  `HK${i}`,
  "R-HK",
  "HK",
  45720 + i,
  i % 2 ? "Done" : "Open",
  `IC${i % 7}`,
  i * 3,
  i * 2,
  "Nos",
  `C${i % 5}`,
]);

const read = (raw: string) => {
  const text = normalizeInstruction(raw);
  const result: any = interpretInstruction(text, HEADERS, ROWS as any);
  const actions = [
    ...new Set([...selectExcelActions(text), ...(result.actions as string[])]),
  ];
  return {
    text,
    reading: { actions, specs: result.specs, problems: result.problems },
  };
};

test("finds the columns a sentence names, including a name typed as one word", () => {
  assert.deepEqual(
    mentionedColumns("total Issued Quantity by Item Code", HEADERS),
    [5, 7],
  );
  assert.deepEqual(mentionedColumns("per itemcode", HEADERS), [5]);
  assert.deepEqual(mentionedColumns("do it", HEADERS), []);
});

test("the dashboard request that named Circuit ID and Item Code is a weak reading", () => {
  const { text, reading } = read(
    "i need creat a dashboard bord cierid walata kopamana itemcode saha materila kopamana use unada kiyana kea",
  );
  assert.ok(weakReading(text, HEADERS, reading), "expected a reason");
  const second = read(
    "dashboard of Issued Quantity by Item Code for each Circuit ID",
  );
  // A dashboard of what each circuit used is read as a usage dashboard now, so it is not weak.
  assert.equal(weakReading(second.text, HEADERS, second.reading), undefined);
  // A dashboard that still ignores a named column is weak.
  const third = read("dashboard of Issued Quantity by Status and RTOM");
  assert.ok(weakReading(third.text, HEADERS, third.reading));
});

test("plain requests the reader handles well are not weak", () => {
  for (const sentence of [
    "pivot table of total Issued Quantity by Circuit ID",
    "clean the data",
    "check the data quality",
    "sort by Issued Quantity descending",
    "bar chart of Issued Quantity by Item Code",
    "make a chart",
  ]) {
    const { text, reading } = read(sentence);
    assert.equal(weakReading(text, HEADERS, reading), undefined, sentence);
  }
});

test("a request that was not recognised at all is weak, one with a plain problem is not", () => {
  assert.ok(weakReading("blah blah", HEADERS, { actions: [], specs: {} }));
  assert.equal(
    weakReading("sort by Salary", HEADERS, {
      actions: [],
      specs: {},
      problems: ["no column Salary"],
    }),
    undefined,
  );
});

test("a one-page dashboard for management names no column on purpose and is not weak", () => {
  const { text, reading } = read(
    "make a one-page dashboard for management, target 5M",
  );
  assert.equal(weakReading(text, HEADERS, reading), undefined);
});
