import { ChatHistoryItem } from "core";
import { BuiltInToolNames } from "core/tools/builtIn";
import type { VerificationCommandCandidate } from "core/workspace/types";

const EDIT_TOOLS = new Set<string>([
  BuiltInToolNames.EditExistingFile,
  BuiltInToolNames.SingleFindAndReplace,
  BuiltInToolNames.MultiEdit,
  BuiltInToolNames.CreateNewFile,
]);

/** Commands that count as checking an edit: tests, type checks, linters, builds. */
const CHECK_COMMAND =
  /\b(test|tests|vitest|jest|mocha|pytest|unittest|tsc|typecheck|type-check|lint|eslint|ruff|mypy|pyright|flake8|build|compile|check|cargo|go (test|build|vet)|mvn|gradle|dotnet (test|build)|phpunit|rspec|swift (test|build))\b/i;

export const VERIFICATION_GATE_MARKER = "[verification-gate]";

function commandOf(args: unknown): string {
  const command = (args as { command?: unknown } | undefined)?.command;
  return typeof command === "string" ? command : "";
}

/** How often one prompt may be asked to check its edits. */
export const MAX_VERIFICATION_GATES = 3;

/**
 * Files edited since the latest real user prompt with no test, type check,
 * lint or build run after the last edit. Returns undefined when the edits are
 * verified, there are none, the model was already asked about these edits
 * (it may decline in one line when no check applies), or the limit is
 * reached.
 *
 * The question is always "was there a check after the last edit". An earlier
 * automatic prompt of another kind (a repair prompt early in a long turn)
 * used to switch the gate off for every later edit of that turn.
 */
export function unverifiedEdits(
  history: ChatHistoryItem[],
): { files: string[] } | undefined {
  let start = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].message.role === "user" && !history[i].isAutoPrompt) {
      start = i + 1;
      break;
    }
  }

  const files = new Set<string>();
  let verifiedSinceLastEdit = false;
  let askedSinceLastEdit = false;
  let gates = 0;
  for (const item of history.slice(start)) {
    const content = item.message.content;
    if (
      item.isAutoPrompt &&
      typeof content === "string" &&
      content.startsWith(VERIFICATION_GATE_MARKER)
    ) {
      gates++;
      askedSinceLastEdit = true;
    }
    for (const call of item.toolCallStates ?? []) {
      if (call.status !== "done") continue;
      const name = call.toolCall.function.name;
      if (EDIT_TOOLS.has(name)) {
        const filepath = (call.parsedArgs as { filepath?: unknown })?.filepath;
        files.add(typeof filepath === "string" ? filepath : "a file");
        verifiedSinceLastEdit = false;
        askedSinceLastEdit = false;
      } else if (
        name === BuiltInToolNames.RunTerminalCommand &&
        CHECK_COMMAND.test(commandOf(call.parsedArgs))
      ) {
        verifiedSinceLastEdit = true;
        // What is left to verify starts again after a check.
        files.clear();
      }
    }
  }
  return files.size > 0 &&
    !verifiedSinceLastEdit &&
    !askedSinceLastEdit &&
    gates < MAX_VERIFICATION_GATES
    ? { files: [...files] }
    : undefined;
}

export function verificationGatePrompt(
  files: string[],
  candidates: VerificationCommandCandidate[],
): string {
  const shown = files.slice(0, 5).join(", ");
  const more = files.length > 5 ? ` and ${files.length - 5} more` : "";
  const commands = [...new Set(candidates.map((c) => c.command))].slice(0, 4);
  const detected = commands.length
    ? ` Detected checks: ${commands.map((c) => `\`${c}\``).join(", ")}.`
    : "";
  return `${VERIFICATION_GATE_MARKER} Before finishing: you changed ${shown}${more} but ran no test, type check, lint or build after the last edit.${detected} Run the smallest relevant check now. If it fails, fix the cause and re-run. If no check applies to this change, say why in one line and finish.`;
}
