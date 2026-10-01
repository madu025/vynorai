const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [
    /\b(?:sk|sess|pat|ghp|github_pat)_[A-Za-z0-9_-]{12,}\b/g,
    "[REDACTED_TOKEN]",
  ],
  [/\bAKIA[0-9A-Z]{16}\b/g, "[REDACTED_AWS_KEY]"],
  [/(authorization\s*[:=]\s*(?:bearer\s+)?)[^\s,;]+/gi, "$1[REDACTED]"],
  [
    /(api[_-]?key|access[_-]?token|client[_-]?secret|password)(\s*[:=]\s*)[^\s,;]+/gi,
    "$1$2[REDACTED]",
  ],
  [
    /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    "[REDACTED_PRIVATE_KEY]",
  ],
];

export function redactSecrets(value: string): string {
  return SECRET_PATTERNS.reduce(
    (redacted, [pattern, replacement]) =>
      redacted.replace(pattern, replacement),
    value,
  );
}

export function redactEventData(value: unknown): unknown {
  if (typeof value === "string") return redactSecrets(value);
  if (Array.isArray(value)) return value.map(redactEventData);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, redactEventData(item)]),
    );
  }
  return value;
}
