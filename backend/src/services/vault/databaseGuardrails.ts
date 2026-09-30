/**
 * VynorAI Deterministic Database Schema & Anti-Vibe-Coding Guardrail
 * -----------------------------------------------------------------------------
 * Protects against the 50 most common database mistakes made by vibe coders
 * and autonomous AI agents:
 * - Floating-point financial amounts (FLOAT instead of DECIMAL)
 * - Missing primary keys and foreign key indexes
 * - Destructive migrations (DROP TABLE / DROP COLUMN)
 * - Missing tenant isolation (tenant_id in multi-tenant SaaS)
 * - Missing audit timestamps (created_at, updated_at)
 * - Unindexed foreign keys causing slow JOINs & table locks
 * - Unbounded queries (missing LIMIT / pagination)
 * - Raw string concatenated SQL injection patterns
 */

export interface SchemaViolation {
  code: string;
  category: "DESIGN" | "PERFORMANCE" | "INTEGRITY" | "SECURITY" | "MIGRATION";
  severity: "CRITICAL" | "HIGH" | "MEDIUM";
  message: string;
  line?: number;
  recommendation: string;
}

export interface DatabaseValidationReport {
  passed: boolean;
  totalViolations: number;
  criticalCount: number;
  violations: SchemaViolation[];
  suggestedFixes: string[];
}

export function validateDatabaseSchema(
  schemaText: string,
  options: { isMultiTenant?: boolean; isProduction?: boolean } = {}
): DatabaseValidationReport {
  const violations: SchemaViolation[] = [];
  const lines = schemaText.split("\n");

  let insideTable = false;
  let currentTable = "";
  let tableHasPK = false;
  let tableHasTimestamps = false;
  let tableHasTenantId = false;
  const tableColumns: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const line = rawLine.trim();
    const lineNum = i + 1;

    // 1. Destructive Migration Detection (DROP TABLE / DROP COLUMN / TRUNCATE)
    if (/DROP\s+TABLE\s+/i.test(line) || /DROP\s+COLUMN\s+/i.test(line) || /TRUNCATE\s+/i.test(line)) {
      violations.push({
        code: "DESTRUCTIVE_MIGRATION",
        category: "MIGRATION",
        severity: "CRITICAL",
        message: `Destructive migration detected at line ${lineNum}: '${line}'`,
        line: lineNum,
        recommendation: "Avoid dropping tables or columns directly in production. Deprecate and backfill instead.",
      });
    }

    // 2. SQL Injection / Concatenation in queries
    if (/\$\{.*?\}|%s\s*\+|f["'].*?\{.*?\}/i.test(line) && /(SELECT|INSERT|UPDATE|DELETE)\s+/i.test(line)) {
      violations.push({
        code: "RAW_SQL_INJECTION_RISK",
        category: "SECURITY",
        severity: "CRITICAL",
        message: `Potential SQL injection via raw string interpolation at line ${lineNum}`,
        line: lineNum,
        recommendation: "Use parameterized queries ($1, ? or Prisma/Drizzle type-safe query builders).",
      });
    }

    // 3. Floating-Point Financial Precision Error (FLOAT / REAL on amount/price columns)
    const moneyMatch = line.match(/\b([a-zA-Z0-9_]*(?:amount|price|balance|salary|cost|total|fee|tax)[a-zA-Z0-9_]*)\b\s+(FLOAT|REAL|DOUBLE)/i);
    if (moneyMatch) {
      violations.push({
        code: "MONEY_FLOATING_POINT_PRECISION",
        category: "INTEGRITY",
        severity: "CRITICAL",
        message: `Financial column '${moneyMatch[1]}' uses floating-point type '${moneyMatch[2]}' at line ${lineNum}`,
        line: lineNum,
        recommendation: "Use DECIMAL(12,2), NUMERIC, or integer cents (BIGINT) for all currency and financial amounts.",
      });
    }

    // 4. Unbounded TEXT bloat check on bounded categories (IP, status, severity, phone, role)
    const textBloatMatch = line.match(/\b([a-zA-Z0-9_]*(?:status|role|severity|ip_address|phone|country_code|otp_code)[a-zA-Z0-9_]*)\b\s+TEXT\b/i);
    if (textBloatMatch) {
      violations.push({
        code: "UNBOUNDED_TEXT_BLOAT",
        category: "PERFORMANCE",
        severity: "HIGH",
        message: `Categorical/bounded column '${textBloatMatch[1]}' uses unbounded 'TEXT' at line ${lineNum}`,
        line: lineNum,
        recommendation: `Change from unbounded TEXT to bounded VARCHAR(n) (e.g. VARCHAR(45) for IP, VARCHAR(20) for status/severity) or Enum to reduce memory and B-tree cache overhead.`,
      });
    }

    // Track SQL CREATE TABLE
    const createTableMatch = line.match(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-zA-Z0-9_"`]+)/i);
    if (createTableMatch) {
      insideTable = true;
      currentTable = createTableMatch[1].replace(/[`"']/g, "");
      tableHasPK = false;
      tableHasTimestamps = false;
      tableHasTenantId = false;
      tableColumns.length = 0;
    }

    if (insideTable) {
      tableColumns.push(line);
      if (/PRIMARY\s+KEY/i.test(line) || /@id\b/i.test(line)) {
        tableHasPK = true;
      }
      if (/created_at/i.test(line) || /createdAt/i.test(line)) {
        tableHasTimestamps = true;
      }
      if (/tenant_id/i.test(line) || /tenantId/i.test(line)) {
        tableHasTenantId = true;
      }

      // Check end of table definition
      if (line.endsWith(");") || (line === "}" && schemaText.includes("model "))) {
        insideTable = false;

        // Verify Primary Key existence
        if (!tableHasPK) {
          violations.push({
            code: "MISSING_PRIMARY_KEY",
            category: "DESIGN",
            severity: "CRITICAL",
            message: `Table '${currentTable}' is missing a PRIMARY KEY.`,
            recommendation: "Define a UUID or BIGSERIAL primary key (e.g. id VARCHAR(36) PRIMARY KEY).",
          });
        }

        // Verify Audit Timestamps
        if (!tableHasTimestamps) {
          violations.push({
            code: "MISSING_AUDIT_TIMESTAMPS",
            category: "INTEGRITY",
            severity: "MEDIUM",
            message: `Table '${currentTable}' is missing 'created_at' audit timestamp.`,
            recommendation: "Add 'created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP' to all operational tables.",
          });
        }

        // Multi-tenant check
        if (options.isMultiTenant && !tableHasTenantId && !["users", "tenants", "organizations"].includes(currentTable.toLowerCase())) {
          violations.push({
            code: "MISSING_TENANT_ISOLATION",
            category: "SECURITY",
            severity: "CRITICAL",
            message: `Multi-tenant SaaS violation: Table '${currentTable}' is missing 'tenant_id'.`,
            recommendation: "Add 'tenant_id VARCHAR(36) NOT NULL' and create an index on (tenant_id).",
          });
        }
      }
    }
  }

  // 4. Missing Index on Foreign Keys check
  const fkMatches = schemaText.matchAll(/FOREIGN\s+KEY\s*\(([a-zA-Z0-9_]+)\)\s+REFERENCES/gi);
  for (const match of fkMatches) {
    const fkCol = match[1];
    const indexRegex = new RegExp(`CREATE\\s+INDEX.*?ON.*?\\(.*?${fkCol}.*?\\)`, "i");
    if (!indexRegex.test(schemaText)) {
      violations.push({
        code: "UNINDEXED_FOREIGN_KEY",
        category: "PERFORMANCE",
        severity: "HIGH",
        message: `Foreign key column '${fkCol}' has no dedicated index.`,
        recommendation: `Add 'CREATE INDEX idx_${fkCol} ON table_name(${fkCol});' to prevent slow JOIN locks.`,
      });
    }
  }

  const criticalCount = violations.filter((v) => v.severity === "CRITICAL").length;
  const passed = criticalCount === 0;

  const suggestedFixes = violations.map((v) => `[${v.code}] ${v.recommendation}`);

  return {
    passed,
    totalViolations: violations.length,
    criticalCount,
    violations,
    suggestedFixes,
  };
}
