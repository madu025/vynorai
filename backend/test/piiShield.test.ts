import assert from "node:assert/strict";
import { test } from "node:test";

import {
  maskRequestBody,
  PiiMap,
  PiiStreamRestorer,
  restoreResponse,
} from "../src/services/piiShield.js";

test("masks emails, SL phones, NICs and Luhn-valid cards only", () => {
  const map = new PiiMap();
  const out = map.mask(
    'send("kasun@gmail.com", "0771234567", "+94 71 234 5678", nic="199812345678", old="981234567V", card="4111 1111 1111 1111", id=1234567890123456, port=8080)',
  );
  assert.ok(!out.includes("kasun@gmail.com"));
  assert.ok(!out.includes("0771234567") && !out.includes("+94 71 234 5678"));
  assert.ok(!out.includes("199812345678") && !out.includes("981234567V"));
  assert.ok(!out.includes("4111 1111 1111 1111"));
  assert.ok(out.includes("1234567890123456"), "non-Luhn number kept");
  assert.ok(out.includes("8080"));
  assert.equal(
    map.restore(out),
    'send("kasun@gmail.com", "0771234567", "+94 71 234 5678", nic="199812345678", old="981234567V", card="4111 1111 1111 1111", id=1234567890123456, port=8080)',
  );
});

test("placeholders are stable across rounds (prefix cache stays valid)", () => {
  const round1 = {
    messages: [{ role: "user", content: "mail a@b.co and c@d.co" }],
  };
  const round2 = {
    messages: [
      ...round1.messages,
      {
        role: "assistant",
        content: "",
        tool_calls: [
          {
            id: "1",
            type: "function",
            function: { name: "edit", arguments: '{"to":"c@d.co"}' },
          },
        ],
      },
      { role: "tool", content: "wrote c@d.co, new e@f.co" },
    ],
  };
  const a = maskRequestBody(round1).body;
  const b = maskRequestBody(round2).body;
  assert.deepEqual(b.messages[0], a.messages[0]);
  assert.equal(
    b.messages[1].tool_calls[0].function.arguments,
    '{"to":"__PII_EMAIL_2__"}',
  );
  assert.equal(
    b.messages[2].content,
    "wrote __PII_EMAIL_2__, new __PII_EMAIL_3__",
  );
});

test("a body without PII is returned unchanged", () => {
  const body = { messages: [{ role: "user", content: "refactor utils.ts" }] };
  assert.equal(maskRequestBody(body).body, body);
});

test("stream restore handles placeholders split across chunks", () => {
  const { map } = maskRequestBody({
    messages: [{ role: "user", content: "x kasun@gmail.com" }],
  });
  const r = new PiiStreamRestorer(map);
  const chunk = (content: string, finish: string | null = null) => ({
    choices: [{ index: 0, delta: { content }, finish_reason: finish }],
  });
  const pieces = ["Send to __P", "II_EMA", "IL_1", "__ now. Done_", "", "!"];
  let text = "";
  pieces.forEach((p, i) => {
    text +=
      r.restoreChunk(chunk(p, i === pieces.length - 1 ? "stop" : null))
        .choices[0].delta.content ?? "";
  });
  assert.equal(text, "Send to kasun@gmail.com now. Done_!");
});

test("stream restore handles tool call arguments and flushes on finish", () => {
  const { map } = maskRequestBody({
    messages: [{ role: "user", content: "0771234567" }],
  });
  const r = new PiiStreamRestorer(map);
  const tc = (args: string, finish: string | null = null) => ({
    choices: [
      {
        index: 0,
        delta: { tool_calls: [{ index: 0, function: { arguments: args } }] },
        finish_reason: finish,
      },
    ],
  });
  let args = "";
  for (const c of [tc('{"phone":"__PII_PH'), tc('ONE_1__"}')]) {
    for (const t of r.restoreChunk(c).choices[0].delta.tool_calls)
      args += t.function.arguments;
  }
  const end = r.restoreChunk({
    choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
  });
  for (const t of end.choices[0].delta.tool_calls ?? [])
    args += t.function.arguments;
  assert.equal(args, '{"phone":"0771234567"}');
});

test("non-stream responses are restored", () => {
  const { map } = maskRequestBody({
    messages: [{ role: "user", content: "a@b.co" }],
  });
  const out = restoreResponse(
    { choices: [{ message: { content: "hi __PII_EMAIL_1__" } }] },
    map,
  );
  assert.equal(out.choices[0].message.content, "hi a@b.co");
});

test("stream restore handles DeepSeek-style tiny tokens", () => {
  const { map } = maskRequestBody({
    messages: [{ role: "user", content: "kasun@gmail.com" }],
  });
  const r = new PiiStreamRestorer(map);
  const pieces = [
    "mail",
    " __",
    "P",
    "II",
    "_",
    "EMAIL",
    "_",
    "1",
    "__",
    " now",
  ];
  let text = "";
  pieces.forEach((p, i) => {
    text += r.restoreChunk({
      choices: [
        {
          index: 0,
          delta: { content: p },
          finish_reason: i === pieces.length - 1 ? "stop" : null,
        },
      ],
    }).choices[0].delta.content;
  });
  assert.equal(text, "mail kasun@gmail.com now");
});

test("completions restore, drop a cut-off placeholder, keep dunder names", () => {
  const map = new PiiMap();
  map.mask("a@b.co");
  const out = (text: string) =>
    restoreResponse({ choices: [{ text }] }, map).choices[0].text;
  assert.equal(out("to = '__PII_EMAIL_1__'"), "to = 'a@b.co'");
  assert.equal(out("x = '__PII_EM"), "x = '");
  assert.equal(out("def __init__"), "def __init__");
  assert.equal(out("if __name__"), "if __name__");
});
