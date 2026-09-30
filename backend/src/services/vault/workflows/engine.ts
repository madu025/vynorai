import {
  WorkflowDefinition,
  WorkflowExecutionResult,
  ValidatorReport,
  RiskLevel,
  PatchOperation,
} from "../types.js";
import { RULES_REGISTRY, evaluateRules } from "../rules/engine.js";
import { runUnifiedValidators, validateSecurity, validateDatabase } from "../validators/engine.js";
import { ExecutionTools } from "../tools/engine.js";
import { validateDatabaseSchema } from "../databaseGuardrails.js";

/**
 * VynorAI Workflow Engine (Layer 4)
 * -----------------------------------------------------------------------------
 * "Workflow = IN WHAT SEQUENCE / STEPS SHOULD THIS BE EXECUTED?"
 * Coordinates Templates (Layer 1), Rules (Layer 2), Validators (Layer 3),
 * and Execution Tools (Layer 5) in a deterministic, token-efficient pipeline.
 */

export const WORKFLOW_REGISTRY: Record<string, WorkflowDefinition> = {
  // ── 1. Add Database Table Workflow ──────────────────────────────────────────
  "add-database-table": {
    id: "add-database-table",
    name: "Add Database Table Workflow",
    description: "Safely scaffolds a database entity with naming rules, foreign keys, indexes, timestamps, and migration validation.",
    category: "database",
    triggerIntents: ["database.create_table", "database.migration", "database.schema"],
    steps: [
      { id: "s1_inspect_schema", name: "Inspect Existing Schema", layer: "TOOL", action: "database.inspectSchema" },
      { id: "s2_check_naming_rules", name: "Check Naming Rules", layer: "RULE", action: "rules.check_naming" },
      { id: "s3_generate_schema", name: "Generate Table Schema", layer: "TEMPLATE", action: "templates.generate_table" },
      { id: "s4_check_relationships", name: "Check Relationships & Foreign Keys", layer: "RULE", action: "rules.db.foreign_keys_required" },
      { id: "s5_check_indexes", name: "Check Foreign Key Indexes", layer: "RULE", action: "rules.db.indexes_required_for_foreign_keys" },
      { id: "s6_generate_migration", name: "Generate Migration Script", layer: "TOOL", action: "database.createMigration" },
      { id: "s7_detect_destructive", name: "Detect Destructive Schema Changes", layer: "VALIDATOR", action: "validators.detect_destructive" },
      { id: "s8_validate_migration", name: "Run 50-Point Migration Guardrail", layer: "VALIDATOR", action: "validators.databaseGuardrails" },
      { id: "s9_generate_tests", name: "Generate Entity Test Suite", layer: "TEMPLATE", action: "templates.entity_tests" },
      { id: "s10_run_tests", name: "Run Integration Tests", layer: "TEST", action: "testing.runTestSuite" },
      { id: "s11_show_diff", name: "Show Unified Git Diff", layer: "TOOL", action: "git.computeDiff" },
      { id: "s12_ask_approval", name: "Human Approval Gate", layer: "RULE", action: "approval.risk_gate" },
    ],
  },

  // ── 2. Add Payment Workflow (PayHere / Stripe) ──────────────────────────────
  "add-payment": {
    id: "add-payment",
    name: "Add Payment Gateway Workflow",
    description: "Configures financial transactions, checkout signatures, webhook verification, decimal precision, and idempotency.",
    category: "payment",
    triggerIntents: ["payment.payhere", "payment.stripe", "payment.checkout", "payment.webhook"],
    steps: [
      { id: "s1_detect_intent", name: "Detect Gateway Intent", layer: "TOOL", action: "intentClassifier.detect" },
      { id: "s2_select_workflow", name: "Select Add-Payment Workflow", layer: "RULE", action: "workflow.select" },
      { id: "s3_load_templates", name: "Load PayHere Templates (Checkout, Webhook, Model)", layer: "TEMPLATE", action: "templates.load_payment" },
      { id: "s4_enforce_rules", name: "Enforce Financial Rules (DECIMAL, Webhook Signature, Idempotency)", layer: "RULE", action: "rules.evaluate" },
      { id: "s5_execute_tools", name: "Execute File Tools (Write handlers & patch routes)", layer: "TOOL", action: "tools.filesystem" },
      { id: "s6_run_validators", name: "Run Security, Database & Code Validators", layer: "VALIDATOR", action: "validators.runUnified" },
      { id: "s7_run_tests", name: "Execute Cryptographic & Payment Unit Tests", layer: "TEST", action: "tools.testing" },
      { id: "s8_diff_and_approval", name: "Compute Diff & Require High-Risk Human Approval", layer: "TOOL", action: "git.diff" },
    ],
  },

  // ── 3. Add Authentication Workflow ──────────────────────────────────────────
  "add-auth": {
    id: "add-auth",
    name: "Add Authentication & JWT Workflow",
    description: "Deploys secure password hashing (Argon2/Bcrypt), JWT generation with refresh token rotation, and auth guards.",
    category: "auth",
    triggerIntents: ["auth.login", "auth.register", "auth.jwt", "auth.session"],
    steps: [
      { id: "s1_inspect_context", name: "Inspect Project Tech Stack", layer: "TOOL", action: "projectScanner.inspect" },
      { id: "s2_check_security_rules", name: "Check Security Rules (No Plaintext Secrets, Salt Rounds >= 12)", layer: "RULE", action: "rules.security" },
      { id: "s3_load_auth_templates", name: "Load JWT & Password Hashing Templates", layer: "TEMPLATE", action: "templates.load_auth" },
      { id: "s4_scaffold_files", name: "Scaffold Auth Controller, Middleware & Routes", layer: "TOOL", action: "tools.filesystem" },
      { id: "s5_validate_auth", name: "Validate Security, Token Expirations & CSP", layer: "VALIDATOR", action: "validators.security" },
      { id: "s6_run_auth_tests", name: "Run Token & Password Verification Tests", layer: "TEST", action: "tools.testing" },
      { id: "s7_diff_and_approval", name: "Show Diff & Gate Medium-Risk Changes", layer: "TOOL", action: "git.diff" },
    ],
  },

  // ── 4. Add API Endpoint Workflow ────────────────────────────────────────────
  "add-api": {
    id: "add-api",
    name: "Add REST / RPC API Endpoint Workflow",
    description: "Scaffolds input-validated API route with rate limiting, error handling, and OpenAPI documentation.",
    category: "api",
    triggerIntents: ["api.create_endpoint", "api.route", "api.controller"],
    steps: [
      { id: "s1_inspect_routes", name: "Inspect Existing API Routes", layer: "TOOL", action: "tools.filesystem.searchCode" },
      { id: "s2_check_api_rules", name: "Check Input Validation & Rate Limit Rules", layer: "RULE", action: "rules.api" },
      { id: "s3_generate_handler", name: "Generate Route Handler & Validation Schema", layer: "TEMPLATE", action: "templates.api" },
      { id: "s4_patch_router", name: "Patch Main Router File", layer: "TOOL", action: "tools.filesystem.patchFile" },
      { id: "s5_validate_api", name: "Validate Route Security & Types", layer: "VALIDATOR", action: "validators.code" },
      { id: "s6_run_endpoint_tests", name: "Run Route Integration Tests", layer: "TEST", action: "tools.testing" },
      { id: "s7_diff_review", name: "Show Diff Review", layer: "TOOL", action: "git.diff" },
    ],
  },

  // ── 5. Add General Feature Workflow ─────────────────────────────────────────
  "add-feature": {
    id: "add-feature",
    name: "Add Generic Feature Workflow",
    description: "Standard engineering workflow with dependency verification, rule checking, validation, and diff review.",
    category: "feature",
    triggerIntents: ["feature.scaffold", "feature.generic"],
    steps: [
      { id: "s1_inspect_codebase", name: "Inspect Codebase Context", layer: "TOOL", action: "tools.filesystem" },
      { id: "s2_evaluate_rules", name: "Evaluate Architectural Constraints", layer: "RULE", action: "rules.evaluate" },
      { id: "s3_apply_templates", name: "Apply Scaffolds & Multi-File Patches", layer: "TOOL", action: "tools.filesystem.patch" },
      { id: "s4_run_validators", name: "Run Unified Security, Code & DB Validators", layer: "VALIDATOR", action: "validators.runUnified" },
      { id: "s5_run_tests", name: "Run Verification Tests", layer: "TEST", action: "tools.testing" },
      { id: "s6_diff_and_review", name: "Generate Diff & Request Approval", layer: "TOOL", action: "git.diff" },
    ],
  },
};

/**
 * Execute a deterministic 5-Layer workflow by ID with the given project files and inputs.
 */
export async function executeWorkflow(
  workflowId: string,
  context: {
    files: Record<string, string>;
    schemaSQL?: string;
    params?: Record<string, any>;
    generatedFiles?: { path: string; content: string; description: string }[];
    patches?: PatchOperation[];
    testFn?: () => boolean;
  }
): Promise<WorkflowExecutionResult> {
  const workflow = WORKFLOW_REGISTRY[workflowId];
  if (!workflow) {
    return {
      workflowId,
      success: false,
      completedSteps: [],
      failedStep: "workflow_not_found",
      generatedFiles: [],
      validatorReports: [],
      diffs: [],
      errors: [`Workflow '${workflowId}' not found in registry.`],
      userApprovalRequired: false,
      riskLevel: "low",
    };
  }

  const completedSteps: string[] = [];
  const errors: string[] = [];
  const validatorReports: ValidatorReport[] = [];
  const diffs: { file: string; diff: string }[] = [];
  let currentFiles = { ...context.files };

  // Determine Risk Level based on category
  const riskLevel: RiskLevel =
    workflow.category === "payment" ? "high" :
    workflow.category === "database" || workflow.category === "auth" ? "medium" : "low";

  for (const step of workflow.steps) {
    // ── 1. RULE LAYER ────────────────────────────────────────────────────────
    if (step.layer === "RULE") {
      const codeToEvaluate = Object.values(currentFiles).join("\n") +
        (context.generatedFiles ? context.generatedFiles.map((f) => f.content).join("\n") : "");

      const ruleEval = evaluateRules({
        code: codeToEvaluate,
        schema: context.schemaSQL,
        files: currentFiles,
      });

      if (!ruleEval.passed) {
        // Collect violations
        for (const v of ruleEval.violations) {
          errors.push(`[${v.ruleId}] ${v.message} ${v.suggestion ? `(Fix: ${v.suggestion})` : ""}`);
        }
        return {
          workflowId,
          success: false,
          completedSteps,
          failedStep: step.id,
          generatedFiles: [],
          validatorReports,
          diffs,
          errors,
          userApprovalRequired: true,
          riskLevel,
        };
      }
      completedSteps.push(step.id);
    }

    // ── 2. TEMPLATE / TOOL LAYER ─────────────────────────────────────────────
    else if (step.layer === "TEMPLATE" || step.layer === "TOOL") {
      // Apply generated files if any
      if (context.generatedFiles && context.generatedFiles.length > 0) {
        for (const genFile of context.generatedFiles) {
          const before = currentFiles[genFile.path] || "";
          currentFiles = ExecutionTools.filesystem.writeFile(currentFiles, genFile.path, genFile.content);
          const after = genFile.content;
          diffs.push({
            file: genFile.path,
            diff: ExecutionTools.git.computeDiff(before, after),
          });
        }
      }

      // Apply patches if any
      if (context.patches && context.patches.length > 0) {
        for (const patch of context.patches) {
          const before = currentFiles[patch.file] || "";
          const patchRes = ExecutionTools.filesystem.patchFile(currentFiles, patch);
          if (!patchRes.success) {
            errors.push(...patchRes.errors);
            return {
              workflowId,
              success: false,
              completedSteps,
              failedStep: step.id,
              generatedFiles: [],
              validatorReports,
              diffs,
              errors,
              userApprovalRequired: false,
              riskLevel,
            };
          }
          currentFiles = { ...currentFiles };
          for (const d of patchRes.diffs) {
            diffs.push(d);
          }
        }
      }

      completedSteps.push(step.id);
    }

    // ── 3. VALIDATOR LAYER ───────────────────────────────────────────────────
    else if (step.layer === "VALIDATOR") {
      const codeToValidate = Object.values(currentFiles).join("\n") +
        (context.generatedFiles ? context.generatedFiles.map((f) => f.content).join("\n") : "");

      const valReport = runUnifiedValidators({
        code: codeToValidate,
        schema: context.schemaSQL,
        files: currentFiles,
      });

      validatorReports.push(...valReport.reports);

      if (!valReport.passed) {
        errors.push(...valReport.errors);
        return {
          workflowId,
          success: false,
          completedSteps,
          failedStep: step.id,
          generatedFiles: context.generatedFiles?.map((f) => ({ path: f.path, description: f.description })) || [],
          validatorReports,
          diffs,
          errors,
          userApprovalRequired: true,
          riskLevel,
        };
      }

      // If database migration step, also validate schema directly
      if (context.schemaSQL) {
        const dbReport = validateDatabaseSchema(context.schemaSQL);
        if (!dbReport.passed) {
          for (const v of dbReport.violations) {
            errors.push(`[${v.code}] ${v.message} (Recommendation: ${v.recommendation})`);
          }
          return {
            workflowId,
            success: false,
            completedSteps,
            failedStep: step.id,
            generatedFiles: context.generatedFiles?.map((f) => ({ path: f.path, description: f.description })) || [],
            validatorReports,
            diffs,
            errors,
            userApprovalRequired: true,
            riskLevel,
          };
        }
      }

      completedSteps.push(step.id);
    }

    // ── 4. TEST LAYER ────────────────────────────────────────────────────────
    else if (step.layer === "TEST") {
      if (context.testFn) {
        const testRes = ExecutionTools.testing.runTestSuite(`${workflowId}_test`, context.testFn);
        if (!testRes.passed) {
          errors.push(`Test suite failed in step '${step.name}'`);
          return {
            workflowId,
            success: false,
            completedSteps,
            failedStep: step.id,
            generatedFiles: context.generatedFiles?.map((f) => ({ path: f.path, description: f.description })) || [],
            validatorReports,
            diffs,
            errors,
            userApprovalRequired: true,
            riskLevel,
          };
        }
      }
      completedSteps.push(step.id);
    }
  }

  return {
    workflowId,
    success: errors.length === 0,
    completedSteps,
    generatedFiles: context.generatedFiles?.map((f) => ({ path: f.path, description: f.description })) || [],
    validatorReports,
    diffs,
    errors,
    userApprovalRequired: riskLevel === "high" || riskLevel === "medium",
    riskLevel,
  };
}
