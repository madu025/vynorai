import type { SlashCommandWithSource } from "../..";

/**
 * Task shortcuts (/fix, /test, /review ...). Each one is a prompt that runs as a
 * normal agent turn, so the model keeps its tools: it can read files, grep, run
 * diagnostics and tests, and edit. The earlier versions called the model
 * directly with one 8,000-character file excerpt and no tools.
 *
 * Whatever the user types after the command is appended to the prompt by the
 * chat, so these never repeat it. Do not use double braces here: the prompt is
 * rendered as a template.
 */
const TARGET =
  "Work on the code the user attached or selected. If nothing is attached, use the file open in the editor.";

export const AGENT_PROMPT_COMMANDS: Array<{
  name: string;
  description: string;
  prompt: string;
}> = [
  {
    name: "fix",
    description:
      "Find the root cause of an error or the IDE problems and fix it",
    prompt: [
      "Debug and fix this. The error or symptom is below if the user gave one; otherwise call get_diagnostics for the open file and fix those problems.",
      TARGET,
      "Read the relevant code first, find the root cause, then make the smallest change that fixes it. Do not refactor unrelated code. After editing, re-check the diagnostics or run the relevant test, and say what you verified.",
    ].join("\n"),
  },
  {
    name: "explain",
    description: "Explain code step by step, including how it fits the project",
    prompt: [
      "Explain this code: what it does, how it works step by step, why it is written this way, and edge cases or gotchas.",
      TARGET,
      "Read the callers and definitions it depends on with your tools so the explanation is about this project, not generic. Do not edit anything.",
    ].join("\n"),
  },
  {
    name: "test",
    description:
      "Write and run unit tests for code, matching the project's test setup",
    prompt: [
      "Write unit tests for this code.",
      TARGET,
      "First find how this project tests (framework, folder, naming, existing examples) and follow it. Cover normal cases, edge cases and error paths. Create the test file, run it, and fix failures until it passes. Report the command you ran and its result.",
    ].join("\n"),
  },
  {
    name: "refactor",
    description: "Refactor for clarity without changing behavior, then verify",
    prompt: [
      "Refactor this code for clarity and maintainability without changing behavior.",
      TARGET,
      "Find its callers and tests first. Keep public names and behavior stable unless the user said otherwise. After editing, run the typecheck or the relevant tests and report the result.",
    ].join("\n"),
  },
  {
    name: "docs",
    description: "Add documentation comments that match the project's style",
    prompt: [
      "Add documentation comments to this code.",
      TARGET,
      "Match the comment style already used in this project. Document purpose, parameters, return values and non-obvious behavior; do not restate the code. Change comments only, never logic.",
    ].join("\n"),
  },
  {
    name: "review",
    description: "Review the attached code or the uncommitted changes",
    prompt: [
      "Review this code like a senior engineer.",
      "If code is attached or selected, review that. Otherwise run git diff (and git diff --staged) and review the uncommitted changes.",
      "Look for correctness bugs, missing error handling, security problems, missing tests and risky changes. Read surrounding code when needed. Report findings ordered by severity with file and line, and say what you could not verify. Do not edit unless asked.",
    ].join("\n"),
  },
  {
    name: "security",
    description: "Security audit of the attached code or the open file",
    prompt: [
      "Audit this code for security problems (injection, auth and access control, secrets, unsafe input handling, path traversal, SSRF, dependency risks).",
      TARGET,
      "Trace where untrusted input enters and where it is used. Report only issues you can point to in the code, each with file, line, impact and a concrete fix. Do not edit unless asked.",
    ].join("\n"),
  },
  {
    name: "optimize",
    description: "Find and fix real performance problems, with evidence",
    prompt: [
      "Find performance problems in this code and fix the ones that matter.",
      TARGET,
      "Explain the cost of each problem (complexity, repeated work, I/O, memory). Do not micro-optimize without a reason. Keep behavior identical and run the relevant tests after editing.",
    ].join("\n"),
  },
  {
    name: "scaffold",
    description:
      "Create a new component or feature following the project's patterns",
    prompt: [
      "Scaffold what is described below.",
      "First look at how similar features are structured in this project (folders, naming, exports, tests) and follow those conventions. Create the files, wire them in where the project expects it, and run the typecheck or tests. List the files you created.",
    ].join("\n"),
  },
  {
    name: "commit",
    description: "Write a commit message for the current changes",
    prompt: [
      "Write a Conventional Commit message for the current changes.",
      "Run git status and git diff (and git diff --staged) to see them. Use the project's recent commit style from git log. Give the subject line and a short body. Do not run git commit.",
    ].join("\n"),
  },
];

/** Registered by doLoadConfig. A name the user or another source defined wins. */
export function addAgentPromptSlashCommands(
  slashCommands: SlashCommandWithSource[],
): void {
  for (const c of AGENT_PROMPT_COMMANDS) {
    if (!slashCommands.some((cmd) => cmd.name === c.name)) {
      slashCommands.push({
        name: c.name,
        description: c.description,
        prompt: c.prompt,
        source: "built-in-legacy",
      } as SlashCommandWithSource);
    }
  }
}
