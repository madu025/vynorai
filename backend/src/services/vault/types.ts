/**
 * VynorAI Golden Template & Scaffold Schema Specification
 * -----------------------------------------------------------------------------
 * Enterprise specification for versioned, schema-validated, and verified
 * local scaffolds.
 */

export type TemplateCategory =
  | "security"
  | "auth"
  | "srilanka"
  | "database"
  | "api"
  | "payments"
  | "storage"
  | "testing";

export type SecurityLevel = "standard" | "high";
export type TemplateStatus = "verified" | "deprecated" | "experimental";

export interface ConfigFieldSchema {
  type: "string" | "number" | "boolean" | "object" | "array";
  required: boolean;
  description: string;
  default?: any;
  secret?: boolean;
}

export interface CompatibilityConstraints {
  node?: string;
  nextjs?: string;
  python?: string;
  framework?: string;
}

export interface GoldenTemplate {
  id: string;
  version: string;
  category: TemplateCategory;
  title: string;
  description: string;

  languages: string[];
  frameworks?: string[];
  keywords: string[];

  code: string;
  usageSnippet: string;

  // Enterprise additions requested by Architecture
  dependencies: string[];
  requiredEnv: string[];
  configSchema?: Record<string, ConfigFieldSchema>;
  validationRules?: string[];

  compatibleWith?: CompatibilityConstraints;

  testCommand?: string;
  testFiles?: string[];

  securityLevel: SecurityLevel;
  status: TemplateStatus;
}

export interface IntentMatchResult {
  template: GoldenTemplate | null;
  score: number;
  confidence: "HIGH" | "MEDIUM" | "LOW" | "NONE";
  matchedKeywords: string[];
  reasons: string[];
}

export interface ConfigValidationResult {
  isValid: boolean;
  missingEnv: string[];
  missingParams: string[];
  errors: string[];
}

export interface CompatibilityResult {
  isCompatible: boolean;
  reasons: string[];
  warnings: string[];
}
