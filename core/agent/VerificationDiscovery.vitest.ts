import { describe, expect, it } from "vitest";

import {
  classifyChangedSurface,
  discoverPackageScripts,
  planVerification,
} from "./VerificationDiscovery";
import type { CompletionContract } from "./types";

describe("discoverPackageScripts", () => {
  it("returns bounded high-confidence commands without script bodies", () => {
    const result = discoverPackageScripts(
      JSON.stringify({
        scripts: {
          test: "secret-token=do-not-return vitest",
          typecheck: "tsc --noEmit",
          lint: "eslint .",
          build: "vite build",
          deploy: "dangerous-command",
        },
      }),
      "pnpm",
      { id: "root-1", name: "app" },
    );

    expect(result.map((item) => item.command)).toEqual([
      "pnpm run test",
      "pnpm run typecheck",
      "pnpm run lint",
      "pnpm run build",
    ]);
    expect(JSON.stringify(result)).not.toContain("do-not-return");
    expect(result.every((item) => item.requiresApproval)).toBe(true);
  });

  it("ignores malformed manifests", () => {
    expect(
      discoverPackageScripts("not-json", "npm", {
        id: "root-1",
        name: "app",
      }),
    ).toEqual([]);
  });

  it("keeps commands scoped to distinct workspace roots", () => {
    const left = discoverPackageScripts(
      JSON.stringify({ scripts: { test: "vitest" } }),
      "npm",
      { id: "root-left", name: "left" },
    )[0];
    const right = discoverPackageScripts(
      JSON.stringify({ scripts: { test: "vitest" } }),
      "npm",
      { id: "root-right", name: "right" },
    )[0];
    expect(left.rootId).toBe("root-left");
    expect(right.rootId).toBe("root-right");
    expect(left.id).not.toBe(right.id);
    expect(left.command).toBe("npm run test");
    expect(right.command).toBe("npm run test");
  });

  it("rejects adversarial and non-verification script names", () => {
    const result = discoverPackageScripts(
      JSON.stringify({
        scripts: {
          test: "node test.js && curl https://example.invalid",
          deploy: "rm -rf /",
          posttest: "steal-secrets",
        },
      }),
      "npm",
      { id: "root-1", name: "app" },
    );
    expect(result.map((item) => item.command)).toEqual(["npm run test"]);
    expect(JSON.stringify(result)).not.toContain("curl");
    expect(JSON.stringify(result)).not.toContain("rm -rf");
  });

  it("links only discovered commands and reports criteria with no safe check", () => {
    const contract: CompletionContract = {
      id: "contract-1",
      version: 1,
      taskId: "task-1",
      goalVersion: 1,
      workspaceId: "workspace-1",
      scope: "medium",
      confidence: 0.9,
      criteria: [
        {
          id: "behavior",
          statement: "Behavior works",
          provenance: "inferred",
          required: true,
          evidencePolicy: ["focused_check"],
          status: "pending",
        },
        {
          id: "review",
          statement: "A review is complete",
          provenance: "repository_required",
          required: true,
          evidencePolicy: ["independent_review"],
          status: "pending",
        },
      ],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const candidate = discoverPackageScripts(
      JSON.stringify({ scripts: { test: "vitest" } }),
      "npm",
      { id: "root-1", name: "app" },
    )[0];
    const plan = planVerification([candidate], contract, ["src/app.ts"]);
    expect(plan.checks[0].criterionIds).toEqual(["behavior"]);
    expect(plan.unresolvedCriterionIds).toEqual(["review"]);
    expect(plan.checks[0].candidate.requiresApproval).toBe(true);
  });

  it("never invents a command when no candidate exists", () => {
    const plan = planVerification([], {
      id: "contract-2",
      version: 1,
      taskId: "task-2",
      goalVersion: 1,
      workspaceId: "workspace-1",
      scope: "simple",
      confidence: 1,
      criteria: [
        {
          id: "check",
          statement: "The change is checked",
          provenance: "inferred",
          required: true,
          evidencePolicy: ["focused_check"],
          status: "pending",
        },
      ],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    expect(plan.checks).toEqual([]);
    expect(plan.unresolvedCriterionIds).toEqual(["check"]);
  });

  it("raises deterministic impact floors without inventing a command", () => {
    expect(classifyChangedSurface(["backend/src/auth/session.ts"])).toEqual({
      minimumEvidenceKinds: ["test", "typecheck"],
      requiresIndependentReview: true,
      residualRisks: ["high_risk_surface_requires_independent_review"],
    });
    const ui = classifyChangedSurface(["gui/src/pages/Checkout.tsx"]);
    expect(ui.minimumEvidenceKinds).toContain("test");
    expect(ui.residualRisks).toContain(
      "browser_qa_not_represented_by_command_discovery",
    );
  });

  it("keeps high-risk review unresolved until a real review candidate is supplied", () => {
    const contract: CompletionContract = {
      id: "contract-risk",
      version: 1,
      taskId: "task-risk",
      goalVersion: 1,
      workspaceId: "workspace-1",
      scope: "complex",
      confidence: 1,
      criteria: [
        {
          id: "security",
          statement: "Authentication remains safe",
          provenance: "repository_required",
          required: true,
          evidencePolicy: ["independent_review"],
          status: "pending",
        },
      ],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const plan = planVerification([], contract, [
      "backend/src/auth/session.ts",
    ]);
    expect(plan.impact.requiresIndependentReview).toBe(true);
    expect(plan.unresolvedCriterionIds).toEqual(["security"]);
  });
});
