import { CheckIcon } from "@heroicons/react/24/outline";
import { JSONContent } from "@tiptap/react";
import { renderChatMessage } from "core/util/messageContent";
import { useAppDispatch, useAppSelector } from "../../redux/hooks";
import { setMode } from "../../redux/slices/sessionSlice";

export const APPROVE_PLAN_PROMPT =
  "The plan is approved. Implement it now, step by step. After each change run the relevant tests, type check or build, and report the evidence. Stop and ask if a step needs something the plan did not cover.";

export const approvePlanEditorState: JSONContent = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [{ type: "text", text: APPROVE_PLAN_PROMPT }],
    },
  ],
};

/** A plan reply shorter than this is a clarifying question, not a plan. */
const MIN_PLAN_CHARS = 200;

/**
 * Plan mode only reads and plans. When the planner has finished a turn, this
 * offers an explicit approval step: Approve switches to Agent mode and sends
 * the go-ahead as a normal prompt, so it can be rewound like any other. Nothing
 * is executed until the user presses it.
 */
export function PlanApprovalBanner({
  onApprove,
}: {
  onApprove: (editorState: JSONContent) => void;
}) {
  const dispatch = useAppDispatch();
  const mode = useAppSelector((state) => state.session.mode);
  const isStreaming = useAppSelector((state) => state.session.isStreaming);
  const lastItem = useAppSelector((state) => {
    const history = state.session.history;
    return history[history.length - 1];
  });

  if (mode !== "plan" || isStreaming) return null;
  if (!lastItem || lastItem.message.role !== "assistant") return null;
  if (renderChatMessage(lastItem.message).trim().length < MIN_PLAN_CHARS)
    return null;

  return (
    <div
      className="border-command-border bg-editor mx-2 mb-1 flex items-center gap-2 rounded-md border border-solid px-2 py-1.5 text-[11px]"
      data-testid="plan-approval-banner"
    >
      <span className="text-description min-w-0 flex-1">
        Plan ready. Nothing has been changed yet.
      </span>
      <button
        type="button"
        onClick={() => {
          dispatch(setMode("agent"));
          onApprove(approvePlanEditorState);
        }}
        className="text-foreground hover:bg-lightgray/10 border-command-border flex cursor-pointer items-center gap-1 rounded border border-solid bg-transparent px-2 py-0.5 text-[11px] font-semibold"
        data-testid="plan-approve-button"
      >
        <CheckIcon className="h-3 w-3" />
        Approve &amp; implement
      </button>
    </div>
  );
}
