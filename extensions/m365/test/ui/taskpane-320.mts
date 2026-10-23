/**
 * Renders taskpane.html at 320x700 in English, Sinhala and Tamil with the agent roles filled with their
 * longest evidence lines, and checks: no horizontal scroll, and every role status is at least 120px wide.
 * Run: npx tsx test/ui/taskpane-320.mts   (needs playwright-core and a chromium; see the paths below)
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { localizeMessage, translate } from "../../src/i18n.js";

const require = createRequire("/opt/node-tools/node_modules/");
const { chromium } = require("playwright-core");
const page_url = pathToFileURL(
  fileURLToPath(new URL("../../taskpane.html", import.meta.url)),
).href;

const ROLES = ["planner", "relationships", "builder", "accuracy", "safety", "verification"];
const EVIDENCE = [
  "12 plan step(s)",
  "Orders.CustomerID → Customers.CustomerID · many-to-one · 1,204 unmatched rows · 37 duplicate keys",
  "12 staged change(s)",
  "3 issue(s): C12 sums C2:C10 but the data ends at C11 and more words here",
  "checks passed · 14 calculation(s)",
  "5 change(s) read back, 1 failed",
];

const browser = await chromium.launch({
  executablePath: process.env.M365_UI_CHROME_PATH || undefined,
  args: ["--no-sandbox"],
});
try {
  for (const lang of ["en", "si", "ta"] as const) {
    const page = await browser.newPage({ viewport: { width: 320, height: 700 } });
    await page.goto(page_url);
    const labels = ROLES.map((role) => translate(lang, `role_${role}`, role));
    const lines = EVIDENCE.map((line) => (lang === "en" ? line : localizeMessage(lang, line)));
    const result = await page.evaluate(
      ({ labels, lines }) => {
        let node: HTMLElement | null = document.getElementById("agent-card");
        document.body.dataset.auth = "in";
        while (node) {
          node.hidden = false;
          node.style.display = node.id === "agent-card" ? "block" : node.style.display;
          node = node.parentElement;
        }
        const rows = [...document.querySelectorAll<HTMLElement>("#agent-activity-list [data-agent-role]")];
        rows.forEach((row, i) => {
          row.querySelector("strong")!.textContent = labels[i];
          row.querySelector(".agent-role-status")!.textContent = lines[i];
        });
        const scroller = document.scrollingElement as HTMLElement;
        const widths = rows.map((row) => row.querySelector<HTMLElement>(".agent-role-status")!.getBoundingClientRect().width);
        return { scrollWidth: scroller.scrollWidth, widths };
      },
      { labels, lines },
    );
    assert.ok(result.scrollWidth <= 320, `${lang}: horizontal scroll ${result.scrollWidth}`);
    assert.ok(Math.min(...result.widths) >= 120, `${lang}: role status ${Math.min(...result.widths)}px`);
    console.log(lang, "scrollWidth", result.scrollWidth, "min status width", Math.round(Math.min(...result.widths)));
    await page.close();
  }
} finally {
  await browser.close();
}
