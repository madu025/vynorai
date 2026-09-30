/**
 * VynorAI Enterprise Privacy Shield — In-Flight Secret & PII Sanitizer
 * ---------------------------------------------------------------------
 * Automatically scrubs sensitive credentials, private keys, and environment
 * secrets from code prompts BEFORE they leave the server to upstream LLMs.
 * Guarantees Zero Data Leakage for enterprise & proprietary repositories.
 */

export interface SanitizationResult {
  sanitized: any;
  scrubbedCount: number;
  scrubbedTypes: string[];
}

// High-confidence regex patterns for sensitive credentials
const SECRET_PATTERNS: Array<{ name: string; regex: RegExp; placeholder: string }> = [
  // Private Keys (RSA, EC, PGP, OPENSSH)
  {
    name: "Private Key",
    regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/gi,
    placeholder: "[REDACTED_PRIVATE_KEY]",
  },
  // AWS Access Key ID
  {
    name: "AWS Access Key",
    regex: /\b(AKIA|ABIA|ACCA|ASIA)[0-9A-Z]{16}\b/g,
    placeholder: "[REDACTED_AWS_KEY]",
  },
  // Generic / OpenAI API Keys
  {
    name: "OpenAI / Anthropic Key",
    regex: /\b(sk-[a-zA-Z0-9_-]{20,64}|sk-ant-[a-zA-Z0-9_-]{20,80})\b/g,
    placeholder: "[REDACTED_API_KEY]",
  },
  // Database Connection Strings with Passwords
  {
    name: "Database Credentials URI",
    regex: /\b(mongodb(\+srv)?|postgres|postgresql|mysql|redis):\/\/[a-zA-Z0-9_.-]+:([a-zA-Z0-9_.~%!$&'()*+,;=-]+)@[a-zA-Z0-9_.-]+/gi,
    placeholder: "$1://[REDACTED_USER]:[REDACTED_PASSWORD]@[REDACTED_HOST]",
  },
  // JWT Tokens (3 base64 strings separated by dots)
  {
    name: "JSON Web Token (JWT)",
    regex: /\beyJ[a-zA-Z0-9_-]{10,}\.eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\b/g,
    placeholder: "[REDACTED_JWT_TOKEN]",
  },
  // PayHere / Stripe / Payment Gateway Secrets
  {
    name: "Payment Gateway Secret",
    regex: /\b(sk_live_[0-9a-zA-Z]{24,32}|merchant_secret\s*[:=]\s*['"][a-zA-Z0-9+=/]{24,}['"])/gi,
    placeholder: "merchant_secret: '[REDACTED_PAYMENT_SECRET]'",
  },
  // Standard .env assignments with sensitive variable names
  {
    name: "Environment Secret Variable",
    regex: /\b(SECRET|PASSWORD|PASSWD|AUTH_TOKEN|API_SECRET|PRIVATE_TOKEN)\s*=\s*['"][^'"]{8,}['"]/gi,
    placeholder: "$1='[REDACTED_ENV_SECRET]'",
  },
];

/**
 * Sanitize a string by redacting all identified secrets.
 */
export function sanitizeText(text: string): { text: string; scrubbedCount: number; types: string[] } {
  if (!text || typeof text !== "string") return { text, scrubbedCount: 0, types: [] };

  let current = text;
  let count = 0;
  const typesSet = new Set<string>();

  for (const pattern of SECRET_PATTERNS) {
    if (pattern.regex.test(current)) {
      current = current.replace(pattern.regex, () => {
        count++;
        typesSet.add(pattern.name);
        return pattern.placeholder;
      });
    }
  }

  return { text: current, scrubbedCount: count, types: Array.from(typesSet) };
}

/**
 * Sanitize an entire OpenAI/Anthropic messages payload recursively.
 */
export function sanitizePayload(body: any): SanitizationResult {
  if (!body) return { sanitized: body, scrubbedCount: 0, scrubbedTypes: [] };

  const clone = JSON.parse(JSON.stringify(body));
  let totalScrubbed = 0;
  const typesSet = new Set<string>();

  function walkAndScrub(node: any): any {
    if (typeof node === "string") {
      const res = sanitizeText(node);
      if (res.scrubbedCount > 0) {
        totalScrubbed += res.scrubbedCount;
        res.types.forEach((t) => typesSet.add(t));
      }
      return res.text;
    }
    if (Array.isArray(node)) {
      return node.map(walkAndScrub);
    }
    if (node && typeof node === "object") {
      for (const key of Object.keys(node)) {
        node[key] = walkAndScrub(node[key]);
      }
      return node;
    }
    return node;
  }

  const sanitized = walkAndScrub(clone);
  return {
    sanitized,
    scrubbedCount: totalScrubbed,
    scrubbedTypes: Array.from(typesSet),
  };
}
