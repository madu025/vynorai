import "./agent.js";
import assert from "node:assert/strict";
import test from "node:test";
import { ACTIONS_SAMPLE } from "./messagesActions.sample.js";
import { ACTION_TOOLS } from "./agentActions.js";
import { localizeMessageSi } from "./messagesSi.js";
import { localizeMessageTa } from "./messagesTa.js";

const sinhala = /[඀-෿]/;
const tamil = /[஀-௿]/;

test("every workbook-object tool description gets Sinhala and Tamil wording", () => {
  for (const [tool, args] of Object.entries(ACTIONS_SAMPLE)) {
    const english = ACTION_TOOLS[tool].describe(args);
    assert.match(localizeMessageSi(english), sinhala, `${tool} (si): ${english}`);
    assert.match(localizeMessageTa(english), tamil, `${tool} (ta): ${english}`);
  }
});

test("names, values and addresses inside a description are kept as they are", () => {
  const text = "Join 'Orders'!A1:C9 with 'Customers'!A1:B5 on Customer Id into 'Result'!A1 as live formulas";
  assert.match(localizeMessageSi(text), /'Orders'!A1:C9/);
  assert.match(localizeMessageSi(text), /Customer Id/);
});

test("text that is not a tool description stays as it is", () => {
  assert.equal(localizeMessageSi("Something unrelated here."), "Something unrelated here.");
});
