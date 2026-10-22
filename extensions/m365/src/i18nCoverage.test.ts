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
  "VynorAI Excel",
  "pending",
  "Workbook report",
  "Size calculated after approval",
  "Not sent yet · approval required",
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

test("the chat scrolls in its own area and the request box never covers it", () => {
  assert.match(
    html,
    /body\[data-auth="in"\] main \{[^}]*height: 100dvh[^}]*display: flex[^}]*flex-direction: column[^}]*overflow: hidden/,
  );
  assert.match(
    html,
    /\.scroll-area \{[^}]*flex: 1 1 auto[^}]*min-height: 0[^}]*overflow-y: auto/,
  );
  // The request box is a sibling of the scroll area, never inside it, so it takes its own space
  // instead of hiding the chat; the cards and the chat are inside the scroll area.
  const area = html.indexOf('id="scroll-area"');
  const composer = html.indexOf('class="composer"');
  const conversation = html.indexOf('class="conversation"');
  const agent = html.indexOf('id="agent-card"');
  assert.ok(area > 0 && composer > 0 && conversation > area && agent > area);
  assert.ok(composer < area, "the request box must come before the scroll area, not inside it");
});

test("a chat message keeps its line breaks, so a reply can be a bullet list", () => {
  assert.match(html, /\.message-body \{[^}]*white-space: pre-line/);
});

test("every status message the pane sets has a Sinhala wording", async () => {
  const { localizeMessage } = await import("./i18n.js");
  const source = readFileSync(new URL("./taskpane.ts", import.meta.url), "utf8");
  const missing = new Set<string>();
  // Every sentence passed to setStatus, including both sides of a ternary.
  for (const call of source.matchAll(/setStatus\(([^;]*?)\);/gs)) {
    for (const match of call[1].matchAll(/"((?:[^"\\]|\\.)+)"|`((?:[^`\\]|\\.)+)`/g)) {
      const text = (match[1] ?? match[2]).replace(/\$\{[^}]*\}/g, "1");
      // A fragment that ends in a space is joined to another sentence before it is shown.
      if (!/[A-Za-z]+ [A-Za-z]+/.test(text) || text.length < 12 || text.endsWith(" ")) continue;
      if (localizeMessage("si", text) === text) missing.add(text);
    }
  }
  assert.deepEqual([...missing], []);
});


test("buttons wrap at spaces only, so a Sinhala label never breaks letter by letter", () => {
  assert.match(html, /\.apply-dock \{\s*flex-wrap: wrap;/);
  assert.match(html, /\n\s*button \{\s*min-width: 0;\s*overflow-wrap: normal;\s*word-break: normal;/);
});

test("an empty status strip is not drawn as a coloured bar", () => {
  assert.match(html, /\.delivery-status:empty \{\s*display: none;/);
});

test("a stored chat message keeps a whole reply, and a role name is not broken mid-word", () => {
  const source = readFileSync(new URL("./taskpane.ts", import.meta.url), "utf8");
  const limit = Number(/const MAX_CONVERSATION_CHARS = (\d+);/.exec(source)?.[1]);
  assert.ok(limit >= 1500, `chat message limit is ${limit}`);
  assert.match(
    html,
    /\.agent-activity-list > div strong \{[^}]*white-space: nowrap/,
  );
});

test("the plan and the sources are drawn as cards and a long formula is collapsed", () => {
  assert.match(html, /#agent-plan-steps li,\s*#agent-sources-list li \{[^}]*border: 1px solid/);
  assert.match(html, /#agent-plan-steps li::before \{\s*content: counter\(plan-step\)/);
  const view = readFileSync(new URL("./taskpaneAgentView.ts", import.meta.url), "utf8");
  assert.match(view, /createElement\("details"\)/);
});

test("the noticed card is in the Work panel and its tiles are localized", () => {
  assert.match(html, /id="noticed"[\s\S]{0,200}data-workspace-panel="work"/);
  const source = readFileSync(new URL("./taskpane.ts", import.meta.url), "utf8");
  assert.match(source, /localizeMessage\(language, tile\.label\)/);
});
