import { ChatHistoryItem } from "core";
import { renderChatMessage } from "core/util/messageContent";

export const EMPTY_ANSWER_MARKER = "[empty-answer]";

/** Without a limit, a model that keeps answering with nothing would loop. */
export const MAX_EMPTY_ANSWER_GATES = 2;

/**
 * The model's last answer had no text and no tool call (a reasoning model can
 * spend its whole answer thinking). A build run ended this way after three
 * model calls with no file written and nothing shown to the user.
 */
export function emptyAnswerGate(history: ChatHistoryItem[]): boolean {
  let gates = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    const { message, isAutoPrompt } = history[i];
    if (message.role !== "user") continue;
    if (!isAutoPrompt) break;
    if (renderChatMessage(message).startsWith(EMPTY_ANSWER_MARKER)) gates++;
  }
  if (gates >= MAX_EMPTY_ANSWER_GATES) return false;

  let answered = false;
  for (let i = history.length - 1; i >= 0; i--) {
    const { message, toolCallStates } = history[i];
    if (message.role !== "assistant" && message.role !== "thinking") break;
    answered = true;
    if ((toolCallStates ?? []).length > 0) return false;
    if (
      message.role === "assistant" &&
      renderChatMessage(message).trim() !== ""
    ) {
      return false;
    }
  }
  return answered;
}

export const EMPTY_ANSWER_PROMPT = `${EMPTY_ANSWER_MARKER} Your last answer had no text and no tool call, so nothing happened. The task is not finished. Carry on now: call the next tool. If everything the user asked for is really done and verified, say so in a short report.`;
