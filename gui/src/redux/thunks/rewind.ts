import { createAsyncThunk } from "@reduxjs/toolkit";
import { ChatHistoryItem } from "core";
import { renderChatMessage } from "core/util/messageContent";
import {
  rewindHistoryToIndex,
  setMainEditorContentTrigger,
} from "../slices/sessionSlice";
import { ThunkApiType } from "../store";
import { saveCurrentSession } from "./session";

export interface RewindResult {
  rewound: boolean;
  restoredFiles: number;
  reason?: string;
}

/** Tasks started by the prompt at `index` and every prompt after it, oldest first. */
export function taskIdsFrom(
  history: ChatHistoryItem[],
  index: number,
): string[] {
  const ids: string[] = [];
  for (const item of history.slice(index)) {
    if (
      item.message.role === "user" &&
      item.taskId &&
      !ids.includes(item.taskId)
    ) {
      ids.push(item.taskId);
    }
  }
  return ids;
}

/**
 * "Rewind to here": undo the files changed by this prompt and every later
 * prompt, drop those turns from the conversation, and put the prompt back in
 * the input box so it can be edited and resent.
 */
export const rewindToUserMessage = createAsyncThunk<
  RewindResult,
  { index: number },
  ThunkApiType
>(
  "session/rewindToUserMessage",
  async ({ index }, { dispatch, extra, getState }) => {
    const { history, isStreaming } = getState().session;
    const target = history[index];
    if (isStreaming) {
      return {
        rewound: false,
        restoredFiles: 0,
        reason: "Stop the current response first.",
      };
    }
    if (!target || target.message.role !== "user") {
      return {
        rewound: false,
        restoredFiles: 0,
        reason: "Only a prompt can be rewound.",
      };
    }

    let restoredFiles = 0;
    const taskIds = taskIdsFrom(history, index);
    if (taskIds.length) {
      const result = await extra.ideMessenger.request(
        "checkpoints/restoreTasks",
        { taskIds },
      );
      if (result.status === "error") {
        return { rewound: false, restoredFiles: 0, reason: result.error };
      }
      const { restored, reason } = result.content;
      restoredFiles = result.content.restoredFiles;
      // "No checkpoints" just means those prompts changed no files.
      const nothingToRestore =
        !restored &&
        restoredFiles === 0 &&
        reason?.startsWith("No checkpoints");
      if (!restored && !nothingToRestore) {
        // The user declined to overwrite newer changes, or VS Code refused an edit.
        return { rewound: false, restoredFiles, reason };
      }
      if (restoredFiles > 0) {
        // Refreshes the workspace snapshot; the files are already restored, so
        // a failure here must not undo the rewind.
        try {
          await extra.ideMessenger.request("workspace/invalidate", {
            reason: "Rewound to an earlier prompt",
          });
        } catch {}
      }
    }

    dispatch(rewindHistoryToIndex(index));
    dispatch(
      setMainEditorContentTrigger(
        target.editorState ?? {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [
                { type: "text", text: renderChatMessage(target.message) },
              ],
            },
          ],
        },
      ),
    );
    await dispatch(
      saveCurrentSession({ openNewSession: false, generateTitle: false }),
    );
    return { rewound: true, restoredFiles };
  },
);
