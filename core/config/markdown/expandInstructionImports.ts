import type { IDE } from "../..";

/** How many levels of imports are followed (the importing file is level 0). */
export const MAX_IMPORT_DEPTH = 4;
/** Imported file size cap; larger files are left as a plain `@path`. */
const MAX_IMPORT_BYTES = 64 * 1024;
/** Total characters one instruction file may grow to through imports. */
const MAX_EXPANDED_CHARS = 200_000;

// `@docs/style.md`, `@./a.md`, `@../shared/rules.txt`. Not preceded by a word
// character, so emails and `pkg@1.md` are left alone.
const IMPORT_PATTERN =
  /(?<![\w@/.-])@((?:\.{1,2}\/)?[\w.-]+(?:\/[\w.-]+)*\.(?:md|mdx|markdown|txt|yaml|yml|json))(?![\w/-])/g;

type ReadIde = Pick<IDE, "readFile" | "fileExists">;

/** Splits text into code (fenced blocks and inline spans) and prose segments. */
function splitCode(text: string): Array<{ code: boolean; text: string }> {
  const parts: Array<{ code: boolean; text: string }> = [];
  const codeRe = /```[\s\S]*?(?:```|$)|`[^`\n]*`/g;
  let last = 0;
  for (const match of text.matchAll(codeRe)) {
    const start = match.index ?? 0;
    if (start > last)
      parts.push({ code: false, text: text.slice(last, start) });
    parts.push({ code: true, text: match[0] });
    last = start + match[0].length;
  }
  if (last < text.length) parts.push({ code: false, text: text.slice(last) });
  return parts;
}

/** Resolves `relative` against the importing file; null if it leaves the root. */
export function resolveImportUri(
  importerUri: string,
  relative: string,
  rootUri: string,
): string | null {
  let resolved: string;
  try {
    resolved = new URL(relative, importerUri).href;
  } catch {
    return null;
  }
  const root = rootUri.endsWith("/") ? rootUri : `${rootUri}/`;
  return resolved.startsWith(root) ? resolved : null;
}

/**
 * Inlines `@path` imports in an instruction file (AGENTS.md / CLAUDE.md), the
 * way Claude Code does: up to four levels, paths relative to the importing
 * file, ignored inside code spans and fenced blocks. Imports must stay inside
 * the workspace root; a path that escapes it, a missing or oversized file, a
 * cycle, or a file already inlined is left as the original `@path` text.
 */
export async function expandInstructionImports(
  content: string,
  fileUri: string,
  rootUri: string,
  ide: ReadIde,
): Promise<string> {
  let budget = MAX_EXPANDED_CHARS - content.length;
  const inlined = new Set<string>([fileUri]);

  async function expand(
    text: string,
    importerUri: string,
    depth: number,
    ancestors: string[],
  ): Promise<string> {
    if (depth >= MAX_IMPORT_DEPTH) return text;
    const out: string[] = [];
    for (const part of splitCode(text)) {
      if (part.code) {
        out.push(part.text);
        continue;
      }
      let cursor = 0;
      let piece = "";
      for (const match of part.text.matchAll(IMPORT_PATTERN)) {
        const index = match.index ?? 0;
        piece += part.text.slice(cursor, index);
        cursor = index + match[0].length;
        const target = resolveImportUri(importerUri, match[1], rootUri);
        let replacement = match[0];
        if (
          target &&
          !ancestors.includes(target) &&
          !inlined.has(target) &&
          budget > 0
        ) {
          try {
            if (await ide.fileExists(target)) {
              const body = await ide.readFile(target);
              if (body.length <= MAX_IMPORT_BYTES) {
                inlined.add(target);
                const nested = await expand(body, target, depth + 1, [
                  ...ancestors,
                  target,
                ]);
                const block = `\n<!-- imported from ${match[1]} -->\n${nested.trim()}\n<!-- end ${match[1]} -->\n`;
                budget -= block.length;
                if (budget >= 0) replacement = block;
              }
            }
          } catch {
            // unreadable import: keep the original text
          }
        }
        piece += replacement;
      }
      out.push(piece + part.text.slice(cursor));
    }
    return out.join("");
  }

  return expand(content, fileUri, 0, [fileUri]);
}
