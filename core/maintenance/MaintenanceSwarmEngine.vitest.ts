import { describe, it, expect } from "vitest";
import { IssueTriageProvider } from "./IssueTriageProvider";
import { MorningBriefingGenerator } from "./MorningBriefing";
import { MaintenanceSwarmEngine } from "./MaintenanceSwarmEngine";
import type { MaintenanceIssue } from "./types";

describe("VynorAI Proactive Self-Driving Maintenance Swarm", () => {
  describe("IssueTriageProvider", () => {
    it("correctly parses GitHub issues and prioritizes critical bugs", () => {
      const mockGitHubJson = JSON.stringify([
        {
          number: 101,
          title: "Minor typo in README.md",
          body: "Please fix spelling error",
          labels: [{ name: "docs" }],
        },
        {
          number: 102,
          title: "Critical memory crash in payment webhook",
          body: "Server throws fatal OOM crash in src/payment/webhook.ts",
          labels: [{ name: "security" }, { name: "critical" }],
        },
        {
          number: 103,
          title: "TypeError: Cannot read properties of undefined in auth",
          body: "Found in src/auth/token.ts",
          labels: [{ name: "bug" }],
        },
      ]);

      const issues = IssueTriageProvider.parseGitHubIssues(mockGitHubJson);
      expect(issues.length).toBe(3);

      const prioritized = IssueTriageProvider.prioritize(issues, 2);
      expect(prioritized.length).toBe(2);
      expect(prioritized[0].id).toBe("GH-102");
      expect(prioritized[0].severity).toBe("critical");
      expect(prioritized[0].targetFiles).toContain("src/payment/webhook.ts");
    });

    it("correctly parses npm audit vulnerabilities", () => {
      const mockAuditJson = JSON.stringify({
        vulnerabilities: {
          tar: {
            name: "tar",
            severity: "high",
            via: [
              {
                title: "Arbitrary File Overwrite in tar",
                cve: "CVE-2026-1024",
              },
            ],
          },
        },
      });

      const issues = IssueTriageProvider.parseNpmAudit(mockAuditJson);
      expect(issues.length).toBe(1);
      expect(issues[0].id).toBe("SEC-tar");
      expect(issues[0].source).toBe("security_audit");
      expect(issues[0].severity).toBe("high");
      expect(issues[0].cveId).toBe("CVE-2026-1024");
    });

    it("correctly parses Sentry crash errors", () => {
      const issues = IssueTriageProvider.parseSentryCrashes([
        {
          id: "crash-99",
          title: "NullPointerException in user profile loader",
          culprit: "src/user/profile.ts",
          stackTrace:
            "TypeError: Cannot read properties of null (reading 'id')\n  at loadProfile",
          count: 42,
        },
      ]);

      expect(issues.length).toBe(1);
      expect(issues[0].source).toBe("sentry_crash");
      expect(issues[0].severity).toBe("critical");
      expect(issues[0].targetFiles).toContain("src/user/profile.ts");
    });
  });

  describe("Reproduction Test Generator", () => {
    it("generates runnable reproduction test spec with safe file path", () => {
      const engine = new MaintenanceSwarmEngine("/dummy/root", {
        maxConcurrentTasks: 1,
        maxTasksPerRun: 2,
        autoPrCreation: true,
        baseBranch: "main",
        branchPrefix: "vynor/auto-fix-",
        worktreeDir: "/tmp/worktrees",
        briefingOutputDir: "/tmp/briefings",
        dryRun: true,
      });

      const issue: MaintenanceIssue = {
        id: "GH-205",
        source: "github_issue",
        title: "Fix off-by-one error in pagination",
        description: "Pagination skips last item",
        labels: ["bug"],
        severity: "high",
        targetFiles: ["src/pagination.ts"],
      };

      const repro = engine.generateReproductionSpec(issue);
      expect(repro.testFilePath).toBe("tests/repro-gh-205.test.ts");
      expect(repro.testCode).toContain("Reproduction: GH-205");
      expect(repro.testCode).toContain("src/pagination.ts");
    });
  });

  describe("Morning Briefing Generator", () => {
    it("generates markdown summary with PR links and verification evidence", () => {
      const report = MorningBriefingGenerator.formatReport(
        [
          {
            issue: {
              id: "GH-42",
              source: "github_issue",
              title: "Resolve auth session race condition",
              description: "",
              labels: ["bug"],
              severity: "critical",
            },
            status: "pr_created",
            branchName: "vynor/auto-fix-gh-42",
            prNumber: 42,
            prUrl: "https://github.com/vynorai/vynorai/pull/42",
            prTitle: "fix(core): Resolve auth session race condition (#GH-42)",
            reproductionTestPath: "tests/repro-gh-42.test.ts",
            diffSummary: { filesChanged: 2, additions: 24, deletions: 4 },
            verificationEvidence: "vitest run passed (48 tests passed)",
            durationMs: 12000,
          },
        ],
        [],
        5,
        "2026-10-07",
      );

      expect(report.markdownBriefing).toContain(
        "VynorAI Self-Driving Maintenance Briefing (2026-10-07)",
      );
      expect(report.markdownBriefing).toContain(
        "Pull Requests Ready for Review (1)",
      );
      expect(report.markdownBriefing).toContain(
        "[View PR #42](https://github.com/vynorai/vynorai/pull/42)",
      );
      expect(report.markdownBriefing).toContain("tests/repro-gh-42.test.ts");
      expect(report.markdownBriefing).toContain("48 tests passed");
    });
  });

  describe("MaintenanceSwarmEngine End-to-End Loop (Dry Run)", () => {
    it("executes triage, reproduction, verification, and creates morning briefing", async () => {
      const engine = new MaintenanceSwarmEngine("/dummy/root", {
        maxConcurrentTasks: 1,
        maxTasksPerRun: 2,
        autoPrCreation: true,
        baseBranch: "main",
        branchPrefix: "vynor/auto-fix-",
        worktreeDir: "/tmp/worktrees",
        briefingOutputDir: "/tmp/briefings",
        dryRun: true,
      });

      const issues: MaintenanceIssue[] = [
        {
          id: "SEC-vite",
          source: "security_audit",
          title: "Vulnerability in vite dev server",
          description: "Update to >=4.5.14",
          labels: ["security"],
          severity: "critical",
        },
        {
          id: "GH-77",
          source: "github_issue",
          title: "Fix broken button hover state in navbar",
          description: "Navbar CSS glitch",
          labels: ["ui"],
          severity: "low",
        },
      ];

      const report = await engine.runSwarm(issues);
      expect(report.totalIssuesScanned).toBe(2);
      expect(report.prsCreated.length).toBe(2);
      expect(report.prsCreated[0].issue.id).toBe("SEC-vite");
      expect(report.prsCreated[0].status).toBe("pr_created");
      expect(report.markdownBriefing).toContain("SEC-vite");
    });
  });
});
