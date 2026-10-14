import type { IDE } from "..";
import { joinPathsToUri } from "../util/uri";
import type {
  VerificationCommandCandidate,
  WorkspaceSnapshot,
} from "../workspace/types";
import type { CompletionContract } from "./types";

type CandidateInput = Omit<
  VerificationCommandCandidate,
  "id" | "requiresApproval"
>;

const SCRIPT_PRIORITY: Array<{
  names: string[];
  kind: VerificationCommandCandidate["kind"];
}> = [
  { names: ["test", "test:unit"], kind: "test" },
  {
    names: ["typecheck", "type-check", "tsc", "check:types"],
    kind: "typecheck",
  },
  { names: ["lint"], kind: "lint" },
  { names: ["build"], kind: "build" },
];

function makeCandidate(input: CandidateInput): VerificationCommandCandidate {
  // This module is shared by the Node extension host and the browser-based
  // GUI bundle.  Keep the identifier hash implementation platform-neutral;
  // importing Node's `crypto` here makes the production GUI bundle fail at
  // Rollup time.  Two independent 32-bit FNV-1a lanes give a stable,
  // content-derived 16-hex-character identifier without exposing command
  // text or requiring a cryptographic primitive.
  const value = `${input.rootId}:${input.command}`;
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    first ^= code;
    first = Math.imul(first, 0x01000193);
    second ^= code + index;
    second = Math.imul(second, 0x01000193);
  }
  const id = `${(first >>> 0).toString(16).padStart(8, "0")}${(second >>> 0)
    .toString(16)
    .padStart(8, "0")}`;
  return {
    ...input,
    id,
    requiresApproval: true,
  };
}

export function discoverPackageScripts(
  content: string,
  runner: "npm" | "pnpm" | "yarn" | "bun",
  root: { id: string; name: string },
): VerificationCommandCandidate[] {
  let parsed: { scripts?: Record<string, unknown> };
  try {
    parsed = JSON.parse(content) as { scripts?: Record<string, unknown> };
  } catch {
    return [];
  }
  const scripts = parsed.scripts ?? {};
  const selected = new Set<string>();
  const candidates: VerificationCommandCandidate[] = [];
  for (const group of SCRIPT_PRIORITY) {
    const name = group.names.find(
      (candidate) =>
        typeof scripts[candidate] === "string" &&
        /^[A-Za-z0-9:_-]+$/.test(candidate),
    );
    if (!name || selected.has(name)) continue;
    selected.add(name);
    const run = runner === "yarn" ? `yarn ${name}` : `${runner} run ${name}`;
    candidates.push(
      makeCandidate({
        rootId: root.id,
        rootName: root.name,
        kind: group.kind,
        command: run,
        source: `package.json#scripts.${name}`,
        confidence: "high",
      }),
    );
  }
  return candidates;
}

export interface PlannedVerification {
  candidate: VerificationCommandCandidate;
  criterionIds: string[];
}

export interface VerificationImpact {
  minimumEvidenceKinds: VerificationCommandCandidate["kind"][];
  requiresIndependentReview: boolean;
  residualRisks: string[];
}

export interface VerificationPlan {
  checks: PlannedVerification[];
  unresolvedCriterionIds: string[];
  impact: VerificationImpact;
}

/** Classifies only the changed-surface names; it never executes or invents a command. */
export function classifyChangedSurface(
  changedFiles: string[],
): VerificationImpact {
  const files = changedFiles.map((file) =>
    file.toLowerCase().replace(/\\/g, "/"),
  );
  const joined = files.join(" ");
  const highRisk =
    /(^|[/_.-])(auth|security|permission|billing|payment|deploy|release)([/_.-]|$)/.test(
      joined,
    );
  const database =
    /(^|[/_.-])(migration|migrations|schema|database|db)([/_.-]|$)/.test(
      joined,
    );
  const ui =
    /(^|[/_.-])(gui|ui|web|pages|components)([/_.-]|$)/.test(joined) ||
    /\.(tsx|jsx|css|scss|html)$/.test(joined);
  const typeSurface = /\.(ts|tsx|js|jsx|py|go|rs|java|kt|cs)$/.test(joined);
  const minimumEvidenceKinds = new Set<VerificationCommandCandidate["kind"]>();
  if (typeSurface || database || ui) minimumEvidenceKinds.add("test");
  if (typeSurface || database) minimumEvidenceKinds.add("typecheck");
  if (!minimumEvidenceKinds.size && files.length)
    minimumEvidenceKinds.add("test");
  const residualRisks: string[] = [];
  if (ui) residualRisks.push("browser_qa_not_represented_by_command_discovery");
  if (database)
    residualRisks.push("migration_parity_requires_repository_check");
  if (highRisk)
    residualRisks.push("high_risk_surface_requires_independent_review");
  return {
    minimumEvidenceKinds: [...minimumEvidenceKinds],
    requiresIndependentReview: highRisk,
    residualRisks,
  };
}

/**
 * Link discovered, repository-defined commands to contract criteria. This
 * only selects existing candidates; it never invents a shell command or
 * lowers the candidate's approval requirement.
 */
export function planVerification(
  candidates: VerificationCommandCandidate[],
  contract: CompletionContract | undefined,
  changedFiles: string[] = [],
): VerificationPlan {
  if (!contract)
    return {
      checks: candidates.map((candidate) => ({ candidate, criterionIds: [] })),
      unresolvedCriterionIds: [],
      impact: classifyChangedSurface(changedFiles),
    };
  const impact = classifyChangedSurface(changedFiles);
  const checks = candidates.map((candidate) => ({
    candidate,
    criterionIds: contract.criteria
      .filter((criterion) =>
        criterion.evidencePolicy.some((policy) =>
          policy === "focused_check"
            ? candidate.kind === "test"
            : policy === "typecheck"
              ? candidate.kind === "typecheck"
              : policy === "lint"
                ? candidate.kind === "lint"
                : policy === "build"
                  ? candidate.kind === "build"
                  : policy === "relevant_checks"
                    ? ["test", "typecheck", "lint", "build"].includes(
                        candidate.kind,
                      )
                    : false,
        ),
      )
      .map((criterion) => criterion.id),
  }));
  const linked = new Set(checks.flatMap((item) => item.criterionIds));
  // A changed source surface without a discoverable command is explicitly
  // unresolved; callers must show blocked/unverified rather than claim pass.
  const unresolvedCriterionIds = contract.criteria
    .filter((criterion) => criterion.required && !linked.has(criterion.id))
    .map((criterion) => criterion.id);
  if (impact.requiresIndependentReview) {
    for (const criterion of contract.criteria) {
      if (
        criterion.required &&
        criterion.evidencePolicy.includes("independent_review") &&
        !unresolvedCriterionIds.includes(criterion.id)
      ) {
        unresolvedCriterionIds.push(criterion.id);
      }
    }
  }
  return { checks, unresolvedCriterionIds, impact };
}

async function detectRunner(
  ide: IDE,
  rootUri: string,
  packageJson: string,
): Promise<"npm" | "pnpm" | "yarn" | "bun"> {
  try {
    const manager = (
      JSON.parse(packageJson) as { packageManager?: string }
    ).packageManager?.split("@")[0];
    if (["npm", "pnpm", "yarn", "bun"].includes(manager ?? "")) {
      return manager as "npm" | "pnpm" | "yarn" | "bun";
    }
  } catch {
    // Invalid package metadata is handled by discoverPackageScripts.
  }
  const lockfiles: Array<[string, "pnpm" | "yarn" | "bun"]> = [
    ["pnpm-lock.yaml", "pnpm"],
    ["yarn.lock", "yarn"],
    ["bun.lockb", "bun"],
  ];
  for (const [file, runner] of lockfiles) {
    if (
      await ide.fileExists(joinPathsToUri(rootUri, file)).catch(() => false)
    ) {
      return runner;
    }
  }
  return "npm";
}

export async function discoverVerificationCommands(
  ide: IDE,
  snapshot: WorkspaceSnapshot,
): Promise<VerificationCommandCandidate[]> {
  if (!snapshot.trusted) return [];
  const workspaceUris = [...(await ide.getWorkspaceDirs())].sort();
  const roots = snapshot.roots.map((root, index) => ({
    ...root,
    uri: workspaceUris[index],
  }));
  const output: VerificationCommandCandidate[] = [];

  for (const artifact of snapshot.manifests) {
    const root = roots.find((item) => item.id === artifact.rootId);
    if (!root?.uri) continue;
    if (artifact.uri === "package.json") {
      const content = await ide
        .readFile(joinPathsToUri(root.uri, artifact.uri))
        .catch(() => undefined);
      if (!content || Buffer.byteLength(content, "utf8") > 64 * 1024) continue;
      const runner = await detectRunner(ide, root.uri, content);
      output.push(...discoverPackageScripts(content, runner, root));
      continue;
    }
    const definitions: Record<
      string,
      Array<[VerificationCommandCandidate["kind"], string]>
    > = {
      "Cargo.toml": [["test", "cargo test"]],
      "go.mod": [["test", "go test ./..."]],
      "pom.xml": [["test", "mvn test"]],
      "build.gradle": [["test", "gradle test"]],
      "build.gradle.kts": [["test", "gradle test"]],
      "composer.json": [["test", "composer test"]],
      Gemfile: [["test", "bundle exec rake test"]],
      "pyproject.toml": [["test", "python -m pytest"]],
      "requirements.txt": [["test", "python -m pytest"]],
    };
    for (const [kind, command] of definitions[artifact.uri] ?? []) {
      output.push(
        makeCandidate({
          rootId: root.id,
          rootName: root.name,
          kind,
          command,
          source: artifact.uri,
          confidence: ["pyproject.toml", "requirements.txt"].includes(
            artifact.uri,
          )
            ? "medium"
            : "high",
        }),
      );
    }
  }

  return [
    ...new Map(
      output.map((item) => [`${item.rootId}:${item.command}`, item]),
    ).values(),
  ].slice(0, 12);
}
