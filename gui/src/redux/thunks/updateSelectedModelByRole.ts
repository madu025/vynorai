import { ModelRole } from "@continuedev/config-yaml";
import { createAsyncThunk } from "@reduxjs/toolkit";
import { ProfileDescription } from "core/config/ProfileLifecycleManager";
import { updateConfig } from "../slices/configSlice";
import { ThunkApiType } from "../store";

export const updateSelectedModelByRole = createAsyncThunk<
  void,
  {
    role: ModelRole;
    modelTitle: string;
    selectedProfile: ProfileDescription | null;
  },
  ThunkApiType
>(
  "config/updateSelectedModel",
  async (
    { role, modelTitle, selectedProfile },
    { dispatch, extra, getState },
  ) => {
    const state = getState();

    const {
      config: { config },
    } = state;

    const effectiveProfileId =
      selectedProfile?.id ??
      state.profiles.selectedProfileId ??
      state.profiles.profiles?.[0]?.id ??
      "local";

    // Find model across current role, chat role, or edit role
    const model =
      state.config.config.modelsByRole[role]?.find((m) => m.title === modelTitle) ??
      state.config.config.modelsByRole.chat?.find((m) => m.title === modelTitle) ??
      state.config.config.modelsByRole.edit?.find((m) => m.title === modelTitle);

    if (model) {
      dispatch(
        updateConfig({
          ...config,
          selectedModelByRole: {
            ...config.selectedModelByRole,
            [role]: model,
          },
        }),
      );
    }

    extra.ideMessenger.post("config/updateSelectedModel", {
      role,
      profileId: effectiveProfileId,
      title: modelTitle,
    });
  },
);
