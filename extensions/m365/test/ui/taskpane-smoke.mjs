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
  assert.equal(result.visible, true, `${selector} is not visible in the pane`);
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
  page.on("pageerror", (error) => consoleErrors.push(error.message));
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
  await page.waitForFunction(
    () =>
      document.body.dataset.auth === "in" &&
      !document.querySelector("#smart-run")?.hasAttribute("disabled"),
    { timeout: 8000 },
  );
  await page.waitForSelector('#context-suggestion-list[data-count="3"]', {
    timeout: 8000,
  });
  assert.equal(
    await page.$eval(
      "#context-selection",
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
  for (const selector of [
    "#menu-toggle",
    "#refresh-context",
    ".smart-suggestion",
    "#new-chat",
    "#instruction",
    "#smart-run",
  ]) {
    await assertReachable(page, selector);
  }
  await page.click("#menu-toggle");
  await page.waitForSelector("#menu:not([hidden])");
  await assertReachable(page, "#language");
  await page.click("#menu-toggle");
  await page.click("#refresh-context");
  await page.waitForSelector('#context-suggestion-list[data-count="3"]');
  await page.screenshot({
    path: path.join(artifactDirectory, `taskpane-${label}.png`),
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
