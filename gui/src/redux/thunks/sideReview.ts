import { createAsyncThunk } from "@reduxjs/toolkit";

import { selectSelectedChatModel } from "../slices/configSlice";
import { setSideReview } from "../slices/sessionSlice";
import { ThunkApiType } from "../store";
import {
  diffForFiles,
  parseSideReview,
  sideReviewPrompt,
  turnEdits,
} from "../util/sideReview";

/**
 * Background "You should know" review of the files an agent turn changed.
 * Runs after the turn, never blocks it, and fails silently: it is a hint.
 */
export const runSideReview = createAsyncThunk<
  void,
  { messageId: string },
  ThunkApiType
>(
  "session/sideReview",
  async ({ messageId }, { dispatch, extra, getState }) => {
    const state = getState();
    if (state.ui.sideReviewEnabled === false) return;
    const model = selectSelectedChatModel(state);
    if (!model) return;
    const { files, request } = turnEdits(state.session.history);
    if (files.length === 0) return;

    dispatch(setSideReview({ messageId, note: { status: "running" } }));
    try {
      const diffs = await extra.ideMessenger.request("getDiff", {
        includeUnstaged: true,
      });
      if (diffs.status !== "success" || diffs.content.length === 0) {
        dispatch(
          setSideReview({ messageId, note: { status: "done", text: null } }),
        );
        return;
      }
      const result = await extra.ideMessenger.request("llm/complete", {
        title: model.title,
        prompt: sideReviewPrompt(request, diffForFiles(diffs.content, files)),
        completionOptions: { maxTokens: 300, temperature: 0, reasoning: false },
      });
      const text =
        result.status === "success" ? parseSideReview(result.content) : null;
      dispatch(setSideReview({ messageId, note: { status: "done", text } }));
    } catch {
      dispatch(
        setSideReview({ messageId, note: { status: "done", text: null } }),
      );
    }
  },
);
