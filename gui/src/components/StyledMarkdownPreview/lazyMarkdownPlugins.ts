/**
 * KaTeX (about 580 KB of source) and highlight.js with its languages (about
 * 430 KB) used to sit in the webview's main script. They are separate chunks
 * now. react-remark builds its processor once from the plugin list it gets on
 * the first render, so the plugins below are fixed stand-ins that delegate to
 * the real transformer once its chunk has loaded.
 */
type Transformer = (tree: any, file: any) => void;

let katexTransform: Transformer | undefined;
let highlightTransform: Transformer | undefined;
let katexLoading: Promise<void> | undefined;
let highlightLoading: Promise<void> | undefined;

export function ensureKatexLoaded(): Promise<void> {
  katexLoading ??= import("rehype-katex")
    .then((module) => {
      katexTransform = (module.default as any)({}) as Transformer;
    })
    .catch((error) => {
      console.warn("Could not load KaTeX, math stays as plain text", error);
      katexLoading = undefined;
    });
  return katexLoading;
}

export function ensureHighlightLoaded(): Promise<void> {
  highlightLoading ??= import("./rehypeHighlightPlugin")
    .then((module) => {
      const [plugin, options] = module.rehypeHighlightPlugin() as [
        (options: unknown) => Transformer,
        unknown,
      ];
      highlightTransform = plugin(options);
    })
    .catch((error) => {
      console.warn("Could not load the highlighter, code stays plain", error);
      highlightLoading = undefined;
    });
  return highlightLoading;
}

export const isKatexLoaded = () => katexTransform !== undefined;
export const isHighlightLoaded = () => highlightTransform !== undefined;

/** Only text with a `$$` block can contain math (single-dollar math is off). */
export const sourceNeedsKatex = (source: string) => source.includes("$$");
export const sourceNeedsHighlight = (source: string) => source.includes("```");

export function lazyRehypeKatex() {
  return (tree: any, file: any): void => katexTransform?.(tree, file);
}

export function lazyRehypeHighlight() {
  return (tree: any, file: any): void => highlightTransform?.(tree, file);
}

/** Test hook. */
export function resetLazyMarkdownPluginsForTests() {
  katexTransform = highlightTransform = undefined;
  katexLoading = highlightLoading = undefined;
}
