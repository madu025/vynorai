import { createAsyncThunk } from "@reduxjs/toolkit";
import { JSONContent } from "@tiptap/core";
import { PanelCommand } from "../../util/panelCommands";
import { setCompactionLoading, setMode } from "../slices/sessionSlice";
import { ThunkApiType } from "../store";
import { loadSession, saveCurrentSession } from "./session";
import { streamResponseThunk } from "./streamResponse";

function textDocument(text: string): JSONContent {
  return {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  };
}

/**
 * Runs `/clear`, `/compact [focus]` and `/plan [task]` in the panel. Nothing is
 * sent to the model except the optional task after `/plan`.
 */
export const runPanelCommand = createAsyncThunk<
  void,
  {
    command: PanelCommand;
    modifiers: Parameters<typeof streamResponseThunk>[0]["modifiers"];
  },
  ThunkApiType
>(
  "chat/runPanelCommand",
  async ({ command, modifiers }, { dispatch, extra, getState }) => {
    switch (command.name) {
      case "clear": {
        // Same as the New Session button: the old chat stays in History.
        await dispatch(
          saveCurrentSession({ openNewSession: true, generateTitle: true }),
        );
        return;
      }
      case "plan": {
        dispatch(setMode("plan"));
        if (command.arg) {
          await dispatch(
            streamResponseThunk({
              editorState: textDocument(command.arg),
              modifiers,
            }),
          );
        }
        return;
      }
      case "compact": {
        const { session } = getState();
        const index = session.history.length - 1;
        if (!session.id || index < 0) return;
        try {
          dispatch(setCompactionLoading({ index, loading: true }));
          await extra.ideMessenger.request("conversation/compact", {
            index,
            sessionId: session.id,
            instructions: command.arg || undefined,
          });
          await dispatch(
            loadSession({ sessionId: session.id, saveCurrentSession: false }),
          );
        } finally {
          dispatch(setCompactionLoading({ index, loading: false }));
        }
        return;
      }
    }
  },
);
