import {
  SharedConfigSchema,
  modifyAnyConfigWithSharedConfig,
} from "core/config/sharedConfig";
import { useContext, useEffect, useState } from "react";
import { Card, Toggle, useFontSize } from "../../../components/ui";
import { IdeMessengerContext } from "../../../context/IdeMessenger";
import { useAppDispatch, useAppSelector } from "../../../redux/hooks";
import { updateConfig } from "../../../redux/slices/configSlice";
import {
  setJudgmentLevel,
  setSideReviewEnabled,
  setTaskCreditCap,
} from "../../../redux/slices/uiSlice";
import {
  DEFAULT_JUDGMENT_LEVEL,
  JudgmentLevel,
} from "../../../redux/util/judgment";
import {
  formatCredits,
  TASK_CREDIT_CAP_OPTIONS,
} from "../../../redux/util/turnCredits";
import { setLocalStorage } from "../../../util/localStorage";
import { ConfigHeader } from "../components/ConfigHeader";
import { UserSetting } from "../components/UserSetting";

export function UserSettingsSection() {
  /////// User settings section //////
  const dispatch = useAppDispatch();
  const ideMessenger = useContext(IdeMessengerContext);
  const config = useAppSelector((state) => state.config.config);

  const [showExperimental, setShowExperimental] = useState(false);

  function handleUpdate(sharedConfig: SharedConfigSchema) {
    // Optimistic update
    const updatedConfig = modifyAnyConfigWithSharedConfig(config, sharedConfig);
    dispatch(updateConfig(updatedConfig));
    // IMPORTANT no need for model role updates (separate logic for selected model roles)
    // simply because this function won't be used to update model roles

    // Actual update to core which propagates back with config update event
    ideMessenger.post("config/updateSharedConfig", sharedConfig);
  }

  // Disable autocomplete
  const disableAutocompleteInFiles = (
    config.tabAutocompleteOptions?.disableInFiles ?? []
  ).join(", ");
  const [formDisableAutocomplete, setFormDisableAutocomplete] = useState(
    disableAutocompleteInFiles,
  );

  useEffect(() => {
    // Necessary so that reformatted/trimmed values don't cause dirty state
    setFormDisableAutocomplete(disableAutocompleteInFiles);
  }, [disableAutocompleteInFiles]);

  // Workspace prompts
  const promptPath = config.experimental?.promptPath || "";

  // TODO defaults are in multiple places, should be consolidated and probably not explicit here
  const showSessionTabs = config.ui?.showSessionTabs ?? false;
  const continueAfterToolRejection =
    config.ui?.continueAfterToolRejection ?? false;
  const codeWrap = config.ui?.codeWrap ?? false;
  const showChatScrollbar = config.ui?.showChatScrollbar ?? false;
  const readResponseTTS = config.experimental?.readResponseTTS ?? false;
  const displayRawMarkdown = config.ui?.displayRawMarkdown ?? false;
  const disableSessionTitles = config.disableSessionTitles ?? false;
  const useCurrentFileAsContext =
    config.experimental?.useCurrentFileAsContext ?? false;
  const enableExperimentalTools =
    config.experimental?.enableExperimentalTools ?? false;
  const onlyUseSystemMessageTools =
    config.experimental?.onlyUseSystemMessageTools ?? false;
  const codebaseToolCallingOnly =
    config.experimental?.codebaseToolCallingOnly ?? false;
  const allowAnonymousTelemetry = config.allowAnonymousTelemetry ?? false;

  const useAutocompleteMultilineCompletions =
    config.tabAutocompleteOptions?.multilineCompletions ?? "auto";
  const modelTimeout = config.tabAutocompleteOptions?.modelTimeout ?? 150;
  const debounceDelay = config.tabAutocompleteOptions?.debounceDelay ?? 250;
  const fontSize = useFontSize();

  const cancelChangeDisableAutocomplete = () => {
    setFormDisableAutocomplete(disableAutocompleteInFiles);
  };
  const handleDisableAutocompleteSubmit = () => {
    handleUpdate({
      disableAutocompleteInFiles: formDisableAutocomplete
        .split(",")
        .map((val) => val.trim())
        .filter((val) => !!val),
    });
  };

  const disableTelemetryToggle = false;
  const taskCreditCap = useAppSelector((state) => state.ui.taskCreditCap ?? 0);
  const judgmentLevel = useAppSelector(
    (state) => state.ui.judgmentLevel ?? DEFAULT_JUDGMENT_LEVEL,
  );
  const sideReviewEnabled = useAppSelector(
    (state) => state.ui.sideReviewEnabled !== false,
  );

  return (
    <div>
      <div className="flex flex-col">
        <ConfigHeader title="User Settings" />
        <div className="space-y-6">
          {/* Chat Interface Settings */}
          <div>
            <ConfigHeader title="Chat" variant="sm" />
            <Card>
              <div className="flex flex-col gap-4">
                <UserSetting
                  type="toggle"
                  title="Show Session Tabs"
                  description="Displays tabs above the chat as an alternative way to organize and access your sessions."
                  value={showSessionTabs}
                  onChange={(value) => handleUpdate({ showSessionTabs: value })}
                />
                <UserSetting
                  type="select"
                  title="Credit Limit per Task"
                  description="Pause a single prompt once it has used this many credits. The agent then summarizes what is done and what is left, and Continue resumes it."
                  value={String(taskCreditCap)}
                  options={TASK_CREDIT_CAP_OPTIONS.map((n) => ({
                    value: String(n),
                    label: n === 0 ? "Off" : `${formatCredits(n)} credits`,
                  }))}
                  onChange={(value) =>
                    dispatch(setTaskCreditCap(Number(value)))
                  }
                />
                <UserSetting
                  type="select"
                  title="Agent Judgment"
                  description="How carefully the agent reviews its own changes before finishing. Careful and Max check other uses of what changed, think through what could break, and end with an honest report of what was and was not verified. In our tests this caught 98-100% of hidden issues vs about 70% without it, and uses more credits on changes (about 2-3x on small tasks)."
                  value={judgmentLevel}
                  options={[
                    { value: "fast", label: "Fast (no extra review)" },
                    { value: "careful", label: "Careful (multi-file changes)" },
                    { value: "max", label: "Max (every change, Pro reviewer)" },
                  ]}
                  onChange={(value) =>
                    dispatch(setJudgmentLevel(value as JudgmentLevel))
                  }
                />
                <UserSetting
                  type="toggle"
                  title="You Should Know (second look)"
                  description="After an agent turn that changes files, a quick review of the diff flags secrets, leftover debug code, likely bugs or missing tests. Uses a few credits per task."
                  value={sideReviewEnabled}
                  onChange={(value) => dispatch(setSideReviewEnabled(value))}
                />
                <UserSetting
                  type="toggle"
                  title="Wrap Codeblocks"
                  description="Wraps long lines in code blocks instead of showing horizontal scroll."
                  value={codeWrap}
                  onChange={(value) => handleUpdate({ codeWrap: value })}
                />
                <UserSetting
                  type="toggle"
                  title="Show Chat Scrollbar"
                  description="Enables a scrollbar in the chat window."
                  value={showChatScrollbar}
                  onChange={(value) =>
                    handleUpdate({ showChatScrollbar: value })
                  }
                />
                <UserSetting
                  type="toggle"
                  title="Text-to-Speech Output"
                  description="Reads LLM responses aloud with TTS."
                  value={readResponseTTS}
                  onChange={(value) => handleUpdate({ readResponseTTS: value })}
                />
                <UserSetting
                  type="toggle"
                  title="Enable Session Titles"
                  description="Generates summary titles for each chat session after the first message, using the current Chat model."
                  value={!disableSessionTitles}
                  onChange={(value) =>
                    handleUpdate({ disableSessionTitles: !value })
                  }
                />
                <UserSetting
                  type="toggle"
                  title="Format Markdown"
                  description="If off, shows responses as raw text."
                  value={!displayRawMarkdown}
                  onChange={(value) =>
                    handleUpdate({ displayRawMarkdown: !value })
                  }
                />
              </div>
            </Card>
          </div>

          {/* Appearance Settings */}
          <div>
            <ConfigHeader title="Appearance" variant="sm" />
            <Card>
              <div className="flex flex-col gap-4">
                <UserSetting
                  type="number"
                  title="Font Size"
                  description="Specifies base font size for UI elements."
                  value={fontSize}
                  onChange={(val) => {
                    setLocalStorage("fontSize", val);
                    handleUpdate({ fontSize: val });
                  }}
                  min={7}
                  max={50}
                />
              </div>
            </Card>
          </div>

          {/* Autocomplete Settings */}
          <div>
            <ConfigHeader title="Autocomplete" variant="sm" />
            <Card>
              <div className="flex flex-col gap-4">
                <UserSetting
                  type="select"
                  title="Multiline Autocompletions"
                  description="Controls multiline completions for autocomplete."
                  value={useAutocompleteMultilineCompletions}
                  onChange={(value) =>
                    handleUpdate({
                      useAutocompleteMultilineCompletions: value as
                        | "auto"
                        | "always"
                        | "never",
                    })
                  }
                  options={[
                    { label: "Auto", value: "auto" },
                    { label: "Always", value: "always" },
                    { label: "Never", value: "never" },
                  ]}
                />
                <UserSetting
                  type="number"
                  title="Autocomplete Timeout (ms)"
                  description="Maximum time in milliseconds for autocomplete request/retrieval."
                  value={modelTimeout}
                  onChange={(val) => handleUpdate({ modelTimeout: val })}
                  min={100}
                  max={5000}
                />
                <UserSetting
                  type="number"
                  title="Autocomplete Debounce (ms)"
                  description="Minimum time in milliseconds to trigger an autocomplete request after a change."
                  value={debounceDelay}
                  onChange={(val) => handleUpdate({ debounceDelay: val })}
                  min={0}
                  max={2500}
                />
                <UserSetting
                  type="input"
                  title="Disable autocomplete in files"
                  description="List of comma-separated glob pattern to disable autocomplete in matching files."
                  placeholder="**/*.(txt,md)"
                  value={formDisableAutocomplete}
                  onChange={setFormDisableAutocomplete}
                  onSubmit={handleDisableAutocompleteSubmit}
                  onCancel={cancelChangeDisableAutocomplete}
                  isDirty={
                    formDisableAutocomplete !== disableAutocompleteInFiles
                  }
                  isValid={formDisableAutocomplete.trim() !== ""}
                />
              </div>
            </Card>
          </div>

          {/* Experimental Settings */}
          <div>
            <ConfigHeader title="Experimental" variant="sm" />
            <Card>
              <Toggle
                isOpen={showExperimental}
                onToggle={() => setShowExperimental(!showExperimental)}
                title="Show Experimental Settings"
              >
                <div className="flex flex-col gap-x-1 gap-y-4">
                  <UserSetting
                    type="toggle"
                    title="Add Current File by Default"
                    description=" the currently open file is added as context in every new conversation."
                    value={useCurrentFileAsContext}
                    onChange={(value) =>
                      handleUpdate({ useCurrentFileAsContext: value })
                    }
                  />
                  <UserSetting
                    type="toggle"
                    title="Enable experimental tools"
                    description=" enables access to experimental tools that are still in development."
                    value={enableExperimentalTools}
                    onChange={(value) =>
                      handleUpdate({ enableExperimentalTools: value })
                    }
                  />
                  <UserSetting
                    type="toggle"
                    title="Only use system message tools"
                    description=" Continue will not attempt to use native tool calling and will only use system message tools."
                    value={onlyUseSystemMessageTools}
                    onChange={(value) =>
                      handleUpdate({ onlyUseSystemMessageTools: value })
                    }
                  />
                  <UserSetting
                    type="toggle"
                    title="@Codebase: use tool calling only"
                    description=" @codebase context provider will only use tool calling for code retrieval."
                    value={codebaseToolCallingOnly}
                    onChange={(value) =>
                      handleUpdate({ codebaseToolCallingOnly: value })
                    }
                  />
                  <UserSetting
                    type="toggle"
                    title="Stream after tool rejection"
                    description=" streaming will continue after the tool call is rejected."
                    value={continueAfterToolRejection}
                    onChange={(value) =>
                      handleUpdate({ continueAfterToolRejection: value })
                    }
                  />
                </div>
              </Toggle>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
