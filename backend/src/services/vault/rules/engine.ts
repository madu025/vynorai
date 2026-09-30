import { EngineeringRule } from "../types.js";

/**
 * VynorAI Deterministic Rules Engine (Layer 2)
 * -----------------------------------------------------------------------------
 * "Rule = WHAT MUST / MUST NOT happen"
 * Inviolable constraints that prevent AI agents from generating insecure,
 * unindexed, or bug-ridden code.
 */
export const RULES_REGISTRY: EngineeringRule[] = [
  // ── Database Rules ──────────────────────────────────────────────────────────
  {
    id: "db.never_use_float_for_money",
    category: "database",
    description: "Financial amounts (amount, price, fee, balance) must NEVER use FLOAT or REAL.",
    severity: "ERROR",
    enforce: ({ schema }) => {
      if (!schema) return { passed: true };
      const match = schema.match(/\b([a-zA-Z0-9_]*(?:amount|price|balance|salary|cost|total|fee|tax)[a-zA-Z0-9_]*)\b\s+(FLOAT|REAL|DOUBLE)/i);
      if (match) {
        return {
          passed: false,
          message: `Rule violation: Financial column '${match[1]}' uses floating-point type '${match[2]}'.`,
          suggestion: "Use DECIMAL(12,2), NUMERIC, or integer cents (BIGINT).",
        };
      }
      return { passed: true };
    },
  },
  {
    id: "db.timestamps_required",
    category: "database",
    description: "Operational tables must define 'created_at' and 'updated_at' audit timestamps.",
    severity: "ERROR",
    enforce: ({ schema }) => {
      if (!schema) return { passed: true };
      if (/CREATE\s+TABLE/i.test(schema) && !/created_at|createdAt/i.test(schema)) {
        return {
          passed: false,
          message: "Rule violation: Table definition is missing 'created_at' audit timestamp.",
          suggestion: "Add 'created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP'.",
        };
      }
      return { passed: true };
    },
  },
  {
    id: "db.foreign_keys_required",
    category: "database",
    description: "Relational entity references (e.g. user_id, order_id) must have FOREIGN KEY constraints.",
    severity: "ERROR",
    enforce: ({ schema }) => {
      if (!schema) return { passed: true };
      if (/_id\s+VARCHAR/i.test(schema) && !/FOREIGN\s+KEY|REFERENCES/i.test(schema) && !/PRIMARY\s+KEY/i.test(schema)) {
        return {
          passed: false,
          message: "Rule violation: Relational ID column declared without FOREIGN KEY constraint.",
          suggestion: "Add 'FOREIGN KEY (user_id) REFERENCES users(id)' to prevent orphan records.",
        };
      }
      return { passed: true };
    },
  },
  {
    id: "db.indexes_required_for_foreign_keys",
    category: "database",
    description: "Foreign key lookup columns must have an index to prevent table locks and slow joins.",
    severity: "ERROR",
    enforce: ({ schema }) => {
      if (!schema) return { passed: true };
      const fkMatch = schema.match(/FOREIGN\s+KEY\s*\(([a-zA-Z0-9_]+)\)/i);
      if (fkMatch) {
        const fkCol = fkMatch[1];
        if (!new RegExp(`INDEX.*?\\(.*?${fkCol}.*?\\)`, "i").test(schema)) {
          return {
            passed: false,
            message: `Rule violation: Foreign key '${fkCol}' has no corresponding INDEX.`,
            suggestion: `Add 'CREATE INDEX idx_${fkCol} ON table_name(${fkCol});'`,
          };
        }
      }
      return { passed: true };
    },
  },

  // ── Security Rules ──────────────────────────────────────────────────────────
  {
    id: "sec.no_plaintext_secrets",
    category: "security",
    description: "Secrets, passwords, and private keys must never be hardcoded or fallback to plaintext strings.",
    severity: "ERROR",
    enforce: ({ code }) => {
      if (!code) return { passed: true };
      if (code.includes('|| "change_this') || code.includes("|| 'change_this") || code.includes('|| "secret"')) {
        return {
          passed: false,
          message: "Rule violation: Hardcoded fallback secret detected in code string.",
          suggestion: "Throw a fatal startup error if process.env.SECRET is undefined.",
        };
      }
      return { passed: true };
    },
  },
  {
    id: "sec.no_raw_sql_interpolation",
    category: "security",
    description: "SQL queries must use parameterized placeholders, never raw string interpolation.",
    severity: "ERROR",
    enforce: ({ code }) => {
      if (!code) return { passed: true };
      if (/\$\{.*?\}|%s\s*\+|f["'].*?\{.*?\}/i.test(code) && /(SELECT|INSERT|UPDATE|DELETE)\s+/i.test(code)) {
        return {
          passed: false,
          message: "Rule violation: Raw string interpolation detected in SQL query.",
          suggestion: "Use parameterized queries ($1, ? or Prisma/Drizzle type-safe query builders).",
        };
      }
      return { passed: true };
    },
  },
  {
    id: "sec.webhook_signature_verification",
    category: "security",
    description: "Payment and integration webhooks must verify HMAC/MD5 signatures and status codes.",
    severity: "ERROR",
    enforce: ({ code }) => {
      if (!code) return { passed: true };
      if (code.includes("/webhook") && !code.includes("verify") && !code.includes("Signature") && !code.includes("md5")) {
        return {
          passed: false,
          message: "Rule violation: Webhook handler does not perform cryptographic signature verification.",
          suggestion: "Verify raw body HMAC/MD5 signature and validate status_code before fulfilling order.",
        };
      }
      return { passed: true };
    },
  },
  {
    id: "sec.idempotency_required",
    category: "security",
    description: "Payment checkout and webhook events must be idempotent to prevent duplicate order charges.",
    severity: "ERROR",
    enforce: ({ code }) => {
      if (!code) return { passed: true };
      if (code.includes("fulfillOrder") || code.includes("activateSubscription")) {
        if (!code.includes("isPaid") && !code.includes("processed") && !code.includes("status === 2")) {
          return {
            passed: false,
            message: "Rule violation: Financial fulfillment missing idempotency or payment success guard.",
            suggestion: "Check if order is already marked as paid before fulfillment.",
          };
        }
      }
      return { passed: true };
    },
  },
];

/**
 * Evaluate all registered engineering rules against the code / schema context.
 */
export function evaluateRules(context: {
  code?: string;
  schema?: string;
  files?: Record<string, string>;
  env?: Record<string, any>;
}): { passed: boolean; violations: { ruleId: string; category: string; message: string; suggestion?: string }[] } {
  const violations: { ruleId: string; category: string; message: string; suggestion?: string }[] = [];

  for (const rule of RULES_REGISTRY) {
    const res = rule.enforce(context);
    if (!res.passed) {
      violations.push({
        ruleId: rule.id,
        category: rule.category,
        message: res.message || rule.description,
        suggestion: res.suggestion,
      });
    }
  }

  return {
    passed: violations.length === 0,
    violations,
  };
}
