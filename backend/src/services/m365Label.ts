/**
 * Display label for a Microsoft account on the self-service link page: the person must be able to see
 * WHICH Microsoft account they are connecting, but the full address never travels or is stored.
 * Only a masked name and a masked address ("Prasad P. (p***@slts.lk)") are ever kept.
 */

const CONTROL =
  /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g;
const EMAIL = /^[^\s@]{1,64}@([A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,24})$/;

export const FALLBACK_LABEL = "a Microsoft work or school account";

/** "prasad@slts.lk" -> "p***@slts.lk". Anything that is not an address gives undefined. */
export function maskEmail(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.replace(CONTROL, "").trim();
  const match = EMAIL.exec(text);
  if (!match) return undefined;
  const local = text.slice(0, text.indexOf("@"));
  return `${[...local][0]}***@${match[1].toLowerCase()}`;
}

/** "Prasad Perera" -> "Prasad P."; a single word stays, capped at 40 characters. */
export function maskName(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const words = value.replace(CONTROL, "").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return undefined;
  const first = [...words[0]].slice(0, 24).join("");
  const rest = words.length > 1 ? ` ${[...words[words.length - 1]][0]}.` : "";
  return `${first}${rest}`;
}

/** Masked name plus masked address, at most 160 characters; never the raw values. */
export function buildIdentityLabel(input: {
  name?: unknown;
  address?: unknown;
}): string {
  const name = maskName(input.name);
  const address = maskEmail(input.address);
  const label =
    name && address
      ? `${name} (${address})`
      : (name ?? address ?? FALLBACK_LABEL);
  return label.slice(0, 160);
}
