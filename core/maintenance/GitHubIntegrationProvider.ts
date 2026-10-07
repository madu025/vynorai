/**
 * GitHub Integration Provider
 *
 * Implements real Cloud & GitHub API interactions for VynorAI Proactive Swarm:
 *  1. Remote URL parsing (SSH / HTTPS)
 *  2. Authenticated issue fetching via GitHub REST API
 *  3. Pull Request creation (POST /repos/{owner}/{repo}/pulls)
 *  4. Issue labeling & automated briefing comments
 */

import { IssueTriageProvider } from "./IssueTriageProvider.js";
import type {
  GitHubPullRequestResult,
  GitHubRepoRef,
  MaintenanceIssue,
} from "./types.js";

export interface GitHubProviderOptions {
  token?: string;
  baseUrl?: string;
  fetchFn?: typeof fetch;
}

export interface CreatePrParams {
  owner: string;
  repo: string;
  title: string;
  body: string;
  headBranch: string;
  baseBranch: string;
  isDraft?: boolean;
}

export class GitHubIntegrationProvider {
  private readonly baseUrl: string;
  private readonly token?: string;
  private readonly fetchFn: typeof fetch;

  constructor(options: GitHubProviderOptions = {}) {
    this.baseUrl = (options.baseUrl || "https://api.github.com").replace(
      /\/+$/,
      "",
    );
    this.token =
      options.token ||
      process.env.GITHUB_TOKEN ||
      process.env.GH_TOKEN ||
      undefined;
    this.fetchFn =
      options.fetchFn ||
      (globalThis.fetch ? globalThis.fetch.bind(globalThis) : (fetch as any));
  }

  /**
   * Parse owner and repository name from git remote URL (HTTPS or SSH).
   */
  static parseGitHubRemote(remoteUrl: string): GitHubRepoRef | null {
    if (!remoteUrl || typeof remoteUrl !== "string") return null;

    const trimmed = remoteUrl.trim();

    // SSH formats: git@github.com:owner/repo.git or ssh://git@github.com/owner/repo.git
    const sshMatch = trimmed.match(
      /^(?:ssh:\/\/)?git@github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?$/i,
    );
    if (sshMatch && sshMatch[1] && sshMatch[2]) {
      return { owner: sshMatch[1], repo: sshMatch[2] };
    }

    // HTTPS format: https://github.com/owner/repo.git
    const httpsMatch = trimmed.match(
      /^https?:\/\/(?:[^@]+@)?github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/i,
    );
    if (httpsMatch && httpsMatch[1] && httpsMatch[2]) {
      return { owner: httpsMatch[1], repo: httpsMatch[2] };
    }

    return null;
  }

  /**
   * Check if credentials are configured for remote GitHub write operations.
   */
  hasAuthentication(): boolean {
    return Boolean(this.token && this.token.length > 5);
  }

  /**
   * Helper to make authenticated requests to GitHub REST API.
   */
  private async request(
    endpoint: string,
    options: RequestInit = {},
  ): Promise<Response> {
    const url = endpoint.startsWith("http")
      ? endpoint
      : `${this.baseUrl}${endpoint.startsWith("/") ? "" : "/"}${endpoint}`;
    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "VynorAI-Swarm/1.2.39",
      ...((options.headers as Record<string, string>) || {}),
    };

    if (this.token) {
      headers.Authorization = `Bearer ${this.token}`;
    }

    return this.fetchFn(url, {
      ...options,
      headers,
    });
  }

  /**
   * Fetch open issues from the GitHub repository.
   */
  async fetchOpenIssues(
    owner: string,
    repo: string,
    options: { labels?: string[]; perPage?: number } = {},
  ): Promise<MaintenanceIssue[]> {
    const query = new URLSearchParams({
      state: "open",
      per_page: String(options.perPage || 30),
    });

    if (options.labels && options.labels.length > 0) {
      query.set("labels", options.labels.join(","));
    }

    const res = await this.request(
      `/repos/${owner}/${repo}/issues?${query.toString()}`,
    );
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(
        `GitHub API error (${res.status}): ${errText || res.statusText}`,
      );
    }

    const data = await res.json();
    return IssueTriageProvider.parseGitHubIssues(JSON.stringify(data));
  }

  /**
   * Create a real Pull Request on GitHub.
   */
  async createPullRequest(
    params: CreatePrParams,
  ): Promise<GitHubPullRequestResult> {
    if (!this.hasAuthentication()) {
      throw new Error(
        "GitHub token not found. Please provide GITHUB_TOKEN or configure Vynor Cloud Authentication.",
      );
    }

    const payload = {
      title: params.title,
      body: params.body,
      head: params.headBranch,
      base: params.baseBranch,
      draft: params.isDraft ?? false,
    };

    const res = await this.request(
      `/repos/${params.owner}/${params.repo}/pulls`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      },
    );

    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      const message = (errBody as any).message || res.statusText;
      const errors = (errBody as any).errors
        ? ` (${(errBody as any).errors.map((e: any) => e.message || JSON.stringify(e)).join(", ")})`
        : "";
      throw new Error(
        `GitHub PR creation failed [HTTP ${res.status}]: ${message}${errors}`,
      );
    }

    const data: any = await res.json();
    return {
      prNumber: data.number,
      prUrl: data.html_url,
      prTitle: data.title,
      prBody: data.body || "",
      headBranch: params.headBranch,
      baseBranch: params.baseBranch,
      isDraft: data.draft,
    };
  }

  /**
   * Attach labels to a Pull Request or Issue.
   */
  async addLabels(
    owner: string,
    repo: string,
    issueNumber: number,
    labels: string[],
  ): Promise<boolean> {
    if (!this.hasAuthentication() || labels.length === 0) return false;

    const res = await this.request(
      `/repos/${owner}/${repo}/issues/${issueNumber}/labels`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ labels }),
      },
    );

    return res.ok;
  }

  /**
   * Add a comment to an Issue or PR.
   */
  async addComment(
    owner: string,
    repo: string,
    issueNumber: number,
    body: string,
  ): Promise<boolean> {
    if (!this.hasAuthentication()) return false;

    const res = await this.request(
      `/repos/${owner}/${repo}/issues/${issueNumber}/comments`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      },
    );

    return res.ok;
  }
}
