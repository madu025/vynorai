import assert from "node:assert/strict";
import { test } from "node:test";
import { buildAnalysisMessages } from "../src/services/m365Analysis.js";
import { buildAssistMessages } from "../src/services/m365TextAssist.js";

const summary = {
  columnCount: 1,
  rowCount: 2,
  columns: [],
} as any;

test("analysis asks for the requested language and keeps keys in English", () => {
  const si = buildAnalysisMessages(summary, "si")[0].content;
  assert.match(si, /Sinhala/);
  assert.match(si, /Keep JSON keys, enum values/);
  assert.match(buildAnalysisMessages(summary)[0].content, /English/);
});

test("text assist follows the text language unless it is a translation", () => {
  const base = { host: "word", text: "x", consent: true } as any;
  const auto = buildAssistMessages({ ...base, task: "summarize" })[0].content;
  assert.match(auto, /same language as the text/);
  const si = buildAssistMessages({
    ...base,
    task: "rewrite",
    language: "si",
  })[0].content;
  assert.match(si, /Reply in Sinhala/);
  const translate = buildAssistMessages({
    ...base,
    task: "translate-si",
    language: "en",
  })[0].content;
  assert.doesNotMatch(translate, /Reply in English/);
});
