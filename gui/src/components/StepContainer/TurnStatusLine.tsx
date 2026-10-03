import { useEffect, useRef, useState } from "react";
import styled, { keyframes } from "styled-components";
import { useAppSelector } from "../../redux/hooks";
import { deriveTurnStatus, TurnPhase } from "./turnStatus";

const shimmer = keyframes`
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
`;

const pulse = keyframes`
  0%, 100% { opacity: 0.45; transform: scale(0.9) rotate(0deg); }
  50% { opacity: 1; transform: scale(1.1) rotate(45deg); }
`;

// The "shining" label: a highlight sweeps across the text while work runs.
const ShimmerText = styled.span`
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
    color: var(--vscode-foreground, #ddd);
  }
`;

const Spark = styled.span<{ $phase: TurnPhase }>`
  display: inline-block;
  color: ${({ $phase }) =>
    $phase === "approval"
      ? "var(--vscode-editorWarning-foreground, #cca700)"
      : "var(--vscode-textLink-foreground, #3794ff)"};
  animation: ${pulse} 1.6s ease-in-out infinite;
  @media (prefers-reduced-motion: reduce) {
    animation: none;
  }
`;

// Rotated only while reasoning is actually streaming.
const THINKING_WORDS = [
  "Thinking",
  "Reasoning",
  "Working it out",
  "Considering",
];

function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

/**
 * Persistent status line for the turn in progress. Every value shown comes
 * from session state (stream flag, reasoning stream, tool-call status), so it
 * reflects what the model and tools are really doing.
 */
export function TurnStatusLine() {
  const history = useAppSelector((state) => state.session.history);
  const isStreaming = useAppSelector((state) => state.session.isStreaming);
  const status = deriveTurnStatus(history, isStreaming);

  const startedAt = useRef<number | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (isStreaming && startedAt.current === null)
      startedAt.current = Date.now();
    if (!isStreaming) startedAt.current = null;
  }, [isStreaming]);

  useEffect(() => {
    if (!status) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [status !== null]);

  if (!status) return null;

  const elapsed = startedAt.current ? now - startedAt.current : 0;
  const label =
    status.phase === "thinking"
      ? THINKING_WORDS[Math.floor(elapsed / 3000) % THINKING_WORDS.length]
      : status.label;

  return (
    <div
      className="text-description flex min-w-0 items-center gap-1.5 px-3 py-1 text-xs"
      data-testid="turn-status-line"
      role="status"
      aria-live="polite"
    >
      <Spark $phase={status.phase} aria-hidden="true">
        ✶
      </Spark>
      <ShimmerText className="truncate">{label}…</ShimmerText>
      <span className="text-description-muted shrink-0">
        {elapsed >= 1000 && ` · ${formatElapsed(elapsed)}`}
        {status.tokens > 0 && ` · ~${status.tokens.toLocaleString()} tokens`}
      </span>
    </div>
  );
}
