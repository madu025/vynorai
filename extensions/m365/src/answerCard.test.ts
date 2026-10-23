import assert from "node:assert/strict";
import { test } from "node:test";
import {
  answerResults,
  buildAnswerCard,
  formatNumber,
  recallAnswerResults,
  rememberAnswerResults,
} from "./answerCard.js";

const REGIONS = [
  ["Central", 8620425],
  ["Western", 8612825],
  ["Northern", 8599487.5],
  ["Eastern", 8596775],
  ["Southern", 8587162.5],
];

const REPLY = [
  "- Orders sheet: Central 8,620,425.00, Western 8,612,825.00, Northern 8,599,487.50, Eastern 8,596,775.00, Southern 8,587,162.50.",
  "- Total Net Amount 43,016,675.",
  "- 21 rows not found in Customers.",
  "- Want a bar chart?",
].join("\n");

test("region totals become bars with a Total and a Rows tile", () => {
  const card = buildAnswerCard({
    reply: REPLY,
    results: [{ values: REGIONS }],
  });
  assert.equal(card.bars.length, 5);
  assert.equal(card.bars[0].label, "Central");
  assert.equal(card.bars[0].ratio, 1);
  assert.ok(card.bars[4].ratio < 1 && card.bars[4].ratio > 0.9);
  assert.deepEqual(
    card.tiles.map((t) => t.label),
    ["Total", "Rows"],
  );
  assert.equal(card.tiles[0].value, "43,016,675");
  assert.equal(card.tiles[1].value, "5");
  assert.equal(card.fallbackText, undefined);
});

test("a header row is dropped from the bars", () => {
  const card = buildAnswerCard({
    reply: "- Totals by region",
    results: [{ values: [["Region", "Amount"], ...REGIONS.slice(0, 3)] }],
  });
  assert.equal(card.bars.length, 3);
  assert.equal(card.bars[0].label, "Central");
});

test("a single row of stats becomes tiles named by the header", () => {
  const card = buildAnswerCard({
    reply: "- Orders summary",
    results: [
      {
        values: [
          ["Orders", "Units", "Average"],
          [3000, 13500, 14338.89],
        ],
      },
    ],
  });
  assert.deepEqual(
    card.tiles.map((t) => [t.label, t.value]),
    [
      ["Orders", "3,000"],
      ["Units", "13,500"],
      ["Average", "14,338.89"],
    ],
  );
  assert.equal(card.bars.length, 0);
});

test("a scalar becomes one tile", () => {
  const card = buildAnswerCard({
    reply: "- Total is 5",
    results: [{ values: [[43016675]] }],
  });
  assert.equal(card.tiles[0].value, "43,016,675");
});

test("a wide result becomes a table of at most 5 rows", () => {
  const rows = Array.from({ length: 8 }, (_, i) => [
    `ORD-${i}`,
    `CUST-${i}`,
    i * 1000,
  ]);
  const card = buildAnswerCard({
    reply: "- Sample rows",
    results: [{ values: [["Order", "Customer", "Amount"], ...rows] }],
  });
  assert.deepEqual(card.table?.headers, ["Order", "Customer", "Amount"]);
  assert.equal(card.table?.rows.length, 5);
  assert.equal(card.table?.rows[1][2], "1,000");
});

test("warning bullets become short warn pills and are not in the title", () => {
  const card = buildAnswerCard({
    reply: REPLY,
    results: [{ values: REGIONS }],
  });
  assert.equal(card.pills.length, 1);
  assert.equal(card.pills[0].tone, "warn");
  assert.ok(card.pills[0].text.split(" ").length <= 9);
  assert.match(card.pills[0].text, /21 rows not found/);
  assert.ok(card.title.split(" ").length <= 8);
});

test("a closing question becomes a chip", () => {
  const card = buildAnswerCard({
    reply: REPLY,
    results: [{ values: REGIONS }],
  });
  assert.deepEqual(card.chips, ["Want a bar chart?"]);
});

test("without calculations, numbers in prose never become tiles or bars", () => {
  const card = buildAnswerCard({ reply: REPLY });
  assert.equal(card.bars.length, 0);
  assert.equal(card.tiles.length, 0);
  assert.equal(card.table, undefined);
  assert.ok(card.fallbackText);
});

test("the real bad example (old chat, no results) is a text fallback, not a card", () => {
  const card = buildAnswerCard({
    reply: [
      "- The reviewer is right: the data spans 2 years: 22,070,525 in 2025, 1,460 orders and 20,946,150 in 2026.",
      "- Should I put the split bar by year on the summary too?",
    ].join("\n"),
  });
  assert.equal(card.bars.length + card.tiles.length, 0);
  assert.ok(card.fallbackText);
  assert.equal(card.title, "Result");
});

test("a leaked reviewer sentence is never the title", () => {
  const card = buildAnswerCard({
    reply: "- The reviewer is right.\n- Central 1, West 2",
    results: [{ values: REGIONS }],
  });
  assert.equal(card.title, "Result");
});

test("five real result rows give exact bars and sums", () => {
  const card = buildAnswerCard({
    reply: REPLY,
    results: [{ values: REGIONS }],
  });
  assert.equal(card.bars.length, 5);
  assert.equal(card.tiles[0].value, "43,016,675");
  assert.equal(card.fallbackText, undefined);
});

test("an answer with no numbers falls back to the first bullet", () => {
  const card = buildAnswerCard({
    reply: "- The Region column has no blanks.\n- Nothing else needs fixing.",
  });
  assert.equal(card.fallbackText, "The Region column has no blanks.");
  assert.equal(card.bars.length + card.tiles.length, 0);
});

test("numbers use thousands separators and at most two decimals", () => {
  assert.equal(formatNumber(1234567), "1,234,567");
  assert.equal(formatNumber(8599487.5), "8,599,487.5");
  assert.equal(formatNumber(14338.8888), "14,338.89");
});

test("answerResults pairs calculate calls with their results and restores text", () => {
  const messages: any[] = [
    {
      role: "assistant",
      content: null,
      tool_calls: [
        {
          id: "c1",
          type: "function",
          function: {
            name: "calculate",
            arguments: JSON.stringify({ formula: "=GROUPBY(a,b)" }),
          },
        },
        {
          id: "c2",
          type: "function",
          function: { name: "read_range", arguments: "{}" },
        },
      ],
    },
    {
      role: "tool",
      tool_call_id: "c1",
      content: JSON.stringify({
        result: [
          ["T1", 5],
          ["T2", 7],
        ],
      }),
    },
    {
      role: "tool",
      tool_call_id: "c2",
      content: JSON.stringify({ values: [[1]] }),
    },
  ];
  const results = answerResults(messages, (t) => t.replace("T", "Region "));
  assert.equal(results.length, 1);
  assert.equal(results[0].formula, "=GROUPBY(a,b)");
  assert.deepEqual(results[0].values, [
    ["Region 1", 5],
    ["Region 2", 7],
  ]);
});

test("remembered results are recalled by reply text", () => {
  rememberAnswerResults("reply-x", [{ values: [[1]] }]);
  assert.equal(recallAnswerResults("reply-x").length, 1);
  assert.equal(recallAnswerResults("other").length, 0);
});
