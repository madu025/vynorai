import { describe, it, expect, vi } from "vitest";
import { GitHubIntegrationProvider } from "./GitHubIntegrationProvider.js";
import { MaintenanceSwarmEngine } from "./MaintenanceSwarmEngine.js";
import type { MaintenanceIssue } from "./types.js";

describe("GitHubIntegrationProvider", () => {
  describe("parseGitHubRemote", () => {
    it("should parse standard HTTPS GitHub URLs", () => {
      const result = GitHubIntegrationProvider.parseGitHubRemote(
        "https://github.com/madu025/vynorai.git",
      );
      expect(result).toEqual({ owner: "madu025", repo: "vynorai" });
    });

    it("should parse HTTPS URLs without .git extension", () => {
      const result = GitHubIntegrationProvider.parseGitHubRemote(
        "https://github.com/madu025/vynorai",
      );
      expect(result).toEqual({ owner: "madu025", repo: "vynorai" });
    });

    it("should parse SSH Git URLs", () => {
      const result = GitHubIntegrationProvider.parseGitHubRemote(
        "git@github.com:madu025/vynorai.git",
      );
      expect(result).toEqual({ owner: "madu025", repo: "vynorai" });
    });

    it("should return null for non-GitHub URLs", () => {
      const result = GitHubIntegrationProvider.parseGitHubRemote(
        "https://gitlab.com/other/repo.git",
      );
      expect(result).toBeNull();
    });

    it("should handle empty or malformed strings safely", () => {
      expect(GitHubIntegrationProvider.parseGitHubRemote("")).toBeNull();
      expect(
        GitHubIntegrationProvider.parseGitHubRemote(null as any),
      ).toBeNull();
    });
  });

  describe("Authentication & Token Detection", () => {
    it("should report authenticated when valid token provided", () => {
      const provider = new GitHubIntegrationProvider({
        token: "ghp_1234567890abcdef",
      });
      expect(provider.hasAuthentication()).toBe(true);
    });

    it("should report unauthenticated when no token provided", () => {
      const provider = new GitHubIntegrationProvider({ token: "" });
      expect(provider.hasAuthentication()).toBe(false);
    });
  });

  describe("API Interactions (Mocked Fetch)", () => {
    it("should fetch open issues and map them via IssueTriageProvider", async () => {
      const mockIssues = [
        {
          number: 101,
          title: "Crash on invalid token in auth.ts",
          body: "Stack trace points to core/auth.ts line 42",
          labels: [{ name: "bug" }, { name: "high" }],
        },
      ];

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockIssues,
      } as Response);

      const provider = new GitHubIntegrationProvider({
        token: "test-token",
        fetchFn: mockFetch,
      });

      const issues = await provider.fetchOpenIssues("madu025", "vynorai");
      expect(issues).toHaveLength(1);
      expect(issues[0].id).toBe("GH-101");
      expect(issues[0].title).toBe("Crash on invalid token in auth.ts");
      expect(issues[0].severity).toBe("critical");
    });

    it("should throw informative error on API failure when fetching issues", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: "Not Found",
        text: async () => "Repository not found",
      } as Response);

      const provider = new GitHubIntegrationProvider({
        token: "test-token",
        fetchFn: mockFetch,
      });

      await expect(
        provider.fetchOpenIssues("madu025", "non-existent"),
      ).rejects.toThrow(/GitHub API error \(404\)/);
    });

    it("should fail PR creation if unauthenticated", async () => {
      const provider = new GitHubIntegrationProvider({ token: "" });
      await expect(
        provider.createPullRequest({
          owner: "madu025",
          repo: "vynorai",
          title: "fix: test issue",
          body: "test body",
          headBranch: "vynor/auto-fix-1",
          baseBranch: "main",
        }),
      ).rejects.toThrow(/GitHub token not found/);
    });

    it("should successfully create PR when authenticated", async () => {
      const mockPrResponse = {
        number: 42,
        html_url: "https://github.com/madu025/vynorai/pull/42",
        title: "fix: payment webhook timeout",
        body: "Automated fix by VynorAI",
        draft: false,
      };

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockPrResponse,
      } as Response);

      const provider = new GitHubIntegrationProvider({
        token: "ghp_mock_token_12345",
        fetchFn: mockFetch,
      });

      const pr = await provider.createPullRequest({
        owner: "madu025",
        repo: "vynorai",
        title: "fix: payment webhook timeout",
        body: "Automated fix by VynorAI",
        headBranch: "vynor/auto-fix-42",
        baseBranch: "main",
      });

      expect(pr.prNumber).toBe(42);
      expect(pr.prUrl).toBe("https://github.com/madu025/vynorai/pull/42");
      expect(pr.prTitle).toBe("fix: payment webhook timeout");
    });
  });

  describe("MaintenanceSwarmEngine Integration with GitHub Provider", () => {
    it("should resolve repository and populate real PR numbers and URLs", async () => {
      const mockPrResponse = {
        number: 88,
        html_url: "https://github.com/madu025/vynorai/pull/88",
        title: "fix: auto fix issue",
        body: "Swarm PR body",
      };

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockPrResponse,
      } as Response);

      const provider = new GitHubIntegrationProvider({
        token: "ghp_valid_token",
        fetchFn: mockFetch,
      });

      const engine = new MaintenanceSwarmEngine(
        process.cwd(),
        {
          maxConcurrentTasks: 1,
          maxTasksPerRun: 1,
          autoPrCreation: true,
          baseBranch: "main",
          branchPrefix: "vynor/auto-fix-",
          worktreeDir: ".vynor-worktrees",
          briefingOutputDir: ".vynor/briefings",
          dryRun: false,
          pushToRemote: false, // don't push actual git network in unit test
          githubRepo: { owner: "madu025", repo: "vynorai" },
        },
        provider,
      );

      const issue: MaintenanceIssue = {
        id: "GH-88",
        source: "github_issue",
        title: "Auto fix issue",
        description: "Fix description",
        labels: ["bug"],
        severity: "high",
      };

      // Mock createWorktree & commitChanges
      (engine as any).worktreeManager.createWorktree = vi
        .fn()
        .mockResolvedValue({
          id: "gh-88",
          path: "/mock/worktree",
          branch: "vynor/auto-fix-gh-88",
          baseBranch: "main",
        });
      (engine as any).worktreeManager.commitChanges = vi
        .fn()
        .mockResolvedValue(true);
      (engine as any).worktreeManager.getDiffStats = vi.fn().mockResolvedValue({
        filesChanged: 1,
        additions: 12,
        deletions: 2,
        diff: "mock diff",
      });
      (engine as any).worktreeManager.removeWorktree = vi
        .fn()
        .mockResolvedValue(undefined);

      const report = await engine.runSwarm([issue]);

      expect(report.prsCreated).toHaveLength(1);
      expect(report.prsCreated[0].prNumber).toBe(88);
      expect(report.prsCreated[0].prUrl).toBe(
        "https://github.com/madu025/vynorai/pull/88",
      );
      expect(report.markdownBriefing).toContain("PR #88");
    });
  });
});
