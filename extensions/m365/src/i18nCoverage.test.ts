import "./packSi.js";
import "./packTa.js";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { applyLanguage, localizeMessage, translate } from "./i18n.js";
import { checkedLine, CHECKED_OK } from "./agentChecked.js";
import { HEALTH_LABELS } from "./dataHealth.js";
import { idleSuggestions } from "./idleSuggestions.js";
import { workbookOverviewLines } from "./paneText.js";
import { evaluateRunGate } from "./taskpaneRunGate.js";

const html =
  readFileSync(new URL("../taskpane.html", import.meta.url), "utf8") +
  "\n" +
  readFileSync(new URL("../pane.css", import.meta.url), "utf8");
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
  assert.ok(
    composer < area,
    "the request box must come before the scroll area, not inside it",
  );
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
  const missing = new Set<string>();
  // Every sentence passed to setStatus, including both sides of a ternary.
  for (const call of source.matchAll(/setStatus\(([^;]*?)\);/gs)) {
    for (const match of call[1].matchAll(
      /"((?:[^"\\]|\\.)+)"|`((?:[^`\\]|\\.)+)`/g,
    )) {
      const text = (match[1] ?? match[2]).replace(/\$\{[^}]*\}/g, "1");
      // A fragment that ends in a space is joined to another sentence before it is shown.
      if (
        !/[A-Za-z]+ [A-Za-z]+/.test(text) ||
        text.length < 12 ||
        text.endsWith(" ")
      )
        continue;
      if (localizeMessage("si", text) === text) missing.add(text);
    }
  }
  assert.deepEqual([...missing], []);
});

test("buttons wrap at spaces only, so a Sinhala label never breaks letter by letter", () => {
  assert.match(html, /\.apply-dock \{\s*flex-wrap: wrap;/);
  assert.match(
    html,
    /\n\s*button \{\s*min-width: 0;\s*overflow-wrap: normal;\s*word-break: normal;/,
  );
});

test("an empty status strip is not drawn as a coloured bar", () => {
  assert.match(html, /\.delivery-status:empty \{\s*display: none;/);
});

test("a stored chat message keeps a whole reply, and a role name is not broken mid-word", () => {
  const source = readFileSync(
    new URL("./taskpane.ts", import.meta.url),
    "utf8",
  );
  const limit = Number(
    /const MAX_CONVERSATION_CHARS = (\d+);/.exec(source)?.[1],
  );
  assert.ok(limit >= 1500, `chat message limit is ${limit}`);
  assert.match(
    html,
    /\.agent-activity-list > div strong \{[^}]*white-space: nowrap/,
  );
});

test("the plan and the sources are drawn as cards and a long formula is collapsed", () => {
  assert.match(
    html,
    /#agent-plan-steps li,\s*#agent-sources-list li \{[^}]*border: 1px solid/,
  );
  assert.match(
    html,
    /#agent-plan-steps li::before \{\s*content: counter\(plan-step\)/,
  );
  const view = readFileSync(
    new URL("./taskpaneAgentView.ts", import.meta.url),
    "utf8",
  );
  assert.match(view, /createElement\("details"\)/);
});

test("the noticed card is in the Work panel and its tiles are localized", () => {
  assert.match(html, /id="noticed"[\s\S]{0,200}data-workspace-panel="work"/);
  const source = readFileSync(
    new URL("./taskpane.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /localizeMessage\(language, tile\.label\)/);
});

test("buttons, selects and text boxes never fall back to the browser's plain look", () => {
  // Boxes the person types in must have a border of their own (the request box sits inside the
  // bordered composer, so it is the one exception).
  assert.match(html, /#share-paste,\s*#share-message \{[^}]*border: 1px solid/);
  // The run-mode select and the chart tweaks keep room for their words in a narrow pane.
  assert.match(html, /\.mode-control \{[^}]*flex: 1 1 120px/);
  assert.match(
    html,
    /\.tweaks \{[^}]*repeat\(auto-fit, minmax\(118px, 1fr\)\)/,
  );
  // Secondary buttons use the shared "ghost" style.
  for (const id of [
    "dup-fix-btn",
    "share-use-result",
    "share-use-selection",
    "share-copy-text",
    "email-ai-write",
    "prefs-holidays",
    "prefs-payroll",
  ])
    assert.match(
      html,
      new RegExp(
        `<button[^>]*id="${id}"[^>]*class="[^"]*ghost|<button[^>]*class="[^"]*ghost[^"]*"[^>]*id="${id}"`,
      ),
      id,
    );
});

test("agent role rows wrap the status under the name at 320px instead of squeezing it", () => {
  assert.match(
    html,
    /\.agent-activity-list > div \{[^}]*display: flex[^}]*flex-wrap: wrap/,
  );
  assert.match(
    html,
    /\.agent-activity-list > div \.agent-role-status \{[^}]*flex: 1 1 120px[^}]*min-width: 120px/,
  );
  assert.match(
    html,
    /\.agent-activity-list > div strong \{[^}]*text-overflow: ellipsis/,
  );
  assert.match(html, /data-state="skipped"\] \.agent-role-status/);
  const view = readFileSync(
    new URL("./taskpaneAgentView.ts", import.meta.url),
    "utf8",
  );
  assert.match(view, /table\.title = /);
  assert.match(view, /name\.title = /);
});

test("the agent badge is a polite live region and every button has a name", () => {
  assert.match(
    html,
    /id="agent-badge"[\s\S]*?role="status"[\s\S]*?aria-live="polite"/,
  );
  assert.match(html, /id="status"\s+role="status"\s+aria-live="polite"/);
  const unnamed: string[] = [];
  for (const match of body.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)) {
    const [, attrs, inner] = match;
    const text = inner.replace(/<[^>]+>/g, "").trim();
    if (
      !/aria-label=|data-i18n-aria-label=/.test(attrs) &&
      !/[A-Za-z0-9]{2}/.test(text)
    )
      unnamed.push(attrs.replace(/\s+/g, " ").slice(0, 80));
  }
  assert.deepEqual(unnamed, []);
});

test("status lines follow the pane language, not the language of the typed request", () => {
  const source = readFileSync(
    new URL("./taskpane.ts", import.meta.url),
    "utf8",
  );
  const start = source.indexOf("function setStatus(message: string) {");
  assert.ok(start > 0);
  const fn = source.slice(start, source.indexOf("\n}\n", start));
  assert.match(fn, /localizeMessage\(language, message\)/);
  assert.doesNotMatch(fn, /textLanguage\(\)/);
});

test("the run tooltip and the action dock tooltip are translated", () => {
  for (const lang of ["si", "ta"] as const) {
    assert.notEqual(localizeMessage(lang, "Ready to run."), "Ready to run.");
    assert.notEqual(
      localizeMessage(lang, "Preview ready. Nothing changed yet."),
      "Preview ready. Nothing changed yet.",
    );
  }
  const page = readFileSync(
    new URL("../taskpane.html", import.meta.url),
    "utf8",
  );
  assert.match(
    page,
    /class="apply-dock"[^>]*title="Nothing changed yet\."\s+data-i18n-title="agent_note"/,
  );
});

test("the Share composer (source buttons and paste box) is never hidden, so a first card can be made", () => {
  const page = readFileSync(
    new URL("../taskpane.html", import.meta.url),
    "utf8",
  );
  const section = page.match(/<section\s+id="share-card"[^>]*>/);
  assert.ok(section, "share-card section exists");
  assert.doesNotMatch(section[0], /\bhidden\b/);
  const source = readFileSync(
    new URL("./taskpane.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, /shareCard\.hidden/);
});

test("result glyphs have a text alternative and the tiles show a keyboard focus outline", () => {
  const source = readFileSync(
    new URL("./taskpane.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /glyph\.setAttribute\("aria-hidden", "true"\)/);
  assert.match(source, /word\.className = "sr-only"/);
  assert.match(html, /\.sr-only \{/);
  // Both tile kinds are real buttons (focusable, Enter and Space work) with a visible outline.
  assert.match(
    source,
    /createElement\("button"\);\s+button\.type = "button";\s+button\.className = "noticed-tile"/,
  );
  assert.match(
    source,
    /createElement\("button"\);\s+button\.type = "button";\s+button\.className = "explore-chip"/,
  );
  assert.match(
    html,
    /\.noticed-tile:focus-visible,\s*\.explore-chip:focus-visible \{[^}]*outline: 3px solid/,
  );
});

test("every aria-label in the page has a Sinhala and a Tamil string (a screen reader reads it)", () => {
  const missing: string[] = [];
  for (const match of body.matchAll(/<(\w+)\b([^>]*)>/g)) {
    const attrs = match[2];
    const label = /aria-label="([^"]*)"/.exec(attrs)?.[1];
    if (!label || label === "VynorAI Excel") continue;
    const key = /data-i18n-aria-label="(\w+)"/.exec(attrs)?.[1];
    if (!key) {
      missing.push(`no key: ${label}`);
      continue;
    }
    for (const lang of ["si", "ta"] as const)
      if (!translate(lang, key, "")) missing.push(`${lang}: ${key}`);
  }
  assert.deepEqual(missing, []);
});

test("a label's own words and a placeholder are translatable in Sinhala and Tamil", () => {
  const missing: string[] = [];
  // <label for="x">Words<input ...>: the words need their own span, or a language switch cannot reach them.
  for (const match of body.matchAll(
    /<label\b[^>]*>\s*([^<>]*[A-Za-z]{3}[^<>]*?)\s*<(?:input|select|textarea)\b/g,
  ))
    if (!/^B?CC$/.test(match[1].trim()))
      missing.push(`label text without data-i18n: ${match[1].trim()}`);
  const WORDLESS = new Set(["Ctrl+V", "recipient@example.com", "Finance"]);
  for (const match of body.matchAll(
    /<(\w+)\b([^>]*\bplaceholder="([^"]+)"[^>]*)>/g,
  )) {
    const [, , attrs, text] = match;
    if (WORDLESS.has(text)) continue;
    const key = /data-i18n-placeholder="(\w+)"/.exec(attrs)?.[1];
    if (!key) missing.push(`placeholder without key: ${text}`);
    else
      for (const lang of ["si", "ta"] as const)
        if (!translate(lang, key, "")) missing.push(`${lang}: ${key}`);
  }
  // A tooltip (title) is read aloud and shown on hover: it needs a key too.
  for (const match of body.matchAll(
    /<(\w+)\b([^>]*\btitle="([^"]+)"[^>]*)>/g,
  )) {
    const [, , attrs, text] = match;
    if (text === "Nothing changed yet.") continue; // set by code with the dock's state
    const key = /data-i18n-title="(\w+)"/.exec(attrs)?.[1];
    if (!key) missing.push(`title without key: ${text}`);
    else
      for (const lang of ["si", "ta"] as const)
        if (!translate(lang, key, "")) missing.push(`${lang}: ${key}`);
  }
  for (const match of body.matchAll(/<span data-i18n="(lbl_\w+)"/g))
    for (const lang of ["si", "ta"] as const)
      if (!translate(lang, match[1], "")) missing.push(`${lang}: ${match[1]}`);
  assert.deepEqual(missing, []);
});

test("run-time lines the pane builds from fixed English text have Sinhala and Tamil wording", () => {
  const schema = {
    hasMeasure: true,
    hasDate: true,
    hasCategory: true,
    hasText: true,
    sampleRows: 40,
    columns: [
      { name: "Net Amount", role: "measure" },
      { name: "Region", role: "category" },
      { name: "Order No", role: "identifier" },
      { name: "Order Date", role: "date" },
    ],
    blankColumns: ["Customer"],
    otherSheets: [{ name: "Customers", headers: ["Order No", "Segment"] }],
  };
  const english: string[] = [];
  for (const card of idleSuggestions(schema))
    english.push(card.title, card.hint);
  english.push(
    CHECKED_OK,
    ...Object.values(
      checkedLine({ badge: "Stopped", progress: "", issues: [] }),
    )
      .filter((v) => typeof v === "string" && v.length > 0 && v !== "warn")
      .map((v) => v.replace(/^Check needed: /, "")),
  );
  const base = {
    signedIn: true,
    accountReady: true,
    request: "",
    selection: undefined,
    busy: false,
    capabilityState: "ready",
    canInspect: true,
    agentMode: true,
    aiAvailable: true,
  } as const;
  for (const input of [
    { ...base, signedIn: false },
    base,
    { ...base, request: "x" },
    { ...base, request: "x", busy: true },
    { ...base, request: "x", capabilityState: "idle", canInspect: undefined },
    { ...base, request: "x", capabilityState: "unavailable" },
    { ...base, request: "x", aiAvailable: false },
  ] as const) {
    const gate = evaluateRunGate({ ...input } as never);
    if (!gate.enabled) english.push(gate.message);
  }
  const missing: string[] = [];
  for (const lang of ["si", "ta"] as const)
    for (const text of new Set(english))
      if (/[A-Za-z]{3}/.test(text) && localizeMessage(lang, text) === text)
        missing.push(`${lang}: ${text}`);
  assert.deepEqual(missing, []);
});

test("the Check my data card sits in the Work panel and every one of its strings is in Sinhala and Tamil", () => {
  assert.match(html, /id="health"[\s\S]{0,200}data-workspace-panel="work"/);
  const source = readFileSync(
    new URL("./taskpane.ts", import.meta.url),
    "utf8",
  );
  const keys = new Set<string>();
  for (const match of source.matchAll(/healthText\(\s*"(health_\w+)"/g))
    keys.add(match[1]);
  for (const kind of Object.keys(HEALTH_LABELS)) keys.add(`health_${kind}`);
  for (const level of ["high", "medium", "low"])
    keys.add(`health_sev_${level}`);
  assert.ok(keys.size >= 20);
  const missing: string[] = [];
  for (const lang of ["si", "ta"] as const)
    for (const key of keys) {
      const text = translate(lang, key, "");
      if (!text) missing.push(`${lang}: ${key}`);
      // The same placeholders as the English text, or a number or column name would be lost.
      const english =
        HEALTH_LABELS[
          key.replace(/^health_/, "") as keyof typeof HEALTH_LABELS
        ];
      if (english)
        for (const slot of english.match(/\{\w+\}/g) ?? [])
          if (!text.includes(slot))
            missing.push(`${lang}: ${key} lacks ${slot}`);
    }
  assert.deepEqual(missing, []);
  // A finding's button only fills the request box; nothing runs by itself.
  assert.match(source, /instruction\.value = finding\.request;/);
});

test("the workbook overview answer is written in the pane's language", () => {
  const overview = {
    sheets: [{ name: "Orders", rows: 3001, columns: 12 }],
    tables: [{ name: "Sales", sheet: "Orders", rows: 3000, columns: 12 }],
  };
  const en = workbookOverviewLines(overview, "en").join(" ");
  assert.equal(
    en,
    "1 sheet(s): Orders (3001×12). 1 table(s): Sales on Orders (3000×12).",
  );
  for (const lang of ["si", "ta"] as const) {
    const lines = workbookOverviewLines(overview, lang).join(" ");
    assert.match(lines, /Orders \(3001×12\)/);
    assert.doesNotMatch(lines, /sheet\(s\)|table\(s\)| on /);
    assert.doesNotMatch(
      workbookOverviewLines({ sheets: [], tables: [] }, lang).join(" "),
      /No Excel tables/,
    );
  }
});
