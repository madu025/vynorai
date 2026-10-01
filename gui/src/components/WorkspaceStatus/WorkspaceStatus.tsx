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

  const refresh = async () => {
    const result = await ideMessenger.request(
      "workspace/refreshSnapshot",
      undefined,
    );
    if (result.status === "success") {
      dispatch(setWorkspaceSnapshot(result.content));
    } else {
      dispatch(setWorkspaceError("Could not refresh workspace state."));
    }
  };

  const activeRoot = snapshot?.roots.find(
    (root) => root.id === snapshot.activeRootId,
  );
  const indexState = snapshot?.index.find(
    (item) => item.rootId === snapshot.activeRootId,
  );
  const evidence =
    !snapshot || snapshot.roots.length === 0
      ? "No workspace"
      : snapshot.manifests.length + snapshot.instructions.length > 0
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
        {!snapshot?.trusted && snapshot?.roots.length ? " · restricted" : ""}
      </span>
    </button>
  );
}
