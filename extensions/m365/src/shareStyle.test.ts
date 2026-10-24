import "./packSi.js";
import "./packTa.js";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildShareCard } from "./shareCard.js";
import {
  SHARE_STYLES,
  SHARE_STYLE_KEY,
  availableShareStyles,
  chartStyleLayout,
  insightStyleLayout,
  parseShareStyle,
  pickShareStyle,
  readShareStyle,
  storeShareStyle,
} from "./shareStyle.js";
import { onStylePick, updateStylePicker } from "./taskpaneShareStyle.js";
import { translate } from "./i18n.js";

const date = new Date(2026, 9, 22);
const dashboard = buildShareCard(
  [
    ["Sales by Region"],
    ["subtitle"],
    [],
    ["RECORDS", "TOTAL SALES"],
    [120, 4500000],
    [],
    ["Region", "Sales"],
    ["Western", 3000000],
    ["Central", 1000000],
    ["North", 500000],
  ],
  { sheet: "Dashboard", symbol: "Rs", date },
);
const pairs = buildShareCard([["Total", 1200]], { sheet: "S", date });

test("a card with bars and a headline offers all three styles", () => {
  assert.ok(dashboard.bars.length >= 2 && dashboard.headline);
  assert.deepEqual(availableShareStyles(dashboard), [...SHARE_STYLES]);
});

test("a style the card cannot show is not offered, so no picture is empty", () => {
  assert.deepEqual(availableShareStyles({ bars: [], headline: "" }), [
    "summary",
  ]);
  assert.deepEqual(
    availableShareStyles({
      bars: [{ name: "a", value: 1, text: "1" }],
      headline: "  ",
    }),
    ["summary"],
  );
  assert.deepEqual(
    availableShareStyles({ bars: [], headline: "Western brings 67%." }),
    ["summary", "insight"],
  );
  assert.deepEqual(availableShareStyles(pairs), ["summary"]);
});

test("the chosen style falls back to the summary when this card cannot show it", () => {
  assert.equal(pickShareStyle(dashboard, "insight"), "insight");
  assert.equal(pickShareStyle(pairs, "insight"), "summary");
  assert.equal(pickShareStyle(dashboard, undefined), "summary");
});

test("only the three known styles are read back from storage", () => {
  assert.equal(parseShareStyle("chart"), "chart");
  assert.equal(parseShareStyle("<img onerror=1>"), undefined);
  assert.equal(parseShareStyle(null), undefined);
  let stored = "";
  const storage = {
    getItem: (key: string) => (key === SHARE_STYLE_KEY ? stored || null : null),
    setItem: (_key: string, value: string) => {
      stored = value;
    },
  };
  storeShareStyle(storage, "insight");
  assert.equal(readShareStyle(storage), "insight");
  const blocked = {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("blocked");
    },
  };
  assert.doesNotThrow(() => storeShareStyle(blocked, "chart"));
  assert.equal(readShareStyle(blocked), undefined);
  assert.equal(readShareStyle(undefined), undefined);
});

test("the chart style grows with its bars and keeps room for the footer", () => {
  const three = chartStyleLayout(3, 3);
  const five = chartStyleLayout(3, 5);
  assert.ok(five.height > three.height);
  assert.equal(chartStyleLayout(3, 9).bars, 5);
  assert.ok(five.panelY + five.panelHeight + 100 <= five.height);
  assert.ok(chartStyleLayout(0, 3).panelY < three.panelY);
});

test("the insight style stacks headline, chart, tiles and footer without overlap", () => {
  const full = insightStyleLayout(3, 4, 3);
  assert.ok(full.panelY! > full.headlineY + 2 * 88);
  assert.ok(full.tilesY! >= full.panelY! + full.panelHeight);
  assert.ok(full.footerY > full.tilesY! + 150);
  assert.ok(full.height > full.footerY);
  const bare = insightStyleLayout(1, 0, 0);
  assert.equal(bare.panelY, undefined);
  assert.equal(bare.tilesY, undefined);
  assert.ok(bare.height < full.height);
  assert.equal(insightStyleLayout(9, 4, 3).headlineLines, 4);
});

// A minimal element, enough for the picker's logic.
function fakeButton(style: string) {
  const attributes: Record<string, string> = {};
  const image = { src: "" };
  return {
    dataset: { style },
    hidden: false,
    attributes,
    image,
    setAttribute: (name: string, value: string) => {
      attributes[name] = value;
    },
    querySelector: () => image,
    closest: function () {
      return this;
    },
  };
}

test("the picker shows only the styles the card can draw, marks the chosen one and sets thumbnails", () => {
  const buttons = SHARE_STYLES.map(fakeButton);
  const clicks: ((event: unknown) => void)[] = [];
  const root: any = {
    hidden: true,
    querySelectorAll: () => buttons,
    addEventListener: (_type: string, listener: (event: unknown) => void) =>
      clicks.push(listener),
  };
  updateStylePicker(root, ["summary", "chart"], "chart", {
    summary: "data:a",
    chart: "data:b",
  });
  assert.equal(root.hidden, false);
  assert.deepEqual(
    buttons.map((button) => button.hidden),
    [false, false, true],
  );
  assert.deepEqual(
    buttons.map((button) => button.attributes["aria-pressed"]),
    ["false", "true", "false"],
  );
  assert.equal(buttons[1].image.src, "data:b");
  const picked: string[] = [];
  onStylePick(root, (style) => picked.push(style));
  clicks[0]({ target: buttons[1] });
  clicks[0]({ target: buttons[2] });
  assert.deepEqual(picked, ["chart"], "a hidden style cannot be picked");
  assert.doesNotThrow(() =>
    updateStylePicker(null, ["summary"], "summary", {}),
  );
  updateStylePicker(root, ["summary"], "summary", {});
  assert.equal(root.hidden, true, "a single style needs no picker");
});

test("the picker is in the page with a Sinhala and Tamil label for each style", () => {
  const html =
    readFileSync(new URL("../taskpane.html", import.meta.url), "utf8") +
    "\n" +
    readFileSync(new URL("../pane.css", import.meta.url), "utf8");
  for (const style of SHARE_STYLES) {
    assert.match(html, new RegExp(`data-style="${style}"`));
    const key = `share_style_${style}`;
    assert.match(html, new RegExp(`data-i18n="${key}"`));
    assert.match(translate("si", key, ""), /[඀-෿]/);
    assert.match(translate("ta", key, ""), /[஀-௿]/);
  }
  assert.match(html, /data-i18n-aria-label="share_style_label"/);
  assert.match(translate("si", "share_style_label", ""), /[඀-෿]/);
  assert.match(translate("ta", "share_style_label", ""), /[஀-௿]/);
});
