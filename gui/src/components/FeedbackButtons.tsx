import {
  HandThumbDownIcon,
  HandThumbUpIcon,
} from "@heroicons/react/24/outline";
import { ChatHistoryItem } from "core";
import { useContext, useState } from "react";
import { IdeMessengerContext } from "../context/IdeMessenger";
import { useAppSelector } from "../redux/hooks";
import HeaderButtonWithToolTip from "./gui/HeaderButtonWithToolTip";

export interface FeedbackButtonsProps {
  item: ChatHistoryItem;
}

export function FeedbackButtons({ item }: FeedbackButtonsProps) {
  const [feedback, setFeedback] = useState<boolean | undefined>(undefined);
  const ideMessenger = useContext(IdeMessengerContext);
  const sessionId = useAppSelector((store) => store.session.id);
  const history = useAppSelector((store) => store.session.history);

  const sendFeedback = (feedback: boolean) => {
    setFeedback(feedback);
    // The real user prompt this answer belongs to (auto prompts skipped).
    const at = history.findIndex((h) => h === (item as unknown));
    const prompt = history
      .slice(0, at === -1 ? history.length : at)
      .reverse()
      .find((h) => h.message.role === "user" && !h.isAutoPrompt);
    const content = prompt?.message.content;
    const text =
      typeof content === "string"
        ? content
        : Array.isArray(content)
          ? content.map((p) => (p.type === "text" ? p.text : "")).join("")
          : "";
    if (text)
      ideMessenger.post("vynor/feedback", {
        prompt: text,
        signal: feedback ? "helpful" : "unhelpful",
      });
    if (item.promptLogs?.length) {
      for (const promptLog of item.promptLogs) {
        const { modelTitle, modelProvider, ...logData } = promptLog;
        ideMessenger.post("devdata/log", {
          name: "chatFeedback",
          data: {
            ...logData,
            completionOptions: {}, // TODO delete completionOptions from @continuedev/config-yaml
            modelProvider: modelProvider || "unknown",
            modelName: modelTitle,
            modelTitle: modelTitle,
            feedback,
            sessionId,
          },
        });
      }
    }
  };

  return (
    <>
      <HeaderButtonWithToolTip
        text="Helpful"
        tabIndex={-1}
        onClick={() => sendFeedback(true)}
      >
        <HandThumbUpIcon
          className={`mx-0.5 h-3.5 w-3.5 ${feedback === true ? "text-success" : "text-description-muted"}`}
        />
      </HeaderButtonWithToolTip>
      <HeaderButtonWithToolTip
        text="Unhelpful"
        tabIndex={-1}
        onClick={() => sendFeedback(false)}
      >
        <HandThumbDownIcon
          className={`h-3.5 w-3.5 ${feedback === false ? "text-error" : "text-description-muted"}`}
        />
      </HeaderButtonWithToolTip>
    </>
  );
}
