/**
 * Small, dependency-free helpers for what the HTTP layer may log and which browser origins it
 * accepts. Kept separate from index.ts so both are unit-testable.
 */

/** Browser origins that may call the API. Anything else needs CORS_ORIGINS. No wildcard subdomains. */
export const DEFAULT_CORS_ORIGINS: readonly string[] = [
  "https://vynor.lk",
  "https://www.vynor.lk",
  "https://admin.vynor.lk",
  "https://api.vynor.lk",
];

/** Local development ports (the backend, the admin port, common dev servers). */
const LOCAL_DEV_PORTS = new Set([
  "3000",
  "3001",
  "3334",
  "3335",
  "4173",
  "5173",
  "8080",
]);

export function isAllowedCorsOrigin(
  origin: string,
  allowed: ReadonlySet<string>,
): boolean {
  if (allowed.has(origin)) return true;
  // IDE webviews have an opaque per-window authority: only the scheme can be checked.
  if (origin.startsWith("vscode-webview://")) return true;
  if (origin.startsWith("vscode-file://")) return true;
  const local = /^https?:\/\/(localhost|127\.0\.0\.1):(\d{2,5})$/.exec(origin);
  return Boolean(local && LOCAL_DEV_PORTS.has(local[2]));
}

/** "alice@example.com" -> "a***@e***.com": enough to correlate by eye, not enough to contact. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at < 1) return "***";
  const domain = email.slice(at + 1);
  const dot = domain.lastIndexOf(".");
  const host = dot > 0 ? domain.slice(0, dot) : domain;
  const tld = dot > 0 ? domain.slice(dot) : "";
  return `${email[0]}***@${host[0] ?? ""}***${tld}`;
}

/**
 * One safe log line for an error: the class, the HTTP status and the message only.
 * Never the whole object: a body-parser SyntaxError carries the raw request text in `err.body`,
 * which can hold passwords, prompts or workbook cells, and Node prints every own property.
 */
export function describeError(err: unknown): string {
  if (!err || typeof err !== "object") return String(err ?? "unknown error");
  const e = err as {
    name?: unknown;
    message?: unknown;
    status?: unknown;
    type?: unknown;
    body?: unknown;
  };
  const name = typeof e.name === "string" ? e.name : "Error";
  const status = typeof e.status === "number" ? ` (${e.status})` : "";
  // Recent Node versions put a snippet of the unparsable input into a JSON SyntaxError message.
  if (e.type === "entity.parse.failed" || "body" in e)
    return `${name}${status}: malformed request body (content not logged)`;
  const message =
    typeof e.message === "string"
      ? e.message.replace(/[\u0000-\u001f\u007f]+/g, " ").slice(0, 300)
      : "";
  return `${name}${status}: ${message}`;
}
