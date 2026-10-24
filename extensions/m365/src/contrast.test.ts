import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const html = readFileSync(new URL("../pane.css", import.meta.url), "utf8");

function tokens(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const match of block.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g))
    out[match[1]] = match[2];
  return out;
}

const light = tokens(
  html.slice(
    html.indexOf(":root {"),
    html.indexOf("@media (prefers-color-scheme: dark)"),
  ),
);
const darkStart = html.indexOf("@media (prefers-color-scheme: dark)");
const dark = {
  ...light,
  ...tokens(
    html.slice(darkStart, html.indexOf("@media (forced-colors", darkStart)),
  ),
};

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** Text token on the surface it is drawn on: WCAG AA needs 4.5:1 for normal text. */
const PAIRS: Array<[string, string]> = [
  ["muted", "bg"],
  ["muted", "surface-solid"],
  ["muted", "surface-muted"],
  ["muted", "tint"],
  ["ink", "surface-solid"],
  ["brand-ink", "tint"],
  ["brand-ink", "surface-solid"],
  ["on-brand", "brand"],
  ["success", "success-bg"],
  ["warning", "warning-bg"],
  ["danger", "danger-bg"],
  ["bar-ink", "bar-bg"],
];

for (const [name, theme] of [
  ["light", light],
  ["dark", dark],
] as const) {
  test(`${name} theme text tokens reach WCAG AA contrast`, () => {
    const low: string[] = [];
    for (const [fg, bg] of PAIRS) {
      assert.ok(theme[fg] && theme[bg], `missing token ${fg} or ${bg}`);
      const ratio = contrast(theme[fg], theme[bg]);
      if (ratio < 4.5) low.push(`${fg} on ${bg} = ${ratio.toFixed(2)}`);
    }
    assert.deepEqual(low, []);
  });
}

test("disabled workspace tabs keep readable text instead of fading it", () => {
  const fixes = html.slice(html.indexOf("/* polish-fixes-2 */"));
  assert.match(fixes, /\.workspace-nav button:disabled\s*\{[^}]*opacity: 1/);
});
