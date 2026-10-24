/**
 * Drives the built task pane in a real browser against a stateful Excel stub (test/ui/officeStub.js)
 * and a stubbed backend, in English, Sinhala and Tamil at 320 and 480 px, and collects problems:
 * console errors, uncaught exceptions and unhandled rejections, elements wider than the pane, buttons
 * with no accessible name, English text left on screen in si/ta, controls that stay disabled, and
 * duplicated handling of a double click. Flows: tab switching, Explore chips (measure and group
 * choice, empty selection, single cell), "More ideas" (consent once, chips, tap fills the request
 * box, language switch, selection change), the Noticed card, the agent (preview, approve, Stop during
 * apply, Undo, Discard), the local preview Cancel, the Share tab and the role cards.
 *
 * Run (after `npm run build`):  npx tsx test/ui/taskpane-drive.mts
 * Needs playwright-core and a chromium; see the paths below. Exit code 1 when a check fails.
 * Options (env): M365_DRIVE_LANGS=en,si,ta  M365_DRIVE_WIDTHS=320,480  M365_DRIVE_SHOTS=<dir>
 */
import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire("/opt/node-tools/node_modules/");
const { chromium } = require("playwright-core");

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const OFFICE_URL = "https://appsforoffice.microsoft.com/lib/1/hosted/office.js";
const STUB = readFileSync(path.join(ROOT, "test/ui/officeStub.js"), "utf8");
const SHOTS = process.env.M365_DRIVE_SHOTS;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

type Lang = "en" | "si" | "ta";
const LANGS = (process.env.M365_DRIVE_LANGS ?? "en,si,ta").split(",") as Lang[];
const WIDTHS = (process.env.M365_DRIVE_WIDTHS ?? "320,480").split(",").map(Number);

// --- findings -------------------------------------------------------------------------------

const failures: string[] = [];
const notes = new Set<string>();
let scope = "";
function check(ok: unknown, message: string) {
  if (!ok) failures.push(`[${scope}] ${message}`);
}
function note(message: string) {
  notes.add(`[${scope}] ${message}`);
}

// --- the sales data: a 40-row table the stub serves --------------------------------------------

const HEADERS = ["Order Date", "Order No", "Region", "Product", "Category", "Customer", "Quantity", "Unit Price", "Net Amount"];
const REGIONS = ["Western", "Southern", "Central", "Northern"];
const PRODUCTS = ["Laptop", "Phone", "Tablet", "Monitor"];
const CATEGORIES = ["Technology", "Office"];
function salesRows(): unknown[][] {
  const rows: unknown[][] = [HEADERS];
  for (let i = 0; i < 40; i += 1) {
    const quantity = (i % 5) + 1;
    const price = 900 + (i % 4) * 150;
    rows.push([
      `2026-01-${String((i % 28) + 1).padStart(2, "0")}`,
      `ORD-${1000 + i}`,
      REGIONS[i % 4],
      PRODUCTS[(i + 1) % 4],
      CATEGORIES[i % 2],
      i === 6 || i === 17 ? "" : `Customer ${i + 1}`,
      quantity,
      price,
      i === 11 ? 250000 : quantity * price,
    ]);
  }
  rows[40] = [...rows[39]]; // an exact repeat of the row above
  return rows;
}
/** Texts that come from the stubbed AI or from what the person typed: English on purpose. */
const STUB_TEXTS = [
  "Everything was written as planned",
  "Western has the highest Net Amount",
  "Create the sheet",
  "Write the totals of Net Amount",
  "Staged a new sheet",
  "Create a summary of Net Amount by Region",
  "Create a pivot table of Net Amount by Region",
  "Which Region has the highest Net Amount",
  "Check Customer for blank cells",
  "Make a column chart of Net Amount by Category",
  "Which Customer has the highest Net Amount",
  "UPSTREAM_FAILED",
];
const DATA_WORDS = new Set(
  [...HEADERS, ...REGIONS, ...PRODUCTS, ...CATEGORIES, "Customer", "Orders", "Notes", "Blank", "SalesTable", "Chart", "Region", "Summary"]
    .flatMap((text) => text.toLowerCase().split(/\W+/))
    .filter(Boolean),
);
const STUB_DATA = {
  sheets: [
    { name: "Orders", values: salesRows(), table: "SalesTable", chart: true },
    { name: "Notes", values: [["Remember to review the totals"]] },
    { name: "Blank", values: [] },
  ],
  selection: { sheet: "Orders", address: "A1:I41" },
};

// --- the backend stub -----------------------------------------------------------------------------

interface Call {
  path: string;
  body: any;
}
const calls: Call[] = [];
const api = {
  /** "ok" | "error" (HTTP 500) | "hang" (never answers) */
  agent: "ok" as "ok" | "error" | "hang",
  delayMs: 0,
  plan: "hang" as "hang" | "error",
};
const CAPABILITIES = {
  contractVersion: 1,
  excel: {
    canInspect: true,
    canPreview: true,
    canApply: true,
    actionKinds: ["chart", "pivot-table", "dashboard"],
    writableActionKinds: ["chart", "pivot-table", "dashboard"],
  },
  aiAnalysis: true,
  advanced: {},
};
const STAGE_SHEET = "Region Summary";
const IDEAS = [
  "- Create a summary of Net Amount by Region",
  "- Make a column chart of Net Amount by Category",
  "- Which Customer has the highest Net Amount?",
  "- Check Customer for blank cells",
].join("\n");

/** What the "model" says, decided from the last message the pane sent. */
function agentAnswer(body: any) {
  const messages: any[] = body.messages ?? [];
  const lastUser = [...messages].reverse().find((message) => message.role === "user");
  const text = String(lastUser?.content ?? "");
  const last = messages[messages.length - 1];
  const say = (content: string, tool_calls: unknown[] = []) => ({
    reply: { content, tool_calls, usage: { prompt: 1200, cached: 1000, completion: 80 } },
  });
  if (text.startsWith("Suggest up to 4")) return say(IDEAS);
  if (text.startsWith("[Report from the add-in: plan]"))
    return say(`PLAN:\n1. Create the sheet "${STAGE_SHEET}"\n2. Write the totals of Net Amount per Region`);
  if (text.startsWith("[Report from the add-in: review]")) return say("VERDICT: OK");
  if (text.startsWith("[Report from the add-in")) return say("Everything was written as planned.");
  if (/\?\s*$/.test(text) || /^(which|what)\b/i.test(text)) return say("Western has the highest Net Amount.");
  if (last?.role === "tool") return say(`- Staged a new sheet "${STAGE_SHEET}" with the totals per Region.`);
  const call = (id: string, name: string, args: unknown) => ({
    id,
    type: "function",
    function: { name, arguments: JSON.stringify(args) },
  });
  return say("", [
    call("c1", "create_sheet", { name: STAGE_SHEET }),
    call("c2", "write_values", {
      sheet: STAGE_SHEET,
      cell: "A1",
      values: [["Region", "Net Amount"], ["Western", 120000], ["Southern", 98000], ["Central", 51000], ["Northern", 43000]],
    }),
  ]);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};
const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  const json = (status: number, value: unknown) => {
    response.writeHead(status, { "content-type": "application/json" });
    response.end(JSON.stringify(value));
  };
  if (url.pathname === "/favicon.ico") return void (response.writeHead(204), response.end());
  if (url.pathname === "/runtime-config.js") {
    response.writeHead(200, { "content-type": TYPES[".js"] });
    return void response.end(
      'window.__VYNORAI_M365_CONFIG__ = { tenantId: "ui-test", clientId: "ui-test", redirectUri: location.origin + "/taskpane.html", scopes: ["api://ui-test/m365.excel.read"], apiBaseUrl: location.origin };',
    );
  }
  if (url.pathname === "/build-id.js") {
    response.writeHead(200, { "content-type": TYPES[".js"] });
    return void response.end('window.__VYNOR_M365_BUILD_ID__ = "ui-drive";');
  }
  if (url.pathname.startsWith("/v1/")) {
    let raw = "";
    for await (const chunk of request) raw += chunk;
    let body: any;
    try {
      body = raw ? JSON.parse(raw) : undefined;
    } catch {
      body = undefined;
    }
    calls.push({ path: url.pathname, body });
    if (url.pathname === "/v1/m365/excel/capabilities") return json(200, CAPABILITIES);
    if (url.pathname === "/v1/m365/excel/agent") {
      if (api.delayMs) await sleep(api.delayMs);
      if (api.agent === "hang") return;
      if (api.agent === "error") return json(500, { error: { code: "UPSTREAM_FAILED" } });
      return json(200, agentAnswer(body));
    }
    if (url.pathname === "/v1/m365/excel/plan") {
      if (api.plan === "hang") return;
      return json(500, { error: { code: "PLAN_FAILED" } });
    }
    return json(404, { error: { code: "NOT_STUBBED" } });
  }
  const relative = url.pathname === "/" ? "taskpane.html" : url.pathname.replace(/^\//, "");
  const target = path.resolve(ROOT, relative);
  if (!target.startsWith(ROOT + path.sep) || !existsSync(target)) {
    response.writeHead(404);
    return void response.end("Not found");
  }
  response.writeHead(200, { "content-type": TYPES[path.extname(target)] ?? "application/octet-stream" });
  response.end(readFileSync(target));
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const BASE = `http://127.0.0.1:${(server.address() as any).port}`;

// --- the pane ---------------------------------------------------------------------------------------

type Page = any;
interface Pane {
  page: Page;
  errors: string[];
  lang: Lang;
  width: number;
}

async function openPane(
  browser: any,
  options: { lang: Lang; width: number; consent?: boolean; runMode?: "agent" | "smart" | "local"; selection?: { sheet: string; address: string } },
): Promise<Pane> {
  const context = await browser.newContext({
    viewport: { width: options.width, height: 820 },
    permissions: ["clipboard-read", "clipboard-write"],
  });
  await context.addInitScript("window.__name = (f) => f;"); // tsx wraps named functions with __name
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("console", (message: any) => {
    if (message.type() === "error" || message.type() === "warning") errors.push(`console.${message.type()}: ${message.text()}`);
  });
  page.on("pageerror", (error: Error) => errors.push(`pageerror: ${error.message}`));
  page.on("dialog", (dialog: any) => {
    errors.push(`native dialog: ${dialog.message()}`);
    void dialog.dismiss();
  });
  const data = { ...STUB_DATA, selection: options.selection ?? STUB_DATA.selection };
  await page.addInitScript(
    ({ data, lang, consent, runMode }: any) => {
      (window as any).__XL_DATA__ = data;
      (window as any).__rejections = [];
      window.addEventListener("unhandledrejection", (event) =>
        (window as any).__rejections.push(String(event.reason?.stack || event.reason)),
      );
      try {
        localStorage.setItem(
          "vynorai.m365.excel.session.v2",
          JSON.stringify({ accessToken: "ui-drive-token", expiresAt: Date.now() + 3600_000, issuedAt: Date.now(), long: false }),
        );
        localStorage.setItem("vynorai.m365.language.v2", lang);
        localStorage.setItem("vynorai.m365.runMode", runMode);
        if (consent) localStorage.setItem("vynorai.m365.agentConsent", "1");
      } catch {
        // storage unavailable
      }
    },
    { data, lang: options.lang, consent: Boolean(options.consent), runMode: options.runMode ?? "agent" },
  );
  await page.route(OFFICE_URL, (route: any) => route.fulfill({ contentType: "text/javascript", body: STUB }));
  await page.route((url: URL) => !url.href.startsWith(BASE) && url.href !== OFFICE_URL, (route: any) => route.abort());
  await page.goto(`${BASE}/taskpane.html`);
  await page.waitForFunction(
    () => document.body.dataset.auth === "in" && !(document.querySelector("#smart-run") as HTMLButtonElement | null)?.disabled,
    undefined,
    { timeout: 10_000 },
  );
  await page.waitForFunction(() => (document.querySelector("#selection-text")?.textContent ?? "").trim() !== "", undefined, { timeout: 10_000 });
  return { page, errors, lang: options.lang, width: options.width };
}

async function tab(pane: Pane, name: "work" | "results" | "share" | "explore") {
  await pane.page.click(`[data-workspace-target="${name}"]`);
}
const view = (pane: Pane): Promise<string> => pane.page.evaluate(() => document.body.dataset.workspaceView ?? "");
const visible = (pane: Pane, selector: string): Promise<boolean> =>
  pane.page.evaluate((sel: string) => {
    const el = document.querySelector<HTMLElement>(sel);
    return Boolean(el && !el.hidden && el.getClientRects().length > 0);
  }, selector);
const value = (pane: Pane, selector: string): Promise<string> =>
  pane.page.evaluate((sel: string) => (document.querySelector(sel) as HTMLInputElement | null)?.value ?? "", selector);
const text = (pane: Pane, selector: string): Promise<string> =>
  pane.page.evaluate((sel: string) => (document.querySelector(sel)?.textContent ?? "").trim(), selector);
const count = (pane: Pane, selector: string): Promise<number> =>
  pane.page.evaluate((sel: string) => document.querySelectorAll(sel).length, selector);
const settle = (pane: Pane, ms = 450) => pane.page.waitForTimeout(ms);

async function select(pane: Pane, sheet: string, address: string) {
  await pane.page.evaluate(([s, a]: string[]) => (window as any).__xl.select(s, a), [sheet, address]);
  await settle(pane, 700); // the pane reads the selection once per 250 ms pause
}
async function waitSelectionText(pane: Pane, contains: string) {
  await pane.page.waitForFunction((needle: string) => (document.querySelector("#selection-text")?.textContent ?? "").includes(needle), contains, {
    timeout: 5000,
  });
}
async function shot(pane: Pane, name: string) {
  if (SHOTS) await pane.page.screenshot({ path: path.join(SHOTS, `${pane.lang}-${pane.width}-${name}.png`), fullPage: false });
}

// --- the audit: overflow, names, English left over, disabled controls ----------------------------------

const seenEnglish = new Map<string, Set<string>>();
async function audit(pane: Pane, label: string) {
  const result = await pane.page.evaluate(
    ({ lang, dataWords, ignoreTexts }: { lang: string; dataWords: string[]; ignoreTexts: string[] }) => {
      const data = new Set(dataWords);
      const shown = (el: Element) => {
        const rect = (el as HTMLElement).getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return false;
        for (let node: Element | null = el; node; node = node.parentElement) {
          const style = getComputedStyle(node);
          if (style.display === "none" || style.visibility === "hidden" || (node as HTMLElement).hidden) return false;
        }
        return true;
      };
      const describe = (el: Element) => {
        const h = el as HTMLElement;
        return `${el.tagName.toLowerCase()}${h.id ? `#${h.id}` : ""}${h.className && typeof h.className === "string" ? `.${h.className.split(/\s+/).filter(Boolean).slice(0, 2).join(".")}` : ""} "${(h.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 40)}"`;
      };
      const out: Record<string, string[]> = { overflow: [], clipped: [], noName: [], english: [], englishAttr: [] };
      const root = document.documentElement;
      if (root.scrollWidth > root.clientWidth) out.overflow.push(`page scrollWidth ${root.scrollWidth} > ${root.clientWidth}`);
      const area = document.querySelector<HTMLElement>("#scroll-area");
      if (area && area.scrollWidth > area.clientWidth + 1) out.overflow.push(`#scroll-area scrollWidth ${area.scrollWidth} > ${area.clientWidth}`);
      const vw = root.clientWidth;
      for (const el of document.querySelectorAll<HTMLElement>("body *")) {
        if (!shown(el) || el.closest(".skip-link, .sr-only, svg, canvas")) continue;
        const rect = el.getBoundingClientRect();
        const fixedOverlay = getComputedStyle(el).position === "fixed";
        const clipped = (() => {
          for (let node = el.parentElement; node && node !== document.body; node = node.parentElement) {
            if (getComputedStyle(node).overflowX === "visible") continue;
            const box = node.getBoundingClientRect();
            if (box.right <= vw + 1 && box.left >= -1) return true;
          }
          return false;
        })();
        if (!fixedOverlay && !clipped && (rect.right > vw + 1 || rect.left < -1)) out.overflow.push(`${describe(el)} spans ${Math.round(rect.left)}..${Math.round(rect.right)} of ${vw}`);
        const style = getComputedStyle(el);
        if (
          el.children.length === 0 &&
          (el.textContent ?? "").trim() &&
          el.scrollWidth > el.clientWidth + 1 &&
          style.overflowX !== "visible" &&
          style.textOverflow !== "ellipsis" &&
          el.tagName !== "TEXTAREA" &&
          el.tagName !== "PRE" &&
          el.tagName !== "INPUT"
        )
          out.clipped.push(`${describe(el)} content ${el.scrollWidth} > box ${el.clientWidth}`);
      }
      // Accessible names.
      const nameOf = (el: HTMLElement): string => {
        const labelled = el.getAttribute("aria-labelledby");
        if (labelled)
          return labelled
            .split(/\s+/)
            .map((id) => document.getElementById(id)?.textContent ?? "")
            .join(" ")
            .trim();
        const aria = el.getAttribute("aria-label")?.trim();
        if (aria) return aria;
        if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement) {
          const wrap = el.closest("label");
          const byFor = el.id ? document.querySelector(`label[for="${el.id}"]`) : null;
          const label = (byFor?.textContent ?? wrap?.textContent ?? "").trim();
          if (label) return label;
          if (el instanceof HTMLInputElement && ["button", "submit"].includes(el.type) && el.value) return el.value;
          return (el.getAttribute("placeholder") ?? el.title ?? "").trim();
        }
        const own = (el.textContent ?? "").trim();
        if (own) return own;
        const img = el.querySelector("img[alt]")?.getAttribute("alt")?.trim();
        return img || el.title?.trim() || "";
      };
      for (const el of document.querySelectorAll<HTMLElement>("button, a[href], input:not([type=hidden]), select, textarea, summary, [role=button], [role=tab], [role=checkbox]")) {
        if (!shown(el) && !(el.closest(".skip-link") && false)) continue;
        if (!nameOf(el)) out.noName.push(describe(el));
      }
      // English left over in si/ta: visible text (or aria-label/title/placeholder/alt) that is not data
      // and not text from the stubbed AI or the person: two or more English words, or a lone English
      // sentence-less word such as "Cell".
      if (lang !== "en") {
        const allowed = /^(vynorai|excel|epf|etf|apit|vat|ai|whatsapp|pdf|png|xlsx|csv|ctrl|ok|url|id|nic|lkr|rs|usd|tsv|agent|cache|sample|build)$/i;
        const consider = (value: string, where: string, attribute: boolean) => {
          if (ignoreTexts.some((known) => value.includes(known))) return;
          const words = value.match(/[A-Za-z][A-Za-z'\u2019-]{2,}/g) ?? [];
          const foreign = words.filter((word) => !allowed.test(word) && !data.has(word.toLowerCase()));
          const native = /[\u0D80-\u0DFF\u0B80-\u0BFF]/.test(value);
          if (foreign.length >= 2 || (foreign.length >= 1 && !native))
            out[attribute ? "englishAttr" : "english"].push(`${where}: ${value.trim().slice(0, 90)}`);
        };
        for (const el of document.querySelectorAll<HTMLElement>("body *")) {
          if (!shown(el) || el.closest("script, style, pre#diagnostics, #diagnostics-panel, canvas, textarea, #instruction")) continue;
          const own = [...el.childNodes].filter((node) => node.nodeType === Node.TEXT_NODE).map((node) => node.textContent ?? "").join(" ");
          if (own.trim()) consider(own.replace(/\s+/g, " "), describe(el).split(" ")[0], false);
          for (const attribute of ["aria-label", "title", "placeholder", "alt"]) {
            const v = el.getAttribute(attribute);
            if (v?.trim()) consider(v, `${describe(el).split(" ")[0]}[${attribute}]`, true);
          }
        }
      }
      return out;
    },
    { lang: pane.lang, dataWords: [...DATA_WORDS], ignoreTexts: STUB_TEXTS },
  );
  const tag = `${label} @${pane.lang}/${pane.width}`;
  for (const item of result.overflow) check(false, `overflow (${tag}): ${item}`);
  for (const item of result.clipped) check(false, `clipped text (${tag}): ${item}`);
  for (const item of result.noName) check(false, `control without accessible name (${tag}): ${item}`);
  for (const item of result.englishAttr) check(false, `English attribute text in ${pane.lang} (${tag}): ${item}`);
  for (const item of result.english) {
    const bucket = seenEnglish.get(pane.lang) ?? new Set<string>();
    bucket.add(`${label}: ${item}`);
    seenEnglish.set(pane.lang, bucket);
  }
}

async function runtimeErrors(pane: Pane, label: string) {
  const rejections: string[] = await pane.page.evaluate(() => (window as any).__rejections ?? []);
  for (const item of rejections) check(false, `unhandled rejection after ${label}: ${item.slice(0, 200)}`);
  for (const item of pane.errors) check(false, `${label}: ${item.slice(0, 220)}`);
  pane.errors.length = 0;
  await pane.page.evaluate(() => ((window as any).__rejections = []));
}

// --- flows -------------------------------------------------------------------------------------------

async function chipRequests(pane: Pane, host: string): Promise<string[]> {
  const total = await count(pane, `${host} .explore-chip`);
  const requests: string[] = [];
  for (let i = 0; i < total; i += 1) {
    await tab(pane, "explore");
    await pane.page.locator(`${host} .explore-chip`).nth(i).click();
    requests.push(await value(pane, "#instruction"));
    check((await view(pane)) === "work", `a chip in ${host} must open the Work tab (is ${await view(pane)})`);
  }
  return requests;
}

async function flowTabs(pane: Pane) {
  scope = `tabs ${pane.lang}/${pane.width}`;
  for (const name of ["explore", "share", "work", "results"] as const) {
    const before = await view(pane);
    await tab(pane, name).catch(() => undefined);
    const disabled = await pane.page.evaluate((n: string) => (document.querySelector(`[data-workspace-target="${n}"]`) as HTMLButtonElement).disabled, name);
    if (name === "results") check(disabled && (await view(pane)) === before, "Results must stay disabled with no result");
    else check((await view(pane)) === name, `tab ${name} did not open (is ${await view(pane)})`);
    const selected = await pane.page.evaluate(() => [...document.querySelectorAll("[data-workspace-target]")].map((b) => `${b.getAttribute("data-workspace-target")}:${b.getAttribute("aria-selected")}`).join(","));
    check(selected.split(",").filter((s) => s.endsWith(":true")).length === 1, `exactly one selected tab expected: ${selected}`);
    await audit(pane, `tab-${name}`);
  }
  await tab(pane, "work");
  // Keyboard: every tab must be reachable without a mouse (roving tabindex needs arrow keys).
  await pane.page.focus('[data-workspace-target="work"]');
  await pane.page.keyboard.press("ArrowRight");
  const focused = await pane.page.evaluate(() => (document.activeElement as HTMLElement)?.dataset?.workspaceTarget ?? "");
  const tabs = await pane.page.evaluate(() => [...document.querySelectorAll<HTMLElement>("[data-workspace-target]")].map((b) => `${b.dataset.workspaceTarget}:${b.tabIndex}:${(b as HTMLButtonElement).disabled}`));
  check(focused !== "work" && focused !== "", `ArrowRight on the Work tab must move to another tab (focus on "${focused}", tabindex ${tabs.join(" ")})`);
  await tab(pane, "work");
}

async function flowExplore(pane: Pane) {
  scope = `explore ${pane.lang}/${pane.width}`;
  await tab(pane, "explore");
  await settle(pane);
  const templates = await chipRequests(pane, "#explore-template-list");
  const questions = await chipRequests(pane, "#explore-question-list");
  const all = [...templates, ...questions];
  check(templates.includes("Create a summary of Net Amount by Region"), `summary template must use Net Amount and Region, got ${JSON.stringify(templates)}`);
  check(all.every((r) => !/Unit Price|Order No|Quantity/.test(r)), `Unit Price / Order No / Quantity must not be chosen: ${JSON.stringify(all)}`);
  check(questions.some((r) => /total Net Amount/.test(r)), `"total Net Amount" question missing: ${JSON.stringify(questions)}`);
  await tab(pane, "explore");
  await audit(pane, "explore");
  await shot(pane, "explore");

  // Double click on a chip: the request box must hold the sentence once (no appended copy).
  await pane.page.locator("#explore-template-list .explore-chip").first().dblclick();
  const doubled = await value(pane, "#instruction");
  check(doubled === templates[0], `double click on a chip changed the request: ${JSON.stringify(doubled)}`);
  await tab(pane, "explore");

  const cases: Array<[string, string, string, (req: string[], empty: boolean) => void]> = [
    ["single cell with a value", "Notes", "A1", (req, empty) => check(empty && req.length === 0, `a single cell must give no chips (empty message ${empty}, chips ${req.length})`)],
    ["empty sheet", "Blank", "B7", (req, empty) => check(empty && req.length === 0, `an empty selection must give no chips (empty message ${empty}, chips ${req.length})`)],
    ["blank cell next to the data", "Orders", "M60", (req) => check(req.includes("Create a summary of Net Amount by Region"), `a blank cell must resolve to the data table, got ${JSON.stringify(req)}`)],
    ["two number columns only", "Orders", "H1:I41", (req) => check(req.length >= 1 && req.every((r) => !/Unit Price/.test(r)) && req.some((r) => /total Net Amount/.test(r)), `Unit Price + Net Amount must offer Net Amount only, got ${JSON.stringify(req)}`)],
    ["no number column", "Orders", "C1:E41", (req, empty) => check(req.length === 0 && empty, `text columns only must give the empty hint, got ${JSON.stringify(req)} empty=${empty}`)],
  ];
  for (const [name, sheet, address, verify] of cases) {
    await select(pane, sheet, address);
    await tab(pane, "explore");
    await settle(pane, 250);
    const chips = await pane.page.evaluate(() => [...document.querySelectorAll("#explore-template-list .explore-chip, #explore-question-list .explore-chip")].map((b) => (b as HTMLElement).dataset.explore));
    const requests: string[] = [];
    for (const host of ["#explore-template-list", "#explore-question-list"]) requests.push(...(await chipRequests(pane, host)));
    await tab(pane, "explore");
    const empty = await visible(pane, "#explore-empty");
    check(empty === (chips.length === 0), `#explore-empty must show exactly when there are no chips (${name}: empty=${empty}, chips=${chips.length})`);
    verify(requests, empty);
    await audit(pane, `explore-${name}`);
  }
  await select(pane, "Orders", "A1:I41");
  await tab(pane, "work");
  await runtimeErrors(pane, "explore");
}

async function flowNoticed(pane: Pane) {
  scope = `noticed ${pane.lang}/${pane.width}`;
  await tab(pane, "work");
  await pane.page.waitForSelector("#noticed:not([hidden])", { timeout: 5000 }).catch(() => undefined);
  const tiles = await count(pane, "#noticed-tiles .noticed-tile");
  check(tiles >= 1 && tiles <= 3, `Noticed card should show 1 to 3 tiles for the sales table, has ${tiles}`);
  await audit(pane, "noticed");
  await shot(pane, "noticed");
  if (tiles) {
    await pane.page.locator("#noticed-tiles .noticed-tile").first().click();
    const request = await value(pane, "#instruction");
    check(/^(fix the dates|which rows|which Net Amount)/.test(request), `tile tap must fill a request, got ${JSON.stringify(request)}`);
    check((await view(pane)) === "work", "a Noticed tile must stay on the Work tab");
  }
  await select(pane, "Notes", "A1");
  check(!(await visible(pane, "#noticed")), "Noticed card must hide for a single cell");
  await select(pane, "Orders", "A1:I41");
  check(await visible(pane, "#noticed"), "Noticed card must come back when the table is selected again");
  await runtimeErrors(pane, "noticed");
}

async function flowIdeas(browser: any, lang: Lang, width: number) {
  scope = `ideas ${lang}/${width}`;
  const pane = await openPane(browser, { lang, width });
  const { page } = pane;
  calls.length = 0;
  await tab(pane, "explore");
  check(!(await visible(pane, "#explore-ai-list .explore-chip")), "no ideas before the person asks");
  await page.click("#explore-ai-go");
  await page.waitForSelector('[role="dialog"]', { timeout: 3000 });
  check((await count(pane, '[role="dialog"]')) === 1, "exactly one consent dialog expected");
  const dialogText = await page.evaluate(() => document.querySelector('[role="dialog"]')?.textContent ?? "");
  if (lang !== "en") check(!/Ideas for the selected columns/.test(dialogText), `consent card title is still English in ${lang}: ${dialogText.slice(0, 80)}`);
  const buttons: string[] = await page.evaluate(() => [...document.querySelectorAll('[role="dialog"] button')].map((b) => b.textContent ?? ""));
  if (lang !== "en") check(buttons.every((label) => /[^\x20-\x7e]/.test(label)), `consent buttons are English in ${lang}: ${JSON.stringify(buttons)}`);
  await audit(pane, "ideas-consent");
  await shot(pane, "ideas-consent");
  check(!calls.some((c) => c.path.endsWith("/agent")), "nothing may be sent before the person agrees");
  // Agree is the second button.
  await page.locator('[role="dialog"] button').last().click();
  await page.waitForSelector("#explore-ai-list .explore-chip", { timeout: 6000 });
  const agentCalls = calls.filter((c) => c.path.endsWith("/agent"));
  check(agentCalls.length === 1, `one request expected for the ideas, got ${agentCalls.length}`);
  const sent = JSON.stringify(agentCalls[0]?.body ?? {});
  check(!/ORD-1|Customer 1|Laptop|Phone|2026-01/.test(sent), "the ideas request must carry column names and counts, never cell values");
  check((await count(pane, "#explore-ai-list .explore-chip")) === 4, `4 idea chips expected, got ${await count(pane, "#explore-ai-list .explore-chip")}`);
  check(!(await page.evaluate(() => (document.querySelector("#explore-ai-go") as HTMLButtonElement).disabled)), "More ideas button must be enabled again after the answer");
  await audit(pane, "ideas-shown");
  await shot(pane, "ideas-shown");

  // The consent card appears once: a second request asks nothing.
  await page.click("#explore-ai-go");
  await settle(pane, 300);
  check((await count(pane, '[role="dialog"]')) === 0, "the consent card must not appear a second time");
  await page.waitForFunction(() => !(document.querySelector("#explore-ai-go") as HTMLButtonElement).disabled, undefined, { timeout: 5000 });

  // Tap a chip: fills the request box and opens Work.
  const wanted = "Create a summary of Net Amount by Region";
  await page.locator("#explore-ai-list .explore-chip").first().click();
  check((await value(pane, "#instruction")) === wanted, `idea chip must fill the request box, got ${JSON.stringify(await value(pane, "#instruction"))}`);
  check((await view(pane)) === "work", "idea chip must open the Work tab");

  // Language switch keeps the ideas.
  await tab(pane, "explore");
  const before = await count(pane, "#explore-ai-list .explore-chip");
  await page.click("#menu-toggle");
  await page.click("#language");
  await settle(pane, 300);
  await page.keyboard.press("Escape");
  check((await count(pane, "#explore-ai-list .explore-chip")) === before && before > 0, `a language switch must keep the ideas (${before} before, ${await count(pane, "#explore-ai-list .explore-chip")} after)`);
  await runtimeErrors(pane, "ideas");

  // A selection change clears them.
  await select(pane, "Orders", "C1:G41");
  await tab(pane, "explore");
  check((await count(pane, "#explore-ai-list .explore-chip")) === 0, "a selection change must clear the ideas");
  await select(pane, "Orders", "A1:I41");

  // A selection change while the answer is on its way: the answer belongs to the old selection.
  api.delayMs = 900;
  await tab(pane, "explore");
  await page.click("#explore-ai-go");
  await settle(pane, 200);
  // Run while the ideas are on their way: it must say so, and keep the request in the box.
  await tab(pane, "work");
  await page.fill("#instruction", "Which Region has the highest Net Amount?");
  await page.click("#smart-run");
  const busyStatus = await text(pane, "#status-text");
  check(
    /still working|තවමත් පෙර|இன்னும் முந்தைய/.test(busyStatus), // the language switch earlier in this flow moved the pane on
    `Run during the ideas request must say the AI is busy (status: ${JSON.stringify(busyStatus)})`,
  );
  check((await value(pane, "#instruction")) !== "", "the request must stay in the box when Run is refused");
  await page.fill("#instruction", "");
  await tab(pane, "explore");
  await select(pane, "Orders", "H1:I41");
  await page.waitForFunction(() => !(document.querySelector("#explore-ai-go") as HTMLButtonElement).disabled, undefined, { timeout: 8000 });
  await settle(pane, 300);
  check(
    (await count(pane, "#explore-ai-list .explore-chip")) === 0,
    `ideas made for another selection were shown after the selection changed (${await count(pane, "#explore-ai-list .explore-chip")} chips)`,
  );
  api.delayMs = 0;
  await select(pane, "Orders", "A1:I41");
  await tab(pane, "work");
  check(await visible(pane, "#noticed"), "Noticed must be current after the selection changed during the ideas request");

  // Double click on More ideas: one consent card (fresh page without consent), one request.
  await page.evaluate(() => localStorage.removeItem("vynorai.m365.agentConsent"));
  calls.length = 0;
  await tab(pane, "explore");
  await page.locator("#explore-ai-go").dblclick();
  await settle(pane, 300);
  const dialogs = await count(pane, '[role="dialog"]');
  check(dialogs <= 1, `a double click on More ideas opened ${dialogs} consent cards`);
  await page.evaluate(() => document.querySelectorAll('[role="dialog"]').forEach((d) => d.remove()));

  // A failing backend leaves the button usable and says so.
  await page.evaluate(() => localStorage.setItem("vynorai.m365.agentConsent", "1"));
  api.agent = "error";
  await page.click("#explore-ai-go");
  await settle(pane, 800);
  check(!(await page.evaluate(() => (document.querySelector("#explore-ai-go") as HTMLButtonElement).disabled)), "More ideas must be enabled again after an error");
  check((await text(pane, "#status-text")).length > 0, "an error must leave a status message");
  api.agent = "ok";
  pane.errors.length = 0; // the 500 is expected to show up as a console error
  await page.context().close();
}

async function flowAgent(browser: any, lang: Lang, width: number) {
  scope = `agent ${lang}/${width}`;
  const pane = await openPane(browser, { lang, width });
  const { page } = pane;
  calls.length = 0;
  await tab(pane, "work");
  await page.fill("#instruction", "Create a summary of Net Amount by Region");
  await page.click("#smart-run");
  await page.waitForSelector('[role="dialog"]', { timeout: 4000 });
  const agentButtons: string[] = await page.evaluate(() => [...document.querySelectorAll('[role="dialog"] button')].map((b) => b.textContent ?? ""));
  if (lang !== "en") check(agentButtons.every((label) => /[^\x20-\x7e]/.test(label)), `agent consent buttons are English in ${lang}: ${JSON.stringify(agentButtons)}`);
  await audit(pane, "agent-consent");
  await shot(pane, "agent-consent");
  await page.locator('[role="dialog"] button').last().click();
  await page.waitForSelector("#agent-approve:not([hidden])", { timeout: 15_000 });
  await settle(pane, 500);
  check((await count(pane, "#agent-changes li")) === 2, `2 staged changes expected, got ${await count(pane, "#agent-changes li")}`);
  check((await count(pane, "#agent-plan-steps li")) === 2, `the planner's 2 steps expected, got ${await count(pane, "#agent-plan-steps li")}`);
  const roles = await page.evaluate(() => [...document.querySelectorAll("#agent-activity-list [data-agent-role]")].map((row) => `${(row as HTMLElement).dataset.agentRole}=${(row as HTMLElement).dataset.state}:${row.querySelector(".agent-role-status")?.textContent}`));
  note(`roles at preview: ${roles.join(" | ")}`);
  await audit(pane, "agent-preview");
  await shot(pane, "agent-preview");
  const sheetsBefore: string[] = await page.evaluate(() => (window as any).__xl.sheetNames());
  check(!sheetsBefore.includes(STAGE_SHEET), "nothing may be written before Approve");

  // Double click on Approve: applied once.
  await page.locator("#agent-approve").dblclick();
  await page.waitForSelector("#agent-undo:not([hidden])", { timeout: 15_000 });
  await page.waitForFunction(() => !(document.querySelector("#agent-badge")?.textContent ?? "").match(/Verifying|Applying|සත්‍යාපන|යොදමින්|சரிபார்|பயன்படுத்/), undefined, { timeout: 15_000 }).catch(() => undefined);
  await settle(pane, 600);
  const sheetsAfter: string[] = await page.evaluate(() => (window as any).__xl.sheetNames());
  check(sheetsAfter.filter((n) => n.startsWith(STAGE_SHEET)).length === 1, `Approve double-clicked must create the sheet once: ${JSON.stringify(sheetsAfter)}`);
  const appliedItems = await page.evaluate(() => [...document.querySelectorAll("#agent-changes li")].map((li) => li.textContent ?? ""));
  check(
    appliedItems.length === 2 && appliedItems.every((t) => t.includes("✓")),
    `the list of applied changes (check marks) must stay on screen after the read-back: ${JSON.stringify(appliedItems)}`,
  );
  const finalRoles = await page.evaluate(() => [...document.querySelectorAll("#agent-activity-list [data-agent-role]")].map((row) => `${(row as HTMLElement).dataset.agentRole}=${(row as HTMLElement).dataset.state}`));
  check(finalRoles.every((r) => !r.endsWith("=pending") && !r.endsWith("=active")), `role cards left unfinished after apply: ${finalRoles.join(" ")}`);
  await audit(pane, "agent-applied");
  await shot(pane, "agent-applied");
  const status = await text(pane, "#status-text");
  check(status.length > 0, "status text empty after apply");
  note(`status after apply: ${status}`);

  // Undo.
  await page.click("#agent-undo");
  await page.waitForFunction(() => !(window as any).__xl.sheetNames().includes("Region Summary"), undefined, { timeout: 8000 }).catch(() => undefined);
  const afterUndo: string[] = await page.evaluate(() => (window as any).__xl.sheetNames());
  check(!afterUndo.some((n) => n.startsWith(STAGE_SHEET)), `Undo must remove the created sheet: ${JSON.stringify(afterUndo)}`);
  check(!(await visible(pane, "#agent-undo")), "Undo button must hide after Undo");
  await settle(pane, 300);
  const undoRoles = await page.evaluate(() => [...document.querySelectorAll("#agent-activity-list [data-agent-role]")].map((row) => `${(row as HTMLElement).dataset.agentRole}=${(row as HTMLElement).dataset.state}`));
  check(undoRoles.every((r) => !r.endsWith("=pending") && !r.endsWith("=active")), `role cards left unfinished after Undo: ${undoRoles.join(" ")}`);
  await runtimeErrors(pane, "agent apply/undo");

  // Discard.
  await page.fill("#instruction", "Create a summary of Net Amount by Region");
  await page.click("#smart-run");
  await page.waitForSelector("#agent-approve:not([hidden])", { timeout: 15_000 });
  await page.click("#agent-discard");
  await settle(pane, 300);
  check(!(await visible(pane, "#agent-approve")) && !(await visible(pane, "#agent-discard")), "Discard must hide Approve and Discard");
  check(!(await page.evaluate(() => (window as any).__xl.sheetNames())).includes(STAGE_SHEET), "Discard must write nothing");
  const discardRoles = await page.evaluate(() => [...document.querySelectorAll("#agent-activity-list [data-agent-role]")].map((row) => `${(row as HTMLElement).dataset.agentRole}=${(row as HTMLElement).dataset.state}`));
  check(discardRoles.every((r) => !r.endsWith("=pending") && !r.endsWith("=active")), `role cards left unfinished after Discard: ${discardRoles.join(" ")}`);
  check(!(await page.evaluate(() => (document.querySelector("#smart-run") as HTMLButtonElement).disabled)), "Run must stay enabled after Discard");
  await audit(pane, "agent-discarded");

  // A question: nothing to approve, every role gets a final state.
  await page.fill("#instruction", "Which Region has the highest Net Amount?");
  await page.click("#smart-run");
  await page.waitForTimeout(300);
  await page.waitForFunction(() => (document.querySelector("#agent-stop") as HTMLElement).hidden, undefined, { timeout: 15_000 });
  note(`badge after a question: ${await text(pane, "#agent-badge")}`);
  await settle(pane, 400);
  const qRoles = await page.evaluate(() => [...document.querySelectorAll("#agent-activity-list [data-agent-role]")].map((row) => `${(row as HTMLElement).dataset.agentRole}=${(row as HTMLElement).dataset.state}`));
  check(qRoles.every((r) => !r.endsWith("=pending") && !r.endsWith("=active")), `role cards left unfinished after a question: ${qRoles.join(" ")}`);
  await audit(pane, "agent-question");
  await runtimeErrors(pane, "agent discard/question");

  // Stop during apply: the first change runs, the rest is skipped, Undo is offered and no role stays "waiting".
  await page.fill("#instruction", "Create a summary of Net Amount by Region");
  await page.click("#smart-run");
  await page.waitForSelector("#agent-approve:not([hidden])", { timeout: 15_000 });
  await page.evaluate(() => ((window as any).__xl.delay = 400));
  await page.click("#agent-approve");
  await page.waitForSelector("#agent-stop:not([hidden])", { timeout: 4000 });
  await settle(pane, 250);
  await page.click("#agent-stop");
  await page.waitForFunction(() => !(document.querySelector("#agent-undo") as HTMLElement | null)?.hidden, undefined, { timeout: 15_000 });
  await page.evaluate(() => ((window as any).__xl.delay = 0));
  await settle(pane, 800);
  const stopRoles = await page.evaluate(() => [...document.querySelectorAll("#agent-activity-list [data-agent-role]")].map((row) => `${(row as HTMLElement).dataset.agentRole}=${(row as HTMLElement).dataset.state}:${row.querySelector(".agent-role-status")?.textContent}`));
  check(stopRoles.every((r) => !/=(pending|active)/.test(r)), `role cards left unfinished after Stop during apply: ${stopRoles.join(" | ")}`);
  check(!(await visible(pane, "#agent-stop")), "Stop must hide after the apply ended");
  const stopStatus = await text(pane, "#status-text");
  note(`status after Stop during apply: ${stopStatus}`);
  await page.click("#agent-undo");
  await page.waitForFunction(() => !(window as any).__xl.sheetNames().includes("Region Summary"), undefined, { timeout: 8000 }).catch(() => undefined);
  check(!(await page.evaluate(() => (window as any).__xl.sheetNames())).some((n: string) => n.startsWith(STAGE_SHEET)), "Undo after Stop must remove the sheet");
  await audit(pane, "agent-stopped");
  await runtimeErrors(pane, "agent stop/undo");

  // Stop while the model is thinking: nothing changes and no role is left "pending".
  api.delayMs = 1500;
  await page.fill("#instruction", "Create a summary of Net Amount by Region");
  await page.click("#smart-run");
  await page.waitForSelector("#agent-stop:not([hidden])", { timeout: 6000 });
  await page.click("#agent-stop");
  await page.waitForFunction(() => (document.querySelector("#agent-stop") as HTMLElement).hidden, undefined, { timeout: 8000 });
  api.delayMs = 0;
  const stoppedRoles = await page.evaluate(() => [...document.querySelectorAll("#agent-activity-list [data-agent-role]")].map((row) => `${(row as HTMLElement).dataset.agentRole}=${(row as HTMLElement).dataset.state}:${row.querySelector(".agent-role-status")?.textContent}`));
  check(stoppedRoles.every((r) => !/=pending/.test(r)), `role cards say "pending" after Stop while thinking: ${stoppedRoles.join(" | ")}`);
  check(!(await page.evaluate(() => (document.querySelector("#smart-run") as HTMLButtonElement).disabled)), "Run must be enabled after Stop");
  await audit(pane, "agent-stopped-thinking");

  // Excel refuses the write: the person sees the failure, can still Undo, and no control stays disabled.
  await page.fill("#instruction", "Create a summary of Net Amount by Region");
  await page.click("#smart-run");
  await page.waitForSelector("#agent-approve:not([hidden])", { timeout: 15_000 });
  await page.evaluate(() => ((window as any).__xl.failWrites = true));
  await page.click("#agent-approve");
  await page.waitForFunction(() => !(document.querySelector("#agent-undo") as HTMLElement | null)?.hidden, undefined, { timeout: 15_000 });
  await page.waitForFunction(() => (document.querySelector("#agent-stop") as HTMLElement).hidden, undefined, { timeout: 15_000 });
  await page.evaluate(() => ((window as any).__xl.failWrites = false));
  await settle(pane, 500);
  const failedItems = await page.evaluate(() => [...document.querySelectorAll("#agent-changes li")].map((li) => li.textContent ?? ""));
  check(failedItems.some((t) => t.includes("✗")), `a failed write must be listed with a cross: ${JSON.stringify(failedItems)}`);
  check(!(await page.evaluate(() => (document.querySelector("#smart-run") as HTMLButtonElement).disabled)), "Run must be enabled after a failed apply");
  check(!(await page.evaluate(() => (document.querySelector("#instruction") as HTMLTextAreaElement).disabled)), "the request box must be enabled after a failed apply");
  const failRoles = await page.evaluate(() => [...document.querySelectorAll("#agent-activity-list [data-agent-role]")].map((row) => `${(row as HTMLElement).dataset.agentRole}=${(row as HTMLElement).dataset.state}`));
  check(failRoles.every((r) => !/=(pending|active)/.test(r)), `role cards left unfinished after a failed apply: ${failRoles.join(" ")}`);
  note(`status after a failed apply: ${await text(pane, "#status-text")}`);
  await audit(pane, "agent-apply-failed");
  await page.click("#agent-undo");
  await page.waitForFunction(() => !(window as any).__xl.sheetNames().includes("Region Summary"), undefined, { timeout: 8000 }).catch(() => undefined);
  check(!(await page.evaluate(() => (window as any).__xl.sheetNames())).some((n: string) => n.startsWith(STAGE_SHEET)), "Undo after a failed write must remove the sheet");
  await runtimeErrors(pane, "agent failed apply");

  // A failing backend: Run stays usable, the roles end, a message says so.
  api.agent = "error";
  await page.fill("#instruction", "Create a summary of Net Amount by Region");
  await page.click("#smart-run");
  await page.waitForFunction(() => (document.querySelector("#agent-stop") as HTMLElement).hidden, undefined, { timeout: 15_000 });
  await settle(pane, 500);
  const errRoles = await page.evaluate(() => [...document.querySelectorAll("#agent-activity-list [data-agent-role]")].map((row) => `${(row as HTMLElement).dataset.agentRole}=${(row as HTMLElement).dataset.state}`));
  check(errRoles.every((r) => !/=(pending|active)/.test(r)), `role cards left unfinished after a backend error: ${errRoles.join(" ")}`);
  check(!(await page.evaluate(() => (document.querySelector("#smart-run") as HTMLButtonElement).disabled)), "Run must be enabled after a backend error");
  note(`status after backend error: ${await text(pane, "#status-text")}`);
  await audit(pane, "agent-error");
  api.agent = "ok";
  pane.errors.length = 0;
  await page.context().close();
}

async function flowDoubleRun(browser: any, lang: Lang, width: number) {
  scope = `double-run ${lang}/${width}`;
  const pane = await openPane(browser, { lang, width, consent: true });
  calls.length = 0;
  api.delayMs = 300;
  await pane.page.fill("#instruction", "Which Region has the highest Net Amount?");
  await pane.page.locator("#smart-run").dblclick();
  await pane.page.waitForFunction(() => (document.querySelector("#agent-stop") as HTMLElement | null)?.hidden, undefined, { timeout: 15_000 }).catch(() => undefined);
  await settle(pane, 600);
  const builderCalls = calls.filter((c) => c.path.endsWith("/agent") && String(c.body?.messages?.[0]?.content ?? "").length > 0);
  const users = builderCalls.filter((c) => !String(c.body.messages.at(-1)?.content ?? "").startsWith("[Report")).length;
  note(`agent calls after a double click on Run: ${builderCalls.length} (${users} from the person)`);
  const requests = await pane.page.evaluate(() => document.querySelectorAll("#conversation-history .user, #conversation-history [data-role=user]").length);
  note(`user messages in the chat after a double click: ${requests}`);
  api.delayMs = 0;
  await runtimeErrors(pane, "double run");
  await pane.page.context().close();
}

async function flowPreviewCancel(browser: any, lang: Lang, width: number) {
  scope = `preview-cancel ${lang}/${width}`;
  const pane = await openPane(browser, { lang, width, runMode: "local" });
  const { page } = pane;
  api.plan = "hang";
  await page.fill("#instruction", "Create a pivot table of Net Amount by Region");
  await page.click("#smart-run");
  await page.waitForFunction(() => !(document.querySelector("#cancel-preview") as HTMLElement | null)?.hidden, undefined, { timeout: 8000 }).catch(() => undefined);
  const cancelVisible = await visible(pane, "#cancel-preview");
  check(cancelVisible, "Cancel must show while the preview is being made");
  await audit(pane, "preview-running");
  if (cancelVisible) {
    await page.click("#cancel-preview");
    await settle(pane, 400);
    check(!(await visible(pane, "#cancel-preview")), "Cancel must hide after it was pressed");
    check(/cancel|අවලංගු|ரத்து/i.test(await text(pane, "#status-text")), `status must say the preview was cancelled: ${await text(pane, "#status-text")}`);
    check(!(await page.evaluate(() => (document.querySelector("#smart-run") as HTMLButtonElement).disabled)), "Run must be enabled after Cancel");
    check(!(await page.evaluate(() => (document.querySelector("#inspect") as HTMLButtonElement).disabled)), "Preview must be enabled after Cancel");
    check(await page.evaluate(() => (document.querySelector("#apply") as HTMLButtonElement).disabled), "Apply must stay disabled after Cancel");
  }
  await runtimeErrors(pane, "preview cancel");
  await page.context().close();
}

async function flowShare(browser: any, lang: Lang, width: number) {
  scope = `share ${lang}/${width}`;
  const pane = await openPane(browser, { lang, width });
  const { page } = pane;
  await tab(pane, "share");
  await audit(pane, "share-empty");
  check(await page.evaluate(() => (document.querySelector("#share-main") as HTMLButtonElement).disabled), "Share must be disabled before there is a card");
  // Paste text.
  const pasted = ["Region\tNet Amount", "Western\t120000", "Southern\t98000", "Central\t51000", "Northern\t43000"].join("\n");
  await page.fill("#share-paste", pasted);
  await page.waitForSelector("#share-card-img:not([hidden])", { timeout: 6000 });
  await settle(pane, 500);
  check(await visible(pane, "#share-styles"), "the style picker must show for pasted numbers");
  check(!(await page.evaluate(() => (document.querySelector("#share-main") as HTMLButtonElement).disabled)), "Share must be enabled with a card");
  const styles = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>("#share-styles .share-style")].map((b) => `${b.dataset.style}:${b.getAttribute("aria-pressed")}:${b.hidden}`));
  note(`share styles: ${styles.join(" ")}`);
  await audit(pane, "share-card");
  await shot(pane, "share");
  for (const style of ["chart", "insight", "summary"]) {
    const button = page.locator(`#share-styles .share-style[data-style="${style}"]`);
    if (await button.isVisible().catch(() => false)) {
      await button.click();
      await settle(pane, 400);
      const pressed = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>("#share-styles .share-style")].filter((b) => b.getAttribute("aria-pressed") === "true").map((b) => b.dataset.style));
      check(pressed.length === 1 && pressed[0] === style, `style ${style} must be the only pressed one, got ${JSON.stringify(pressed)}`);
    }
  }
  // Copy text.
  await page.click("#share-copy-text");
  await settle(pane, 400);
  const clip = await page.evaluate(() => navigator.clipboard.readText().catch(() => "(no clipboard)"));
  const message = await value(pane, "#share-message");
  check(clip === message.trim(), `Copy text must put the message on the clipboard (clip ${JSON.stringify(clip.slice(0, 40))})`);
  check((await text(pane, "#share-card-status")).length > 0, "Copy text must say what happened");
  // Garbage paste: no numbers.
  await page.fill("#share-paste", "hello\nworld");
  await settle(pane, 500);
  const gStatus = await text(pane, "#share-card-status");
  check(gStatus.length > 0, "pasting text without numbers must explain why no card was made");
  check(await page.evaluate(() => (document.querySelector("#share-main") as HTMLButtonElement).disabled), "Share must be disabled when no card exists");
  // Selected cells.
  await page.click("#share-use-selection");
  await settle(pane, 800);
  check(await visible(pane, "#share-card-img"), "Selected cells must make a card");
  await page.click("#share-use-result");
  await settle(pane, 500);
  note(`share "Latest result" with no result: ${await text(pane, "#share-card-status")}`);
  await audit(pane, "share-selection");
  await runtimeErrors(pane, "share");
  await page.context().close();
}


/** Starts in English, runs the agent to the preview, then switches the language twice and audits what stays on screen. */
async function flowLanguageSwitch(browser: any, width: number) {
  scope = `language-switch ${width}`;
  const pane = await openPane(browser, { lang: "en", width, consent: true });
  const { page } = pane;
  await page.fill("#instruction", "Create a summary of Net Amount by Region");
  await page.click("#smart-run");
  await page.waitForSelector("#agent-approve:not([hidden])", { timeout: 15_000 });
  await page.waitForTimeout(500);
  for (const lang of ["si", "ta"] as const) {
    await page.click("#menu-toggle");
    await page.click("#language");
    await page.keyboard.press("Escape");
    await settle(pane, 400);
    pane.lang = lang;
    await audit(pane, "switch-agent");
    await tab(pane, "explore");
    await audit(pane, "switch-explore");
    await tab(pane, "share");
    await audit(pane, "switch-share");
    await tab(pane, "work");
    const stillEnglish = await page.evaluate(() =>
      ["#agent-badge", "#agent-note", "#agent-approve", "#agent-discard", "#status-text"].filter((sel) => /^[\x20-\x7e]+$/.test((document.querySelector(sel)?.textContent ?? "").trim() || "x\u0DC1")),
    );
    check(stillEnglish.length === 0, `after switching to ${lang} these stayed English: ${stillEnglish.join(", ")}`);
  }
  await runtimeErrors(pane, "language switch");
  await page.context().close();
}

async function flowStatus(pane: Pane) {
  scope = `status ${pane.lang}/${pane.width}`;
  const status = await text(pane, "#status-text");
  const mode = await pane.page.evaluate(() => (document.querySelector("#status") as HTMLElement).dataset.mode);
  note(`status mode=${mode} text=${JSON.stringify(status)}`);
  if (pane.lang !== "en" && status) check(!/^[\x20-\x7e]+$/.test(status), `status line is English in ${pane.lang}: ${status}`);
  await pane.page.click("#menu-toggle");
  await audit(pane, "menu");
  await shot(pane, "menu");
  await pane.page.keyboard.press("Escape");
}

// --- main ----------------------------------------------------------------------------------------------

const browser = await chromium.launch({ executablePath: process.env.M365_UI_CHROME_PATH || "/opt/pw-browsers/chromium", args: ["--no-sandbox"] }).catch(async () =>
  chromium.launch({ args: ["--no-sandbox"] }),
);
try {
  for (const width of WIDTHS) {
    for (const lang of LANGS) {
      const pane = await openPane(browser, { lang, width, consent: true });
      scope = `home ${lang}/${width}`;
      await audit(pane, "home");
      await shot(pane, "home");
      await runtimeErrors(pane, "start");
      await flowStatus(pane);
      await flowTabs(pane);
      await flowNoticed(pane);
      await flowExplore(pane);
      await runtimeErrors(pane, "explore+tabs");
      const misses: string[] = await pane.page.evaluate(() => [...(window as any).__xl.misses]);
      for (const miss of misses) note(`stub did not model ${miss}`);
      await pane.page.context().close();
      await flowIdeas(browser, lang, width);
      await flowAgent(browser, lang, width);
      await flowDoubleRun(browser, lang, width);
      await flowPreviewCancel(browser, lang, width);
      await flowShare(browser, lang, width);
    }
    await flowLanguageSwitch(browser, width);
  }
} finally {
  await browser.close();
  server.close();
}

for (const [lang, strings] of seenEnglish) {
  console.log(`\n--- possibly untranslated text in ${lang} (${strings.size}) ---`);
  for (const line of [...strings].sort()) console.log(`  ${line}`);
}
console.log("\n--- notes ---");
for (const line of [...notes].sort()) console.log(`  ${line}`);
console.log(`\n--- failures (${failures.length}) ---`);
const unique = [...new Set(failures)];
for (const line of unique) console.log(`  ${line}`);
if (unique.length) process.exit(1);
console.log("taskpane-drive: all checks passed");
