import assert from "node:assert/strict";
import { test } from "node:test";
import {
  activeMessages,
  chatTitle,
  deleteChat,
  emptyChatStore,
  historyList,
  MAX_CHAT_SESSIONS,
  openChat,
  parseChatStore,
  saveActiveChat,
  startNewChat,
  type ChatMessage,
} from "./chatSessions.js";

let counter = 0;
const newId = () => `chat-${(counter += 1)}`;
const say = (
  text: string,
  kind: ChatMessage["kind"] = "user",
): ChatMessage => ({ kind, text });

test("a new chat starts empty and the earlier chat stays in the history", () => {
  let store = saveActiveChat(
    emptyChatStore(),
    [say("pivot of Sales by Region"), say("Done", "assistant")],
    1,
    newId,
  );
  const first = store.activeId;
  assert.equal(historyList(store)[0].title, "pivot of Sales by Region");
  store = startNewChat(store);
  assert.deepEqual(activeMessages(store), []);
  store = saveActiveChat(store, [say("chart of Cost by Month")], 2, newId);
  assert.notEqual(store.activeId, first);
  assert.deepEqual(
    historyList(store).map((entry) => entry.title),
    ["chart of Cost by Month", "pivot of Sales by Region"],
  );
});

test("an older chat can be reopened with its own messages and then deleted", () => {
  let store = saveActiveChat(
    emptyChatStore(),
    [say("first request")],
    1,
    newId,
  );
  const first = store.activeId;
  store = saveActiveChat(
    startNewChat(store),
    [say("second request")],
    2,
    newId,
  );
  store = openChat(store, first);
  assert.equal(activeMessages(store)[0].text, "first request");
  store = saveActiveChat(
    store,
    [...activeMessages(store), say("answer", "assistant")],
    3,
    newId,
  );
  assert.equal(
    store.sessions.find((entry) => entry.id === first)?.messages.length,
    2,
  );
  assert.equal(store.sessions.length, 2);
  store = deleteChat(store, first);
  assert.equal(store.sessions.length, 1);
  assert.equal(store.activeId, "");
  assert.equal(openChat(store, "missing"), store);
});

test("the history keeps the newest chats only and titles are short", () => {
  let store = emptyChatStore();
  for (let index = 0; index < MAX_CHAT_SESSIONS + 5; index += 1)
    store = saveActiveChat(
      startNewChat(store),
      [say(`request ${index}`)],
      index,
      newId,
    );
  assert.equal(store.sessions.length, MAX_CHAT_SESSIONS);
  assert.equal(historyList(store)[0].title, `request ${MAX_CHAT_SESSIONS + 4}`);
  assert.ok(chatTitle([say("x".repeat(100))]).length <= 40);
  assert.equal(chatTitle([say("only an answer", "assistant")]), "");
});

test("stored chats are validated, and an old single-chat history becomes the first chat", () => {
  const legacy = JSON.stringify([
    say("old request"),
    say("old answer", "assistant"),
    { kind: "bogus", text: 1 },
  ]);
  const migrated = parseChatStore(null, legacy, 5, newId);
  assert.equal(migrated.sessions.length, 1);
  assert.equal(activeMessages(migrated).length, 2);
  assert.equal(migrated.sessions[0].title, "old request");
  assert.deepEqual(
    parseChatStore("{not json", null, 5, newId),
    emptyChatStore(),
  );
  const raw = JSON.stringify({
    activeId: "gone",
    sessions: [
      { id: "a", updatedAt: 3, messages: [say("kept")] },
      { id: 7, messages: [] },
    ],
  });
  const parsed = parseChatStore(raw, null, 9, newId);
  assert.equal(parsed.sessions.length, 1);
  assert.equal(parsed.activeId, "a");
});

test("a different workbook starts a new chat; the same or an unknown one keeps it", async () => {
  const { shouldStartNewChat } = await import("./chatSessions.js");
  assert.equal(shouldStartNewChat("a1", "b2"), true);
  assert.equal(shouldStartNewChat("a1", "a1"), false);
  assert.equal(shouldStartNewChat(null, "b2"), false);
  assert.equal(shouldStartNewChat("a1", undefined), false);
  assert.equal(shouldStartNewChat("", ""), false);
});
