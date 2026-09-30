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
  {
    id: "db.unbounded_text_type_prohibited",
    category: "database",
    description: "Status, role, IP address, severity, and code fields must use bounded VARCHAR(n) or Enum CHECK, never unbounded TEXT.",
    severity: "ERROR",
    enforce: ({ schema }) => {
      if (!schema) return { passed: true };
      const textMatch = schema.match(/\b([a-zA-Z0-9_]*(?:status|role|severity|ip_address|phone|country_code|otp_code)[a-zA-Z0-9_]*)\b\s+TEXT\b/i);
      if (textMatch) {
        return {
          passed: false,
          message: `Rule violation: Categorical/bounded column '${textMatch[1]}' uses unbounded type 'TEXT'.`,
          suggestion: `Use bounded VARCHAR(n) (e.g. VARCHAR(45) for IP, VARCHAR(20) for status/severity) or Enum CHECK constraints to prevent B-tree memory bloat.`,
        };
      }
      return { passed: true };
    },
  },
  {
    id: "db.audit_logs_indexing_required",
    category: "database",
    description: "High-volume append/audit tables (audit_logs, usage_logs, events) must define an INDEX on created_at / timestamp.",
    severity: "ERROR",
    enforce: ({ schema }) => {
      if (!schema) return { passed: true };
      const auditTableMatch = schema.match(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-zA-Z0-9_"`]*(?:audit|usage|log|history|event|metric)[a-zA-Z0-9_"`]*)/i);
      if (auditTableMatch) {
        const tblName = auditTableMatch[1].replace(/[`"']/g, "");
        if (!/CREATE\s+INDEX.*?ON.*?(?:created_at|timestamp)/i.test(schema)) {
          return {
            passed: false,
            message: `Rule violation: High-volume audit/log table '${tblName}' has no INDEX on 'created_at'.`,
            suggestion: `Add 'CREATE INDEX idx_${tblName}_created ON ${tblName}(created_at DESC);' to prevent full-table disk/RAM scans during queries.`,
          };
        }
      }
      return { passed: true };
    },
  },
  {
    id: "db.billing_cycle_unique_constraint",
    category: "database",
    description: "Billing and quota tables must use multi-cycle uniqueness (UNIQUE(user_id, period_start)), never single user_id UNIQUE.",
    severity: "ERROR",
    enforce: ({ schema }) => {
      if (!schema) return { passed: true };
      const isUsageTable = /CREATE\s+TABLE.*?(?:usage|quota|billing|cycle)/i.test(schema);
      if (isUsageTable && /user_id\s+TEXT\s+NOT\s+NULL\s+UNIQUE/i.test(schema)) {
        return {
          passed: false,
          message: "Rule violation: Quota/Billing table locks user to single cycle via 'user_id TEXT NOT NULL UNIQUE'.",
          suggestion: "Use 'UNIQUE(user_id, period_start)' so historical monthly cycles can be archived without collision.",
        };
      }
      return { passed: true };
    },
  },
  {
    id: "db.tokens_secrets_hashing_required",
    category: "database",
    description: "API keys, verification tokens, and OTP codes must be stored as hashes (api_key_hash, token_hash), never plaintext.",
    severity: "ERROR",
    enforce: ({ schema }) => {
      if (!schema) return { passed: true };
      const plaintextSecretMatch = schema.match(/\b(api_key|otp_code|verification_token|session_token)\b\s+(?:VARCHAR|TEXT)\s+NOT\s+NULL\b/i);
      if (plaintextSecretMatch && !schema.includes("_hash")) {
        return {
          passed: false,
          message: `Rule violation: Sensitive authentication credential '${plaintextSecretMatch[1]}' stored without cryptographic hashing.`,
          suggestion: `Store as '${plaintextSecretMatch[1]}_hash VARCHAR(64)' containing a SHA-256 / HMAC hash to prevent credential exposure if database leaks.`,
        };
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
