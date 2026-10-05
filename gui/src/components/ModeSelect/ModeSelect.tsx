import {
  CheckIcon,
  ChevronDownIcon,
  ExclamationTriangleIcon,
  InformationCircleIcon,
  UserGroupIcon,
} from "@heroicons/react/24/outline";
import { MessageModes } from "core";
import { isRecommendedAgentModel } from "core/llm/toolSupport";
import { useCallback, useContext, useEffect, useMemo, useState } from "react";
import { IdeMessengerContext } from "../../context/IdeMessenger";
import { useAppDispatch, useAppSelector } from "../../redux/hooks";
import { selectSelectedChatModel } from "../../redux/slices/configSlice";
import { setExpertTeamEnabled, setMode } from "../../redux/slices/sessionSlice";
import { getFontSize, getMetaKeyLabel } from "../../util";
import { ToolTip } from "../gui/Tooltip";
import { useMainEditor } from "../mainInput/TipTapEditor";
import { Listbox, ListboxButton, ListboxOption, ListboxOptions } from "../ui";
import { ModeIcon } from "./ModeIcon";

export function ModeSelect() {
  const dispatch = useAppDispatch();
  const mode = useAppSelector((store) => store.session.mode);
  const expertTeamEnabled = useAppSelector(
    (store) => store.session.expertTeamEnabled,
  );
  const selectedModel = useAppSelector(selectSelectedChatModel);

  const isGoodAtAgentMode = useMemo(() => {
    if (!selectedModel) {
      return undefined;
    }
    return isRecommendedAgentModel(selectedModel.model);
  }, [selectedModel]);

  // Background mode is offered only when the server has it on and the plan
  // includes it; otherwise picking it would only return errors.
  const ideMessenger = useContext(IdeMessengerContext);
  const [backgroundAvailable, setBackgroundAvailable] = useState(false);
  useEffect(() => {
    let alive = true;
    void ideMessenger
      .request("background/availability", undefined)
      .then((response) => {
        if (!alive) return;
        const available =
          response?.status === "success" && response.content.available;
        setBackgroundAvailable(available);
        if (!available && mode === "background") dispatch(setMode("agent"));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
    // Checked once per panel load; the plan rarely changes mid-session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ideMessenger]);

  const { mainEditor } = useMainEditor();
  const metaKeyLabel = useMemo(() => {
    return getMetaKeyLabel();
  }, []);

  const cycleMode = useCallback(() => {
    dispatch(setExpertTeamEnabled(false));
    if (mode === "chat") {
      dispatch(setMode("plan"));
    } else if (mode === "plan") {
      dispatch(setMode("agent"));
    } else if (mode === "agent" && backgroundAvailable) {
      dispatch(setMode("background"));
    } else {
      dispatch(setMode("chat"));
    }
    // Only focus main editor if another one doesn't already have focus
    if (!document.activeElement?.classList?.contains("ProseMirror")) {
      mainEditor?.commands.focus();
    }
  }, [dispatch, mode, mainEditor, backgroundAvailable]);

  const selectMode = useCallback(
    (newMode: MessageModes | "expert") => {
      if (newMode === "expert") {
        dispatch(setExpertTeamEnabled(true));
        mainEditor?.commands.focus();
        return;
      }

      if (newMode === mode && !expertTeamEnabled) {
        return;
      }

      dispatch(setExpertTeamEnabled(false));
      dispatch(setMode(newMode));

      mainEditor?.commands.focus();
    },
    [dispatch, expertTeamEnabled, mode, mainEditor],
  );

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "." && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        void cycleMode();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [cycleMode]);

  const notGreatAtAgent = (mode: string) => (
    <>
      <ToolTip
        style={{
          zIndex: 200001, // in front of listbox
        }}
        className="flex items-center gap-1"
        content={`${mode} might not work well with this model.`}
      >
        <ExclamationTriangleIcon className="text-warning h-2.5 w-2.5" />
      </ToolTip>
    </>
  );

  return (
    <Listbox value={expertTeamEnabled ? "expert" : mode} onChange={selectMode}>
      <div className="relative">
        <ListboxButton
          data-testid="mode-select-button"
          className="xs:px-2 text-description bg-lightgray/20 gap-1 rounded-full border-none px-1.5 py-0.5 transition-colors duration-200 hover:brightness-110"
        >
          {expertTeamEnabled ? (
            <UserGroupIcon className="h-3 w-3" />
          ) : (
            <ModeIcon mode={mode} />
          )}
          <span className="hidden sm:block">
            {expertTeamEnabled
              ? "Expert Team"
              : mode === "chat"
                ? "Chat"
                : mode === "agent"
                  ? "Agent"
                  : mode === "background"
                    ? "Background"
                    : "Plan"}
          </span>
          <ChevronDownIcon
            className="h-2 w-2 flex-shrink-0"
            aria-hidden="true"
          />
        </ListboxButton>
        <ListboxOptions className="min-w-32 max-w-48">
          <ListboxOption value="chat">
            <div className="flex flex-row items-center gap-1.5">
              <ModeIcon mode="chat" />
              <span className="">Chat</span>
              <ToolTip
                style={{
                  zIndex: 200001,
                }}
                content="All tools disabled"
              >
                <InformationCircleIcon
                  data-tooltip-id="chat-tip"
                  className="h-2.5 w-2.5 flex-shrink-0"
                />
              </ToolTip>
              <span
                className={`text-description-muted text-[${getFontSize() - 3}px] mr-auto`}
              >
                {getMetaKeyLabel()}L
              </span>
            </div>
            {mode === "chat" && <CheckIcon className="ml-auto h-3 w-3" />}
          </ListboxOption>
          <ListboxOption value="plan" className={"gap-1"}>
            <div className="flex flex-row items-center gap-1.5">
              <ModeIcon mode="plan" />
              <span className="">Plan</span>
              <ToolTip
                style={{
                  zIndex: 200001,
                }}
                content="Read-only/MCP tools available"
              >
                <InformationCircleIcon className="h-2.5 w-2.5 flex-shrink-0" />
              </ToolTip>
            </div>
            {!isGoodAtAgentMode && notGreatAtAgent("Plan")}
            <CheckIcon
              className={`ml-auto h-3 w-3 ${mode === "plan" ? "" : "opacity-0"}`}
            />
          </ListboxOption>

          <ListboxOption value="agent" className={"gap-1"}>
            <div className="flex flex-row items-center gap-1.5">
              <ModeIcon mode="agent" />
              <span className="">Agent</span>
              <ToolTip
                style={{
                  zIndex: 200001,
                }}
                content="All tools available"
              >
                <InformationCircleIcon className="h-2.5 w-2.5 flex-shrink-0" />
              </ToolTip>
            </div>
            {!isGoodAtAgentMode && notGreatAtAgent("Agent")}
            <CheckIcon
              className={`ml-auto h-3 w-3 ${mode === "agent" ? "" : "opacity-0"}`}
            />
          </ListboxOption>

          <ListboxOption value="expert" className={"gap-1"}>
            <div className="flex flex-row items-center gap-1.5">
              <UserGroupIcon className="h-3 w-3 flex-shrink-0" />
              <span>Expert Team</span>
              <ToolTip
                style={{ zIndex: 200001 }}
                content="Adaptive read-only specialists, Lead Reviewer synthesis, implementation, security and QA verification"
              >
                <InformationCircleIcon className="h-2.5 w-2.5 flex-shrink-0" />
              </ToolTip>
            </div>
            {!isGoodAtAgentMode && notGreatAtAgent("Expert Team")}
            <CheckIcon
              className={`ml-auto h-3 w-3 ${expertTeamEnabled ? "" : "opacity-0"}`}
            />
          </ListboxOption>

          {(backgroundAvailable || mode === "background") && (
            <ListboxOption value="background">
              <div className="flex flex-row items-center gap-1.5">
                <ModeIcon mode="background" />
                <span>Background</span>
                <ToolTip
                  style={{ zIndex: 200001 }}
                  content="Run an encrypted project copy in an isolated cloud sandbox"
                >
                  <InformationCircleIcon className="h-2.5 w-2.5 flex-shrink-0" />
                </ToolTip>
              </div>
              <CheckIcon
                className={`ml-auto h-3 w-3 ${mode === "background" ? "" : "opacity-0"}`}
              />
            </ListboxOption>
          )}

          <div className="text-description-muted px-2 py-1">
            {`${metaKeyLabel} . for next mode`}
          </div>
        </ListboxOptions>
      </div>
    </Listbox>
  );
}
