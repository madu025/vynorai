import { createAsyncThunk } from "@reduxjs/toolkit";
import {
  abortStream,
  clearDanglingMessages,
  setActiveTaskState,
  setInactive,
} from "../slices/sessionSlice";
import { ThunkApiType } from "../store";

export const cancelStream = createAsyncThunk<void, undefined, ThunkApiType>(
  "chat/cancelStream",
  async (messages, { dispatch, extra, getState }) => {
    const activeTaskId = getState().session.activeTaskId;
    if (activeTaskId) {
      try {
        const result = await extra.ideMessenger.request(
          "agent/task/transition",
          {
            taskId: activeTaskId,
            state: "canceled",
            reason: "Stream canceled",
          },
        );
        if (result.status === "success") {
          dispatch(setActiveTaskState(result.content.state));
        }
      } catch {
        // Canceling the stream must not depend on local audit persistence.
      }
    }
    dispatch(setInactive());
    dispatch(abortStream());

    // Clear any dangling incomplete tool calls, thinking messages, etc.
    dispatch(clearDanglingMessages());
  },
);
