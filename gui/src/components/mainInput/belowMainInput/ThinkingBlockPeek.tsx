// src/components/ThinkingBlockPeek.tsx
import { ChevronDownIcon } from "@heroicons/react/24/outline";
import { ChevronUpIcon } from "@heroicons/react/24/solid";
import { ChatHistoryItem } from "core";
import { useEffect, useMemo, useState } from "react";
import styled, { keyframes } from "styled-components";

import StyledMarkdownPreview from "../../StyledMarkdownPreview";
import { Button } from "../../ui";

const MarkdownWrapper = styled.div`
  & > div > *:first-child {
    margin-top: 0 !important;
  }
`;

const shimmer = keyframes`
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
`;

const ShimmerLabel = styled.span`
  background: linear-gradient(
    90deg,
    var(--vscode-descriptionForeground, #888) 0%,
    var(--vscode-foreground, #ddd) 50%,
    var(--vscode-descriptionForeground, #888) 100%
  );
  background-size: 200% 100%;
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  animation: ${shimmer} 2.4s linear infinite;
  @media (prefers-reduced-motion: reduce) {
    animation: none;
    color: inherit;
  }
`;

interface ThinkingBlockPeekProps {
  content: string;
  redactedThinking?: string;
  index: number;
  prevItem: ChatHistoryItem | null;
  inProgress?: boolean;
  signature?: string;
  /** Approximate reasoning tokens streamed so far. */
  tokens?: number;
  /** Real reasoning duration from the stream's start/end timestamps. */
  durationMs?: number;
}

// Only explicit model identifiers are white-labelled. Bare words such as
// "DeepSeek", "Qwen" or "R1" may be the user's own API, file or cell name.
const MODEL_NAME_PATTERNS: Array<[RegExp, string]> = [
  [
    /\b(?:Local\s+)?Qwen[\s-]*(?:2(?:\.5)?[\s-]*)?(?:Coder[\s-]*)?\d+(?:\.\d+)?B\b/gi,
    "Architecture Engine",
  ],
  [/\b(?:Local\s+)?Qwen[\s-]*2\.5(?:[\s-]*Coder)?\b/gi, "Architecture Engine"],
  [
    /\bDeepSeek[\s-]*(?:V\d+(?:\.\d+)?[\s-]*)?(?:Flash|Pro)\b/gi,
    "Code Synthesis Engine",
  ],
  [/\bDeepSeek[\s-]*R1\b/gi, "Deep Reasoning Engine"],
  [/\bllama\.cpp\b/gi, "Core Local Runtime"],
];

/**
 * White-label internal model names in the thought stream, leaving fenced and
 * inline code untouched so identifiers and API names keep their meaning.
 */
export function sanitizeThinkingContent(text: string): string {
  if (!text) return "";
  return text
    .split(/(```[\s\S]*?```|`[^`\n]*`)/g)
    .map((part, i) =>
      i % 2 === 1
        ? part
        : MODEL_NAME_PATTERNS.reduce(
            (acc, [re, label]) => acc.replace(re, label),
            part,
          ),
    )
    .join("");
}

function ThinkingBlockPeek({
  content,
  redactedThinking,
  index,
  prevItem,
  inProgress,
  tokens,
  durationMs,
}: ThinkingBlockPeekProps) {
  const [open, setOpen] = useState(false);
  const [startTime, setStartTime] = useState<number | null>(null);
  const [elapsedTime, setElapsedTime] = useState<string>("");

  const duplicateRedactedThinkingBlock =
    prevItem &&
    prevItem.message.role === "thinking" &&
    redactedThinking &&
    prevItem.message.redactedThinking;

  // Fallback timer for streams without start/end timestamps.
  useEffect(() => {
    if (inProgress) {
      setStartTime(Date.now());
      setElapsedTime("");
    } else if (startTime) {
      setElapsedTime(`${((Date.now() - startTime) / 1000).toFixed(1)}s`);
    }
  }, [inProgress]);

  const shownElapsed =
    durationMs !== undefined
      ? `${(durationMs / 1000).toFixed(1)}s`
      : elapsedTime;
  const sanitizedContent = useMemo(
    () => sanitizeThinkingContent(content),
    [content],
  );

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
                {redactedThinking ? (
                  <span>Redacted Thinking…</span>
                ) : (
                  <ShimmerLabel>Thinking…</ShimmerLabel>
                )}
                {!!tokens && (
                  <span className="text-description-muted">
                    · ~{tokens.toLocaleString()} tokens
                  </span>
                )}
              </span>
            ) : redactedThinking ? (
              "Redacted Thinking"
            ) : (
              <span className="flex items-center gap-1.5">
                <span className="text-xs leading-none">✨</span>
                <span>
                  {"Thought" +
                    (shownElapsed ? ` for ${shownElapsed}` : "") +
                    (tokens ? ` · ~${tokens.toLocaleString()} tokens` : "")}
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
