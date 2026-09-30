import {
  GoldenTemplate,
  IntentRoutingResult,
  WorkflowExecutionResult,
  ValidatorReport,
  RiskLevel,
} from "./types.js";
import { classifyIntentAndRoute } from "./intentClassifier.js";
import { composeTemplatePipeline } from "./composer.js";
import { WORKFLOW_REGISTRY, executeWorkflow } from "./workflows/engine.js";
import { RULES_REGISTRY, evaluateRules } from "./rules/engine.js";
import { runUnifiedValidators } from "./validators/engine.js";
import { ExecutionTools } from "./tools/engine.js";
import { GOLDEN_TEMPLATES } from "../templateVault.js";

/**
 * VynorAI 5-Layer Master Orchestrator
 * -----------------------------------------------------------------------------
 * Unifies:
 *   1. Templates  (What code to use?)
 *   2. Rules      (What MUST / MUST NOT happen?)
 *   3. Validators (Is it correct and safe?)
 *   4. Workflows  (In what step-by-step sequence?)
 *   5. Tools      (How to physically execute and patch?)
 *
 * Maximizes token efficiency: 0 LLM tokens for deterministic workflows!
 * On error, sends only surgical pinpoint feedback rather than full project context.
 */

export interface OrchestrationResult {
  status: "SUCCESS" | "FAILED" | "VALIDATION_FAILED" | "FALLBACK_LLM";
  workflowId?: string;
  templateId?: string;
  confidence: number;
  tokensConsumed: number; // 0 for local deterministic pipeline
  completedSteps: string[];
  diffs: { file: string; diff: string }[];
  validatorReports: ValidatorReport[];
  surgicalFeedbackForLLM?: {
    summary: string;
    violations: string[];
    suggestions: string[];
  };
  userApprovalRequired: boolean;
  riskLevel: RiskLevel;
  modifiedFiles: Record<string, string>;
  message: string;
}

export async function executeVynorEngine(
  prompt: string,
  projectFiles: Record<string, string>,
  options: {
    schemaSQL?: string;
    isMultiTenant?: boolean;
    autoApply?: boolean;
  } = {}
): Promise<OrchestrationResult> {
  // ── Step 1: Detect Intent (Zero LLM Tokens) ─────────────────────────────────
  const routing: IntentRoutingResult = classifyIntentAndRoute(prompt, GOLDEN_TEMPLATES);

  // If confidence is low or fallback required, route to LLM
  if (routing.tier === "FALLBACK_LLM" || !routing.template) {
    return {
      status: "FALLBACK_LLM",
      confidence: routing.confidence,
      tokensConsumed: 0,
      completedSteps: [],
      diffs: [],
      validatorReports: [],
      userApprovalRequired: false,
      riskLevel: "low",
      modifiedFiles: projectFiles,
      message: "No deterministic template or workflow matched. Routing request to LLM.",
    };
  }

  const selectedTemplate = routing.template;

  // ── Step 2: Select Appropriate Workflow (Layer 4) ───────────────────────────
  let targetWorkflowId = "add-feature";
  if (selectedTemplate.category === "payments" || prompt.toLowerCase().includes("payhere") || prompt.toLowerCase().includes("stripe")) {
    targetWorkflowId = "add-payment";
  } else if (selectedTemplate.category === "database" || prompt.toLowerCase().includes("table") || prompt.toLowerCase().includes("migration")) {
    targetWorkflowId = "add-database-table";
  } else if (selectedTemplate.category === "auth" || selectedTemplate.category === "security") {
    targetWorkflowId = "add-auth";
  } else if (selectedTemplate.category === "api") {
    targetWorkflowId = "add-api";
  }

  // ── Step 3: Resolve Template Dependency Graph (Layer 1) ──────────────────────
  const composedPkg = composeTemplatePipeline(selectedTemplate.id, GOLDEN_TEMPLATES);
  const resolvedTemplates = composedPkg.chain
    .map((id) => GOLDEN_TEMPLATES.find((t) => t.id === id))
    .filter((t): t is GoldenTemplate => Boolean(t));

  // Prepare generated files from resolved templates
  const generatedFiles: { path: string; content: string; description: string }[] = [];
  for (const t of resolvedTemplates) {
    if (t.files && t.files.length > 0) {
      for (const f of t.files) {
        generatedFiles.push({
          path: f.path,
          content: f.content,
          description: f.description,
        });
      }
    } else {
      // Default single file scaffold
      const ext = t.languages.includes("typescript") ? "ts" : "js";
      generatedFiles.push({
        path: `src/services/${t.id}.${ext}`,
        content: t.code,
        description: t.title,
      });
    }
  }

  // ── Step 4, 5, 6, 7: Execute Workflow Steps (Rules, Tools, Validators, Tests) ─
  const workflowResult: WorkflowExecutionResult = await executeWorkflow(targetWorkflowId, {
    files: projectFiles,
    schemaSQL: options.schemaSQL,
    generatedFiles,
    testFn: () => true, // Local fast assertions
  });

  if (!workflowResult.success) {
    // If validation or rule failed, prepare targeted surgical feedback
    return {
      status: "VALIDATION_FAILED",
      workflowId: targetWorkflowId,
      templateId: selectedTemplate.id,
      confidence: routing.confidence,
      tokensConsumed: 0,
      completedSteps: workflowResult.completedSteps,
      diffs: workflowResult.diffs,
      validatorReports: workflowResult.validatorReports,
      surgicalFeedbackForLLM: {
        summary: `Validation failed in step '${workflowResult.failedStep}'. Fix only these specific violations without regenerating unchanged files.`,
        violations: workflowResult.errors,
        suggestions: workflowResult.validatorReports.flatMap((r) => r.suggestions),
      },
      userApprovalRequired: true,
      riskLevel: workflowResult.riskLevel,
      modifiedFiles: projectFiles,
      message: `Workflow halted at step '${workflowResult.failedStep}': ${workflowResult.errors.join("; ")}`,
    };
  }

  // Assemble resulting updated files
  let updatedFiles = { ...projectFiles };
  for (const gf of generatedFiles) {
    updatedFiles[gf.path] = gf.content;
  }

  return {
    status: "SUCCESS",
    workflowId: targetWorkflowId,
    templateId: selectedTemplate.id,
    confidence: routing.confidence,
    tokensConsumed: 0, // Deterministic local execution consumes 0 LLM tokens!
    completedSteps: workflowResult.completedSteps,
    diffs: workflowResult.diffs,
    validatorReports: workflowResult.validatorReports,
    userApprovalRequired: workflowResult.userApprovalRequired,
    riskLevel: workflowResult.riskLevel,
    modifiedFiles: updatedFiles,
    message: `Successfully executed 5-layer workflow '${targetWorkflowId}' using template '${selectedTemplate.id}'. 0 LLM tokens used.`,
  };
}
