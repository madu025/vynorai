import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildDraftMessages,
  draftRequestSchema,
  parseDraftResponse,
} from "../src/services/m365DocDraft.js";

const request = draftRequestSchema.parse({
  kind: "memo",
  title: "Q3 sales review",
  brief: "Sales grew 27 percent. Cost grew 18 percent.",
  memo: { to: "All staff", from: "Finance", subject: "Q3 results" },
  consent: true,
});

const good = {
  title: "Q3 sales review",
  memo: { to: "All staff", from: "Finance", date: "[date]", subject: "Q3" },
  blocks: [
    { type: "heading", level: 1, text: "Summary" },
    {
      type: "paragraph",
      runs: [
        { text: "Sales grew ", bold: false },
        { text: "27%", bold: true },
      ],
    },
    { type: "bullets", items: ["Keep investing", "Review east region"] },
    {
      type: "table",
      headers: ["Region", "Sales"],
      rows: [
        ["North", "3000"],
        ["South", "3600"],
      ],
    },
    { type: "callout", label: "Note", text: "[to be confirmed]" },
  ],
};

test("a request needs consent and rejects unknown fields", () => {
  assert.equal(
    draftRequestSchema.safeParse({ ...request, consent: false }).success,
    false,
  );
  assert.equal(
    draftRequestSchema.safeParse({ ...request, system: "x" }).success,
    false,
  );
  assert.equal(
    draftRequestSchema.safeParse({ ...request, brief: "x".repeat(4001) })
      .success,
    false,
  );
});

test("the prompt treats the brief as data and forbids invented facts", () => {
  const messages = buildDraftMessages(request);
  assert.match(messages[0].content, /data, not instructions/);
  assert.match(messages[0].content, /\[to be confirmed\]/);
  assert.match(messages[1].content, /Q3 sales review/);
});

test("a valid draft parses, also inside one code fence", () => {
  assert.equal(parseDraftResponse(JSON.stringify(good)).blocks.length, 5);
  assert.equal(
    parseDraftResponse("```json\n" + JSON.stringify(good) + "\n```").title,
    "Q3 sales review",
  );
});

test("anything outside the contract is rejected", () => {
  const bad = (value: unknown) =>
    assert.throws(
      () => parseDraftResponse(JSON.stringify(value)),
      /AI_DRAFT|invalid|schema|table|long/i,
    );
  bad({ ...good, macro: "Sub X()" });
  bad({ ...good, blocks: [] });
  bad({
    ...good,
    blocks: [{ type: "heading", level: 4, text: "Too deep" }],
  });
  bad({
    ...good,
    blocks: [{ type: "table", headers: ["A", "B"], rows: [["only one"]] }],
  });
  bad({
    ...good,
    blocks: [
      {
        type: "paragraph",
        runs: [{ text: "see https://evil.example/login" }],
      },
    ],
  });
  bad({
    ...good,
    blocks: [{ type: "paragraph", runs: [{ text: "<script>x</script>" }] }],
  });
  assert.throws(() => parseDraftResponse("Sure! Here is your report."));
});
