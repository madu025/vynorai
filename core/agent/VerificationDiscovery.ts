import { createHash } from "crypto";

import type { IDE } from "..";
import { joinPathsToUri } from "../util/uri";
import type {
  VerificationCommandCandidate,
  WorkspaceSnapshot,
} from "../workspace/types";

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
  return {
    ...input,
    id: createHash("sha256")
      .update(`${input.rootId}:${input.command}`)
      .digest("hex")
      .slice(0, 16),
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
