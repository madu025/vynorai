/**
 * The filename used for colocated markdown rules
 */
export const RULES_MARKDOWN_FILENAME = "rules.md";

/**
 * Agent instruction files. At a workspace root they load as always-applied
 * rules; in a subdirectory they load as rules scoped to that directory.
 */
export const AGENT_INSTRUCTION_FILENAMES = [
  "AGENTS.md",
  "AGENT.md",
  "CLAUDE.md",
];

/** True for a nested agent file (not at the workspace root) given its path relative to the root. */
export function isNestedAgentInstructionFile(
  filename: string,
  relativePath: string,
): boolean {
  return (
    AGENT_INSTRUCTION_FILENAMES.includes(filename) && relativePath.includes("/")
  );
}
