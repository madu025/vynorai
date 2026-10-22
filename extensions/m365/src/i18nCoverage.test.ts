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
const SET_BY_CODE = [
  /^AI reads every request:/,
  /^Agent \(preview\):/,
  /^Build /,
  /^Loading/,
];

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
  assert.match(
    html,
    /\.conversation \{[^}]*grid-template-columns: minmax\(0, 1fr\)/,
  );
  assert.match(
    html,
    /#conversation-history \{[^}]*grid-template-columns: minmax\(0, 1fr\)/,
  );
  assert.match(
    html,
    /#conversation-history > article \{[^}]*overflow-wrap: anywhere/,
  );
  assert.match(html, /main \{[^}]*min-width: 0[^}]*overflow-wrap: anywhere/);
});

test("the pane avoids duplicating the Office title bar and keeps its app menu reachable", () => {
  assert.match(
    html,
    /font:\s*13px\/1\.45 -apple-system,\s*BlinkMacSystemFont,\s*"SF Pro Text"/,
  );
  assert.match(html, /--surface-solid: #ffffff/);
  assert.match(html, /@supports \(backdrop-filter: blur\(1px\)\)/);
  assert.match(
    html,
    /class="status-actions">[\s\S]*?<button[\s\S]*?id="menu-toggle"/,
  );
  assert.match(html, /id="more-pills"/);
  assert.match(html, /data-i18n="more_suggestions"/);
  assert.match(
    html,
    /id="advanced-workbook-options"[\s\S]*?data-i18n="menu_advanced_workbook_options"/,
  );
  assert.match(html, /id="prefs-card"[\s\S]*?hidden/);
});

test("visible loading text stays valid UTF-8 instead of mojibake", () => {
  assert.doesNotMatch(html, /Loading\u00e2\u2026|\u00c3.|\u00c2./);
  assert.match(html, /id="status-text">Loading…<\/span>/);
});

test("localized outcome messages stay valid UTF-8", () => {
  const outcome = readFileSync(
    new URL("./outcome.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(
    outcome,
    /\u00e0[\u00b6\u00b7]|\u00e2\u20ac|\u00c3|\u00c2/,
  );
});

test("the prompt starts the pane and the workspace flows below it", () => {
  assert.match(
    html,
    /body\[data-auth="in"\] main\s*\{[^}]*height:\s*100dvh[^}]*overflow:\s*hidden/,
  );
  assert.match(html, /\.scroll-area\s*\{[^}]*overflow-y:\s*auto/);
  assert.match(html, /\.composer\s*\{[^}]*position:\s*relative/);
  // The prompt stays above the scroll area; cards, chat and results flow below it.
  const area = html.indexOf('id="scroll-area"');
  const composer = html.indexOf('class="composer"', html.indexOf("<body"));
  const conversation = html.indexOf('class="conversation"', area);
  const agent = html.indexOf('id="agent-card"');
  assert.ok(composer > 0 && composer < area && area < conversation);
  assert.ok(area < agent);
});

test("selection context and suggestions appear before the conversation", () => {
  const area = html.indexOf('id="scroll-area"');
  const context = html.indexOf('id="workbook-context"');
  const suggestions = html.indexOf('id="context-suggestions"');
  const conversation = html.indexOf('class="conversation"', area);
  assert.ok(
    area < context && context < suggestions && suggestions < conversation,
  );
  assert.match(html, /\.smart-suggestion-list\s*\{[^}]*minmax\(0, 1fr\)/);
  assert.match(
    html,
    /id="selection-guidance"[\s\S]*?class="selection-guidance"[\s\S]*?hidden/,
  );
  assert.match(html, /id="use-sheet-data"[\s\S]*?class="ghost"/);
  assert.match(html, /id="starter-suggestions"[\s\S]*?class="suggestions"/);
  assert.match(html, /\.chat-bar\s*\{[^}]*position:\s*sticky[^}]*top:\s*0/);
  assert.doesNotMatch(html, /<header class="topbar"/);
  assert.match(
    html,
    /\.smart-suggestion-list\s*\{[^}]*grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\)/,
  );
  assert.match(
    html,
    /\.smart-suggestion-list\[data-count="1"\]\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/,
  );
  assert.match(
    html,
    /@media \(max-width: 360px\)\s*\{[\s\S]*?\.smart-suggestion-list\s*\{\s*grid-template-columns:\s*minmax\(0, 1fr\)/,
  );
  assert.match(
    html,
    /\.smart-suggestion::before\s*\{[^}]*content:\s*attr\(data-icon\)/,
  );
});

test("narrow controls and workbook settings stack without overlap", () => {
  assert.match(html, /#menu\s*\{[^}]*flex:\s*1 0 100%[^}]*width:\s*100%/);
  assert.match(
    html,
    /@media \(max-width: 360px\)\s*\{[\s\S]*?\.chat-bar select\s*\{\s*order:\s*3[\s\S]*?flex:\s*1 0 100%/,
  );
  assert.match(
    html,
    /#prefs-card > label:not\(\.email-check\)\s*\{[^}]*display:\s*grid/,
  );
  assert.match(
    html,
    /#prefs-card > label:not\(\.email-check\) select\s*\{[^}]*width:\s*100%/,
  );
  assert.match(html, /#insights-list\s*\{[^}]*max-height:\s*280px/);
});

test("Smart Run is the primary action and specialist controls remain available", () => {
  assert.match(
    html,
    /id="run-mode"[\s\S]*?id="smart-run"[\s\S]*?class="primary"/,
  );
  assert.match(
    html,
    /<details[\s\S]*?class="more-tools"[\s\S]*?id="analyze"[\s\S]*?id="script-plan"[\s\S]*?id="agent-run"[\s\S]*?id="inspect"/,
  );
});

test("preview impact and the agent approval timeline are visible structures", () => {
  assert.match(html, /id="preview-impact"[\s\S]*?class="impact-grid"/);
  assert.match(html, /id="agent-timeline"[\s\S]*?class="agent-timeline"/);
  for (const stage of [
    "inspect",
    "plan",
    "review",
    "approval",
    "apply",
    "verify",
  ])
    assert.match(html, new RegExp(`data-stage="${stage}"`));
});

test("contextual suggestions use the same safe Run flow and Agent unavailability is explicit", () => {
  const source = readFileSync(
    new URL("./taskpane.ts", import.meta.url),
    "utf8",
  );
  const contextRenderer = source.slice(
    source.indexOf("function renderWorkspaceContext"),
    source.indexOf("async function readWorkspaceContext"),
  );
  assert.match(
    contextRenderer,
    /instruction\.value = suggestion\.instruction;[\s\S]*smartRun\?\.click\(\)/,
  );
  assert.match(
    source,
    /mode === "agent" && capabilities\?\.aiAnalysis === false/,
  );
  assert.match(source, /"agent_unavailable"/);
});

test("context suggestions are based on a bounded local schema sample, not a placeholder", () => {
  const source = readFileSync(
    new URL("./taskpane.ts", import.meta.url),
    "utf8",
  );
  assert.match(
    source,
    /const sampleRows = Math\.min\(Math\.max\(info\.rows, 0\), 26\)/,
  );
  assert.match(
    source,
    /const sampleColumns = Math\.min\(Math\.max\(info\.columns, 0\), 20\)/,
  );
  assert.match(source, /buildSchemaSummary\(/);
  assert.match(source, /workbookId: "local-workspace-context"/);
  assert.match(source, /suggestionsForSelection\(info, schema\)/);
  assert.match(
    source,
    /info\.isBlank = String\(range\.values\?\.\[0\]\?\.\[0\] \?\? ""\)\.trim\(\) === ""/,
  );
  assert.match(source, /selected\.worksheet\.getUsedRange\(\)/);
  assert.match(source, /#starter-suggestions/);
  assert.match(source, /translate\(language, "chat_history", "Chat history"\)/);
  assert.match(source, /const suggestionIcons: Record<string, string>/);
  assert.match(
    source,
    /button\.dataset\.icon = suggestionIcons\[suggestion\.id\]/,
  );
  assert.match(
    source,
    /contextSuggestionList\.dataset\.count = String\(suggestions\.length\)/,
  );
});

test("the agent workflow stays visibly staged rather than claiming an automatic apply", () => {
  assert.match(
    html,
    /\.agent-timeline li::before\s*\{[^}]*content:\s*counter\(list-item\)/,
  );
  assert.match(
    html,
    /\.agent-timeline li\.done::before\s*\{[^}]*content:\s*"✓"/,
  );
  assert.match(html, /id="agent-approve"[\s\S]*?class="primary"[\s\S]*?hidden/);
});

test("agent progress is shown without pulling the conversation over contextual cards", () => {
  const source = readFileSync(
    new URL("./taskpane.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /show\(agentCard, true\);/);
  assert.match(source, /prefsCard\.hidden = false;/);
  assert.match(
    source,
    /agentCard\?\.scrollIntoView\?\.\(\{ block: "start", behavior: "smooth" \}\)/,
  );
  assert.match(source, /renderConversation\("user", request, false\)/);
  assert.match(source, /renderConversation\("assistant", run\.reply, false\)/);
});

test("a chat message keeps its line breaks, so a reply can be a bullet list", () => {
  assert.match(html, /\.message-body \{[^}]*white-space: pre-line/);
});

test("every status message the pane sets has a Sinhala wording", async () => {
  const { localizeMessage } = await import("./i18n.js");
  const source = readFileSync(
    new URL("./taskpane.ts", import.meta.url),
    "utf8",
  );
  const pattern = /setStatus\(\s*(?:"((?:[^"\\]|\\.)*)"|`((?:[^`\\]|\\.)*)`)/g;
  const missing = new Set<string>();
  for (const match of source.matchAll(pattern)) {
    const text = (match[1] ?? match[2]).replace(/\$\{[^}]*\}/g, "1");
    if (localizeMessage("si", text) === text) missing.add(text);
  }
  assert.deepEqual([...missing], []);
});
