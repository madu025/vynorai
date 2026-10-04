import { ContextItem } from "core";
import type { VerificationResult } from "core/agent/types";

type VerificationKind = VerificationResult["kind"];

const COMMAND_SIGNALS: Array<[VerificationKind, RegExp]> = [
  [
    "test",
    /(?:^|\s)(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?test\b|\b(?:vitest|jest|pytest|cargo\s+test|go\s+test|dotnet\s+test|mvn\s+test|gradle\w*\s+test)\b/i,
  ],
  ["typecheck", /\b(?:tsc|typecheck|type-check|mypy|pyright)\b/i],
  ["lint", /\b(?:eslint|biome|ruff|pylint|golangci-lint|clippy|lint)\b/i],
  [
    "build",
    /(?:^|\s)(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?build\b|\b(?:cargo\s+build|go\s+build|dotnet\s+build|mvn\s+package|gradle\w*\s+build)\b/i,
  ],
];

export function classifyVerificationCommand(
  command: string,
): VerificationKind | undefined {
  return COMMAND_SIGNALS.find(([, signal]) => signal.test(command))?.[0];
}

export function verificationFromToolResult(args: {
  toolName: string;
  command?: string;
  output?: ContextItem[];
  failed: boolean;
}): Omit<VerificationResult, "id" | "createdAt"> | undefined {
  const normalizedTool = args.toolName.toLowerCase();
  let kind: VerificationKind | undefined;
  if (
    normalizedTool.includes("view_diff") ||
    normalizedTool.includes("browser_qa") ||
    normalizedTool === "browser"
  )
    kind = "review";
  else if (args.command) kind = classifyVerificationCommand(args.command);
  if (!kind) return undefined;

  const outputFailed = args.output?.some((item) =>
    /(?:command failed|timed out|exit code [1-9]\d*|\bfailed\b)/i.test(
      `${item.status ?? ""}\n${item.description ?? ""}`,
    ),
  );
  const status = args.failed || outputFailed ? "failed" : "passed";
  return {
    kind,
    status,
    summary: `${kind} evidence from ${args.toolName}: ${status}`,
  };
}
