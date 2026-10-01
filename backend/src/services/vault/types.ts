/**
 * VynorAI Golden Template & Local Software Engineering Engine Specification
 * -----------------------------------------------------------------------------
 * 20-Point Enterprise Architecture for Deterministic, Schema-Validated,
 * Composable, and Tamper-Proof Scaffolds.
 */

export type TemplateCategory =
  | "security"
  | "auth"
  | "authorization"
  | "srilanka"
  | "database"
  | "api"
  | "payments"
  | "storage"
  | "testing"
  | "infrastructure"
  | "communication"
  | "fullstack"
  | "backend";

export type SecurityLevel = "standard" | "high";
export type TemplateStatus = "verified" | "experimental" | "deprecated";
export type RiskLevel = "low" | "medium" | "high";

export interface Dependency {
  name: string;
  version: string;
  isDev?: boolean;
}

export interface EnvVariable {
  name: string;
  required: boolean;
  secret: boolean;
  description?: string;
  default?: string;
}

export interface TemplateFile {
  path: string;
  description: string;
  content: string;
  operation?: "CREATE" | "PATCH" | "INSERT_AFTER" | "INSERT_BEFORE";
  targetSymbol?: string;
}

export interface ValidationRule {
  id: string;
  description: string;
  severity: "error" | "warning";
}

export interface SecurityRule {
  id: string;
  type:
    | "NO_PLAINTEXT_SECRET"
    | "SQL_INJECTION_GUARD"
    | "AUTH_REQUIRED"
    | "VALIDATION_REQUIRED"
    | "CSRF_GUARD"
    | "IDOR_GUARD"
    | "MONEY_PRECISION";
  description: string;
}

export interface CompatibilityConstraints {
  node?: string;
  nextjs?: string;
  python?: string;
  framework?: string;
  orm?: string;
  database?: string;
}

export interface TestDefinition {
  name: string;
  command?: string;
  file?: string;
  assertions: string[];
}

export interface IntentDefinition {
  id: string;
  patterns: string[];
  negativePatterns?: string[];
  templateId: string;
  confidenceThreshold: number;
}

export interface ConfigFieldSchema {
  type: "string" | "number" | "boolean" | "object" | "array";
  required: boolean;
  description: string;
  default?: any;
  secret?: boolean;
}

export interface GoldenTemplate {
  id: string;
  version: string;
  category: TemplateCategory;
  title: string;
  description: string;

  keywords: string[];
  intents?: string[];

  languages: string[];
  frameworks?: string[];

  // 1. Dependency & Environment managers
  dependencies: (Dependency | string)[];
  envVariables?: EnvVariable[];

  // 2. Structured schemas & multi-file specifications
  inputSchema?: Record<string, ConfigFieldSchema>;
  outputSchema?: Record<string, any>;
  files?: TemplateFile[];

  // 3. Validation & Security policy engine
  validation?: ValidationRule[];
  validationRules?: string[];
  security?: SecurityRule[];

  // 4. Compatibility & Automated tests
  compatibility?: CompatibilityConstraints;
  tests?: TestDefinition[];

  // 5. Verification status & integrity checksum
  status: TemplateStatus;
  checksum?: string;
  createdAt?: string;
  updatedAt?: string;

  // 6. Enterprise safety controls
  protectedSections?: string[]; // DO_NOT_MODIFY sections (e.g. signature_verification)
  requires?: string[];          // Template dependency graph (e.g. ["user-auth", "payment-core"])
  riskLevel?: RiskLevel;        // Human approval level (low = auto, medium = diff, high = explicit approval)

  // Legacy compatibility fields
  code: string;
  usageSnippet: string;
  requiredEnv: string[];
  testCommand?: string;
  securityLevel: SecurityLevel;
  configSchema?: Record<string, ConfigFieldSchema>;
  compatibleWith?: CompatibilityConstraints;
}

export interface IntentRoutingResult {
  template: GoldenTemplate | null;
  intentId: string | null;
  confidence: number; // 0.00 to 1.00
  tier: "DIRECT_EXECUTE" | "VALIDATE_AND_EXECUTE" | "ASK_CLARIFICATION" | "FALLBACK_LLM";
  reasons: string[];
  matchedKeywords: string[];
}

export interface ProjectContext {
  framework?: string;
  frameworkVersion?: string;
  nodeVersion?: string;
  language?: "typescript" | "javascript" | "python" | "go" | "php";
  orm?: "prisma" | "drizzle" | "typeorm" | "none";
  database?: "postgresql" | "mysql" | "sqlite" | "mongodb";
  installedDependencies?: Record<string, string>;
  existingEnvKeys?: string[];
  hasPrismaSchema?: boolean;
}

export interface PatchOperation {
  file: string;
  type: "INSERT_AFTER" | "INSERT_BEFORE" | "ADD_IMPORT" | "ADD_ROUTE" | "ADD_MODEL" | "REPLACE_BLOCK";
  targetAnchor: string;
  payload: string;
  protectedSectionCheck?: string;
}

export interface PatchResult {
  success: boolean;
  modifiedFiles: string[];
  errors: string[];
  diffs: { file: string; diff: string }[];
  snapshotId?: string;
}

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  templateId: string;
  version: string;
  action: "INSTALL" | "VERIFY" | "ROLLBACK" | "VALIDATE_REJECTED";
  status: "PASSED" | "FAILED" | "PENDING_APPROVAL";
  riskLevel: RiskLevel;
  project: string;
  checksum: string;
  details?: Record<string, any>;
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

// ─────────────────────────────────────────────────────────────────────────────
// 5-LAYER LOCAL ENGINEERING SYSTEM SPECIFICATION (Templates, Rules, Validators, Workflows, Tools)
// ─────────────────────────────────────────────────────────────────────────────

export interface EngineeringRule {
  id: string;
  category: "database" | "security" | "typescript" | "api" | "auth" | "architecture";
  description: string;
  severity: "ERROR" | "WARN";
  enforce: (context: { code?: string; schema?: string; files?: Record<string, string>; env?: Record<string, any> }) => { passed: boolean; message?: string; suggestion?: string };
}

export interface ValidatorReport {
  validatorId: string;
  category: "security" | "database" | "code" | "compatibility";
  passed: boolean;
  errors: string[];
  warnings: string[];
  suggestions: string[];
}

export interface WorkflowStep {
  id: string;
  name: string;
  layer: "RULE" | "TOOL" | "TEMPLATE" | "VALIDATOR" | "TEST";
  action: string;
  execute: (state: any) => Promise<{ success: boolean; details?: any; error?: string }>;
}

export interface WorkflowDefinition {
  id: string;
  name: string;
  description: string;
  category: "payment" | "database" | "auth" | "api" | "feature";
  triggerIntents: string[];
  steps: {
    id: string;
    name: string;
    layer: "RULE" | "TOOL" | "TEMPLATE" | "VALIDATOR" | "TEST";
    action: string;
  }[];
}

export interface WorkflowExecutionResult {
  workflowId: string;
  success: boolean;
  completedSteps: string[];
  failedStep?: string;
  generatedFiles: { path: string; description: string }[];
  validatorReports: ValidatorReport[];
  diffs: { file: string; diff: string }[];
  errors: string[];
  userApprovalRequired: boolean;
  riskLevel: RiskLevel;
}

