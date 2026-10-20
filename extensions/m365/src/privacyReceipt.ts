/**
 * Privacy receipt (pure): after an AI request, a plain account of what left the device. It
 * counts the characters sent, the personal values that were replaced with tokens ([p1]...), and
 * checks the outgoing text once more for anything that still looks like an e-mail address, a
 * phone number or a national identity card number. Nothing here is sent anywhere.
 */

export interface PrivacyReceipt {
  characters: number;
  /** Distinct personal values replaced with tokens before sending. */
  masked: number;
  /** Personal-looking values still in the sent text (should be 0). */
  leaks: { emails: number; phones: number; nic: number };
}

const TOKEN = /\[p\d+\]/g;
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
// Sri Lankan mobile and landline numbers (07X..., +947X..., 0XX-XXXXXXX).
const PHONE =
  /(?<![\d.])(?:(?:\+94|0094)[\s-]?|0)(?:7\d|[1-9]\d)[\s-]?\d{3}[\s-]?\d{4}(?![\d.])/g;
// Old NIC (9 digits + V/X) and new NIC (12 digits starting 19xx or 20xx).
const NIC = /(?<![\dA-Z])(?:\d{9}[VX]|(?:19|20)\d{10})(?![\dA-Z])/gi;

function textOf(message: unknown): string {
  if (typeof message === "string") return message;
  if (!message || typeof message !== "object") return "";
  const value = message as { content?: unknown; tool_calls?: unknown };
  const content =
    typeof value.content === "string"
      ? value.content
      : value.content == null
        ? ""
        : JSON.stringify(value.content);
  return value.tool_calls
    ? `${content}${JSON.stringify(value.tool_calls)}`
    : content;
}

/** Receipt for the messages of one request (the last call carries the whole conversation). */
export function buildPrivacyReceipt(
  messages: readonly unknown[],
): PrivacyReceipt {
  const text = messages.map(textOf).join("\n");
  return {
    characters: text.length,
    masked: new Set(text.match(TOKEN) ?? []).size,
    leaks: {
      emails: (text.match(EMAIL) ?? []).length,
      phones: (text.match(PHONE) ?? []).length,
      nic: (text.match(NIC) ?? []).length,
    },
  };
}

export function describePrivacyReceipt(receipt: PrivacyReceipt): string {
  if (!receipt.characters) return "";
  const sent = `Sent to the AI: ${receipt.characters.toLocaleString("en-US")} characters`;
  const masked = receipt.masked
    ? `; ${receipt.masked} personal value(s) replaced with tokens, and put back only here`
    : "; no personal values found to replace";
  const leaks = receipt.leaks.emails + receipt.leaks.phones + receipt.leaks.nic;
  const warning = leaks
    ? ` Check: ${[
        receipt.leaks.emails
          ? `${receipt.leaks.emails} e-mail address(es)`
          : "",
        receipt.leaks.phones ? `${receipt.leaks.phones} phone number(s)` : "",
        receipt.leaks.nic ? `${receipt.leaks.nic} NIC number(s)` : "",
      ]
        .filter(Boolean)
        .join(", ")} went out unmasked.`
    : "";
  return `${sent}${masked}.${warning}`;
}
