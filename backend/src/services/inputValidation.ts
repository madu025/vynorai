const MAX_NAME_LENGTH = 80;

/** Version of public/privacy.html a user accepted at sign-up. */
export const PRIVACY_POLICY_VERSION = "2026-10-04";

/** Display name: text only, trimmed and bounded; markup characters dropped. */
export function cleanDisplayName(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw
    .replace(/[\u0000-\u001f\u007f<>"'`]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_NAME_LENGTH);
}
