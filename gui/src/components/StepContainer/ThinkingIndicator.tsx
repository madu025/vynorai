import { ChatHistoryItem } from "core";
import { useEffect, useState } from "react";
import { useAppSelector } from "../../redux/hooks";
import { selectSelectedChatModel } from "../../redux/slices/configSlice";

interface ThinkingIndicatorProps {
  historyItem: ChatHistoryItem;
}

/**
 * Detects the active operational phase from the thinking stream
 */
function detectIndicatorPhase(text: string): { label: string; icon: string } {
  if (!text) {
    return { label: "Thinking", icon: "🧠" };
  }

  const recent = text.slice(-400).toLowerCase();

  if (/audit|verif|syntax|check|secur|correct|test|lint|bug/i.test(recent)) {
    return { label: "Auditing", icon: "🛡️" };
  }
  if (/patch|refactor|diff|replac|surgical/i.test(recent)) {
    return { label: "Patching", icon: "🔧" };
  }
  if (/scaffold|boiler|templat|golden/i.test(recent)) {
    return { label: "Scaffolding", icon: "📦" };
  }
  if (/synthesiz|generat|coding|implement|code|writ/i.test(recent)) {
    return { label: "Synthesizing", icon: "⚡" };
  }
  if (/retriev|search|context|index|symbol|fil|workspace/i.test(recent)) {
    return { label: "Retrieving Context", icon: "📚" };
  }
  if (/plan|architect|bluepr|step|breakdown/i.test(recent)) {
    return { label: "Planning", icon: "🧠" };
  }
  if (/analyz|investigat|pars|evaluat|intent|requir/i.test(recent)) {
    return { label: "Analyzing", icon: "🔍" };
  }

  return { label: "Thinking", icon: "🧠" };
}

/*
    Dynamic Thinking animation for VynorAI reasoning and autonomous planning
*/
const ThinkingIndicator = ({ historyItem }: ThinkingIndicatorProps) => {
  // Animation for thinking ellipses
  const [animation, setAnimation] = useState(2);
  useEffect(() => {
    const interval = setInterval(() => {
      setAnimation((prevState) => (prevState === 2 ? 0 : prevState + 1));
    }, 600);
    return () => {
      clearInterval(interval);
    };
  }, []);

  const selectedModel = useAppSelector(selectSelectedChatModel);
  const isStreaming = useAppSelector((state) => state.session.isStreaming);

  const hasContent = Array.isArray(historyItem.message.content)
    ? !!historyItem.message.content.length
    : !!historyItem.message.content;

  const isReasoningModel =
    selectedModel?.model?.toLowerCase().includes("r1") ||
    selectedModel?.model?.toLowerCase().includes("reasoning") ||
    selectedModel?.model?.toLowerCase().includes("flash") ||
    selectedModel?.model?.toLowerCase().includes("o1") ||
    selectedModel?.model?.toLowerCase().includes("vynor") ||
    selectedModel?.title?.toLowerCase().includes("reasoning") ||
    selectedModel?.title?.toLowerCase().includes("r1");

  const hasActiveReasoning = Boolean(historyItem.reasoning?.active);
  const isThinking = isStreaming && !historyItem.isGatheringContext && (!hasContent || hasActiveReasoning);

  if (!isThinking || (!isReasoningModel && !hasActiveReasoning)) {
    return null;
  }

  const phase = detectIndicatorPhase(historyItem.reasoning?.text || "");

  return (
    <div className="flex items-center gap-1.5 px-2 py-2 text-xs">
      <span>{phase.icon}</span>
      <span className="text-lightgray">{`${phase.label}.${".".repeat(animation)}`}</span>
    </div>
  );
};

export default ThinkingIndicator;

