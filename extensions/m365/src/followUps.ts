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
  if (words.length > 9) {
    // Cut at the first choice ("..., or ...") when it fits, never mid-clause with a stray comma.
    const choice = /^(.{8,}?),?\s+or\s+/i.exec(q);
    q =
      choice && choice[1].split(" ").length <= 9
        ? choice[1]
        : words.slice(0, 9).join(" ");
  }
  q = q.replace(/[\s,;:]+$/, "");
  while (TRAILING.test(q)) q = q.replace(TRAILING, "").replace(/[\s,;:]+$/, "");
  q = q.charAt(0).toUpperCase() + q.slice(1);
  return q ? q + "?" : "";
}

/**
 * The request a chip fills in. An offer the assistant made ("Should I X?", "Do you want me to X?")
 * becomes the person's own instruction "X", taken from the full question so a long X is not cut;
 * any other question is asked as its short chip.
 */
const OFFER =
  /\b(?:should\s+i|shall\s+i|can\s+i|may\s+i|do\s+you\s+want\s+me\s+to|would\s+you\s+like\s+me\s+to|want\s+me\s+to)\s+([^?]+)/i;
export function chipRequest(question: string, short: string): string {
  if (!/^(?:should|shall|can|may|do|would|want)\b/i.test(short)) return short;
  const offer = OFFER.exec(question);
  if (!offer) return short;
  // "Should I X, or Y instead?": the chip takes the first choice, X.
  const action = offer[1].split(/,?\s+or\s+/i)[0].trim();
  return action ? action.charAt(0).toUpperCase() + action.slice(1) : short;
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
    add(short, chipRequest(question, short), cleanChipText(question));
  }
  for (const idea of idleSuggestions(input.schema))
    if (!/inspect formulas/i.test(idea.title)) add(idea.title, idea.text);
  return out.slice(0, MAX_NEXT_STEPS);
}
