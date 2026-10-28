import { historyList, type ChatStore } from "./chatSessions.js";
import { translate, type Language } from "./i18n.js";

export function renderChatHistoryPopover(
  document: Document,
  language: Language,
  store: ChatStore,
): void {
  const list = document.querySelector<HTMLElement>("#chat-history-list");
  const trigger =
    document.querySelector<HTMLButtonElement>("#open-chat-history");
  if (!list) return;
  const entries = historyList(store);
  if (trigger) {
    trigger.disabled = entries.length === 0;
    trigger.setAttribute("aria-disabled", String(entries.length === 0));
  }
  list.replaceChildren(
    ...entries.map((entry) => {
      const row = document.createElement("div");
      row.className = "chat-history-entry";
      row.setAttribute("role", "listitem");
      const open = document.createElement("button");
      open.type = "button";
      open.className = "chat-history-open";
      open.dataset.chatId = entry.id;
      const untitled = translate(language, "untitled_chat", "Untitled chat");
      open.title = entry.title || untitled;
      const title = document.createElement("strong");
      title.textContent = entry.title || untitled;
      const date = document.createElement("small");
      date.textContent = new Date(entry.updatedAt).toLocaleDateString();
      open.append(title, date);
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "chat-history-remove";
      remove.dataset.deleteChatId = entry.id;
      const deleteWord = translate(language, "delete_chat", "Delete");
      remove.setAttribute(
        "aria-label",
        `${deleteWord} ${entry.title || untitled}`,
      );
      remove.title = deleteWord;
      remove.textContent = "×";
      row.append(open, remove);
      return row;
    }),
  );
}
