import { configureStore } from "@reduxjs/toolkit";
import { copyOf } from "core/util";
import { vi } from "vitest";
import { MockIdeMessenger } from "../../context/MockIdeMessenger";
import configReducer, {
  INITIAL_CONFIG_SLICE,
} from "../../redux/slices/configSlice";
import editModeStateReducer, {
  INITIAL_EDIT_STATE,
} from "../../redux/slices/editState";
import indexingReducer, {
  INITIAL_INDEXING_STATE,
} from "../../redux/slices/indexingSlice";
import {
  INITIAL_PROFILES_STATE,
  profilesReducer,
} from "../../redux/slices/profilesSlice";
import sessionReducer, {
  INITIAL_SESSION_STATE,
} from "../../redux/slices/sessionSlice";
import tabsReducer, { INITIAL_TABS_STATE } from "../../redux/slices/tabsSlice";
import uiReducer, { DEFAULT_UI_SLICE } from "../../redux/slices/uiSlice";
import workspaceReducer, {
  INITIAL_WORKSPACE_STATE,
} from "../../redux/slices/workspaceSlice";
import { RootState } from "../../redux/store";

import { ensureHighlightLoaded } from "../../components/StyledMarkdownPreview/lazyMarkdownPlugins";
import { ensureTokenizerLoaded } from "../tokenCount";

// The app preloads these chunks shortly after it opens (App.tsx), before anyone
// has typed a prompt. Tests that build a store or render the chat do the same,
// so they never pay for transforming the 6 MB tokenizer while running.
await Promise.all([ensureTokenizerLoaded(), ensureHighlightLoaded()]);

// TODO remove non-serializable streamAborter, causes headaches
export const getEmptyRootState: () => RootState = () => {
  const withoutSession: Omit<RootState, "session"> = {
    config: INITIAL_CONFIG_SLICE,
    ui: DEFAULT_UI_SLICE,
    editModeState: INITIAL_EDIT_STATE,
    indexing: INITIAL_INDEXING_STATE,
    profiles: INITIAL_PROFILES_STATE,
    tabs: INITIAL_TABS_STATE,
    workspace: INITIAL_WORKSPACE_STATE,
  };
  const { streamAborter, ...serializableSession } = INITIAL_SESSION_STATE;
  const sessionCopy = copyOf(serializableSession) as Omit<
    RootState["session"],
    "streamAborter"
  >;
  const withoutSessionCopy = copyOf(withoutSession) as Omit<
    RootState,
    "session"
  >;
  return {
    ...withoutSessionCopy,
    session: {
      ...sessionCopy,
      streamAborter: new AbortController(),
    },
  };
};

export const createMockStore = (
  initialState?: Partial<RootState>,
  mockMessenger?: MockIdeMessenger,
): ReturnType<typeof configureStore> & {
  mockIdeMessenger: MockIdeMessenger;
  getActions: () => any[];
  clearActions: () => void;
} => {
  const mockIdeMessenger = mockMessenger ?? new MockIdeMessenger();

  const store = configureStore({
    reducer: {
      session: sessionReducer,
      ui: uiReducer,
      editModeState: editModeStateReducer,
      config: configReducer,
      indexing: indexingReducer,
      tabs: tabsReducer,
      profiles: profilesReducer,
      workspace: workspaceReducer,
    },
    preloadedState: {
      ...getEmptyRootState(),
      ...initialState,
    },
    middleware: (getDefaultMiddleware) =>
      getDefaultMiddleware({
        serializableCheck: {
          ignoredPaths: ["session.streamAborter", "ui.dialogMessage"],
          ignoredActions: ["ui/setDialogMessage"],
        },
        // newSession aborts the previous AbortController in place.
        immutableCheck: { ignoredPaths: ["session.streamAborter"] },
        thunk: {
          extraArgument: {
            ideMessenger: mockIdeMessenger,
          },
        },
      }),
  });

  // Add getActions method for testing
  const actions: any[] = [];
  const originalDispatch = store.dispatch;

  // Override dispatch to track actions and inject ideMessenger
  store.dispatch = vi.fn((action: any) => {
    if (typeof action === "function") {
      // For thunks, provide the extra argument with ideMessenger
      return action(store.dispatch, store.getState, {
        ideMessenger: mockIdeMessenger,
      });
    }
    actions.push(action);
    return originalDispatch(action);
  });

  // Expose mockIdeMessenger so tests can configure it
  return {
    ...store,
    mockIdeMessenger,
    getActions: () => actions,
    clearActions: () => actions.splice(0, actions.length),
  };
};
