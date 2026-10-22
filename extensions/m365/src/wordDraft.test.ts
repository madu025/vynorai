import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DraftConsentError,
  buildDraftRequest,
  describeOps,
  draftToOps,
  insertOps,
  lettersToOps,
  newDraftTag,
  parseDelimited,
  planMerge,
  removeLastInserted,
  templateFields,
  validateDraft,
} from "./wordDraft.js";

const draft = {
  title: "Q3 review",
  memo: { to: "All staff", from: "Finance", date: "[date]", subject: "Q3" },
  blocks: [
    { type: "heading", level: 1, text: "Summary" },
    {
      type: "paragraph",
      runs: [{ text: "Sales grew " }, { text: "27%", bold: true }],
    },
    { type: "bullets", items: ["One", "Two"] },
    { type: "numbered", items: ["First"] },
    {
      type: "table",
      caption: "By region",
      headers: ["Region", "Sales"],
      rows: [["North", "3000"]],
    },
    { type: "callout", label: "Note", text: "[to be confirmed]" },
  ],
};

test("a draft request needs consent, a title, a brief and memo fields", () => {
  const base = {
    kind: "report" as const,
    title: "T",
    brief: "B",
    length: "standard" as const,
    language: "en" as const,
    consent: true,
  };
  assert.throws(
    () => buildDraftRequest({ ...base, consent: false }),
    DraftConsentError,
  );
  assert.throws(() => buildDraftRequest({ ...base, title: " " }), /title/);
  assert.throws(() => buildDraftRequest({ ...base, brief: "" }), /brief/);
  assert.throws(
    () => buildDraftRequest({ ...base, brief: "x".repeat(4001) }),
    /limited/,
  );
  assert.throws(() => buildDraftRequest({ ...base, kind: "memo" }), /To, From/);
  const memo = buildDraftRequest({
    ...base,
    kind: "memo",
    memo: { to: "A", from: "B", subject: "C" },
  });
  assert.equal(memo.memo?.subject, "C");
  assert.equal("includeTable" in buildDraftRequest(base), false);
});

test("validateDraft accepts the contract and rejects anything else", () => {
  assert.equal(validateDraft(draft).blocks.length, 6);
  const bad = (value: unknown) =>
    assert.throws(() => validateDraft(value), /AI_DRAFT_INVALID/);
  bad({ ...draft, macro: "x" });
  bad({ ...draft, blocks: [] });
  bad({ ...draft, blocks: [{ type: "image", src: "x" }] });
  bad({ ...draft, blocks: [{ type: "heading", level: 4, text: "x" }] });
  bad({
    ...draft,
    blocks: [{ type: "table", headers: ["A", "B"], rows: [["1"]] }],
  });
  bad({
    ...draft,
    blocks: [{ type: "paragraph", runs: [{ text: "open https://x.example" }] }],
  });
  bad({
    ...draft,
    blocks: [{ type: "paragraph", runs: [{ text: "<b>x</b>" }] }],
  });
  bad({
    ...draft,
    blocks: [{ type: "paragraph", runs: [{ text: "a", bold: "yes" }] }],
  });
  bad(null);
});

test("a memo draft becomes a memo header with the real date, then the body", () => {
  const ops = draftToOps(validateDraft(draft), new Date(2026, 9, 15));
  assert.deepEqual(ops[0], { kind: "title", text: "MEMORANDUM" });
  const date = ops.find((op) => op.kind === "memo-line" && op.label === "DATE");
  assert.equal(date && "value" in date ? date.value : "", "15 October 2026");
  assert.ok(ops.some((op) => op.kind === "rule"));
  const table = ops.find((op) => op.kind === "table");
  assert.deepEqual(table && "values" in table ? table.values : [], [
    ["Region", "Sales"],
    ["North", "3000"],
  ]);
  const outline = describeOps(ops);
  assert.match(outline, /MEMORANDUM/);
  assert.match(outline, /\*\*27%\*\*/);
  assert.match(outline, /\| Region \| Sales \|/);
});

test("a report keeps its own title and subtitle", () => {
  const report = {
    title: draft.title,
    subtitle: "Finance team",
    blocks: draft.blocks,
  };
  const ops = draftToOps(validateDraft(report), new Date());
  assert.deepEqual(ops[0], { kind: "title", text: "Q3 review" });
  assert.deepEqual(ops[1], { kind: "subtitle", text: "Finance team" });
});

test("pasted spreadsheet cells, CSV and quoted cells are parsed", () => {
  const tsv = parseDelimited("Name\tAmount\nKamal\t1200\nNimali\t950\n");
  assert.deepEqual(tsv.headers, ["Name", "Amount"]);
  assert.equal(tsv.rows.length, 2);
  const csv = parseDelimited('Name,Note\n"Perera, K","said ""hi"""\n');
  assert.deepEqual(csv.rows[0], ["Perera, K", 'said "hi"']);
  assert.throws(() => parseDelimited(""), /Paste/);
  assert.throws(() => parseDelimited("A,A\n1,2"), /unique/);
  assert.throws(() => parseDelimited("A,B"), /no data rows/);
  assert.throws(
    () =>
      parseDelimited("A\n" + Array.from({ length: 51 }, () => "x").join("\n")),
    /At most 50/,
  );
});

test("mail merge fills placeholders case-insensitively and reports problems", () => {
  const table = parseDelimited(
    "Name,Amount,Branch\nKamal,1200,Colombo\nNimali,,Kandy",
  );
  const template = "Dear {{Name}},\nYour balance is {{ amount }}.\n{{Missing}}";
  assert.deepEqual(templateFields(template), ["Name", "amount", "Missing"]);
  const plan = planMerge(template, table);
  assert.deepEqual(plan.missingFields, ["Missing"]);
  assert.deepEqual(plan.unusedColumns, ["Branch"]);
  assert.equal(plan.emptyValues, 1);
  assert.match(plan.letters[0], /Dear Kamal,\nYour balance is 1200\./);
  assert.match(plan.letters[1], /Your balance is \./);
  assert.throws(() => planMerge("No fields here", table), /placeholders/);
});

test("letters are separated by exactly one page break each", () => {
  const ops = lettersToOps(["A\nB", "C", "D"]);
  assert.equal(ops.filter((op) => op.kind === "page-break").length, 2);
  assert.equal(ops.filter((op) => op.kind === "paragraph").length, 4);
});

function fakeWord() {
  const log: string[] = [];
  const controls: Array<Record<string, unknown>> = [];
  const paragraph = (value: string) => ({
    value,
    font: {} as Record<string, unknown>,
    styleBuiltIn: "",
    insertText: (text: string) => {
      log.push(`text:${text}`);
      return { font: {} as Record<string, unknown> };
    },
    insertBreak: () => log.push("break"),
    getRange: () => ({
      expandTo: () => ({
        insertContentControl: () => {
          const control: Record<string, unknown> = {};
          controls.push(control);
          return control;
        },
      }),
    }),
  });
  const body = {
    insertParagraph: (value: string) => {
      log.push(`p:${value}`);
      return paragraph(value);
    },
    insertTable: (rows: number, cols: number) => {
      log.push(`table:${rows}x${cols}`);
      return { ...paragraph(""), headerRowCount: 0 };
    },
  };
  const context = {
    document: { body },
    sync: async () => undefined,
  };
  return {
    log,
    controls,
    runtime: { run: async (cb: any) => cb(context) },
  };
}

test("insert needs confirmation and a valid tag, and wraps the content in one control", async () => {
  const word = fakeWord();
  const ops = draftToOps(validateDraft(draft), new Date(2026, 9, 15));
  await assert.rejects(
    insertOps(word.runtime, ops, {
      tag: newDraftTag(),
      title: "t",
      confirmed: false,
    }),
    /confirmation/,
  );
  await assert.rejects(
    insertOps(word.runtime, ops, { tag: "bad", title: "t", confirmed: true }),
    /Invalid draft tag/,
  );
  const report = await insertOps(word.runtime, ops, {
    tag: newDraftTag(),
    title: "Q3 review",
    confirmed: true,
  });
  assert.equal(report.operations, ops.length);
  assert.equal(word.controls.length, 1);
  assert.equal(word.controls[0].appearance, "BoundingBox");
  assert.ok(word.log.includes("table:2x2"));
  assert.match(newDraftTag(), /^vynorai-draft-[a-z0-9]{9}$/);
});

test("remove deletes only the newest control that carries this add-in's tag", async () => {
  const deleted: string[] = [];
  const make = (tag: string) => ({
    tag,
    delete: () => deleted.push(tag),
  });
  const items = [
    make("vynorai-draft-000000001"),
    make("someone-elses-control"),
    make("vynorai-draft-000000009"),
  ];
  const runtime = {
    run: async (cb: any) =>
      cb({
        document: { contentControls: { items, load: () => undefined } },
        sync: async () => undefined,
      }),
  };
  await assert.rejects(removeLastInserted(runtime, false), /confirmation/);
  const report = await removeLastInserted(runtime, true);
  assert.deepEqual(deleted, ["vynorai-draft-000000009"]);
  assert.equal(report.removed, 1);
});
