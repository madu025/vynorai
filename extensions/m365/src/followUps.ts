/**
 * Next-step chips shown under the latest answer. The answer's own follow-up question comes first,
 * then data-driven ideas from the table's columns, never the one the person just asked and never
 * "Inspect formulas". At most three. Pure: a click only fills the input, nothing runs.
 */
import { idleSuggestions } from "./idleSuggestions.js";
import type { WorkspaceSchema } from "./smartWorkspace.js";

export interface NextStep {
  /** Short label on the chip. */
  label: string;
  /** The request placed in the composer. */
  text: string;
  /** The full sentence, for the tooltip. */
  full?: string;
}

export const MAX_NEXT_STEPS = 3;

/** A question or idea as a chip text: no leading bullet or dash. */
export const cleanChipText = (text: string): string =>
  text.replace(/^\s*(?:[-–—•*]+\s*)+/, "").trim();

const TRAILING = /\s+(?:the|a|an|of|to|and|or|across|in|on|for|by|with|as)$/i;

/**
 * A follow-up question as a short chip: the clause that holds the question (after the last dash,
 * colon or semicolon), no brackets, "want this as" read as "want", at most nine words, ending in "?".
 */
export function shortQuestion(text: string): string {
  let q = cleanChipText(text)
    .replace(/\([^)]*\)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const parts = q
    .split(/\s[—–-]\s|[:;]\s/)
    .map((p) => p.trim())
    .filter(Boolean);
  const holder = [...parts].reverse().find((p) => p.includes("?"));
  q = (holder ?? parts[parts.length - 1] ?? q).replace(/\s+\?/, "?");
  q = q
    .replace(/^want this as\b/i, "Want")
    .replace(/\s+/g, " ")
    .trim();
  q = q.replace(/[?.!]+$/, "");
  const words = q.split(" ");
  if (words.length > 9) q = words.slice(0, 9).join(" ");
  while (TRAILING.test(q)) q = q.replace(TRAILING, "");
  q = q.charAt(0).toUpperCase() + q.slice(1);
  return q ? q + "?" : "";
}

const key = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

export function nextSteps(input: {
  /** Follow-up questions taken from the answer card. */
  questions?: string[];
  schema?: WorkspaceSchema;
  /** What the person just asked. */
  asked?: string;
}): NextStep[] {
  const asked = key(input.asked ?? "");
  const out: NextStep[] = [];
  const seen = new Set<string>();
  const add = (label: string, text: string, full?: string) => {
    const clean = cleanChipText(text);
    const id = key(clean);
    if (!clean || !id || seen.has(id) || id === asked) return;
    seen.add(id);
    out.push({ label: cleanChipText(label), text: clean, full });
  };
  for (const question of input.questions ?? []) {
    const short = shortQuestion(question);
    add(short, short, cleanChipText(question));
  }
  for (const idea of idleSuggestions(input.schema))
    if (!/inspect formulas/i.test(idea.title)) add(idea.title, idea.text);
  return out.slice(0, MAX_NEXT_STEPS);
}
