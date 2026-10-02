// src/components/ThinkingBlockPeek.tsx
import { ChevronDownIcon } from "@heroicons/react/24/outline";
import { ChevronUpIcon } from "@heroicons/react/24/solid";
import { ChatHistoryItem } from "core";
import { useEffect, useMemo, useState } from "react";
import styled from "styled-components";

import { AnimatedEllipsis } from "../../AnimatedEllipsis";
import StyledMarkdownPreview from "../../StyledMarkdownPreview";
import { Button } from "../../ui";

const MarkdownWrapper = styled.div`
  & > div > *:first-child {
    margin-top: 0 !important;
  }
`;

interface ThinkingBlockPeekProps {
  content: string;
  redactedThinking?: string;
  index: number;
  prevItem: ChatHistoryItem | null;
  inProgress?: boolean;
  signature?: string;
  tokens?: number;
}

/**
 * Strips internal model names and technical provider terms from user-facing thought stream
 * to preserve a unified, enterprise-grade VynorAI appearance.
 */
function sanitizeThinkingContent(text: string): string {
  if (!text) return "";
  return text
    .replace(/\(?(?:Local\s+)?Qwen(?:\s*2\.5)?(?:\s*Coder)?(?:\s*3B)?\)?/gi, "(Autonomous Architecture Engine)")
    .replace(/\(?(?:DeepSeek(?:-|\s+))?V4\.1(?:-|\s+)?Flash\)?/gi, "(Code Synthesis Engine)")
    .replace(/\(?(?:DeepSeek(?:-|\s+))?R1\)?/gi, "(Deep Reasoning Engine)")
    .replace(/\(?(?:llama\.cpp|ollama)\)?/gi, "(Core Local Runtime)")
    .replace(/\bQwen\b/gi, "Reasoner")
    .replace(/\bDeepSeek\b/gi, "Synthesizer");
}

/**
 * Detects the active operational phase from the thinking stream
 */
function detectThinkingPhase(text: string): { label: string; icon: string } {
  if (!text) {
    return { label: "Thinking", icon: "🧠" };
  }

  // Look at the latest 400 characters to reflect current activity
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

function ThinkingBlockPeek({
  content,
  redactedThinking,
  index,
  prevItem,
  inProgress,
  tokens,
}: ThinkingBlockPeekProps) {
  const [open, setOpen] = useState(false);
  const [startTime, setStartTime] = useState<number | null>(null);
  const [elapsedTime, setElapsedTime] = useState<string>("");

  const duplicateRedactedThinkingBlock =
    prevItem &&
    prevItem.message.role === "thinking" &&
    redactedThinking &&
    prevItem.message.redactedThinking;

  useEffect(() => {
    if (inProgress) {
      setStartTime(Date.now());
      setElapsedTime("");
    } else if (startTime) {
      const endTime = Date.now();
      const diff = endTime - startTime;
      const diffString = `${(diff / 1000).toFixed(1)}s`;
      setElapsedTime(diffString);
    }
  }, [inProgress]);

  const sanitizedContent = useMemo(() => sanitizeThinkingContent(content), [content]);
  const activePhase = useMemo(() => detectThinkingPhase(content), [content]);

  return duplicateRedactedThinkingBlock ? null : (
    <div className="thread-message">
      <div className="mt-1 flex flex-col px-4">
        <div>
          <Button
            variant="outline"
            className="text-description flex-0 border-border m-0 mb-2 flex min-w-0 cursor-pointer flex-row items-center gap-1.5 rounded-full border-[0.5px] border-solid px-3 text-xs transition-colors duration-200 ease-in-out hover:brightness-125"
            data-testid="thinking-block-peek"
            aria-expanded={open}
            aria-controls={`thinking-block-content-${index}`}
            onClick={() => setOpen(!open)}
          >
            {inProgress ? (
              <span className="flex items-center gap-1.5">
                <span className="text-xs leading-none">{activePhase.icon}</span>
                <span>{redactedThinking ? "Redacted Thinking" : activePhase.label}</span>
                <AnimatedEllipsis />
              </span>
            ) : redactedThinking ? (
              "Redacted Thinking"
            ) : (
              <span className="flex items-center gap-1.5">
                <span className="text-xs leading-none">✨</span>
                <span>
                  {"Thought" +
                    (elapsedTime ? ` for ${elapsedTime}` : "") +
                    (tokens ? ` (${tokens} tokens)` : "")}
                </span>
              </span>
            )}
            {open ? (
              <ChevronUpIcon className="h-3 w-3" />
            ) : (
              <ChevronDownIcon className="h-3 w-3" />
            )}
          </Button>
        </div>
        <div
          id={`thinking-block-content-${index}`}
          className={`overflow-y-auto transition-all duration-300 ease-in-out ${
            open ? "max-h-[50vh] opacity-100" : "max-h-0 opacity-0"
          }`}
        >
          {redactedThinking ? (
            <div className="text-description pl-5 text-xs italic">
              Thinking content redacted due to safety reasons.
            </div>
          ) : (
            <MarkdownWrapper>
              <StyledMarkdownPreview
                isRenderingInStepContainer
                source={sanitizedContent}
                itemIndex={index}
              />
            </MarkdownWrapper>
          )}
        </div>
      </div>
    </div>
  );
}

export default ThinkingBlockPeek;

