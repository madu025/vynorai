/**
 * Saved chats, like a chat app's history: each chat keeps its own messages, a new chat starts empty,
 * and an older one can be reopened. Pure data functions; the task pane only stores and renders them.
 */
export type ChatMessage = {
  kind: "user" | "assistant" | "error";
  text: string;
};

export interface ChatSession {
  id: string;
  title: string;
  updatedAt: number;
  messages: ChatMessage[];
}

export interface ChatStore {
  activeId: string;
  sessions: ChatSession[];
}

export const MAX_CHAT_SESSIONS = 20;
export const MAX_CHAT_MESSAGES = 12;
const MAX_TITLE_CHARS = 40;

export function emptyChatStore(): ChatStore {
  return { activeId: "", sessions: [] };
}

/** The title is the first thing the person asked, shortened. */
export function chatTitle(messages: readonly ChatMessage[]): string {
  const first = messages.find((message) => message.kind === "user");
  const text = (first?.text ?? "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  return text.length > MAX_TITLE_CHARS
    ? `${text.slice(0, MAX_TITLE_CHARS - 1).trimEnd()}…`
    : text;
}

const isMessage = (entry: unknown): entry is ChatMessage => {
  const value = entry as Partial<ChatMessage> | null;
  return Boolean(
    value &&
      (value.kind === "user" ||
        value.kind === "assistant" ||
        value.kind === "error") &&
      typeof value.text === "string",
  );
};

const cleanMessages = (entries: unknown, maxChars: number): ChatMessage[] =>
  Array.isArray(entries)
    ? entries
        .filter(isMessage)
        .slice(-MAX_CHAT_MESSAGES)
        .map((entry) => ({
          kind: entry.kind,
          text: entry.text.slice(0, maxChars),
        }))
    : [];

/** Reads a stored value; a damaged one is discarded. An old single-chat history becomes the first chat. */
export function parseChatStore(
  raw: string | null,
  legacyRaw: string | null,
  now: number,
  newId: () => string,
  maxChars = 300,
): ChatStore {
  try {
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed && Array.isArray(parsed.sessions)) {
      const sessions: ChatSession[] = parsed.sessions
        .filter(
          (entry: any) =>
            entry &&
            typeof entry.id === "string" &&
            Array.isArray(entry.messages),
        )
        .slice(-MAX_CHAT_SESSIONS)
        .map((entry: any) => {
          const messages = cleanMessages(entry.messages, maxChars);
          return {
            id: entry.id,
            title: chatTitle(messages),
            updatedAt: Number.isFinite(entry.updatedAt) ? entry.updatedAt : now,
            messages,
          };
        });
      const activeId = sessions.some((entry) => entry.id === parsed.activeId)
        ? parsed.activeId
        : (sessions.at(-1)?.id ?? "");
      return { activeId, sessions };
    }
  } catch {
    // fall through to the legacy history
  }
  try {
    const messages = cleanMessages(
      legacyRaw ? JSON.parse(legacyRaw) : [],
      maxChars,
    );
    if (messages.length) {
      const id = newId();
      return {
        activeId: id,
        sessions: [
          { id, title: chatTitle(messages), updatedAt: now, messages },
        ],
      };
    }
  } catch {
    // a damaged legacy history is ignored
  }
  return emptyChatStore();
}

export function activeMessages(store: ChatStore): ChatMessage[] {
  return (
    store.sessions.find((entry) => entry.id === store.activeId)?.messages ?? []
  );
}

/** Saves the messages of the open chat (creating the chat on its first message). */
export function saveActiveChat(
  store: ChatStore,
  messages: readonly ChatMessage[],
  now: number,
  newId: () => string,
): ChatStore {
  if (!messages.length) return store;
  const kept = messages.slice(-MAX_CHAT_MESSAGES);
  const exists = store.sessions.some((entry) => entry.id === store.activeId);
  const id = exists ? store.activeId : newId();
  const updated: ChatSession = {
    id,
    title: chatTitle(kept),
    updatedAt: now,
    messages: [...kept],
  };
  const sessions = exists
    ? store.sessions.map((entry) => (entry.id === id ? updated : entry))
    : [...store.sessions, updated];
  return { activeId: id, sessions: sessions.slice(-MAX_CHAT_SESSIONS) };
}

/** Starts an empty chat; the open chat is kept in the history. */
export function startNewChat(store: ChatStore): ChatStore {
  return { ...store, activeId: "" };
}

export function openChat(store: ChatStore, id: string): ChatStore {
  return store.sessions.some((entry) => entry.id === id)
    ? { ...store, activeId: id }
    : store;
}

export function deleteChat(store: ChatStore, id: string): ChatStore {
  const sessions = store.sessions.filter((entry) => entry.id !== id);
  return {
    sessions,
    activeId: store.activeId === id ? "" : store.activeId,
  };
}

/** Newest first, for the history list. */
export function historyList(store: ChatStore): ChatSession[] {
  return [...store.sessions]
    .filter((entry) => entry.messages.length > 0)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}
