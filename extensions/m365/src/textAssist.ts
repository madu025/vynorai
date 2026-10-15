export const MAX_TEXT_CHARS = 8000;

export type TextHost = "word" | "powerpoint" | "outlook";
export type TextTask =
  | "summarize"
  | "rewrite"
  | "fix-grammar"
  | "draft-reply"
  | "translate-si"
  | "translate-en";
export type TextTone = "formal" | "friendly" | "concise";

export const TASKS_BY_HOST: Record<TextHost, TextTask[]> = {
  word: ["summarize", "rewrite", "fix-grammar", "translate-si", "translate-en"],
  powerpoint: [
    "summarize",
    "rewrite",
    "fix-grammar",
    "translate-si",
    "translate-en",
  ],
  outlook: [
    "draft-reply",
    "summarize",
    "rewrite",
    "fix-grammar",
    "translate-si",
    "translate-en",
  ],
};

export class TextConsentError extends Error {
  readonly code = "AI_CONSENT_REQUIRED";
  constructor() {
    super("AI_CONSENT_REQUIRED");
  }
}

export class TextTooLongError extends Error {
  readonly code = "TEXT_TOO_LONG";
  constructor(readonly length: number) {
    super(`TEXT_TOO_LONG: ${length} characters (limit ${MAX_TEXT_CHARS})`);
  }
}

/**
 * The only way to build a text request. Consent is a precondition and the length limit is enforced
 * before anything leaves the task pane; the text is never truncated silently.
 */
export function buildAssistRequest(input: {
  host: TextHost;
  task: TextTask;
  tone?: TextTone;
  text: string;
  language?: "auto" | "en" | "si" | "ta";
  consent: boolean;
}): {
  host: TextHost;
  task: TextTask;
  tone?: TextTone;
  text: string;
  language?: "auto" | "en" | "si" | "ta";
  consent: true;
} {
  if (input.consent !== true) throw new TextConsentError();
  const text = input.text.replace(/\r\n/g, "\n").trim();
  if (text.length === 0) throw new Error("Select some text first.");
  if (!TASKS_BY_HOST[input.host].includes(input.task))
    throw new Error("That task is not available in this app.");
  if (text.length > MAX_TEXT_CHARS) throw new TextTooLongError(text.length);
  return {
    host: input.host,
    task: input.task,
    ...(input.tone ? { tone: input.tone } : {}),
    text,
    ...(input.language ? { language: input.language } : {}),
    consent: true,
  };
}

export interface AssistResult {
  text: string;
  notes?: string[];
}

/** Strict check of the server answer; anything else is rejected instead of being shown. */
export function validateAssistResult(value: unknown): AssistResult {
  const fail = (): never => {
    throw new Error("AI_ASSIST_INVALID");
  };
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return fail();
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record))
    if (!["text", "notes"].includes(key)) return fail();
  if (
    typeof record.text !== "string" ||
    record.text.length === 0 ||
    record.text.length > 12_000
  )
    return fail();
  if (record.notes !== undefined) {
    if (
      !Array.isArray(record.notes) ||
      record.notes.length > 5 ||
      record.notes.some(
        (note) =>
          typeof note !== "string" || note.length === 0 || note.length > 200,
      )
    )
      return fail();
  }
  return {
    text: record.text,
    ...(record.notes ? { notes: record.notes as string[] } : {}),
  };
}
