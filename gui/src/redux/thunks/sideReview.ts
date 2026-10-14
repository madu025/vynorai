import { createAsyncThunk } from "@reduxjs/toolkit";

import { selectSelectedChatModel } from "../slices/configSlice";
import { setSideReview } from "../slices/sessionSlice";
import { ThunkApiType } from "../store";
import { reviewerModel } from "../util/judgment";
import { resolveRelativePathInDir } from "core/util/ideUtils";
import {
  SIDE_REVIEW_MAX_DIFF_CHARS,
  diffForFiles,
  editsDiff,
  filesMissingFromDiff,
  turnChanges,
  newFileDiff,
  parseSideReviewResult,
  sideReviewPrompt,
  turnEdits,
  requiresIndependentSideReview,
} from "../util/sideReview";
import { currentTaskScope } from "../util/taskScope";

/**
 * Background "You should know" review of the files an agent turn changed.
 * Runs before the task completion receipt. Ordinary turns skip it; complex or
 * high-risk turns receive a review evidence receipt that the core contract can
 * require before completion.
 */
export const runSideReview = createAsyncThunk<
  void,
  { messageId: string; taskId?: string },
  ThunkApiType
>(
  "session/sideReview",
  async ({ messageId, taskId }, { dispatch, extra, getState }) => {
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
    if (
      !requiresIndependentSideReview(
        files,
        currentTaskScope(state.session.history),
      )
    )
      return;

    dispatch(setSideReview({ messageId, note: { status: "running" } }));
    try {
      const diffs = await extra.ideMessenger.request("getDiff", {
        includeUnstaged: true,
      });
      let diff =
        diffs.status === "success" ? diffForFiles(diffs.content, files) : "";
      // New files are untracked, so git diff does not show them: read them.
      const changes = turnChanges(state.session.history);
      for (const file of filesMissingFromDiff(diff, files).slice(0, 5)) {
        const change = changes.get(file);
        if (change && !change.created && change.edits.length) {
          // Edited but untracked: review only what this turn replaced.
          diff += `\n${editsDiff(file, change.edits)}`;
          continue;
        }
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
        await recordReviewEvidence(
          extra,
          taskId,
          "blocked",
          "Independent review could not inspect a non-empty diff.",
        );
        return;
      }
      const result = await extra.ideMessenger.request("llm/complete", {
        title: model.title,
        prompt: sideReviewPrompt(request, diff),
        // A review must inspect the current diff, never a cached answer or the
        // deterministic mutation engine's canned workflow.
        completionOptions: {
          maxTokens: 300,
          temperature: 0,
          reasoning: false,
          cachePolicy: "bypass",
        },
      });
      const parsed =
        result.status === "success"
          ? parseSideReviewResult(result.content)
          : undefined;
      const text =
        parsed?.reliable && (parsed.blocking.length || parsed.warnings.length)
          ? [...parsed.blocking, ...parsed.warnings].join("\n")
          : null;
      dispatch(setSideReview({ messageId, note: { status: "done", text } }));
      await recordReviewEvidence(
        extra,
        taskId,
        result.status !== "success" || !parsed?.reliable
          ? "blocked"
          : parsed.blocking.length
            ? "failed"
            : "passed",
        result.status !== "success"
          ? "Independent review did not return a reliable result."
          : !parsed?.reliable
            ? "Independent review returned an unstructured result."
            : parsed.blocking.length
              ? `Independent review found blocking issues: ${parsed.blocking.join(" ")}`
              : parsed.warnings.length
                ? `Independent review found non-blocking warnings: ${parsed.warnings.join(" ")}`
                : "Independent review found no blocking issue in the changed surface.",
      );
    } catch {
      dispatch(
        setSideReview({ messageId, note: { status: "done", text: null } }),
      );
      await recordReviewEvidence(
        extra,
        taskId,
        "blocked",
        "Independent review failed before producing a reliable receipt.",
      );
    }
  },
);

async function recordReviewEvidence(
  extra: ThunkApiType["extra"],
  taskId: string | undefined,
  status: "passed" | "failed" | "blocked",
  summary: string,
): Promise<void> {
  if (!taskId) return;
  try {
    const task = await extra.ideMessenger.request("agent/task/get", { taskId });
    if (task.status !== "success" || !task.content?.contract) return;
    const criterion = task.content.contract.criteria.find((item) =>
      item.evidencePolicy.includes("independent_review"),
    );
    if (!criterion) return;
    await extra.ideMessenger.request("agent/task/recordVerification", {
      taskId,
      result: {
        kind: "review",
        status: status === "blocked" ? "skipped" : status,
        summary,
      },
    });
    await extra.ideMessenger.request("agent/task/recordEvidence", {
      taskId,
      evidence: {
        criterionId: criterion.id,
        kind: "review",
        status,
        summary,
      },
    });
  } catch {
    // Completion remains blocked because the core has no persisted receipt.
  }
}
