/**
 * Renders taskpane.html at 320x700 in English, Sinhala and Tamil with the agent roles filled with their
 * longest evidence lines, and checks: no horizontal scroll, and every role status is at least 120px wide.
 * Run: npx tsx test/ui/taskpane-320.mts   (needs playwright-core and a chromium; see the paths below)
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { localizeMessage, translate } from "../../src/i18n.js";

const require = createRequire(import.meta.url);
const puppeteer = require("puppeteer-core");
const page_url = pathToFileURL(
  fileURLToPath(new URL("../../taskpane.html", import.meta.url)),
).href;
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
const executablePath = chromeCandidates.find(
  (candidate) => candidate && existsSync(candidate),
);
if (!executablePath)
  throw new Error("No Chrome or Edge executable found for the 320px UI test.");

const ROLES = [
  "planner",
  "relationships",
  "builder",
  "accuracy",
  "safety",
  "verification",
];
const EVIDENCE = [
  "12 plan step(s)",
  "Orders.CustomerID → Customers.CustomerID · many-to-one · 1,204 unmatched rows · 37 duplicate keys",
  "12 staged change(s)",
  "3 issue(s): C12 sums C2:C10 but the data ends at C11 and more words here",
  "checks passed · 14 calculation(s)",
  "5 change(s) read back, 1 failed",
];
const HEIGHTS = [598, 700] as const;

const browser = await puppeteer.launch({
  executablePath,
  headless: true,
  args: ["--no-sandbox"],
});
try {
  for (const height of HEIGHTS) {
    for (const lang of ["en", "si", "ta"] as const) {
      const page = await browser.newPage();
      await page.setViewport({ width: 320, height });
      await page.goto(page_url);
      const labels = ROLES.map((role) => translate(lang, `role_${role}`, role));
      const lines = EVIDENCE.map((line) =>
        lang === "en" ? line : localizeMessage(lang, line),
      );
      const result = await page.evaluate(
        ({ labels, lines }) => {
          let node: HTMLElement | null = document.getElementById("agent-card");
          document.body.dataset.auth = "in";
          while (node) {
            node.hidden = false;
            node.style.display =
              node.id === "agent-card" ? "block" : node.style.display;
            node = node.parentElement;
          }
          const rows = [
            ...document.querySelectorAll<HTMLElement>(
              "#agent-activity-list [data-agent-role]",
            ),
          ];
          rows.forEach((row, i) => {
            row.querySelector("strong")!.textContent = labels[i];
            row.querySelector(".agent-role-status")!.textContent = lines[i];
          });
          const scroller = document.scrollingElement as HTMLElement;
          const widths = rows.map(
            (row) =>
              row
                .querySelector<HTMLElement>(".agent-role-status")!
                .getBoundingClientRect().width,
          );
          return { scrollWidth: scroller.scrollWidth, widths };
        },
        { labels, lines },
      );
      assert.ok(
        result.scrollWidth <= 320,
        `${lang}/${height}: horizontal scroll ${result.scrollWidth}`,
      );
      assert.ok(
        Math.min(...result.widths) >= 120,
        `${lang}/${height}: role status ${Math.min(...result.widths)}px`,
      );
      console.log(
        `${lang}/${height}`,
        "scrollWidth",
        result.scrollWidth,
        "min status width",
        Math.round(Math.min(...result.widths)),
      );
      // The Preview card: Apply and Cancel share the dock without horizontal scroll, and Cancel is reachable by keyboard.
      const dock = await page.evaluate(
        ({ apply, cancel }) => {
          let node: HTMLElement | null = document.getElementById("result-card");
          while (node) {
            node.hidden = false;
            node = node.parentElement;
          }
          // Open the Results tab, as the person does after a preview is ready.
          document.body.dataset.workspaceView = "results";
          const applyButton = document.getElementById(
            "apply",
          ) as HTMLButtonElement;
          const cancelButton = document.getElementById(
            "cancel-result",
          ) as HTMLButtonElement;
          applyButton.textContent = apply;
          cancelButton.textContent = cancel;
          cancelButton.focus();
          const box = cancelButton.getBoundingClientRect();
          return {
            scrollWidth: (document.scrollingElement as HTMLElement).scrollWidth,
            focused: document.activeElement === cancelButton,
            right: box.right,
            width: box.width,
          };
        },
        {
          apply: translate(lang, "apply", "Confirm and apply"),
          cancel: translate(lang, "cancel_preview", "Cancel"),
        },
      );
      assert.ok(
        dock.scrollWidth <= 320,
        `${lang}/${height}: preview card scroll ${dock.scrollWidth}`,
      );
      assert.ok(dock.focused, `${lang}/${height}: Cancel cannot take focus`);
      assert.ok(
        dock.right <= 320 && dock.width >= 40,
        `${lang}/${height}: Cancel box ${dock.right}/${dock.width}`,
      );
      console.log(
        `${lang}/${height}`,
        "cancel button right",
        Math.round(dock.right),
        "width",
        Math.round(dock.width),
      );
      await page.close();
    }
  }
} finally {
  await browser.close();
}
