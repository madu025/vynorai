import { PayloadAction, createSlice } from "@reduxjs/toolkit";
import type { WorkspaceSnapshot } from "core/workspace/types";

type WorkspaceState = {
  snapshot?: WorkspaceSnapshot;
  loading: boolean;
  error?: string;
};

export const INITIAL_WORKSPACE_STATE: WorkspaceState = { loading: true };

const workspaceSlice = createSlice({
  name: "workspace",
  initialState: INITIAL_WORKSPACE_STATE,
  reducers: {
    setWorkspaceSnapshot(state, action: PayloadAction<WorkspaceSnapshot>) {
      state.snapshot = action.payload;
      state.loading = false;
      state.error = undefined;
    },
    setWorkspaceError(state, action: PayloadAction<string>) {
      state.loading = false;
      state.error = action.payload;
    },
  },
});

export const { setWorkspaceError, setWorkspaceSnapshot } =
  workspaceSlice.actions;
export default workspaceSlice.reducer;
