import { createAsyncThunk } from "@reduxjs/toolkit";

import { selectSelectedChatModel } from "../slices/configSlice";
import { setSideReview } from "../slices/sessionSlice";
import { ThunkApiType } from "../store";
import { reviewerModel } from "../util/judgment";
import { resolveRelativePathInDir } from "core/util/ideUtils";
import {
  SIDE_REVIEW_MAX_DIFF_CHARS,
  diffForFiles,
  filesMissingFromDiff,
  newFileDiff,
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
    const selected = selectSelectedChatModel(state);
    if (!selected) return;
    const model = reviewerModel(
      selected,
      state.config.config?.modelsByRole?.chat ?? [],
      state.ui.judgmentLevel,
    );
    const { files, request } = turnEdits(state.session.history);
    if (files.length === 0) return;

    dispatch(setSideReview({ messageId, note: { status: "running" } }));
    try {
      const diffs = await extra.ideMessenger.request("getDiff", {
        includeUnstaged: true,
      });
      let diff =
        diffs.status === "success" ? diffForFiles(diffs.content, files) : "";
      // New files are untracked, so git diff does not show them: read them.
      for (const file of filesMissingFromDiff(diff, files).slice(0, 5)) {
        try {
          const uri = await resolveRelativePathInDir(
            file,
            extra.ideMessenger.ide,
          );
          const contents = await extra.ideMessenger.ide.readFile(uri ?? file);
          diff += `\n${newFileDiff(file, contents)}`;
        } catch {
          // Unreadable: the reviewer just doesn't see this file.
        }
      }
      diff = diff.trim().slice(0, SIDE_REVIEW_MAX_DIFF_CHARS);
      if (!diff) {
        dispatch(
          setSideReview({ messageId, note: { status: "done", text: null } }),
        );
        return;
      }
      const result = await extra.ideMessenger.request("llm/complete", {
        title: model.title,
        prompt: sideReviewPrompt(request, diff),
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
