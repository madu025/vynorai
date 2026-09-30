import { GOLDEN_TEMPLATES } from "../../templateVault.js";
import { RULES_REGISTRY } from "../rules/engine.js";
import { WORKFLOW_REGISTRY } from "../workflows/engine.js";
import { ExecutionTools } from "../tools/engine.js";
import { runUnifiedValidators, validateSecurity, validateDatabase, validateCode } from "../validators/engine.js";

/**
 * VynorAI Unified 5-Layer Registry
 * -----------------------------------------------------------------------------
 * Provides direct metadata introspection, schema summaries, and catalog
 * exports for:
 *   - templates (Layer 1)
 *   - rules (Layer 2)
 *   - validators (Layer 3)
 *   - workflows (Layer 4)
 *   - tools (Layer 5)
 */

export const VYNOR_REGISTRY = {
  // Layer 1: Code Templates
  templates: {
    list: () => GOLDEN_TEMPLATES.map((t) => ({ id: t.id, title: t.title, category: t.category, version: t.version, riskLevel: t.riskLevel })),
    get: (id: string) => GOLDEN_TEMPLATES.find((t) => t.id === id),
    count: () => GOLDEN_TEMPLATES.length,
  },

  // Layer 2: Engineering Rules
  rules: {
    list: () => RULES_REGISTRY.map((r) => ({ id: r.id, category: r.category, description: r.description, severity: r.severity })),
    get: (id: string) => RULES_REGISTRY.find((r) => r.id === id),
    count: () => RULES_REGISTRY.length,
  },

  // Layer 3: Validators
  validators: {
    list: () => [
      { id: "validator.security", category: "security", description: "Verifies zero plaintext secrets, CSP headers, and parameterized SQL." },
      { id: "validator.database", category: "database", description: "50-point database guardrail against float money, unindexed FKs, and destructive migrations." },
      { id: "validator.code", category: "code", description: "Verifies required dependencies and syntax integrity." },
    ],
    runUnified: runUnifiedValidators,
  },

  // Layer 4: Workflows
  workflows: {
    list: () => Object.values(WORKFLOW_REGISTRY).map((w) => ({ id: w.id, name: w.name, category: w.category, stepsCount: w.steps.length })),
    get: (id: string) => WORKFLOW_REGISTRY[id],
    count: () => Object.keys(WORKFLOW_REGISTRY).length,
  },

  // Layer 5: Execution Tools
  tools: {
    list: () => [
      { name: "filesystem", actions: ["readFile", "writeFile", "patchFile", "searchCode"] },
      { name: "database", actions: ["inspectSchema", "createMigration"] },
      { name: "testing", actions: ["runTestSuite"] },
      { name: "git", actions: ["createSnapshot", "rollback", "computeDiff"] },
    ],
    execute: ExecutionTools,
  },
};
