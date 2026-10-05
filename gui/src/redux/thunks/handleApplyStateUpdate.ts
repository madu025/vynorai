import { createAsyncThunk } from "@reduxjs/toolkit";
import { ApplyState, ApplyToFilePayload } from "core";
import { EDIT_MODE_STREAM_ID } from "core/edit/constants";
import { logAgentModeEditOutcome } from "../../util/editOutcomeLogger";
import {
  selectApplyStateByToolCallId,
  selectToolCallById,
} from "../selectors/selectToolCalls";
import { updateEditStateApplyState } from "../slices/editState";
import {
  acceptToolCall,
  errorToolCall,
  updateApplyState,
  updateToolCallOutput,
} from "../slices/sessionSlice";
import { ThunkApiType } from "../store";
import { findToolCallById, logToolUsage } from "../util";
import { runHooks } from "../util/hooks";
import { exitEdit } from "./edit";
import { streamResponseAfterToolCall } from "./streamResponseAfterToolCall";

export const handleApplyStateUpdate = createAsyncThunk<
  void,
  ApplyState,
  ThunkApiType
>(
  "apply/handleStateUpdate",
  async (applyState, { dispatch, getState, extra }) => {
    if (applyState.streamId === EDIT_MODE_STREAM_ID) {
      dispatch(updateEditStateApplyState(applyState));

      if (applyState.status === "closed") {
        const toolCallState = findToolCallById(
          getState().session.history,
          applyState.toolCallId!,
        );
        if (toolCallState) {
          logToolUsage(toolCallState, true, true, extra.ideMessenger);
        }
        void dispatch(exitEdit({}));
      }
    } else {
      // chat or agent
      dispatch(updateApplyState(applyState));

      // Handle apply status updates - use toolCallId from event payload
      if (applyState.toolCallId) {
        const toolCallState = findToolCallById(
          getState().session.history,
          applyState.toolCallId,
        );

        if (
          applyState.status === "done" &&
          toolCallState?.toolCall.function.name &&
          getState().ui.toolSettings[toolCallState.toolCall.function.name] ===
            "allowedWithoutPermission"
        ) {
          extra.ideMessenger.post("acceptDiff", {
            streamId: applyState.streamId,
            filepath: applyState.filepath,
          });
        }

        if (applyState.status === "closed") {
          if (toolCallState) {
            const accepted = toolCallState.status !== "canceled";
            // Rejected in the editor (all at once, or block by block until
            // nothing changed): the file is as it was, so this is no success.
            const stored = getState().session.codeBlockApplyStates.states.find(
              (s) => s.streamId === applyState.streamId,
            );
            // PostToolUse hook feedback is recorded before the apply closes.
            const hookFeedback = (toolCallState.output ?? []).filter(
              (item) => item.name === "Hook feedback",
            );
            const rejectedInEditor =
              applyState.rejected === true ||
              (applyState.fileContent !== undefined &&
                stored?.originalFileContent !== undefined &&
                applyState.fileContent === stored.originalFileContent);

            logToolUsage(toolCallState, accepted, true, extra.ideMessenger);

            // Log edit outcome for Agent Mode
            const newApplyState =
              getState().session.codeBlockApplyStates.states.find(
                (s) => s.streamId === applyState.streamId,
              );
            const newState = getState();
            if (newApplyState) {
              void logAgentModeEditOutcome(
                newState.session.history,
                newState.config.config,
                toolCallState,
                newApplyState,
                accepted,
                extra.ideMessenger,
              );
            }

            if (accepted && rejectedInEditor) {
              dispatch(errorToolCall({ toolCallId: applyState.toolCallId }));
              dispatch(
                updateToolCallOutput({
                  toolCallId: applyState.toolCallId,
                  contextItems: [
                    {
                      icon: "problems",
                      name: "Edit Rejected",
                      description: "The user rejected this edit",
                      content: `The user rejected this edit to ${applyState.filepath} in the editor; the file is unchanged. Do not retry the same edit. Ask the user what they want instead.`,
                      hidden: false,
                    },
                    ...hookFeedback,
                  ],
                }),
              );
              void dispatch(
                streamResponseAfterToolCall({
                  toolCallId: applyState.toolCallId,
                }),
              );
            } else if (accepted) {
              if (toolCallState.status !== "errored") {
                // The edit is now on disk: run its PostToolUse hook here.
                const postHook = await runHooks(extra.ideMessenger, {
                  event: "PostToolUse",
                  sessionId: getState().session.id,
                  toolName: toolCallState.toolCall.function.name,
                  toolInput: {
                    ...(toolCallState.parsedArgs ?? {}),
                    ...(toolCallState.processedArgs ?? {}),
                  },
                  toolOutput: `Successfully edited ${applyState.filepath}`,
                });
                if (postHook.blocked) {
                  hookFeedback.push({
                    icon: "problems",
                    name: "Hook feedback",
                    description: "PostToolUse hook",
                    content: `A PostToolUse hook reported: ${postHook.reason}`,
                    hidden: false,
                  });
                }
                dispatch(
                  acceptToolCall({
                    toolCallId: applyState.toolCallId,
                  }),
                );

                // Add autoformatting diff to tool output if present
                if (applyState.autoFormattingDiff) {
                  dispatch(
                    updateToolCallOutput({
                      toolCallId: applyState.toolCallId,
                      contextItems: [
                        {
                          icon: "info",
                          name: "Auto-formatting Applied",
                          description: "Editor auto-formatting changes",
                          content: `Along with your edits, the editor applied the following auto-formatting:\n\n${applyState.autoFormattingDiff}\n\n(Note: Pay close attention to changes such as single quotes being converted to double quotes, semicolons being removed or added, long lines being broken into multiple lines, adjusting indentation style, adding/removing trailing commas, etc. This will help you ensure future SEARCH/REPLACE operations to this file are accurate.)`,
                          hidden: false,
                        },
                        ...hookFeedback,
                      ],
                    }),
                  );
                } else {
                  dispatch(
                    updateToolCallOutput({
                      toolCallId: applyState.toolCallId,
                      contextItems: [
                        {
                          name: "Edit Success",
                          content: `Successfully edited ${applyState.filepath}`,
                          description: "",
                          hidden: true,
                        },
                        ...hookFeedback,
                      ],
                    }),
                  );
                }
              } else {
                dispatch(
                  updateToolCallOutput({
                    toolCallId: applyState.toolCallId,
                    contextItems: [
                      {
                        name: "Edit Failed",
                        content: `Failed to edit ${applyState.filepath}. To continue working with the file, read it again to see the most up-to-date contents`,
                        description: "",
                        hidden: true,
                      },
                      ...hookFeedback,
                    ],
                  }),
                );
              }

              void dispatch(
                streamResponseAfterToolCall({
                  toolCallId: applyState.toolCallId,
                }),
              );
            }
          }
        }
      }
    }
  },
);

export const applyForEditTool = createAsyncThunk<
  void,
  ApplyToFilePayload & { toolCallId: string },
  ThunkApiType
>("apply/editTool", async (payload, { dispatch, getState, extra }) => {
  const { toolCallId, streamId } = payload;
  dispatch(
    updateApplyState({
      streamId,
      toolCallId,
      status: "not-started",
    }),
  );

  let didError = false;
  try {
    const response = await extra.ideMessenger.request("applyToFile", payload);
    if (response.status === "error") {
      didError = true;
    }
  } catch (e) {
    didError = true;
  }
  if (didError) {
    const state = getState();

    const toolCallState = selectToolCallById(state, toolCallId);
    const applyState = selectApplyStateByToolCallId(state, toolCallId);
    if (
      toolCallState &&
      applyState &&
      applyState.status !== "closed" &&
      toolCallState.status === "calling"
    ) {
      dispatch(
        errorToolCall({
          toolCallId,
        }),
      );
      dispatch(
        updateToolCallOutput({
          toolCallId,
          contextItems: [
            {
              icon: "problems",
              name: "Apply Error",
              description: "Failed to apply changes",
              content: `Error editing file: failed to apply changes to file.\n\nPlease try again with correct args or notify the user and request further instructions.`,
              hidden: false,
            },
          ],
        }),
      );
      void dispatch(
        handleApplyStateUpdate({
          status: "closed",
          streamId: applyState.streamId,
          toolCallId,
        }),
      );
    }
  }
});
