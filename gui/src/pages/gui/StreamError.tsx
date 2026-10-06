import {
  ArrowPathIcon,
  ArrowTopRightOnSquareIcon,
  ClipboardIcon,
  Cog6ToothIcon,
  KeyIcon,
} from "@heroicons/react/24/outline";
import { useContext, useEffect, useMemo, useRef } from "react";

import { GhostButton } from "../../components";
import { useEditModel } from "../../components/mainInput/Lump/useEditBlock";
import { useMainEditor } from "../../components/mainInput/TipTapEditor";
import ToggleDiv from "../../components/ToggleDiv";
import { useAuth } from "../../context/Auth";
import { IdeMessengerContext } from "../../context/IdeMessenger";
import { useAppDispatch, useAppSelector } from "../../redux/hooks";
import { selectSelectedChatModel } from "../../redux/slices/configSlice";
import { setDialogMessage, setShowDialog } from "../../redux/slices/uiSlice";
import { streamResponseThunk } from "../../redux/thunks/streamResponse";
import { analyzeError } from "../../util/errorAnalysis";
import {
  createRuntimeDiagnostic,
  RuntimeDiagnostic,
  saveRuntimeDiagnostic,
} from "../../util/runtimeDiagnostics";

interface StreamErrorProps {
  error: unknown;
}

const StreamErrorDialog = ({ error }: StreamErrorProps) => {
  const dispatch = useAppDispatch();
  const ideMessenger = useContext(IdeMessengerContext);
  const selectedModel = useAppSelector(selectSelectedChatModel);
  const { refreshProfiles } = useAuth();
  const { mainEditor } = useMainEditor();

  const {
    parsedError,
    statusCode,
    message,
    modelTitle,
    providerName,
    apiKeyUrl,
    helpUrl,
    customErrorMessage,
  } = useMemo(() => analyzeError(error, selectedModel), [error, selectedModel]);
  const isQuotaError = /quota_exceeded|monthly_limit_reached|credits/i.test(
    parsedError ?? "",
  );

  const handleRefreshProfiles = () => {
    void refreshProfiles("Clicked reload config from stream error dialog");
    dispatch(setShowDialog(false));
    dispatch(setDialogMessage(undefined));
  };

  const copyErrorToClipboard = () => {
    void navigator.clipboard.writeText(parsedError);
  };

  const history = useAppSelector((store) => store.session.history);
  const sessionId = useAppSelector((store) => store.session.id);
  const mode = useAppSelector((store) => store.session.mode);
  const workspaceSnapshot = useAppSelector((store) => store.workspace.snapshot);
  const diagnosticRef = useRef<RuntimeDiagnostic | null>(null);
  if (!diagnosticRef.current) {
    diagnosticRef.current = createRuntimeDiagnostic({
      error,
      modelTitle: selectedModel?.title,
      provider: selectedModel?.underlyingProviderName,
      sessionId,
      mode,
      historyLength: history.length,
      workspace: workspaceSnapshot
        ? {
            connected: (workspaceSnapshot.roots ?? []).length > 0,
            rootCount: (workspaceSnapshot.roots ?? []).length,
            trusted: workspaceSnapshot.trusted,
            revision: workspaceSnapshot.revision,
          }
        : undefined,
      toolStatusCounts: history.reduce<Record<string, number>>(
        (counts, item) => {
          for (const toolCall of item.toolCallStates ?? []) {
            counts[toolCall.status] = (counts[toolCall.status] ?? 0) + 1;
          }
          return counts;
        },
        {},
      ),
    });
  }
  const diagnostic = diagnosticRef.current;

  useEffect(() => {
    saveRuntimeDiagnostic(diagnostic);
    ideMessenger.post("diagnostics/record", {
      report: JSON.stringify(diagnostic),
    });
    if (isQuotaError) {
      window.dispatchEvent(new Event("vynorai:quota-exhausted"));
    }
  }, [diagnostic, ideMessenger, isQuotaError]);

  const copyDiagnosticToClipboard = () => {
    void navigator.clipboard.writeText(JSON.stringify(diagnostic, null, 2));
  };

  const closeDialog = () => {
    dispatch(setShowDialog(false));
    dispatch(setDialogMessage(undefined));
  };

  const chooseAnotherModel = () => {
    closeDialog();
    window.setTimeout(
      () => window.dispatchEvent(new Event("vynorai:open-model-select")),
      0,
    );
  };

  const checkKeysButton = apiKeyUrl ? (
    <GhostButton
      className="flex items-center"
      onClick={() => ideMessenger.ide.openUrl(apiKeyUrl)}
    >
      <KeyIcon className="mr-1.5 h-3.5 w-3.5" />
      <span>Check API key</span>
    </GhostButton>
  ) : null;

  const handleEditModel = useEditModel();

  const configButton = (
    <GhostButton
      className="flex items-center"
      onClick={() => handleEditModel(selectedModel)}
    >
      <Cog6ToothIcon className="mr-1.5 h-3.5 w-3.5" />
      <span>View config</span>
    </GhostButton>
  );

  const resubmitButton = (
    <GhostButton
      className="flex items-center"
      onClick={() => {
        let index = -1;
        for (let i = history.length - 1; i >= 0; i--) {
          if (
            history[i].message.role === "user" ||
            history[i].message.role === "tool"
          ) {
            index = i;
            break;
          }
        }

        if (!mainEditor) {
          console.error("Main editor not found, cannot resubmit message.");
          return;
        }

        const editorState =
          index === -1 ? mainEditor.getJSON() : history[index].editorState;

        void dispatch(
          streamResponseThunk({
            editorState,
            modifiers: {
              noContext: true,
              useCodebase: false,
            },
            index: index === -1 ? 0 : index,
          }),
        );
        dispatch(setShowDialog(false));
        dispatch(setDialogMessage(undefined));
      }}
    >
      <ArrowPathIcon className="mr-1.5 h-3.5 w-3.5" />
      <span>Resubmit last message</span>
    </GhostButton>
  );

  let errorContent = (
    <div className="mb-1 mt-3">
      <div className="m-0 p-0">
        <p className="m-0 mb-2 p-0">
          There was an error handling the response from{" "}
          {selectedModel?.title || "the model"}.
        </p>
        <p className="m-0 p-0">Please try to submit your message again.</p>
        <div className="mt-3">{resubmitButton}</div>
      </div>
    </div>
  );

  // Display components for specific errors
  if (statusCode === 429) {
    errorContent = (
      <div className="flex flex-col gap-2">
        <span>
          {`This might mean your ${modelTitle} usage has been rate limited
                by ${providerName}.`}
        </span>
        <div className="flex flex-row flex-wrap justify-start gap-3 py-4">
          {checkKeysButton}
          {configButton}
        </div>
      </div>
    );
  }

  if (statusCode === 404) {
    errorContent = (
      <div className="flex flex-col gap-2">
        <span>Likely causes:</span>
        <ul className="m-0">
          <li>
            <span>Invalid</span>
            <code>apiBase</code>
            {selectedModel && (
              <>
                <span>{`: `}</span>
                <code>{selectedModel.apiBase}</code>
              </>
            )}
          </li>
          <li>
            <span>Model/deployment not found</span>
            {selectedModel && (
              <>
                <span>{` for: `}</span>
                <code>{selectedModel.model}</code>
              </>
            )}
          </li>
        </ul>
        <div>{configButton}</div>
      </div>
    );
  }

  if (statusCode === 401) {
    errorContent = (
      <div className="flex flex-col gap-2">
        <span>{`It's possible that your API key is invalid.`}</span>
        <div className="flex flex-row flex-wrap gap-2">
          {checkKeysButton}
          {configButton}
        </div>
      </div>
    );
  }

  if (statusCode === 403) {
    errorContent = (
      <div className="flex flex-col gap-2">
        <span>{`Likely cause: not authorized to access the model deployment.`}</span>
        <div className="flex flex-row flex-wrap gap-2">
          {checkKeysButton}
          {configButton}
        </div>
      </div>
    );
  }

  // VynorAI quota errors come back as 403 but are about credits, not access.
  if (isQuotaError) {
    errorContent = (
      <div className="flex flex-col gap-2">
        <span>
          The account used by the selected VynorAI model has no credits left for
          this month. The current task has been stopped safely.
        </span>
        <span className="text-description text-xs">
          Choose another configured model, upgrade this account, or cancel and
          continue later. Switching models will not automatically repeat the
          failed request.
        </span>
        <div className="flex flex-row flex-wrap gap-2 pt-2">
          <GhostButton onClick={chooseAnotherModel}>
            Choose another model
          </GhostButton>
          <GhostButton
            onClick={() =>
              ideMessenger.post("openUrl", "https://vynor.lk/#pricing")
            }
          >
            Upgrade plan
          </GhostButton>
          <GhostButton onClick={closeDialog}>Cancel</GhostButton>
        </div>
      </div>
    );
  }

  if (
    message &&
    (message.toLowerCase().includes("overloaded") ||
      message.toLowerCase().includes("malformed json"))
  ) {
    errorContent = (
      <div className="flex flex-col gap-2">
        <span>{`Most likely, the provider's server(s) are overloaded and streaming was interrupted. Try again later`}</span>
        {selectedModel ? (
          <span>
            {`Provider: `}
            <code>{selectedModel.underlyingProviderName}</code>
          </span>
        ) : null}
      </div>
    );
  }

  // Custom error message from error analysis (e.g. invalid API key, insufficient balance)
  if (customErrorMessage) {
    errorContent = (
      <div className="flex flex-col gap-2">
        <span>{customErrorMessage}</span>
        <div className="flex flex-row flex-wrap justify-start gap-3 py-2">
          {helpUrl && (
            <GhostButton
              className="flex items-center"
              onClick={() => ideMessenger.ide.openUrl(helpUrl)}
            >
              <ArrowTopRightOnSquareIcon className="mr-1.5 h-3.5 w-3.5" />
              <span>View help documentation</span>
            </GhostButton>
          )}
          {apiKeyUrl && (
            <GhostButton
              className="flex items-center"
              onClick={() => ideMessenger.ide.openUrl(apiKeyUrl)}
            >
              <KeyIcon className="mr-1.5 h-3.5 w-3.5" />
              <span>Check API key</span>
            </GhostButton>
          )}
          {configButton}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 px-3 pb-3 pt-3">
      {/* Concise error title */}
      <h3 className="text-error m-0 p-0 text-lg font-medium">
        {isQuotaError
          ? "VynorAI credits used up"
          : "Error handling model response"}
      </h3>

      {errorContent}

      {/* Expandable technical details using ToggleDiv */}
      {message && (
        <div className="mb-2">
          <ToggleDiv
            title="View error output"
            testId="error-output-toggle"
            defaultOpen
          >
            <div className="flex flex-col gap-0 rounded-sm">
              <code className="text-editor-foreground block max-h-48 overflow-y-auto p-3 font-mono text-xs">
                {parsedError}
              </code>

              <div className="flex flex-row items-center justify-end gap-2 p-2">
                <GhostButton
                  onClick={copyErrorToClipboard}
                  className="flex items-center"
                >
                  <ClipboardIcon className="mr-1.5 h-3.5 w-3.5" />
                  <span>Copy output</span>
                </GhostButton>

                <GhostButton
                  onClick={copyDiagnosticToClipboard}
                  className="flex items-center"
                >
                  <ClipboardIcon className="mr-1.5 h-3.5 w-3.5" />
                  <span>Copy diagnostic</span>
                </GhostButton>

                <GhostButton
                  onClick={() => {
                    ideMessenger.post("toggleDevTools", undefined);
                  }}
                  className="flex items-center"
                >
                  <ArrowTopRightOnSquareIcon className="mr-1.5 h-4 w-4" />
                  <span className="text-xs">View Logs</span>
                </GhostButton>
              </div>
            </div>
          </ToggleDiv>
        </div>
      )}
    </div>
  );
};

export default StreamErrorDialog;
