import { useContext } from "react";

import { IdeMessengerContext } from "../../context/IdeMessenger";
import { useAppDispatch, useAppSelector } from "../../redux/hooks";
import {
  setWorkspaceError,
  setWorkspaceSnapshot,
} from "../../redux/slices/workspaceSlice";

export function WorkspaceStatus() {
  const dispatch = useAppDispatch();
  const ideMessenger = useContext(IdeMessengerContext);
  const { snapshot, loading, error } = useAppSelector(
    (state) => state.workspace,
  );
  const taskState = useAppSelector((state) => state.session.activeTaskState);
  // Snapshot updates arrive in stages while the workspace is opening or
  // refreshing. Treat missing collections as empty until the full snapshot
  // is available instead of crashing the whole webview.
  const roots = snapshot?.roots ?? [];
  const indexItems = snapshot?.index ?? [];
  const manifests = snapshot?.manifests ?? [];
  const instructions = snapshot?.instructions ?? [];

  const refresh = async () => {
    try {
      const result = await ideMessenger.request(
        "workspace/refreshSnapshot",
        undefined,
      );
      if (result.status === "success") {
        dispatch(setWorkspaceSnapshot(result.content));
      } else {
        dispatch(setWorkspaceError("Could not refresh workspace state."));
      }
    } catch {
      dispatch(setWorkspaceError("Could not refresh workspace state."));
    }
  };

  const activeRoot = roots.find((root) => root.id === snapshot?.activeRootId);
  const indexState = indexItems.find(
    (item) => item.rootId === snapshot?.activeRootId,
  );
  const evidence =
    roots.length === 0
      ? "No workspace"
      : manifests.length + instructions.length > 0
        ? "Grounded"
        : "Workspace ready";

  return (
    <button
      type="button"
      onClick={() => void refresh()}
      title={error ?? "Refresh workspace context"}
      className="border-command-border bg-editor text-description hover:text-foreground mx-2 mb-1 flex min-w-0 items-center gap-2 rounded-md border border-solid px-2 py-1 text-[10px]"
    >
      <span
        className={`h-1.5 w-1.5 shrink-0 rounded-full ${
          !snapshot?.trusted
            ? "bg-warning"
            : indexState?.status === "failed"
              ? "bg-error"
              : "bg-success"
        }`}
      />
      <span className="truncate font-medium">
        {loading ? "Detecting workspace…" : (activeRoot?.name ?? evidence)}
      </span>
      {activeRoot?.branch && (
        <span className="text-description-muted truncate">
          {activeRoot.branch}
        </span>
      )}
      <span className="text-description-muted ml-auto shrink-0">
        {taskState && !["completed", "failed", "canceled"].includes(taskState)
          ? taskState.replace("_", " ")
          : (indexState?.status ?? evidence)}
        {!snapshot?.trusted && roots.length ? " · restricted" : ""}
      </span>
    </button>
  );
}
