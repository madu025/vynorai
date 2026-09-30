import { GoldenTemplate, ConfigValidationResult, CompatibilityResult } from "./types.js";

/**
 * Validate user-provided config and environment variables against template requirements.
 */
export function validateTemplateConfig(
  template: GoldenTemplate,
  providedConfig: Record<string, any> = {},
  envVariables: Record<string, string | undefined> = process.env
): ConfigValidationResult {
  const missingEnv: string[] = [];
  const missingParams: string[] = [];
  const errors: string[] = [];

  // 1. Verify required environment variables
  if (template.requiredEnv && Array.isArray(template.requiredEnv)) {
    for (const envKey of template.requiredEnv) {
      const val = envVariables[envKey];
      if (!val || val.trim() === "") {
        missingEnv.push(envKey);
        errors.push(`Missing required environment variable: '${envKey}'`);
      }
    }
  }

  // 2. Verify config schema parameters
  if (template.configSchema) {
    for (const [paramKey, rule] of Object.entries(template.configSchema)) {
      const val = providedConfig[paramKey];
      if (rule.required && (val === undefined || val === null || val === "")) {
        missingParams.push(paramKey);
        errors.push(`Missing required configuration parameter: '${paramKey}' (${rule.description})`);
      } else if (val !== undefined && typeof val !== rule.type && rule.type !== "array") {
        errors.push(`Parameter '${paramKey}' expects type '${rule.type}', received '${typeof val}'`);
      }
    }
  }

  return {
    isValid: errors.length === 0,
    missingEnv,
    missingParams,
    errors,
  };
}

/**
 * Validate project framework, Node.js and runtime version compatibility.
 * Prevents injecting incompatible templates (e.g. Next.js 12 into a Next.js 15 App Router codebase).
 */
export function validateTemplateCompatibility(
  template: GoldenTemplate,
  project: {
    framework?: string;
    frameworkVersion?: string;
    nodeVersion?: string;
    language?: string;
  }
): CompatibilityResult {
  const reasons: string[] = [];
  const warnings: string[] = [];

  if (!template.compatibleWith) {
    return { isCompatible: true, reasons: [], warnings: [] };
  }

  const { framework, nextjs, node } = template.compatibleWith;

  // 1. Framework matching
  if (framework && project.framework) {
    if (project.framework.toLowerCase() !== framework.toLowerCase()) {
      reasons.push(
        `Incompatible framework: Project is '${project.framework}', but template requires '${framework}'`
      );
    }
  }

  // 2. Next.js version checking
  if (nextjs && project.framework?.toLowerCase() === "nextjs" && project.frameworkVersion) {
    const projMajor = parseInt(project.frameworkVersion.replace(/[^0-9.]/g, "").split(".")[0], 10);
    const reqMajor = parseInt(nextjs.replace(/[^0-9.]/g, "").split(".")[0], 10);
    if (!isNaN(projMajor) && !isNaN(reqMajor) && projMajor < reqMajor) {
      reasons.push(
        `Next.js version mismatch: Project uses Next.js ${project.frameworkVersion}, but template requires Next.js >= ${nextjs}`
      );
    }
  }

  // 3. Node version checking
  if (node && project.nodeVersion) {
    const projNode = parseInt(project.nodeVersion.replace(/[^0-9.]/g, "").split(".")[0], 10);
    const reqNode = parseInt(node.replace(/[^0-9.]/g, "").split(".")[0], 10);
    if (!isNaN(projNode) && !isNaN(reqNode) && projNode < reqNode) {
      warnings.push(`Project Node version (${project.nodeVersion}) is lower than recommended (${node})`);
    }
  }

  return {
    isCompatible: reasons.length === 0,
    reasons,
    warnings,
  };
}

/**
 * Enforce strict security validation on the template before code injection.
 * Prohibits hardcoded fallback secrets in production templates.
 */
export function validateTemplateSecurity(template: GoldenTemplate): { passed: boolean; securityIssues: string[] } {
  const securityIssues: string[] = [];

  if (template.code.includes('|| "change_this') || template.code.includes("|| 'change_this")) {
    securityIssues.push("Insecure fallback secret detected in code string. Must throw startup error on missing secret.");
  }

  // Check if header is actively being set (ignoring explanatory comments)
  if (/res\.setHeader\(\s*["']X-XSS-Protection/i.test(template.code)) {
    securityIssues.push("Deprecated X-XSS-Protection header detected. Use Content-Security-Policy instead.");
  }

  return {
    passed: securityIssues.length === 0,
    securityIssues,
  };
}
