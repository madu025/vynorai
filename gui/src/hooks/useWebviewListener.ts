import type { ToWebviewProtocol } from "core/protocol/index.js";
import { Message } from "core/protocol/messenger";
import { useContext, useEffect } from "react";
import { IdeMessengerContext } from "../context/IdeMessenger";

/**
 * Request ids that already got an answer. Several components may listen for
 * the same message type; the extension takes the first answer, so answering
 * once is enough. Each further answer used to come back from the extension
 * as an error message of the same type, which every listener handled and
 * answered again without end.
 */
const answeredIds = new Set<string>();
const MAX_ANSWERED_IDS = 1000;

function markAnswered(id: string): boolean {
  if (answeredIds.has(id)) return false;
  answeredIds.add(id);
  if (answeredIds.size > MAX_ANSWERED_IDS) {
    const oldest = answeredIds.values().next().value;
    if (oldest !== undefined) answeredIds.delete(oldest);
  }
  return true;
}

/** The extension's reply to a webview request has this shape; no request does. */
function looksLikeProtocolReply(data: unknown): boolean {
  if (!data || typeof data !== "object") return false;
  const d = data as Record<string, unknown>;
  return d.done === true && (d.status === "error" || d.status === "success");
}

export function useWebviewListener<T extends keyof ToWebviewProtocol>(
  messageType: T,
  handler: (data: ToWebviewProtocol[T][0]) => Promise<ToWebviewProtocol[T][1]>,
  dependencies?: any[],
  skip?: boolean,
) {
  const ideMessenger = useContext(IdeMessengerContext);

  useEffect(
    () => {
      let listener: (event: {
        data: Message<ToWebviewProtocol[T][0]>;
      }) => Promise<void>;

      if (!skip) {
        listener = async (event) => {
          if (event.data.messageType === messageType) {
            // An error or success reply that came back under the request's
            // type is not a new request.
            if (looksLikeProtocolReply(event.data.data)) return;
            const result = await handler(event.data.data);
            const id = event.data.messageId;
            if (id === undefined || markAnswered(id)) {
              ideMessenger.respond(messageType, result, id);
            }
          }
        };

        window.addEventListener("message", listener);
      }

      return () => {
        if (listener) {
          window.removeEventListener("message", listener);
        }
      };
    },
    dependencies ? [...dependencies, skip, ideMessenger] : [skip, ideMessenger],
  );
}
