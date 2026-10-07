import { describe, it, expect } from "vitest";
import { GitHubIntegrationProvider } from "./GitHubIntegrationProvider.js";
import { MaintenanceSwarmEngine } from "./MaintenanceSwarmEngine.js";
import { execSync } from "node:child_process";

describe("Live Swarm & GitHub Remote Integration", () => {
  it("should inspect real git remote and verify GitHub integration readiness", async () => {
    // 1. Detect Real Git Remote
    const remoteUrl = execSync("git remote get-url origin", {
      encoding: "utf8",
    }).trim();
    console.log(`[LIVE TEST] Detected Git Remote: ${remoteUrl}`);
    expect(remoteUrl).toContain("github.com");

    // 2. Parse Remote
    const parsed = GitHubIntegrationProvider.parseGitHubRemote(remoteUrl);
    console.log(`[LIVE TEST] Parsed Repository:`, parsed);
    expect(parsed).toEqual({ owner: "madu025", repo: "vynorai" });

    // 3. Inspect Authentication
    const provider = new GitHubIntegrationProvider();
    const hasAuth = provider.hasAuthentication();
    console.log(
      `[LIVE TEST] GitHub Authentication: ${hasAuth ? "ACTIVE" : "NO TOKEN (Safe fallback mode)"}`,
    );

    // 4. Test Swarm Engine Auto-Discovery
    const engine = new MaintenanceSwarmEngine(process.cwd(), {
      maxConcurrentTasks: 1,
      maxTasksPerRun: 1,
      autoPrCreation: true,
      baseBranch: "main",
      branchPrefix: "vynor/auto-fix-",
      worktreeDir: ".vynor-worktrees",
      briefingOutputDir: ".vynor/briefings",
      dryRun: true,
    });

    const repoRef = await engine.getGitHubRepo();
    expect(repoRef).toEqual({ owner: "madu025", repo: "vynorai" });

    const mockIssue = {
      id: "LIVE-TEST-01",
      source: "github_issue" as const,
      title: "Add Stripe Webhook Signature Verification and Idempotency",
      description:
        "Webhook handler needs cryptographic signature validation and replay protection.",
      labels: ["security", "p0", "stripe"],
      severity: "critical" as const,
      targetFiles: ["src/payments/stripeWebhook.ts"],
    };

    const report = await engine.runSwarm([mockIssue]);
    expect(report.prsCreated).toHaveLength(1);
    expect(report.prsCreated[0].prUrl).toContain(
      "https://github.com/vynorai/vynorai/pull/live-test-01",
    );
    expect(report.markdownBriefing).toContain(
      "VynorAI Self-Driving Maintenance Briefing",
    );

    console.log(
      "\n[LIVE TEST SUCCESS] All gaps analyzed, parsed, and validated!",
    );
  });
});
