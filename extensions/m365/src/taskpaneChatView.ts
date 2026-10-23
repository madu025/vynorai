import {
  historyList,
  type ChatMessage,
  type ChatStore,
} from "./chatSessions.js";
import { localizeMessage, translate, type Language } from "./i18n.js";
import { clampReply } from "./replyClamp.js";

export interface ChatViewOptions {
  document: Document;
  language: Language;
  /** The language of the request in progress, for message text; labels keep `language`. */
  textLanguage?: Language;
  store: ChatStore;
  messages: readonly ChatMessage[];
  instruction: HTMLTextAreaElement | null;
  contextSuggestionsVisible: boolean;
  contextSuggestionCount: number;
  setStatus(message: string): void;
}

/** Renders only the chat picker controls; it does not mutate chat state or workbook state. */
export function renderChatListView(options: ChatViewOptions): void {
  const { document, language, store, messages } = options;
  const select = document.querySelector<HTMLSelectElement>(
    "#chat-history-select",
  );
  const remove = document.querySelector<HTMLButtonElement>("#delete-chat");
  if (!select) return;
  const saved = historyList(store);
  select.replaceChildren();
  const fresh = document.createElement("option");
  fresh.value = "";
  fresh.textContent = translate(language, "chat_history", "Chat history");
  select.appendChild(fresh);
  for (const entry of saved) {
    const option = document.createElement("option");
    option.value = entry.id;
    option.textContent = `${entry.title || "…"} · ${new Date(entry.updatedAt).toLocaleDateString()}`;
    select.appendChild(option);
  }
  select.value = saved.some((entry) => entry.id === store.activeId)
    ? store.activeId
    : "";
  select.hidden = saved.length === 0;
  // Chat controls are a top-level workspace affordance. Keep New chat visible even for a
  // brand-new workbook; history and delete remain conditional on saved conversations.
  document.querySelector<HTMLElement>("#chat-bar")?.removeAttribute("hidden");
  document.querySelector<HTMLElement>("#new-chat")?.removeAttribute("hidden");
  if (remove)
    remove.hidden = !saved.some((entry) => entry.id === store.activeId);
}

/** Renders bounded conversation messages and the edit action for the latest user request. */
export function renderConversationHistoryView(options: ChatViewOptions): void {
  const {
    document,
    language,
    messages,
    instruction,
    contextSuggestionsVisible,
    contextSuggestionCount,
    setStatus,
  } = options;
  const history = document.querySelector<HTMLElement>("#conversation-history");
  if (!history) return;
  history.replaceChildren();
  document
    .querySelector<HTMLElement>("#welcome-state")
    ?.toggleAttribute("hidden", messages.length > 0);
  const starter = document.querySelector<HTMLElement>("#starter-suggestions");
  starter?.toggleAttribute(
    "hidden",
    messages.length > 0 ||
      (contextSuggestionsVisible && contextSuggestionCount > 0),
  );
  messages.forEach((message, index) => {
    const item = document.createElement("article");
    item.className = `message ${message.kind}`;
    const label = document.createElement("span");
    label.className = "message-label";
    label.textContent =
      message.kind === "user"
        ? translate(language, "conversation_you", "You")
        : message.kind === "error"
          ? translate(language, "conversation_attention", "Needs attention")
          : "VynorAI";
    const body = document.createElement("span");
    body.className = "message-body";
    const shown = localizeMessage(
      options.textLanguage ?? language,
      message.text,
    );
    const clamped =
      message.kind === "assistant" ? clampReply(shown) : undefined;
    if (clamped && clamped.hiddenCount > 0) {
      clamped.lines.forEach((line) => {
        const row = document.createElement("span");
        row.className = `reply-line${line.bullet ? " reply-bullet" : ""}${line.extra ? " reply-extra" : ""}`;
        row.textContent = line.text;
        if (line.extra) row.hidden = true;
        body.append(row);
      });
    } else body.textContent = shown;
    item.append(label, body);
    if (clamped && clamped.hiddenCount > 0) {
      const more = document.createElement("button");
      more.type = "button";
      more.className = "reply-more";
      more.setAttribute("aria-expanded", "false");
      const labelMore = `${translate(language, "show_more", "Show more")} (${clamped.hiddenCount})`;
      const labelLess = translate(language, "show_less", "Show less");
      more.textContent = labelMore;
      more.addEventListener("click", () => {
        const open = more.getAttribute("aria-expanded") !== "true";
        body
          .querySelectorAll<HTMLElement>(".reply-extra")
          .forEach((row) => (row.hidden = !open));
        more.setAttribute("aria-expanded", String(open));
        more.textContent = open ? labelLess : labelMore;
      });
      item.append(more);
    }
    if (message.kind === "user" && index === messages.length - 1) {
      const tools = document.createElement("div");
      tools.className = "message-tools";
      const edit = document.createElement("button");
      edit.type = "button";
      edit.className = "edit-request";
      edit.textContent = translate(language, "edit_request", "Edit request");
      edit.setAttribute(
        "aria-label",
        translate(language, "edit_request", "Edit request"),
      );
      edit.addEventListener("click", () => {
        if (!instruction) return;
        instruction.value = message.text;
        instruction.focus();
        instruction.setSelectionRange(
          instruction.value.length,
          instruction.value.length,
        );
        setStatus(
          translate(language, "edit_ready", "Ready to edit your last request."),
        );
      });
      tools.append(edit);
      item.append(tools);
    }
    history.appendChild(item);
  });
}
