/**
 * PII shield: personal data never reaches the model provider.
 *
 * Before a request leaves the server, emails, Sri Lankan phone numbers, NIC
 * numbers and payment card numbers in any message are replaced with stable
 * placeholders (__PII_EMAIL_1__). The provider answers with placeholders;
 * the stream is restored to the real values on its way back to the user.
 *
 * Placeholders are numbered by first appearance in the message list. History
 * is append-only, so the same value keeps the same placeholder in every round
 * and the provider's prefix cache is not broken. The mapping lives only in
 * memory for the duration of one request.
 */

type Kind = "EMAIL" | "PHONE" | "NIC" | "CARD";

const PATTERNS: Array<{
  kind: Kind;
  regex: RegExp;
  valid?: (m: string) => boolean;
}> = [
  {
    kind: "EMAIL",
    regex: /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g,
  },
  {
    kind: "CARD",
    regex: /(?<![\d.])\d(?:[ -]?\d){12,18}(?![\d.])/g,
    valid: (m) => luhn(m.replace(/[ -]/g, "")),
  },
  {
    // New NIC: year (19xx/20xx) + day of year (001-366, +500 for women) + 5 digits.
    kind: "NIC",
    regex: /(?<!\d)(?:19|20)\d{2}[0-8]\d{2}\d{5}(?!\d)/g,
    valid: (m) => {
      const day = Number(m.slice(4, 7));
      return (day >= 1 && day <= 366) || (day >= 501 && day <= 866);
    },
  },
  {
    // Old NIC: 9 digits + V/X.
    kind: "NIC",
    regex: /(?<![\dA-Za-z])\d{9}[VvXx](?![A-Za-z\d])/g,
  },
  {
    // Sri Lankan mobile numbers: 07X XXX XXXX, +94 7X..., 0094 7X...
    kind: "PHONE",
    regex: /(?<![\d+])(?:\+94|0094|0)[ -]?7\d[ -]?\d{3}[ -]?\d{4}(?!\d)/g,
  },
];

const PLACEHOLDER_RE = /__PII_(EMAIL|PHONE|NIC|CARD)_\d+__/g;
const PLACEHOLDER_MAX = 24;

function luhn(digits: string): boolean {
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

export class PiiMap {
  private toPlaceholder = new Map<string, string>();
  private toValue = new Map<string, string>();
  private counts: Record<Kind, number> = {
    EMAIL: 0,
    PHONE: 0,
    NIC: 0,
    CARD: 0,
  };

  get size(): number {
    return this.toValue.size;
  }

  mask(text: string): string {
    let out = text;
    for (const { kind, regex, valid } of PATTERNS) {
      out = out.replace(regex, (match) => {
        if (match.startsWith("__PII_")) return match;
        if (valid && !valid(match)) return match;
        let ph = this.toPlaceholder.get(match);
        if (!ph) {
          ph = `__PII_${kind}_${++this.counts[kind]}__`;
          this.toPlaceholder.set(match, ph);
          this.toValue.set(ph, match);
        }
        return ph;
      });
    }
    return out;
  }

  restore(text: string): string {
    if (this.size === 0 || !text.includes("__PII_")) return text;
    return text.replace(PLACEHOLDER_RE, (ph) => this.toValue.get(ph) ?? ph);
  }
}

/** Replaces PII in every message (content, text parts, tool call arguments). */
export function maskRequestBody(body: any): { body: any; map: PiiMap } {
  const map = new PiiMap();
  if (!Array.isArray(body?.messages)) return { body, map };
  const messages = body.messages.map((m: any) => {
    const next = { ...m };
    if (typeof m.content === "string") next.content = map.mask(m.content);
    else if (Array.isArray(m.content))
      next.content = m.content.map((p: any) =>
        p?.type === "text" && typeof p.text === "string"
          ? { ...p, text: map.mask(p.text) }
          : p,
      );
    if (Array.isArray(m.tool_calls))
      next.tool_calls = m.tool_calls.map((tc: any) =>
        typeof tc?.function?.arguments === "string"
          ? {
              ...tc,
              function: {
                ...tc.function,
                arguments: map.mask(tc.function.arguments),
              },
            }
          : tc,
      );
    return next;
  });
  return { body: map.size ? { ...body, messages } : body, map };
}

/** Longest tail of `text` that could be the start of a placeholder. */
function pendingTail(text: string): number {
  for (
    let i = Math.max(0, text.length - PLACEHOLDER_MAX);
    i < text.length;
    i++
  ) {
    if (text[i] !== "_") continue;
    const tail = text.slice(i);
    if ("__PII_".startsWith(tail) || /^__PII_[A-Z]*(_\d*)?_?$/.test(tail))
      return text.length - i;
  }
  return 0;
}

/**
 * Restores streamed chunks. A placeholder split across deltas is held back
 * until it is complete, separately for content, reasoning and each tool
 * call's arguments.
 */
export class PiiStreamRestorer {
  private held = new Map<string, string>();

  constructor(private map: PiiMap) {}

  get active(): boolean {
    return this.map.size > 0;
  }

  private take(key: string, piece: string, final: boolean): string {
    // Restore complete placeholders first; only then hold back a tail that
    // may still become one (a lone "__" after "__PII_EMAIL_1" closes it).
    const text = this.map.restore((this.held.get(key) ?? "") + piece);
    const keep = final ? 0 : pendingTail(text);
    this.held.set(key, text.slice(text.length - keep));
    return text.slice(0, text.length - keep);
  }

  /** Restores a non-streamed completion. */
  restoreFull(data: any): any {
    return restoreResponse(data, this.map);
  }

  /** Restores one OpenAI-style stream chunk (mutates a copy). */
  restoreChunk(chunk: any): any {
    if (!this.active || !Array.isArray(chunk?.choices)) return chunk;
    const out = {
      ...chunk,
      choices: chunk.choices.map((c: any) => ({ ...c })),
    };
    for (const choice of out.choices) {
      const final = choice.finish_reason != null;
      const delta = choice.delta ? { ...choice.delta } : undefined;
      if (delta) {
        const i = choice.index ?? 0;
        if (typeof delta.content === "string" || final)
          delta.content = this.take(`c${i}`, delta.content ?? "", final);
        if (typeof delta.reasoning_content === "string")
          delta.reasoning_content = this.take(
            `r${i}`,
            delta.reasoning_content,
            final,
          );
        if (Array.isArray(delta.tool_calls))
          delta.tool_calls = delta.tool_calls.map((tc: any) =>
            typeof tc?.function?.arguments === "string"
              ? {
                  ...tc,
                  function: {
                    ...tc.function,
                    arguments: this.take(
                      `t${i}:${tc.index ?? 0}`,
                      tc.function.arguments,
                      false,
                    ),
                  },
                }
              : tc,
          );
        if (final) {
          // Flush any tool-call arguments still held for this choice.
          for (const [key, rest] of this.held) {
            if (!key.startsWith(`t${i}:`) || !rest) continue;
            const index = Number(key.split(":")[1]);
            delta.tool_calls = [
              ...(delta.tool_calls ?? []),
              { index, function: { arguments: this.map.restore(rest) } },
            ];
            this.held.set(key, "");
          }
        }
        choice.delta = delta;
      }
      if (choice.message)
        choice.message = restoreMessage(choice.message, this.map);
    }
    return out;
  }
}

function restoreMessage(message: any, map: PiiMap): any {
  const out = { ...message };
  if (typeof out.content === "string") out.content = map.restore(out.content);
  if (typeof out.reasoning_content === "string")
    out.reasoning_content = map.restore(out.reasoning_content);
  if (Array.isArray(out.tool_calls))
    out.tool_calls = out.tool_calls.map((tc: any) =>
      typeof tc?.function?.arguments === "string"
        ? {
            ...tc,
            function: {
              ...tc.function,
              arguments: map.restore(tc.function.arguments),
            },
          }
        : tc,
    );
  return out;
}

/** Restores a non-streamed completion. */
export function restoreResponse(data: any, map: PiiMap): any {
  if (map.size === 0 || !Array.isArray(data?.choices)) return data;
  return {
    ...data,
    choices: data.choices.map((c: any) =>
      c.message ? { ...c, message: restoreMessage(c.message, map) } : c,
    ),
  };
}
