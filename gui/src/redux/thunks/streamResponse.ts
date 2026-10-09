import { createAsyncThunk, unwrapResult } from "@reduxjs/toolkit";
import { JSONContent } from "@tiptap/core";
import { InputModifiers } from "core";

import { v4 as uuidv4 } from "uuid";
import { resolveEditorContent } from "../../components/mainInput/TipTapEditor/utils/resolveEditorContent";
import { diagnoseAgentRun } from "../../util/agentRunDiagnostics";
import { selectSelectedChatModel } from "../slices/configSlice";
import {
  resetNextCodeBlockToApplyIndex,
  submitEditorAndInitAtIndex,
  updateHistoryItemAtIndex,
} from "../slices/sessionSlice";
import { RootState, ThunkApiType } from "../store";
import { ensureTokenizerLoaded } from "../../util/tokenCount";
import { streamNormalInput } from "./streamNormalInput";
import { streamThunkWrapper } from "./streamThunkWrapper";
import { updateFileSymbolsFromFiles } from "./updateFileSymbols";

function newDiagnosticId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now()}-${Math.random().toString(16).slice(2)}`
  );
}

function summarizeTools(history: RootState["session"]["history"]) {
  const statusCounts: Record<string, number> = {};
  const nameCounts: Record<string, number> = {};
  for (const item of history) {
    for (const state of item.toolCallStates ?? []) {
      statusCounts[state.status] = (statusCounts[state.status] ?? 0) + 1;
      const name = state.toolCall.function?.name ?? "unknown";
      nameCounts[name] = (nameCounts[name] ?? 0) + 1;
    }
  }
  return { statusCounts, nameCounts };
}

export const streamResponseThunk = createAsyncThunk<
  void,
  {
    editorState: JSONContent;
    modifiers: InputModifiers;
    index?: number;
    resumeTaskId?: string;
  },
  ThunkApiType
>(
  "chat/streamResponse",
  async (
    { editorState, modifiers, index, resumeTaskId },
    { dispatch, extra, getState },
  ) => {
    const startedAt = Date.now();
    const runId = newDiagnosticId();
    const initialState = getState();
    const initialModel = selectSelectedChatModel(initialState);
    const inputIndex = index ?? initialState.session.history.length;
    const initialWorkspace = initialState.workspace.snapshot;
    extra.ideMessenger.post("diagnostics/record", {
      report: JSON.stringify({
        schemaVersion: 1,
        id: `${runId}:start`,
        recordedAt: new Date(startedAt).toISOString(),
        category: "agent-lifecycle",
        phase: "started",
        model: {
          title: initialModel?.title,
          provider: initialModel?.underlyingProviderName,
        },
        session: {
          id: initialState.session.id,
          mode: initialState.session.mode,
          historyLength: initialState.session.history.length,
        },
        workspace: initialWorkspace
          ? {
              connected: (initialWorkspace.roots ?? []).length > 0,
              rootCount: (initialWorkspace.roots ?? []).length,
              trusted: initialWorkspace.trusted,
              revision: initialWorkspace.revision,
            }
          : undefined,
        privacy:
          "No prompt, file content, absolute path, or credential is included.",
      }),
    });

    const wrapperResult = await dispatch(
      streamThunkWrapper(async () => {
        // Context budgets are counted with the exact tokenizer, so wait for it.
        await ensureTokenizerLoaded();
        const state = getState();
        const selectedChatModel = selectSelectedChatModel(state);
        const inputIndex = index ?? state.session.history.length; // Either given index or concat to end

        if (!selectedChatModel) {
          throw new Error("No chat model selected");
        }
        dispatch(
          submitEditorAndInitAtIndex({ index: inputIndex, editorState }),
        );

        dispatch(resetNextCodeBlockToApplyIndex());

        const defaultContextProviders =
          state.config.config.experimental?.defaultContext ?? [];

        // Resolve context providers and construct new history
        const {
          selectedContextItems,
          selectedCode,
          content,
          legacyCommandWithInput,
        } = await resolveEditorContent({
          editorState,
          modifiers,
          ideMessenger: extra.ideMessenger,
          defaultContextProviders,
          availableSlashCommands: state.config.config.slashCommands,
          dispatch,
          getState,
        });

        // symbols for both context items AND selected codeblocks
        const filesForSymbols = [
          ...selectedContextItems
            .filter((item) => item.uri?.type === "file" && item?.uri?.value)
            .map((item) => item.uri!.value),
          ...selectedCode.map((rif) => rif.filepath),
        ];
        void dispatch(updateFileSymbolsFromFiles(filesForSymbols));

        dispatch(
          updateHistoryItemAtIndex({
            index: inputIndex,
            updates: {
              message: {
                role: "user",
                content,
                id: uuidv4(),
              },
              contextItems: selectedContextItems,
            },
          }),
        );

        unwrapResult(
          await dispatch(
            streamNormalInput({
              ...(resumeTaskId !== undefined ? { resumeTaskId } : {}),
              legacySlashCommandData: legacyCommandWithInput
                ? {
                    command: legacyCommandWithInput.command,
                    contextItems: selectedContextItems,
                    historyIndex: inputIndex,
                    input: legacyCommandWithInput.input,
                    selectedCode,
                  }
                : undefined,
            }),
          ),
        );
      }),
    );

    const finalState = getState();
    const turnHistory = finalState.session.history.slice(inputIndex);
    const tools = summarizeTools(turnHistory);
    const qualitySignals = diagnoseAgentRun(
      tools.nameCounts,
      finalState.session.turnCredits?.used,
      finalState.ui.taskCreditCap,
    );
    const outcome =
      !initialState.ui.showDialog && finalState.ui.showDialog
        ? "failed"
        : streamThunkWrapper.rejected.match(wrapperResult)
          ? "failed"
          : "completed";
    extra.ideMessenger.post("diagnostics/record", {
      report: JSON.stringify({
        schemaVersion: 1,
        id: `${runId}:finish`,
        recordedAt: new Date().toISOString(),
        category: "agent-lifecycle",
        phase: "finished",
        outcome,
        durationMs: Date.now() - startedAt,
        model: {
          title: initialModel?.title,
          provider: initialModel?.underlyingProviderName,
        },
        session: {
          id: finalState.session.id,
          mode: finalState.session.mode,
          historyLength: finalState.session.history.length,
        },
        toolStatusCounts: tools.statusCounts,
        toolNameCounts: tools.nameCounts,
        creditsUsed: finalState.session.turnCredits?.used,
        taskCreditCap: finalState.ui.taskCreditCap,
        qualitySignals,
        pauseReason: finalState.session.toolBudgetPauseReason,
        analysis:
          outcome === "failed"
            ? {
                likelyCause:
                  "The agent run ended in the model-response error path.",
                recovery:
                  "Inspect the paired model-response diagnostic before retrying.",
              }
            : {
                likelyCause: "No runtime failure was recorded for this run.",
                recovery: "No recovery action is required.",
              },
        privacy:
          "No prompt, file content, absolute path, or credential is included.",
      }),
    });
  },
);
