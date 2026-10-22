import { weakReading, type Reading } from "./readerConfidence.js";

export interface InstructionRouteInput {
  instructionText: string;
  headers: string[];
  reading: Reading;
  stepsFromAi: boolean;
  useBuiltInReader: boolean;
  excludedKinds: ReadonlySet<string>;
  aiAnalysisEnabled: boolean;
}

export type InstructionRoute =
  | { kind: "local" }
  | { kind: "ai"; reason: string };

/**
 * Keeps the task pane controller out of the confidence rules. A route already produced by AI,
 * an explicit local retry, or a disabled AI capability must never re-open the consent path.
 */
export function chooseInstructionRoute(
  input: InstructionRouteInput,
): InstructionRoute {
  if (
    input.stepsFromAi ||
    input.useBuiltInReader ||
    input.excludedKinds.size ||
    !input.aiAnalysisEnabled
  )
    return { kind: "local" };
  const reason = weakReading(
    input.instructionText,
    input.headers,
    input.reading,
  );
  return reason ? { kind: "ai", reason } : { kind: "local" };
}
