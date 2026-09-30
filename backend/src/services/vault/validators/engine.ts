import { ValidatorReport } from "../types.js";
import { validateDatabaseSchema } from "../databaseGuardrails.js";
import { evaluateRules } from "../rules/engine.js";

/**
 * VynorAI Validation Layer (Layer 3)
 * -----------------------------------------------------------------------------
 * "Validator = IS IT CORRECT / SAFE?"
 * Tests the generated/patched code against safety, database, and code constraints.
 * Provides exact targeted error feedback so AI only repairs the broken lines
 * without re-prompting the entire project context!
 */

export function validateSecurity(code: string): ValidatorReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  const suggestions: string[] = [];

  // 1. Plaintext secrets check
  if (code.includes('|| "change_this') || code.includes("|| 'change_this")) {
    errors.push("Insecure fallback secret detected in code.");
    suggestions.push("Fail fast at startup if process.env.SECRET is missing.");
  }

  // 2. Deprecated headers check
  if (/res\.setHeader\(\s*["']X-XSS-Protection/i.test(code)) {
    errors.push("Deprecated X-XSS-Protection header detected.");
    suggestions.push("Use modern Content-Security-Policy (CSP) headers instead.");
  }

  // 3. Raw SQL Injection check
  if (/\$\{.*?\}|%s\s*\+|f["'].*?\{.*?\}/i.test(code) && /(SELECT|INSERT|UPDATE|DELETE)\s+/i.test(code)) {
    errors.push("Potential raw SQL injection via string concatenation.");
    suggestions.push("Use parameterized queries ($1, ? or Prisma/Drizzle).");
  }

  return {
    validatorId: "validator.security",
    category: "security",
    passed: errors.length === 0,
    errors,
    warnings,
    suggestions,
  };
}

export function validateDatabase(schemaSQLOrPrisma: string, isMultiTenant = false): ValidatorReport {
  const dbReport = validateDatabaseSchema(schemaSQLOrPrisma, { isMultiTenant });
  const errors: string[] = [];
  const suggestions: string[] = [];

  for (const v of dbReport.violations) {
    if (v.severity === "CRITICAL" || v.severity === "HIGH") {
      errors.push(`[${v.code}] ${v.message}`);
      suggestions.push(v.recommendation);
    }
  }

  return {
    validatorId: "validator.database",
    category: "database",
    passed: dbReport.passed,
    errors,
    warnings: [],
    suggestions,
  };
}

export function validateCode(
  files: Record<string, string>,
  dependencies: { name: string; version: string }[],
  installedDeps: Record<string, string> = {}
): ValidatorReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  const suggestions: string[] = [];

  // Check required dependencies
  for (const dep of dependencies) {
    if (!installedDeps[dep.name]) {
      warnings.push(`Required dependency '${dep.name}@${dep.version}' is not yet in package.json.`);
      suggestions.push(`Run: npm install ${dep.name}@${dep.version}`);
    }
  }

  return {
    validatorId: "validator.code",
    category: "code",
    passed: errors.length === 0,
    errors,
    warnings,
    suggestions,
  };
}

/**
 * Run all validators and compile a unified report.
 */
export function runUnifiedValidators(context: {
  code?: string;
  schema?: string;
  files?: Record<string, string>;
  dependencies?: { name: string; version: string }[];
  installedDeps?: Record<string, string>;
  isMultiTenant?: boolean;
}): { passed: boolean; reports: ValidatorReport[]; errors: string[]; suggestions: string[] } {
  const reports: ValidatorReport[] = [];

  if (context.code) {
    reports.push(validateSecurity(context.code));
  }

  if (context.schema) {
    reports.push(validateDatabase(context.schema, context.isMultiTenant));
  }

  if (context.files) {
    reports.push(validateCode(context.files, context.dependencies || [], context.installedDeps));
  }

  // Also evaluate rules
  const rulesEval = evaluateRules({
    code: context.code,
    schema: context.schema,
    files: context.files,
  });

  if (!rulesEval.passed) {
    reports.push({
      validatorId: "validator.rules",
      category: "security",
      passed: false,
      errors: rulesEval.violations.map((v) => `[${v.ruleId}] ${v.message}`),
      warnings: [],
      suggestions: rulesEval.violations.map((v) => v.suggestion || ""),
    });
  }

  const allErrors = reports.flatMap((r) => r.errors);
  const allSuggestions = reports.flatMap((r) => r.suggestions);

  return {
    passed: allErrors.length === 0,
    reports,
    errors: allErrors,
    suggestions: allSuggestions,
  };
}
