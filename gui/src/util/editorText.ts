import type { JSONContent } from "@tiptap/core";

/** Plain text of a TipTap document, whitespace collapsed. */
export function editorText(node: JSONContent): string {
  return [node.text, ...(node.content ?? []).map(editorText)]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}
