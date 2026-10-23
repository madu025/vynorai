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
}

export const MAX_NEXT_STEPS = 3;

/** A question or idea as a chip text: no leading bullet or dash. */
export const cleanChipText = (text: string): string =>
  text.replace(/^\s*(?:[-–—•*]+\s*)+/, "").trim();

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
  const add = (label: string, text: string) => {
    const clean = cleanChipText(text);
    const id = key(clean);
    if (!clean || !id || seen.has(id) || id === asked) return;
    seen.add(id);
    out.push({ label: cleanChipText(label), text: clean });
  };
  for (const question of input.questions ?? []) add(question, question);
  for (const idea of idleSuggestions(input.schema))
    if (!/inspect formulas/i.test(idea.title)) add(idea.title, idea.text);
  return out.slice(0, MAX_NEXT_STEPS);
}
