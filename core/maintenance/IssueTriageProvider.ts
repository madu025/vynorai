/**
 * Issue Triage Provider
 *
 * Discovers and prioritizes actionable issues from:
 *  1. GitHub Issues (bugs, good-first-issue, dependabot)
 *  2. Security Vulnerabilities (npm/cargo/pip audit)
 *  3. Sentry Crash Logs & local error reports
 */

import type { MaintenanceIssue, IssueSeverity } from "./types.js";

export class IssueTriageProvider {
  /**
   * Parse issues from GitHub CLI JSON or API output.
   */
  static parseGitHubIssues(rawJson: string): MaintenanceIssue[] {
    try {
      const items = JSON.parse(rawJson);
      if (!Array.isArray(items)) return [];

      return items
        .filter((item) => item && (item.number || item.id) && item.title)
        .map((item) => {
          const labels = Array.isArray(item.labels)
            ? item.labels.map((l: any) =>
                typeof l === "string" ? l : l.name || "",
              )
            : [];

          let severity: IssueSeverity = "medium";
          const lowerTitle = (item.title || "").toLowerCase();
          const lowerBody = (item.body || "").toLowerCase();

          if (
            labels.some((l: string) =>
              /critical|security|p0|blocker/i.test(l),
            ) ||
            /crash|critical|cve|vulnerability/i.test(lowerTitle)
          ) {
            severity = "critical";
          } else if (
            labels.some((l: string) => /high|p1|bug/i.test(l)) ||
            /error|exception|fail/i.test(lowerTitle)
          ) {
            severity = "high";
          } else if (labels.some((l: string) => /low|minor|docs/i.test(l))) {
            severity = "low";
          }

          // Extract stack traces or file mentions from body if present
          const targetFiles: string[] = [];
          const fileMatches = (item.body || "").match(
            /(?:src|core|gui|lib|app)\/[A-Za-z0-9_./-]+\.[a-z]+/g,
          );
          if (fileMatches) {
            for (const file of fileMatches) {
              if (!targetFiles.includes(file)) targetFiles.push(file);
            }
          }

          return {
            id: `GH-${item.number || item.id}`,
            source: "github_issue",
            title: item.title,
            description: item.body || "",
            labels,
            severity,
            targetFiles: targetFiles.length > 0 ? targetFiles : undefined,
          };
        });
    } catch {
      return [];
    }
  }

  /**
   * Parse npm audit JSON output to extract actionable CVE vulnerabilities.
   */
  static parseNpmAudit(rawAuditJson: string): MaintenanceIssue[] {
    try {
      const parsed = JSON.parse(rawAuditJson);
      const vulnerabilities = parsed.vulnerabilities || {};
      const issues: MaintenanceIssue[] = [];

      for (const [pkgName, details] of Object.entries<any>(vulnerabilities)) {
        if (!details) continue;
        const severity: IssueSeverity =
          details.severity === "critical"
            ? "critical"
            : details.severity === "high"
              ? "high"
              : details.severity === "moderate"
                ? "medium"
                : "low";

        const via = Array.isArray(details.via)
          ? details.via.find((v: any) => typeof v === "object" && v.title)
          : null;

        const advisoryTitle = via?.title || `Vulnerable dependency: ${pkgName}`;
        const cveId = via?.cve || via?.url?.match(/GHSA-[a-z0-9-]+/i)?.[0];

        issues.push({
          id: `SEC-${pkgName}`,
          source: "security_audit",
          title: `Security: Update ${pkgName} - ${advisoryTitle}`,
          description: `Vulnerable dependency ${pkgName} detected with severity ${severity}. Direct recommendation: bump package version in package.json and verify tests.`,
          labels: ["security", "cve", "dependencies"],
          severity,
          cveId,
          targetFiles: ["package.json"],
        });
      }

      return issues;
    } catch {
      return [];
    }
  }

  /**
   * Parse Sentry crash errors into maintenance issues with stack traces.
   */
  static parseSentryCrashes(
    crashes: Array<{
      id: string;
      title: string;
      culprit?: string;
      stackTrace?: string;
      count?: number;
    }>,
  ): MaintenanceIssue[] {
    return crashes.map((crash) => {
      const targetFiles: string[] = [];
      if (crash.culprit && /\.[a-z]+$/i.test(crash.culprit)) {
        targetFiles.push(crash.culprit);
      }

      return {
        id: `SENTRY-${crash.id}`,
        source: "sentry_crash",
        title: `Crash: ${crash.title}`,
        description: `Production crash observed ${crash.count || 1} times.\nStack trace:\n${crash.stackTrace || "N/A"}`,
        labels: ["sentry", "crash", "bug"],
        severity: (crash.count || 1) > 10 ? "critical" : "high",
        stackTrace: crash.stackTrace,
        targetFiles: targetFiles.length > 0 ? targetFiles : undefined,
      };
    });
  }

  /**
   * Rank and filter issues so the autonomous swarm works on the highest-impact,
   * lowest-risk tasks first (e.g. Critical CVEs and bounded bugs before open-ended features).
   */
  static prioritize(issues: MaintenanceIssue[], limit = 5): MaintenanceIssue[] {
    const score = (issue: MaintenanceIssue): number => {
      let pts = 0;
      if (issue.severity === "critical") pts += 100;
      if (issue.severity === "high") pts += 70;
      if (issue.severity === "medium") pts += 40;
      if (issue.severity === "low") pts += 10;

      if (issue.source === "security_audit") pts += 30; // High confidence / bounded
      if (issue.source === "sentry_crash") pts += 25; // Real production pain
      if (issue.source === "blueprint_stage") pts += 50; // High-level architecture stages
      if (issue.targetFiles && issue.targetFiles.length > 0) pts += 15; // Known scope
      if (
        issue.labels.includes("good-first-issue") ||
        issue.labels.includes("easy")
      )
        pts += 20;

      return pts;
    };

    return [...issues]
      .sort((a, b) => {
        if (a.source === "blueprint_stage" && b.source === "blueprint_stage") {
          return a.id.localeCompare(b.id, undefined, { numeric: true });
        }
        return score(b) - score(a);
      })
      .slice(0, limit);
  }
}
