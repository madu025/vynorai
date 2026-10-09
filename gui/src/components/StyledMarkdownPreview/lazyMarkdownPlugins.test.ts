import { afterEach, describe, expect, it } from "vitest";

import {
  ensureHighlightLoaded,
  ensureKatexLoaded,
  isHighlightLoaded,
  isKatexLoaded,
  lazyRehypeHighlight,
  lazyRehypeKatex,
  resetLazyMarkdownPluginsForTests,
  sourceNeedsHighlight,
  sourceNeedsKatex,
} from "./lazyMarkdownPlugins";

afterEach(() => resetLazyMarkdownPluginsForTests());

describe("lazyMarkdownPlugins", () => {
  it("only asks for the heavy chunks when the text can use them", () => {
    expect(sourceNeedsKatex("plain text, price $5 and $6")).toBe(false);
    expect(sourceNeedsKatex("$$x^2$$")).toBe(true);
    expect(sourceNeedsHighlight("no code here")).toBe(false);
    expect(sourceNeedsHighlight("```ts\nconst a = 1\n```")).toBe(true);
  });

  it("stand-ins do nothing, and do not throw, before the chunks load", () => {
    const tree = { type: "root", children: [] };
    expect(() => lazyRehypeKatex()(tree, {})).not.toThrow();
    expect(() => lazyRehypeHighlight()(tree, {})).not.toThrow();
    expect(isKatexLoaded()).toBe(false);
    expect(isHighlightLoaded()).toBe(false);
  });

  it("loads each chunk once and the stand-ins then delegate to it", async () => {
    const first = ensureKatexLoaded();
    expect(ensureKatexLoaded()).toBe(first);
    await first;
    await ensureHighlightLoaded();
    expect(isKatexLoaded()).toBe(true);
    expect(isHighlightLoaded()).toBe(true);

    // a hast tree with one code block gets highlighted by the real plugin
    const tree: any = {
      type: "root",
      children: [
        {
          type: "element",
          tagName: "pre",
          properties: {},
          children: [
            {
              type: "element",
              tagName: "code",
              properties: { className: ["language-js"] },
              children: [{ type: "text", value: "const a = 1;" }],
            },
          ],
        },
      ],
    };
    lazyRehypeHighlight()(tree, {});
    const code = tree.children[0].children[0];
    expect(code.children.some((c: any) => c.type === "element")).toBe(true);
  });
});
