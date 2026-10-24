import assert from "node:assert/strict";
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const artifactDirectory = path.join(root, "test-artifacts");
const bundle = path.join(root, "dist", "taskpane.bundle.js");
const chromeCandidates =
  process.platform === "win32"
    ? [
        process.env.M365_UI_CHROME_PATH,
        path.join(
          process.env.PROGRAMFILES ?? "C:\\Program Files",
          "Google\\Chrome\\Application\\chrome.exe",
        ),
        path.join(
          process.env["PROGRAMFILES(X86)"] ?? "C:\\Program Files (x86)",
          "Google\\Chrome\\Application\\chrome.exe",
        ),
        path.join(
          process.env["PROGRAMFILES(X86)"] ?? "C:\\Program Files (x86)",
          "Microsoft\\Edge\\Application\\msedge.exe",
        ),
      ]
    : [
        process.env.M365_UI_CHROME_PATH,
        "/usr/bin/google-chrome",
        "/usr/bin/google-chrome-stable",
        "/usr/bin/chromium",
        "/usr/bin/microsoft-edge",
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      ];
const chromePath = chromeCandidates.find(
  (candidate) => candidate && existsSync(candidate),
);

async function assertNoMojibake(page, state) {
  const visibleText = await page.evaluate(() => document.body.innerText);
  assert.equal(
    /(?:â[-¿]|Ã[-¿]|Â[-¿]|�)/u.test(visibleText),
    false,
    `${state} contains incorrectly decoded UTF-8 text`,
  );
}

if (!chromePath) {
  throw new Error(
    "No Chrome or Edge executable found. Set M365_UI_CHROME_PATH for the pane smoke test.",
  );
}
if (!existsSync(bundle)) {
  throw new Error(
    "The task-pane bundle is missing. Run npm run build before this test.",
  );
}

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};
const sampleValues = [
  [
    "Order Date",
    "Region",
    "Product",
    "Net Amount",
    "Quantity",
    "Customer",
    "Category",
    "Unit Price",
    "Discount",
    "Payment Method",
    "Order No",
  ],
  ...Array.from({ length: 25 }, (_, index) => [
    `2026-01-${String((index % 28) + 1).padStart(2, "0")}`,
    index % 2 ? "Western" : "Southern",
    "Laptop",
    1000 + index * 25,
    index + 1,
    `Customer ${index + 1}`,
    "Technology",
    1200,
    0.05,
    "Card",
    `ORD-${index + 1}`,
  ]),
];

const officeMock = `
  (() => {
    const values = ${JSON.stringify(sampleValues)};
    const sheet = { name: "Orders", load() {} };
    const sample = { values, load() {} };
    const range = {
      address: "'Orders'!A1:K301",
      rowCount: 301,
      columnCount: 11,
      worksheet: sheet,
      load() {},
      select() {},
      getCell() { return { getResizedRange() { return sample; } }; },
    };
    window.Office = {
      onReady: async () => ({ host: "Excel", platform: "OfficeOnline" }),
      context: {
        requirements: { isSetSupported: () => true },
        document: { addHandlerAsync() {} },
      },
      EventType: { DocumentSelectionChanged: "selection" },
    };
    window.Excel = {
      run: async (callback) => callback({
        workbook: { getSelectedRange: () => range },
        sync: async () => {},
      }),
    };
  })();
`;

const capabilities = {
  contractVersion: 1,
  excel: {
    canInspect: true,
    canPreview: true,
    canApply: true,
    actionKinds: ["chart", "pivot-table", "dashboard"],
    writableActionKinds: ["chart", "pivot-table", "dashboard"],
  },
  aiAnalysis: false,
  advanced: {},
};

const server = createServer(async (request, response) => {
  const requested = new URL(request.url ?? "/", "http://127.0.0.1");
  if (requested.pathname === "/favicon.ico") {
    response.writeHead(204);
    response.end();
    return;
  }
  if (requested.pathname === "/runtime-config.js") {
    response.writeHead(200, { "content-type": contentTypes[".js"] });
    response.end(
      'window.__VYNORAI_M365_CONFIG__ = { tenantId: "ui-test", clientId: "ui-test", redirectUri: location.origin + "/taskpane.html", scopes: ["api://ui-test/m365.excel.read"], apiBaseUrl: location.origin };',
    );
    return;
  }
  if (requested.pathname === "/build-id.js") {
    response.writeHead(200, { "content-type": contentTypes[".js"] });
    response.end('window.__VYNOR_M365_BUILD_ID__ = "ui-smoke";');
    return;
  }
  if (requested.pathname === "/v1/m365/excel/capabilities") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(capabilities));
    return;
  }
  const relative =
    requested.pathname === "/"
      ? "taskpane.html"
      : requested.pathname.replace(/^\//, "");
  const target = path.resolve(root, relative);
  if (!target.startsWith(root + path.sep) || !existsSync(target)) {
    response.writeHead(404);
    response.end("Not found");
    return;
  }
  try {
    response.writeHead(200, {
      "content-type":
        contentTypes[path.extname(target)] ?? "application/octet-stream",
    });
    response.end(await readFile(target));
  } catch {
    response.writeHead(500);
    response.end("Could not read test asset");
  }
});

const listen = () =>
  new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const close = () => new Promise((resolve) => server.close(resolve));

async function assertReachable(page, selector) {
  await page.$eval(selector, (element) =>
    element.scrollIntoView({ block: "center" }),
  );
  const result = await page.$eval(selector, (element) => {
    const box = element.getBoundingClientRect();
    const top = document.elementFromPoint(
      box.left + box.width / 2,
      box.top + box.height / 2,
    );
    return {
      top: box.top,
      bottom: box.bottom,
      width: box.width,
      height: box.height,
      display: getComputedStyle(element).display,
      hiddenParent: Boolean(element.closest("[hidden]")),
      workspaceView: document.body.dataset.workspaceView,
      visible:
        box.width > 0 &&
        box.height > 0 &&
        box.bottom > 0 &&
        box.top < window.innerHeight,
      unobscured:
        top === element ||
        element.contains(top) ||
        top?.contains(element) === true,
    };
  });
  assert.equal(
    result.visible,
    true,
    `${selector} is not visible in the pane: ${JSON.stringify(result)}`,
  );
  assert.equal(
    result.unobscured,
    true,
    `${selector} is covered by another pane element`,
  );
}

async function verifyViewport(browser, baseUrl, viewport, label) {
  const page = await browser.newPage();
  const consoleErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.stack || error.message));
  await page.setViewport(viewport);
  await page.evaluateOnNewDocument(() => {
    localStorage.setItem(
      "vynorai.m365.excel.session.v2",
      JSON.stringify({
        accessToken: "ui-smoke-token",
        expiresAt: Date.now() + 60 * 60 * 1000,
        issuedAt: Date.now(),
        long: false,
      }),
    );
  });
  await page.setRequestInterception(true);
  page.on("request", (request) => {
    if (
      request.url() ===
      "https://appsforoffice.microsoft.com/lib/1/hosted/office.js"
    ) {
      void request.respond({
        contentType: "text/javascript",
        body: officeMock,
      });
      return;
    }
    if (request.url().startsWith(baseUrl)) {
      void request.continue();
      return;
    }
    void request.abort();
  });
  await page.goto(`${baseUrl}/taskpane.html`, { waitUntil: "networkidle0" });
  try {
    await page.waitForFunction(
      () =>
        document.body.dataset.auth === "in" &&
        !document.querySelector("#smart-run")?.hasAttribute("disabled"),
      { timeout: 8000 },
    );
  } catch (error) {
    const state = await page.evaluate(() => ({
      auth: document.body.dataset.auth,
      status: document.querySelector("#status-text")?.textContent,
      smartDisabled: document.querySelector("#smart-run")?.hasAttribute("disabled"),
    }));
    throw new Error(
      `taskpane initialization failed: ${JSON.stringify(state)}; ${consoleErrors.join(" | ")}`,
      { cause: error },
    );
  }
  const idleStatus = await page.$eval("#status", (element) => ({
    mode: element.dataset.mode,
    statusTextVisible:
      (element.querySelector("#status-text"))?.getClientRects().length > 0,
    menuVisible:
      document.querySelector("#menu-toggle")?.getClientRects().length > 0,
  }));
  assert.equal(
    idleStatus.mode,
    "signed-in-idle",
    "the signed-in landing status should collapse after authentication",
  );
  assert.equal(
    idleStatus.statusTextVisible,
    false,
    "the signed-in landing message should not consume pane space",
  );
  assert.equal(
    idleStatus.menuVisible,
    true,
    "the app menu must remain reachable when the idle status collapses",
  );
  const skipLinkState = await page.evaluate(() => {
    const link = document.querySelector(".skip-link");
    if (!link) return undefined;
    const before = link.getBoundingClientRect();
    link.focus();
    const afterProgrammaticFocus = link.getBoundingClientRect();
    link.blur();
    return {
      beforeTop: before.top,
      afterProgrammaticFocusTop: afterProgrammaticFocus.top,
    };
  });
  assert.ok(skipLinkState, "the accessibility skip link is missing");
  assert.equal(
    skipLinkState.beforeTop < 0,
    true,
    "the skip link must stay off-canvas in the signed-in pane",
  );
  assert.equal(
    skipLinkState.afterProgrammaticFocusTop < 0,
    true,
    `restored Office focus must not show the skip link over the status bar: ${JSON.stringify(skipLinkState)}`,
  );
  await page.evaluate(() => {
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Tab", bubbles: true }),
    );
    document.querySelector(".skip-link")?.focus();
  });
  const keyboardSkipLinkState = await page.evaluate(() => {
    const link = document.querySelector(".skip-link");
    return {
      focused: document.activeElement === link,
      top: link?.getBoundingClientRect().top ?? Number.NaN,
    };
  });
  assert.equal(
    keyboardSkipLinkState.focused,
    true,
    `Tab must reach the accessibility skip link: ${JSON.stringify(keyboardSkipLinkState)}`,
  );
  assert.equal(
    keyboardSkipLinkState.top >= 0,
    true,
    "keyboard focus must reveal the skip link",
  );
  await page.evaluate(() => document.querySelector(".skip-link")?.blur());
  await page.waitForSelector('#context-suggestion-list[data-count="3"]', {
    timeout: 8000,
  });
  await page.$eval("#status", (element) => {
    element.dataset.mode = "signed-in-idle";
  });
  assert.equal(
    await page.$eval(
      "#selection-text",
      (element) => element.textContent?.includes("Orders") ?? false,
    ),
    true,
    "the Office selection mock did not reach the pane",
  );
  assert.equal(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
    true,
    "the pane has horizontal overflow",
  );
  assert.equal(
    await page.$eval("#chat-bar", (element) => element.getClientRects().length),
    0,
    "the legacy chat row must not consume a signed-in pane row",
  );
  assert.equal(
    await page.$eval("#header-new-chat", (element) => element.getClientRects().length),
    1,
    "New chat must remain available from the header",
  );
  assert.equal(
    await page.$eval("#chat-history-select", (element) => element.hidden),
    true,
    "empty workbooks should keep the history picker closed",
  );
  assert.equal(
    await page.$eval(".brand-bar", (element) => element.getClientRects().length > 0),
    true,
    "the premium workspace brand header must remain visible",
  );
  await assertReachable(page, "#header-new-chat");
  assert.equal(
    await page.$eval(
      "#open-chat-history",
      (element) => element.getClientRects().length > 0,
    ),
    true,
    "the disabled history control must remain discoverable in the header",
  );
  assert.equal(
    await page.$eval("#selection-chip", (element) => element.getClientRects().length),
    0,
    "the retained selection context must not consume a work-screen row",
  );
  assert.equal(
    await page.$("#workbook-context"),
    null,
    "the workbook context card must stay out of the main work surface",
  );
  assert.equal(
    await page.evaluate(() => {
      const composer = document
        .querySelector(".composer")
        ?.getBoundingClientRect();
      const area = document
        .querySelector("#scroll-area")
        ?.getBoundingClientRect();
      return Boolean(composer && area && composer.top < area.top);
    }),
    true,
    "the request composer must be above the scrollable workspace",
  );
  await page.click("#menu-toggle");
  await page.waitForSelector("#menu:not([hidden])");
  const menuLayout = await page.evaluate(() => {
    const menu = document.querySelector("#menu")?.getBoundingClientRect();
    const actions = document.querySelector(".brand-actions");
    return {
      menuTop: menu?.top,
      menuBottom: menu?.bottom,
      correct: Boolean(
        menu &&
          actions?.contains(document.querySelector("#menu")) &&
          menu.left >= 0 &&
          menu.right <= window.innerWidth,
      ),
    };
  });
  assert.equal(
    menuLayout.correct,
    true,
    `the open menu must stay anchored to the header and inside the pane: ${JSON.stringify(menuLayout)}`,
  );
  await assertReachable(page, "#language");
  assert.equal(
    await page.$eval("#chat-bar", (element) => element.getClientRects().length),
    0,
    "a new workbook must start with the focused request screen, not empty chat controls",
  );
  await page.click("#menu-toggle");
  await page.waitForSelector("#menu[hidden]");
  for (const selector of [
    "#menu-toggle",
    ".idle-card",
    "#instruction",
    "#smart-run",
  ]) {
    await assertReachable(page, selector);
  }
  // A landing suggestion is a safe shortcut: it may prepare a request, but it must never run a
  // workbook operation or create chat output before the person presses Run.
  const beforeSuggestion = await page.evaluate(() => ({
    messages: document.querySelector("#conversation-history")?.childElementCount,
    previewHidden: document.querySelector("#result-card")?.hasAttribute("hidden"),
  }));
  await page.click(".idle-card");
  const afterSuggestion = await page.evaluate(() => ({
    request: document.querySelector("#instruction")?.value,
    messages: document.querySelector("#conversation-history")?.childElementCount,
    previewHidden: document.querySelector("#result-card")?.hasAttribute("hidden"),
  }));
  assert.ok(afterSuggestion.request, "a landing suggestion must fill the request box");
  assert.equal(
    afterSuggestion.messages,
    beforeSuggestion.messages,
    "a landing suggestion must not create a chat reply before Run",
  );
  assert.equal(
    afterSuggestion.previewHidden,
    beforeSuggestion.previewHidden,
    "a landing suggestion must not create a preview before Run",
  );
  await page.$eval("#instruction", (element) => {
    element.value = "";
    element.dispatchEvent(new Event("input"));
  });
  await page.waitForSelector('#context-suggestion-list[data-count="3"]');
  if (viewport.width <= 360) {
    assert.equal(
      await page.$eval("#idle-cards", (element) => {
        const columns = getComputedStyle(element).gridTemplateColumns.trim();
        return columns.split(/\s+/).length === 1;
      }),
      true,
      "compact panes must show the real-column suggestions in one column",
    );
  } else if (viewport.width >= 500) {
    assert.equal(
      await page.$eval("#idle-cards", (element) => {
        const columns = getComputedStyle(element).gridTemplateColumns.trim();
        return columns.split(/\s+/).length === 2;
      }),
      true,
      "medium panes must use two readable suggestion cards per row",
    );
  }
  await page.$eval("#scroll-area", (area) => {
    area.scrollTop = 0;
  });
  await page.screenshot({
    path: path.join(artifactDirectory, `taskpane-${label}.png`),
    fullPage: true,
  });
  await assertNoMojibake(page, `${label} home`);
  await page.click("#menu-toggle");
  await page.click("#advanced-workbook-options");
  assert.equal(
    await page.$eval("#prefs-card", (details) => details.open),
    true,
    "Advanced workbook options must open the saved workbook settings",
  );
  await page.$eval("#prefs-card", (details) => {
    details.setAttribute("open", "");
    details.scrollIntoView({ block: "center" });
  });
  await assertReachable(page, "#prefs-currency");
  assert.equal(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
    true,
    "the workbook settings have horizontal overflow",
  );
  await page.screenshot({
    path: path.join(artifactDirectory, `taskpane-${label}-settings.png`),
    fullPage: true,
  });
  // Agent runs reveal their progress card before the first model response. Exercise that narrow
  // visual state independently of the network/model path.
  await page.$eval("#agent-card", (card) => {
    document.querySelector("#prefs-card").setAttribute("hidden", "");
    card.removeAttribute("hidden");
    card.querySelector("#agent-badge").textContent = "Planning";
    const checked = card.querySelector("#agent-checked");
    checked.removeAttribute("hidden");
    checked.dataset.state = "working";
    checked.querySelector("#agent-checked-text").textContent =
      "Working... Calculating...";
    card.querySelector("#agent-stop").removeAttribute("hidden");
    card.querySelector('[data-stage="inspect"]').classList.add("done");
    card.querySelector('[data-stage="plan"]').classList.add("active");
    const map = card.querySelector("#workbook-map");
    map.removeAttribute("hidden");
    map.querySelector("#workbook-map-content").innerHTML =
      '<div class="relationship-graph"><div class="relationship-node"><strong>Orders</strong><span>Item Code</span></div><div class="relationship-line">many-to-one -&gt;</div><div class="relationship-node"><strong>Items</strong><span>Item Code</span></div></div><div class="relationship-facts"><span>12 unmatched rows</span><span>2 duplicate keys</span><span>Clean keys first</span></div>';
    card.scrollIntoView({ block: "start" });
  });
  await assertReachable(page, "#agent-card");
  await assertReachable(page, "#agent-stop");
  assert.equal(
    await page.$eval("#agent-checked", (element) =>
      element.textContent?.includes("Working... Calculating..."),
    ),
    true,
    "the compact agent state must show the current process before details",
  );
  assert.equal(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
    true,
    "the active agent progress card has horizontal overflow",
  );
  await page.screenshot({
    path: path.join(artifactDirectory, `taskpane-${label}-agent.png`),
    fullPage: true,
  });
  await assertNoMojibake(page, `${label} agent`);
  // Preview, result, insight and share cards used to be nested inside one another. Keep these
  // representative post-action states in the visual smoke so sticky controls cannot cover them.
  await page.evaluate(() => {
    document.querySelector("#agent-card").setAttribute("hidden", "");
    const result = document.querySelector("#result-card");
    result.removeAttribute("hidden");
    document.querySelector("#preview-summary").textContent =
      "Using 300 rows and 11 columns. Your source data stays unchanged.";
    const impact = document.querySelector("#preview-impact");
    impact.removeAttribute("hidden");
    impact.innerHTML = [
      ["300", "Rows"],
      ["11", "Columns"],
      ["2", "Changes"],
      ["0", "Warnings"],
    ]
      .map(([value, name]) => `<div class="impact-item"><strong>${value}</strong><span>${name}</span></div>`)
      .join("");
    document.querySelector("#outcomes").innerHTML =
      '<div class="outcome"><strong>Sales dashboard</strong><div class="where">Will be created on a new sheet</div><p>Column chart of Net Amount by Category with totals.</p></div>';
    const tweaks = document.querySelector("#preview-tweaks");
    tweaks.removeAttribute("hidden");
    for (const label of tweaks.querySelectorAll("label"))
      label.removeAttribute("hidden");
    document.querySelector("#tweak-chart-type").innerHTML =
      '<option>Column</option><option>Line</option>';
    document.querySelector("#tweak-aggregation").innerHTML =
      '<option>Sum</option><option>Average</option>';
    document.querySelector("#tweak-category").innerHTML =
      '<option>Category</option>';
    document.querySelector("#tweak-value").innerHTML =
      '<option>Net Amount</option>';
    const apply = document.querySelector("#apply");
    apply.removeAttribute("disabled");
    result.scrollIntoView({ block: "start" });
  });
  await page.waitForFunction(
    () => !document.querySelector('[data-workspace-target="results"]')?.disabled,
  );
  await page.click('[data-workspace-target="results"]');
  assert.equal(
    await page.$eval(".composer", (element) => element.getClientRects().length),
    0,
    "the request composer must not consume space in the Results view",
  );
  assert.equal(
    await page.$eval('[data-workspace-target="results"]', (button) =>
      button.getAttribute("aria-selected"),
    ),
    "true",
    "the Results tab must expose its selected state",
  );
  await assertReachable(page, "#result-card");
  await assertReachable(page, "#apply");
  await page.screenshot({
    path: path.join(artifactDirectory, `taskpane-${label}-preview.png`),
    fullPage: true,
  });
  await assertNoMojibake(page, `${label} preview`);
  await page.evaluate(() => {
    document.querySelector("#result-card").setAttribute("hidden", "");
    const gallery = document.querySelector("#result-gallery");
    gallery.removeAttribute("hidden");
    document.querySelector("#verified-result-banner").removeAttribute("hidden");
    document.querySelector("#operation-history").removeAttribute("hidden");
    document.querySelector("#result-gallery-list").innerHTML =
      '<article class="result-item"><div class="result-item-head"><strong>Chart</strong><span class="verified-badge">Verified · Net Amount by Category</span></div><p class="result-item-summary">Saved on Net Amount by Category. Verified by reading the result back from Excel.</p><div class="result-item-actions"><button class="result-primary-action">Show result</button><details class="result-more-actions"><summary>More actions</summary><div class="result-more-actions-list"><button>Email report</button><button>Refresh</button><button>Undo</button><button>Replace older</button></div></details></div><details class="result-evidence"><summary>Show evidence</summary><ul><li>Source: Orders!A1:K301</li><li>Result read back from Excel</li></ul></details></article>';
    const analysis = document.querySelector("#ai-result");
    analysis.dataset.workspacePanel = "results";
    analysis.className = "analysis-card";
    analysis.innerHTML =
      '<h3>Best chart for the sales data</h3><ol class="analysis-step-list"><li class="analysis-step"><span class="analysis-step-number">1</span><div><strong>Column chart of Net Amount by Category</strong><span>Compares four clear groups using the primary measure.</span></div></li></ol><button>Use these steps</button>';
    const insights = document.querySelector("#insights-card");
    insights.removeAttribute("hidden");
    insights.setAttribute("open", "");
    document.querySelector("#insights-list").innerHTML =
      '<p><strong>Net Amount:</strong> Total 7,461,955; average 25,308.</p><p><strong>Trend:</strong> The later half is stronger.</p>';
    gallery.scrollIntoView({ block: "start" });
  });
  await assertReachable(page, "#result-gallery");
  await assertReachable(page, "#operation-history");
  await assertReachable(page, "#open-change-log");
  await assertReachable(page, "#ai-result");
  await assertReachable(page, "#insights-card");
  await page.click(".result-more-actions > summary");
  await assertReachable(page, ".result-more-actions-list button:first-child");
  await page.click(".result-more-actions > summary");
  await page.screenshot({
    path: path.join(artifactDirectory, `taskpane-${label}-results.png`),
    fullPage: true,
  });
  await assertNoMojibake(page, `${label} results`);
  await page.evaluate(() => {
    document.querySelector("#result-gallery").setAttribute("hidden", "");
    document.querySelector("#ai-result").textContent = "";
    document.querySelector("#insights-card").setAttribute("hidden", "");
    const email = document.querySelector("#email-card");
    email.removeAttribute("hidden");
    document.querySelector("#email-to").value = "recipient@example.com";
    document.querySelector("#email-subject").value = "Sales dashboard";
    document.querySelector("#email-body").value =
      "Please find the reviewed Excel report attached.";
    document.querySelector("#share-message-block").removeAttribute("hidden");
    document.querySelector("#share-message").value =
      "Sales dashboard\nTotal Net Amount: 7,461,955";
    email.scrollIntoView({ block: "start" });
  });
  await page.waitForFunction(
    () => !document.querySelector('[data-workspace-target="share"]')?.disabled,
  );
  await page.click('[data-workspace-target="share"]');
  assert.equal(
    await page.$eval(".composer", (element) => element.getClientRects().length),
    0,
    "the request composer must not consume space in the Share view",
  );
  assert.equal(
    await page.$eval('[data-workspace-target="share"]', (button) =>
      button.getAttribute("aria-selected"),
    ),
    "true",
    "the Share tab must expose its selected state",
  );
  await assertReachable(page, "#email-card");
  await assertReachable(page, "#share-copy-text");
  await page.screenshot({
    path: path.join(artifactDirectory, `taskpane-${label}-share.png`),
    fullPage: true,
  });
  assert.deepEqual(
    consoleErrors,
    [],
    `browser errors in ${label}: ${consoleErrors.join(" | ")}`,
  );
  await page.close();
}

await listen();
await mkdir(artifactDirectory, { recursive: true });
const address = server.address();
const baseUrl = `http://127.0.0.1:${address.port}`;
const browser = await puppeteer.launch({
  executablePath: chromePath,
  headless: true,
  args: ["--no-first-run", "--disable-background-networking"],
});

try {
  await verifyViewport(
    browser,
    baseUrl,
    { width: 320, height: 780, deviceScaleFactor: 1 },
    "compact",
  );
  await verifyViewport(
    browser,
    baseUrl,
    { width: 400, height: 780, deviceScaleFactor: 1 },
    "narrow",
  );
  await verifyViewport(
    browser,
    baseUrl,
    { width: 520, height: 900, deviceScaleFactor: 1 },
    "wide",
  );
  console.log(
    `M365 task-pane browser smoke passed; screenshots: ${artifactDirectory}`,
  );
} finally {
  await browser.close();
  await close();
}
