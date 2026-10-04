import { ChatHistoryItem } from "core";

import { STREAM_RECOVERY_MARKER } from "./streamRecovery";
import { turnEdits } from "./sideReview";

/**
 * Judgment levels: how much process the extension adds around the model so a
 * cheaper model behaves like a careful senior engineer.
 * - fast: no extra rounds.
 * - careful: a pre-mortem round when a turn changed 2+ files.
 * - max: a pre-mortem round on every turn that changed files, and the
 *   "You should know" review runs on the strongest VynorAI model.
 */
export type JudgmentLevel = "fast" | "careful" | "max";

export const DEFAULT_JUDGMENT_LEVEL: JudgmentLevel = "careful";

/** Above this share of monthly credits the extra review round is skipped. */
export const JUDGMENT_CREDIT_CEILING = 0.8;

export const PREMORTEM_MARKER = "[pre-mortem]";

export const PREMORTEM_GUIDANCE = `${PREMORTEM_MARKER} Before you finish, review your own change the way a senior engineer would:
1. Impact: for every function, type, config key, route or schema you changed, search for its other uses and confirm they still work.
2. Risks: if you changed a field name, type, unit or format, check data that already exists (JSON/DB rows, saved settings, caches) and either migrate it or keep reading the old shape. Also think about other processes or workers, backwards compatibility, error paths and unusual inputs.
3. Fix any real problem you find and re-run the relevant check. Do not add work for purely hypothetical issues.
Then end with a short report:
- Done: what changed.
- Verified: the checks you ran and their result.
- Not verified / not done: anything you could not check or finish (write "none" if none).
- Noticed: problems outside the request that you saw but did not fix (omit if none).`;

/** Files edited since the last real user prompt, if no pre-mortem was asked yet. */
export function pendingPremortem(
  history: ChatHistoryItem[],
  level: JudgmentLevel | undefined,
): { files: string[] } | undefined {
  const effective = level ?? DEFAULT_JUDGMENT_LEVEL;
  if (effective === "fast") return undefined;
  for (let i = history.length - 1; i >= 0; i--) {
    const { message, isAutoPrompt } = history[i];
    if (message.role !== "user") continue;
    const content = typeof message.content === "string" ? message.content : "";
    if (!isAutoPrompt) break;
    if (content.includes(PREMORTEM_MARKER)) return undefined;
    if (content.startsWith(STREAM_RECOVERY_MARKER)) continue;
  }
  const { files } = turnEdits(history);
  const minFiles = effective === "max" ? 1 : 2;
  return files.length >= minFiles ? { files } : undefined;
}

interface ReviewerCandidate {
  title: string;
  model: string;
  apiBase?: string;
}

/**
 * Model for the "You should know" review. At max judgment, prefer DeepSeek V4
 * Pro from the same provider as the chat model, so the edits get a stronger
 * second look; otherwise review with the chat model itself.
 */
export function reviewerModel<T extends ReviewerCandidate>(
  selected: T,
  chatModels: T[],
  level: JudgmentLevel | undefined,
): T {
  if ((level ?? DEFAULT_JUDGMENT_LEVEL) !== "max") return selected;
  if (/v4-pro/i.test(selected.model)) return selected;
  const pro = chatModels.find(
    (m) => /v4-pro/i.test(m.model) && m.apiBase === selected.apiBase,
  );
  return pro ?? selected;
}
