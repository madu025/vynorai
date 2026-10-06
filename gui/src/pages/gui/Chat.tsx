import {
  ArrowLeftIcon,
  ChatBubbleOvalLeftIcon,
} from "@heroicons/react/24/outline";
import { Editor, JSONContent } from "@tiptap/react";
import { ChatHistoryItem, InputModifiers } from "core";
import { renderChatMessage } from "core/util/messageContent";
import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ErrorBoundary } from "react-error-boundary";
import styled from "styled-components";
import { Button, lightGray, vscBackground } from "../../components";
import { useFindWidget } from "../../components/find/FindWidget";
import TimelineItem from "../../components/gui/TimelineItem";
import { NewSessionButton } from "../../components/mainInput/belowMainInput/NewSessionButton";
import ThinkingBlockPeek from "../../components/mainInput/belowMainInput/ThinkingBlockPeek";
import { TurnStatusLine } from "../../components/StepContainer/TurnStatusLine";
import { useAutoCompaction } from "../../util/autoCompaction";
import { RewindButton } from "../../components/StepContainer/RewindButton";
import { ContinueTaskBanner } from "../../components/StepContainer/ContinueTaskBanner";
import { TodoListPanel } from "../../components/StepContainer/TodoListPanel";
import { estimateTokens } from "../../components/StepContainer/turnStatus";
import {
  createRuntimeDiagnostic,
  saveRuntimeDiagnostic,
} from "../../util/runtimeDiagnostics";
import ContinueInputBox from "../../components/mainInput/ContinueInputBox";
import StepContainer from "../../components/StepContainer";
import { TabBar } from "../../components/TabBar/TabBar";
import { IdeMessengerContext } from "../../context/IdeMessenger";
import { useWebviewListener } from "../../hooks/useWebviewListener";
import { useAppDispatch, useAppSelector } from "../../redux/hooks";
import {
  selectDoneApplyStates,
  selectPendingToolCalls,
} from "../../redux/selectors/selectToolCalls";
import {
  cancelToolCall,
  ChatHistoryItemWithMessageId,
  enqueueInput,
  newSession,
  QueuedInput,
  removeQueuedInput,
  updateToolCallOutput,
} from "../../redux/slices/sessionSlice";
import { streamEditThunk } from "../../redux/thunks/edit";
import { loadLastSession } from "../../redux/thunks/session";
import { streamResponseThunk } from "../../redux/thunks/streamResponse";
import { isJetBrains, isMetaEquivalentKeyPressed } from "../../util";
import { ToolCallDiv } from "./ToolCallDiv";

import { useStore } from "react-redux";
import { FatalErrorIndicator } from "../../components/config/FatalErrorNotice";
import InlineErrorMessage from "../../components/mainInput/InlineErrorMessage";
import { resolveEditorContent } from "../../components/mainInput/TipTapEditor/utils/resolveEditorContent";
import { setDialogMessage, setShowDialog } from "../../redux/slices/uiSlice";
import { RootState } from "../../redux/store";
import { cancelStream } from "../../redux/thunks/cancelStream";
import { EmptyChatBody } from "./EmptyChatBody";
import { ExploreDialogWatcher } from "./ExploreDialogWatcher";
import { useAutoScroll } from "./useAutoScroll";
import { VynorQuotaBar } from "../../components/VynorQuotaBar";
import { ExpertTeamPanel } from "../../components/AgentWorkspace/ExpertTeamPanel";
import { WorkspaceStatus } from "../../components/WorkspaceStatus/WorkspaceStatus";
import { AgentControlCenter } from "../../components/AgentWorkspace/AgentControlCenter";
import { BackgroundModeView } from "../../components/BackgroundMode/BackgroundModeView";

// Helper function to find the index of the latest conversation summary
function findLatestSummaryIndex(history: ChatHistoryItem[]): number {
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].conversationSummary) {
      return i;
    }
  }
  return -1; // No summary found
}

const StepsDiv = styled.div`
  position: relative;
  background-color: transparent;

  & > * {
    position: relative;
  }

  .thread-message {
    margin: 0 0 0 1px;
  }
`;

export const MAIN_EDITOR_INPUT_ID = "main-editor-input";

function editorText(node: JSONContent): string {
  return [node.text, ...(node.content ?? []).map(editorText)]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function fallbackRender({ error, resetErrorBoundary }: any) {
  // Call resetErrorBoundary() to reset the error boundary and retry the render.

  return (
    <div
      role="alert"
      className="px-2"
      style={{ backgroundColor: vscBackground }}
    >
      <p>
        This message could not be rendered. Your session and task were kept.
      </p>
      <pre style={{ color: "red" }}>{error.message}</pre>
      <pre style={{ color: lightGray }}>{error.stack}</pre>

      <div className="text-center">
        <Button onClick={resetErrorBoundary}>Try again</Button>
      </div>
    </div>
  );
}

export function Chat() {
  const dispatch = useAppDispatch();
  const ideMessenger = useContext(IdeMessengerContext);
  const errorReportsEnabled = useAppSelector(
    (state) => state.ui.errorReportsEnabled === true,
  );
  const reduxStore = useStore<RootState>();
  const showSessionTabs = useAppSelector(
    (store) => store.config.config.ui?.showSessionTabs,
  );
  const isStreaming = useAppSelector((state) => state.session.isStreaming);
  const mode = useAppSelector((state) => state.session.mode);
  const sessionId = useAppSelector((state) => state.session.id);
  const [isCreatingBackground, setIsCreatingBackground] = useState(false);
  const [stepsOpen] = useState<(boolean | undefined)[]>([]);
  const mainTextInputRef = useRef<HTMLInputElement>(null);
  const stepsDivRef = useRef<HTMLDivElement>(null);
  const tabsRef = useRef<HTMLDivElement>(null);
  const history = useAppSelector((state) => state.session.history);
  const workspaceSnapshot = useAppSelector((state) => state.workspace.snapshot);
  useAutoCompaction();
  const queuedInputs = useAppSelector(
    (state) => state.session.queuedInputs ?? [],
  );
  const showChatScrollbar = useAppSelector(
    (state) => state.config.config.ui?.showChatScrollbar,
  );
  const codeToEdit = useAppSelector((state) => state.editModeState.codeToEdit);
  const isInEdit = useAppSelector((store) => store.session.isInEdit);

  const lastSessionId = useAppSelector((state) => state.session.lastSessionId);
  const hasDismissedExploreDialog = useAppSelector(
    (state) => state.ui.hasDismissedExploreDialog,
  );
  const jetbrains = useMemo(() => {
    return isJetBrains();
  }, []);

  useAutoScroll(stepsDivRef, history);

  useEffect(() => {
    // Cmd + Backspace to delete current step
    const listener = (e: KeyboardEvent) => {
      if (
        e.key === "Backspace" &&
        (jetbrains ? e.altKey : isMetaEquivalentKeyPressed(e)) &&
        !e.shiftKey
      ) {
        void dispatch(cancelStream());
      }
    };
    window.addEventListener("keydown", listener);

    return () => {
      window.removeEventListener("keydown", listener);
    };
  }, [isStreaming, jetbrains, isInEdit]);

  const { widget, highlights } = useFindWidget(
    stepsDivRef,
    tabsRef,
    isStreaming,
  );

  const sendInput = useCallback(
    (
      editorState: JSONContent,
      modifiers: InputModifiers,
      index?: number,
      editorToClearOnSend?: Editor,
    ) => {
      const stateSnapshot = reduxStore.getState();
      const latestPendingToolCalls = selectPendingToolCalls(stateSnapshot);
      const latestPendingApplyStates = selectDoneApplyStates(stateSnapshot);
      const isCurrentlyInEdit = stateSnapshot.session.isInEdit;
      const codeToEditSnapshot = stateSnapshot.editModeState.codeToEdit;
      const selectedModelByRole =
        stateSnapshot.config.config.selectedModelByRole;
      const currentMode = stateSnapshot.session.mode;

      if (currentMode === "background") {
        const prompt = editorText(editorState);
        if (!prompt || isCreatingBackground) return;
        setIsCreatingBackground(true);
        void ideMessenger
          .request("background/create", { prompt }, 180_000)
          .then((response) => {
            if (response.status === "error") throw new Error(response.error);
            editorToClearOnSend?.commands.clearContent();
          })
          .catch((error) => {
            dispatch(
              setDialogMessage(<div>{String(error.message || error)}</div>),
            );
            dispatch(setShowDialog(true));
          })
          .finally(() => setIsCreatingBackground(false));
        return;
      }

      // Cancel all pending tool calls
      latestPendingToolCalls.forEach((toolCallState) => {
        dispatch(
          cancelToolCall({
            toolCallId: toolCallState.toolCallId,
          }),
        );
      });

      // Reject all pending apply states
      latestPendingApplyStates.forEach((applyState) => {
        if (applyState.status !== "closed") {
          ideMessenger.post("rejectDiff", applyState);
        }
      });
      const model = isCurrentlyInEdit
        ? (selectedModelByRole.edit ?? selectedModelByRole.chat)
        : selectedModelByRole.chat;

      if (!model) {
        return;
      }

      if (isCurrentlyInEdit && codeToEditSnapshot.length === 0) {
        return;
      }

      if (isCurrentlyInEdit) {
        void dispatch(
          streamEditThunk({
            editorState,
            codeToEdit: codeToEditSnapshot,
          }),
        );
      } else {
        void dispatch(streamResponseThunk({ editorState, modifiers, index }));

        if (editorToClearOnSend) {
          editorToClearOnSend.commands.clearContent();
        }
      }
    },
    [dispatch, ideMessenger, isCreatingBackground, reduxStore],
  );

  const submitOrQueue = useCallback(
    (editorState: JSONContent, modifiers: InputModifiers, editor?: Editor) => {
      if (reduxStore.getState().session.isStreaming) {
        dispatch(
          enqueueInput({
            id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}`,
            editorState,
            modifiers,
            createdAt: Date.now(),
          }),
        );
        editor?.commands.clearContent();
        return;
      }
      sendInput(editorState, modifiers, undefined, editor);
    },
    [dispatch, reduxStore, sendInput],
  );

  const wasStreamingRef = useRef(false);
  const startingQueuedInputRef = useRef(false);
  useEffect(() => {
    if (isStreaming) {
      wasStreamingRef.current = true;
      startingQueuedInputRef.current = false;
      return;
    }
    if (
      !wasStreamingRef.current ||
      startingQueuedInputRef.current ||
      queuedInputs.length === 0
    ) {
      return;
    }

    const snapshot = reduxStore.getState();
    if (
      selectPendingToolCalls(snapshot).length > 0 ||
      selectDoneApplyStates(snapshot).some((item) => item.status !== "closed")
    ) {
      return;
    }

    const next = queuedInputs[0];
    startingQueuedInputRef.current = true;
    dispatch(removeQueuedInput(next.id));
    sendInput(next.editorState, next.modifiers);
  }, [dispatch, history, isStreaming, queuedInputs, reduxStore, sendInput]);

  const runQueuedNow = useCallback(
    async (input: QueuedInput) => {
      dispatch(removeQueuedInput(input.id));
      if (reduxStore.getState().session.isStreaming) {
        await dispatch(cancelStream());
      }
      sendInput(input.editorState, input.modifiers);
    },
    [dispatch, reduxStore, sendInput],
  );

  useWebviewListener(
    "newSession",
    async () => {
      // unwrapResult(response) // errors if session creation failed
      mainTextInputRef.current?.focus?.();
    },
    [mainTextInputRef],
  );

  // Handle partial tool call output for streaming updates
  useWebviewListener(
    "toolCallPartialOutput",
    async (data) => {
      // Update tool call output in Redux store
      dispatch(
        updateToolCallOutput({
          toolCallId: data.toolCallId,
          contextItems: data.contextItems,
        }),
      );
    },
    [dispatch],
  );

  const isLastUserInput = useCallback(
    (index: number): boolean => {
      return !history
        .slice(index + 1)
        .some((entry) => entry.message.role === "user");
    },
    [history],
  );

  const renderChatHistoryItem = useCallback(
    (item: ChatHistoryItemWithMessageId, index: number) => {
      const {
        message,
        editorState,
        contextItems,
        appliedRules,
        toolCallStates,
      } = item;

      // Calculate once for the entire function
      const latestSummaryIndex = findLatestSummaryIndex(history);
      const isBeforeLatestSummary =
        latestSummaryIndex !== -1 && index < latestSummaryIndex;

      if (message.role === "user" && item.isAutoPrompt) {
        return (
          <div
            className="text-description-muted px-3 py-1 text-[11px]"
            data-testid="auto-prompt"
            title={renderChatMessage(message)}
          >
            ↻ Checking the changes before finishing
          </div>
        );
      }

      if (message.role === "user") {
        return (
          <>
            <ContinueInputBox
              onEnter={(editorState, modifiers) =>
                sendInput(editorState, modifiers, index)
              }
              isLastUserInput={isLastUserInput(index)}
              isMainInput={false}
              editorState={editorState ?? item.message.content}
              contextItems={contextItems}
              appliedRules={appliedRules}
              inputId={message.id}
            />
            <RewindButton index={index} />
          </>
        );
      }

      if (message.role === "tool") {
        return null;
      }

      if (message.role === "assistant") {
        return (
          <>
            {/* Always render assistant content through normal path */}
            <div className="thread-message">
              <TimelineItem
                item={item}
                iconElement={
                  <ChatBubbleOvalLeftIcon width="16px" height="16px" />
                }
                open={
                  typeof stepsOpen[index] === "undefined"
                    ? true
                    : stepsOpen[index]!
                }
                onToggle={() => {}}
              >
                <StepContainer
                  index={index}
                  isLast={index === history.length - 1}
                  item={item}
                  latestSummaryIndex={latestSummaryIndex}
                />
              </TimelineItem>
            </div>

            {toolCallStates && (
              <ToolCallDiv
                toolCallStates={toolCallStates}
                historyIndex={index}
              />
            )}
          </>
        );
      }

      if (message.role === "thinking") {
        const thinkingContent = renderChatMessage(message);
        if (!thinkingContent?.trim()) {
          return null;
        }
        return (
          <div className={isBeforeLatestSummary ? "opacity-50" : ""}>
            <ThinkingBlockPeek
              content={thinkingContent}
              redactedThinking={message.redactedThinking}
              index={index}
              prevItem={index > 0 ? history[index - 1] : null}
              inProgress={index === history.length - 1 && isStreaming}
              signature={message.signature}
              tokens={estimateTokens(thinkingContent)}
            />
          </div>
        );
      }

      // Default case - regular assistant message
      return (
        <div className="thread-message">
          <TimelineItem
            item={item}
            iconElement={<ChatBubbleOvalLeftIcon width="16px" height="16px" />}
            open={
              typeof stepsOpen[index] === "undefined" ? true : stepsOpen[index]!
            }
            onToggle={() => {}}
          >
            <StepContainer
              index={index}
              isLast={index === history.length - 1}
              item={item}
              latestSummaryIndex={latestSummaryIndex}
            />
          </TimelineItem>
        </div>
      );
    },
    [sendInput, isLastUserInput, history, stepsOpen, isStreaming],
  );

  const showScrollbar = showChatScrollbar ?? window.innerHeight > 5000;

  return (
    <>
      {!!showSessionTabs && !isInEdit && <TabBar ref={tabsRef} />}
      {widget}

      <ExpertTeamPanel />

      <StepsDiv
        ref={stepsDivRef}
        data-testid="chat-steps"
        data-streaming={isStreaming ? "true" : "false"}
        className={`pt-[8px] ${showScrollbar ? "thin-scrollbar" : "no-scrollbar"} ${history.length > 0 ? "min-h-0 flex-1 overflow-y-scroll" : "shrink-0"}`}
      >
        {highlights}
        {mode === "background" ? (
          <BackgroundModeView isCreatingAgent={isCreatingBackground} />
        ) : (
          history
            .filter((item) => item.message.role !== "system")
            .map((item, index: number) => (
              <div
                key={item.message.id}
                style={{
                  minHeight: index === history.length - 1 ? "200px" : 0,
                }}
              >
                <ErrorBoundary
                  FallbackComponent={fallbackRender}
                  onError={(error) => {
                    const diagnostic = createRuntimeDiagnostic({
                      error,
                      sessionId,
                      mode,
                      historyLength: history.length,
                      workspace: workspaceSnapshot
                        ? {
                            connected:
                              (workspaceSnapshot.roots ?? []).length > 0,
                            rootCount: (workspaceSnapshot.roots ?? []).length,
                            trusted: workspaceSnapshot.trusted,
                            revision: workspaceSnapshot.revision,
                          }
                        : undefined,
                      toolStatusCounts: {},
                    });
                    saveRuntimeDiagnostic(diagnostic);
                    if (!errorReportsEnabled) return;
                    ideMessenger.post("vynor/errorReport", {
                      source: "gui",
                      message: diagnostic.error.message,
                      stack: diagnostic.error.stack,
                    });
                  }}
                >
                  {renderChatHistoryItem(item, index)}
                </ErrorBoundary>
                {index === history.length - 1 && <InlineErrorMessage />}
              </div>
            ))
        )}
      </StepsDiv>
      <div className={"relative shrink-0"}>
        <TurnStatusLine />
        <TodoListPanel />
        <ContinueTaskBanner
          onContinue={(editorState) =>
            submitOrQueue(editorState, { useCodebase: false, noContext: true })
          }
        />
        <AgentControlCenter />
        <WorkspaceStatus />
        {queuedInputs.length > 0 && (
          <div
            aria-label="Queued prompts"
            className="border-command-border bg-editor mx-2 mb-1 max-h-28 overflow-y-auto rounded-md border border-solid p-1.5"
          >
            <div className="text-description-muted mb-1 text-[10px]">
              Queue · {queuedInputs.length}/10 · runs in order
            </div>
            {queuedInputs.map((input, index) => (
              <div
                key={input.id}
                className="bg-lightgray/5 mb-1 flex min-w-0 items-center gap-1 rounded px-2 py-1 last:mb-0"
              >
                <span className="min-w-0 flex-1 truncate text-[10px]">
                  {index + 1}.{" "}
                  {editorText(input.editorState) || "Context prompt"}
                </span>
                <button
                  type="button"
                  onClick={() => void runQueuedNow(input)}
                  className="text-description hover:text-foreground cursor-pointer border-0 bg-transparent p-0 text-[9px]"
                >
                  Run now
                </button>
                <button
                  type="button"
                  aria-label="Remove queued prompt"
                  onClick={() => dispatch(removeQueuedInput(input.id))}
                  className="text-description-muted hover:text-error cursor-pointer border-0 bg-transparent p-0 text-[12px]"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
        <ContinueInputBox
          isMainInput
          isLastUserInput={false}
          onEnter={(editorState, modifiers, editor) =>
            submitOrQueue(editorState, modifiers, editor)
          }
          inputId={MAIN_EDITOR_INPUT_ID}
        />

        {/* VynorAI Live Token Remaining & Quota Progress Bar */}
        <VynorQuotaBar />

        <div
          style={{
            pointerEvents: isStreaming ? "none" : "auto",
          }}
        >
          <div className="flex flex-row items-center justify-between pb-1 pl-0.5 pr-2">
            <div className="xs:inline hidden">
              {history.length === 0 && lastSessionId && !isInEdit && (
                <NewSessionButton
                  onClick={async () => {
                    await dispatch(loadLastSession());
                  }}
                  className="flex items-center gap-2"
                >
                  <ArrowLeftIcon className="h-3 w-3" />
                  <span className="text-xs">Last Session</span>
                </NewSessionButton>
              )}
            </div>
          </div>
          <FatalErrorIndicator />
          {history.length === 0 && <EmptyChatBody />}
        </div>
      </div>
    </>
  );
}
