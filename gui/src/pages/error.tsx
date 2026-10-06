import { ArrowPathIcon, ClipboardIcon } from "@heroicons/react/24/outline";
import { useContext, useEffect, useRef } from "react";
import { useNavigate, useRouteError } from "react-router-dom";
import { Button } from "../components";
import { IdeMessengerContext } from "../context/IdeMessenger";
import { useAppSelector } from "../redux/hooks";
import {
  createRuntimeDiagnostic,
  RuntimeDiagnostic,
  saveRuntimeDiagnostic,
} from "../util/runtimeDiagnostics";

const ErrorPage: React.FC = () => {
  const error = useRouteError();
  const navigate = useNavigate();
  const messenger = useContext(IdeMessengerContext);
  const sessionId = useAppSelector((state) => state.session.id);
  const mode = useAppSelector((state) => state.session.mode);
  const history = useAppSelector((state) => state.session.history);
  const workspaceSnapshot = useAppSelector((state) => state.workspace.snapshot);
  const diagnosticRef = useRef<RuntimeDiagnostic | null>(null);
  if (!diagnosticRef.current) {
    diagnosticRef.current = createRuntimeDiagnostic({
      error,
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
      toolStatusCounts: {},
    });
  }
  const diagnostic = diagnosticRef.current;
  useEffect(() => {
    saveRuntimeDiagnostic(diagnostic);
    messenger.post("diagnostics/record", {
      report: JSON.stringify(diagnostic),
    });
  }, [diagnostic, messenger]);

  return (
    <div className="flex flex-col items-center justify-center px-2 py-4 text-center sm:px-8">
      <h1 className="mb-4 text-3xl font-bold">Oops! Something went wrong</h1>

      <code className="whitespace-wrap mx-2 mb-4 max-w-full break-words py-2">
        {diagnostic.error.message}
      </code>
      {/* Where it broke: without this a crash report says only the message. */}
      {diagnostic.error.stack && (
        <details className="mx-2 mb-4 max-w-full text-left">
          <summary className="text-description cursor-pointer text-xs">
            Details
          </summary>
          <pre
            data-testid="error-stack"
            className="text-description whitespace-pre-wrap break-words text-[10px]"
          >
            {diagnostic.error.stack.split("\n").slice(0, 8).join("\n")}
          </pre>
        </details>
      )}

      <div className="flex flex-row flex-wrap justify-center gap-2">
        <Button
          className="flex flex-row items-center gap-2"
          onClick={() => navigate("/", { replace: true })}
        >
          <ArrowPathIcon className="h-5 w-5" />
          Try again
        </Button>
        <Button
          className="flex flex-row items-center gap-2"
          onClick={() =>
            void navigator.clipboard.writeText(
              JSON.stringify(diagnostic, null, 2),
            )
          }
        >
          <ClipboardIcon className="h-4 w-4" />
          Copy diagnostic
        </Button>
      </div>
    </div>
  );
};

export default ErrorPage;
