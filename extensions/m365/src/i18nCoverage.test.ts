import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { applyLanguage, translate } from "./i18n.js";

const html = readFileSync(new URL("../taskpane.html", import.meta.url), "utf8");
const body = html
  .slice(html.indexOf("<body"))
  .replace(/<script[\s\S]*?<\/script>/g, "")
  .replace(/<style[\s\S]*?<\/style>/g, "");

/** Text the pane or the page script writes at run time, or that is not a word to translate. */
const ALLOWED = new Set([
  "Build",
  "Loading",
  "Working",
  "No preview yet.",
  "No sign-in diagnostics yet.",
  "Nothing remembered for this workbook yet.",
  "Choose the report format and review everything before sending.",
  "LKR (Rs)",
  "USD",
  "EUR",
  "GBP",
  "INR",
  "AUD",
  "SGD",
  "AED",
  "JPY",
]);
const SET_BY_CODE = [/^AI reads every request:/, /^Agent \(preview\):/, /^Build /, /^Loading/];

test("every visible word in the task pane has a Sinhala translation", () => {
  const missing: string[] = [];
  for (const match of body.matchAll(/<(\w+)([^>]*)>([^<]+)<\/\1>/g)) {
    const [, , attrs, raw] = match;
    const text = raw.trim();
    if (!/[A-Za-z]{2,}/.test(text) || ALLOWED.has(text)) continue;
    if (SET_BY_CODE.some((pattern) => pattern.test(text))) continue;
    if (!attrs.includes("data-i18n")) missing.push(text);
  }
  assert.deepEqual(missing, []);
});

test("every data-i18n key in the page has a Sinhala string", () => {
  const keys = [...body.matchAll(/data-i18n="(\w+)"/g)].map((m) => m[1]);
  const missing = keys.filter((key) => translate("si", key, "") === "");
  assert.deepEqual([...new Set(missing)], []);
});

test("switching the language does not leave an English default behind", () => {
  const element: any = {
    dataset: { i18n: "approve_apply" },
    textContent: "Approve and apply",
    getAttribute: () => null,
    setAttribute: () => {},
  };
  const root: any = {
    querySelectorAll: (selector: string) =>
      selector === "[data-i18n]" ? [element] : [],
  };
  applyLanguage(root, "si");
  assert.notEqual(element.textContent, "Approve and apply");
  applyLanguage(root, "en");
  assert.equal(element.textContent, "Approve and apply");
});

test("the pane's grids cannot be stretched past the pane by long unbroken text", () => {
  // A grid column of "auto" grows to the longest unbroken word (a formula, a long chat title),
  // which pushed the pane wider than the task pane and cut messages off on the right.
  assert.match(html, /\.conversation \{[^}]*grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(
    html,
    /#conversation-history \{[^}]*grid-template-columns: minmax\(0, 1fr\)/,
  );
  assert.match(html, /#conversation-history > article \{[^}]*overflow-wrap: anywhere/);
  assert.match(html, /main \{[^}]*min-width: 0[^}]*overflow-wrap: anywhere/);
});

test("the chat scrolls above a request box that never covers it", () => {
  assert.match(html, /body\[data-auth="in"\] main \{[^}]*height: 100dvh[^}]*overflow: hidden/);
  assert.match(html, /\.scroll-area \{[^}]*overflow-y: auto/);
  assert.match(html, /\.composer \{ position: relative;/);
  // Every card and the chat are inside the scroll area; the composer is outside it.
  const area = html.indexOf('id="scroll-area"');
  const composer = html.indexOf('<section class="composer"');
  const conversation = html.indexOf('<section class="conversation"');
  const agent = html.indexOf('id="agent-card"');
  assert.ok(area > 0 && area < conversation && conversation < composer);
  assert.ok(area < agent && agent < composer);
});

test("a chat message keeps its line breaks, so a reply can be a bullet list", () => {
  assert.match(html, /\.message-body \{[^}]*white-space: pre-line/);
});
