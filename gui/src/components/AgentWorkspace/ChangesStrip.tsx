import {
  CheckIcon,
  ChevronDownIcon,
  DocumentTextIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import type { ApplyState } from "core";
import { useContext, useMemo, useState } from "react";
import { IdeMessengerContext } from "../../context/IdeMessenger";
import { useAppSelector } from "../../redux/hooks";

export interface ChangedFile {
  streamId: string;
  filepath: string;
  name: string;
  state: "applying" | "review" | "accepted" | "rejected";
}

const MAX_SHOWN = 30;

function baseName(filepath: string): string {
  let clean = filepath.replace(/\/+$/, "");
  try {
    clean = decodeURIComponent(clean);
  } catch {
    // keep the raw text
  }
  return clean.split(/[\\/]/).pop() || clean;
}

/**
 * Files the agent changed in this chat, one row per file with its latest
 * state. A file edited twice shows once, in the state of its last edit.
 */
export function collectChangedFiles(states: ApplyState[]): ChangedFile[] {
  const byFile = new Map<string, ChangedFile>();
  for (const state of states) {
    if (!state.filepath) continue;
    const phase: ChangedFile["state"] = state.rejected
      ? "rejected"
      : state.status === "done"
        ? "review"
        : state.status === "closed"
          ? "accepted"
          : "applying";
    // Re-insert so the map keeps the most recently changed file last.
    byFile.delete(state.filepath);
    byFile.set(state.filepath, {
      streamId: state.streamId,
      filepath: state.filepath,
      name: baseName(state.filepath),
      state: phase,
    });
  }
  return [...byFile.values()].slice(-MAX_SHOWN);
}

const LABEL: Record<ChangedFile["state"], string> = {
  applying: "applying…",
  review: "waiting for review",
  accepted: "accepted",
  rejected: "rejected",
};

/** "N files changed" strip above the input, with per-file review actions. */
export function ChangesStrip() {
  const ideMessenger = useContext(IdeMessengerContext);
  const states = useAppSelector(
    (state) => state.session.codeBlockApplyStates.states,
  );
  const files = useMemo(() => collectChangedFiles(states), [states]);
  const [open, setOpen] = useState(true);
  if (files.length === 0) return null;

  const pending = files.filter((file) => file.state === "review");
  const act = (kind: "acceptDiff" | "rejectDiff", file: ChangedFile) =>
    ideMessenger.post(kind, {
      streamId: file.streamId,
      filepath: file.filepath,
    });

  return (
    <div
      data-testid="changes-strip"
      className="border-border bg-input mx-2 mb-1 rounded-md border border-solid text-xs"
    >
      <div className="text-description flex items-center gap-1.5 px-2 py-1">
        <button
          type="button"
          className="text-description flex flex-1 cursor-pointer items-center gap-1.5 border-none bg-transparent p-0 text-left"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
        >
          <DocumentTextIcon className="h-3 w-3" />
          <span>
            {files.length} {files.length === 1 ? "file" : "files"} changed
            {pending.length ? ` · ${pending.length} to review` : ""}
          </span>
          <ChevronDownIcon
            className={`h-3 w-3 transition-transform ${open ? "" : "-rotate-90"}`}
          />
        </button>
        {pending.length > 1 && (
          <>
            <button
              type="button"
              data-testid="accept-all-changes"
              className="text-foreground cursor-pointer border-none bg-transparent p-0 text-[10px] underline"
              onClick={() => pending.forEach((file) => act("acceptDiff", file))}
            >
              Accept all
            </button>
            <button
              type="button"
              data-testid="reject-all-changes"
              className="text-description cursor-pointer border-none bg-transparent p-0 text-[10px] underline"
              onClick={() => pending.forEach((file) => act("rejectDiff", file))}
            >
              Reject all
            </button>
          </>
        )}
      </div>
      {open && (
        <ul className="m-0 max-h-36 list-none space-y-0.5 overflow-y-auto px-2 pb-1.5">
          {files.map((file) => (
            <li
              key={file.filepath}
              className="text-foreground flex items-center gap-1.5"
            >
              <button
                type="button"
                className="text-foreground min-w-0 flex-1 cursor-pointer truncate border-none bg-transparent p-0 text-left text-xs hover:underline"
                title={file.filepath}
                onClick={() =>
                  ideMessenger.post("showFile", { filepath: file.filepath })
                }
              >
                {file.name}
              </button>
              <span className="text-description-muted flex-shrink-0">
                {LABEL[file.state]}
              </span>
              {file.state === "review" && (
                <>
                  <button
                    type="button"
                    aria-label={`Accept changes to ${file.name}`}
                    className="cursor-pointer border-none bg-transparent p-0"
                    onClick={() => act("acceptDiff", file)}
                  >
                    <CheckIcon className="text-success h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    aria-label={`Reject changes to ${file.name}`}
                    className="cursor-pointer border-none bg-transparent p-0"
                    onClick={() => act("rejectDiff", file)}
                  >
                    <XMarkIcon className="text-error h-3 w-3" />
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
