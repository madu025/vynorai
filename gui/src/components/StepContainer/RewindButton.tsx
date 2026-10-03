import { ArrowUturnLeftIcon } from "@heroicons/react/24/outline";
import { useState } from "react";
import { useAppDispatch, useAppSelector } from "../../redux/hooks";
import { rewindToUserMessage } from "../../redux/thunks/rewind";

/**
 * "Rewind to here" for a past prompt: restores files changed by this prompt
 * and every later one, removes those turns, and puts the prompt back in the
 * input box. Two-step inline confirm because it changes files on disk.
 */
export function RewindButton({ index }: { index: number }) {
  const dispatch = useAppDispatch();
  const isStreaming = useAppSelector((state) => state.session.isStreaming);
  const laterPrompts = useAppSelector(
    (state) =>
      state.session.history
        .slice(index)
        .filter((item) => item.message.role === "user").length,
  );
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  if (isStreaming) return null;

  async function rewind() {
    setBusy(true);
    setMessage(null);
    try {
      const result = await dispatch(rewindToUserMessage({ index })).unwrap();
      if (!result.rewound) setMessage(result.reason ?? "Rewind was canceled.");
    } catch {
      setMessage("Could not rewind.");
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  return (
    <div className="text-description-muted flex items-center justify-end gap-2 px-2 pb-1 text-[10px]">
      {message && <span className="text-error truncate">{message}</span>}
      {confirming ? (
        <>
          <span>
            Undo{" "}
            {laterPrompts === 1 ? "this prompt" : `${laterPrompts} prompts`} and
            their file changes?
          </span>
          <button
            type="button"
            disabled={busy}
            onClick={() => void rewind()}
            className="text-foreground cursor-pointer border-0 bg-transparent p-0 text-[10px] font-semibold"
            data-testid="rewind-confirm"
          >
            {busy ? "Rewinding…" : "Rewind"}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => setConfirming(false)}
            className="text-description cursor-pointer border-0 bg-transparent p-0 text-[10px]"
          >
            Cancel
          </button>
        </>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="hover:text-foreground flex cursor-pointer items-center gap-1 border-0 bg-transparent p-0 text-[10px] opacity-70 hover:opacity-100"
          data-testid="rewind-button"
          title="Restore files and conversation to before this prompt"
        >
          <ArrowUturnLeftIcon className="h-2.5 w-2.5" />
          Rewind to here
        </button>
      )}
    </div>
  );
}
