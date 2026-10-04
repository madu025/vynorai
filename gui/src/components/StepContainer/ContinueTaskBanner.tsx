import { PlayIcon } from "@heroicons/react/24/outline";
import { JSONContent } from "@tiptap/react";
import { useAppSelector } from "../../redux/hooks";
import { CONTINUE_TASK_PROMPT } from "../../redux/util/toolRoundBudget";
import { formatCredits } from "../../redux/util/turnCredits";

export const continueEditorState: JSONContent = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [{ type: "text", text: CONTINUE_TASK_PROMPT }],
    },
  ],
};

/**
 * Shown after a turn pauses at its tool round budget. The agent has already
 * summarized progress and remaining steps; Continue resumes with a fresh
 * budget as a new prompt, so it can be rewound on its own.
 */
export function ContinueTaskBanner({
  onContinue,
}: {
  onContinue: (editorState: JSONContent) => void;
}) {
  const pausedAfter = useAppSelector(
    (state) => state.session.toolBudgetPausedAfter,
  );
  const isStreaming = useAppSelector((state) => state.session.isStreaming);
  const reason = useAppSelector((state) => state.session.toolBudgetPauseReason);
  const cap = useAppSelector((state) => state.ui.taskCreditCap);
  if (pausedAfter === undefined || isStreaming) return null;

  return (
    <div
      className="border-command-border bg-editor mx-2 mb-1 flex items-center gap-2 rounded-md border border-solid px-2 py-1.5 text-[11px]"
      data-testid="continue-task-banner"
    >
      <span className="text-description min-w-0 flex-1">
        {reason === "credits"
          ? `Paused at your ${formatCredits(cap ?? 0)}-credit task limit. The plan above lists what is left.`
          : `Paused after ${pausedAfter} steps to check in. The plan above lists what is left.`}
      </span>
      <button
        type="button"
        onClick={() => onContinue(continueEditorState)}
        className="text-foreground hover:bg-lightgray/10 border-command-border flex cursor-pointer items-center gap-1 rounded border border-solid bg-transparent px-2 py-0.5 text-[11px] font-semibold"
        data-testid="continue-task-button"
      >
        <PlayIcon className="h-3 w-3" />
        Continue
      </button>
    </div>
  );
}
