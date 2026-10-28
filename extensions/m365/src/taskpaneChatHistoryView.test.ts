import assert from "node:assert/strict";
import { renderChatHistoryPopover } from "./taskpaneChatHistoryView.js";

class FakeElement {
  className = "";
  textContent = "";
  title = "";
  disabled = false;
  dataset: Record<string, string> = {};
  children: FakeElement[] = [];
  attributes = new Map<string, string>();
  type = "";
  append(...children: FakeElement[]) {
    this.children.push(...children);
  }
  replaceChildren(...children: FakeElement[]) {
    this.children = children;
  }
  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }
}

const elements = new Map<string, FakeElement>([
  ["#chat-history-list", new FakeElement()],
  ["#open-chat-history", new FakeElement()],
]);
const document = {
  querySelector<T>(selector: string) {
    return elements.get(selector) as T | undefined;
  },
  createElement() {
    return new FakeElement();
  },
} as unknown as Document;

renderChatHistoryPopover(document, "en", {
  activeId: "a",
  sessions: [
    {
      id: "a",
      title: "Revenue review",
      updatedAt: 2,
      messages: [{ kind: "user", text: "review" }],
    },
  ],
});

const list = elements.get("#chat-history-list")!;
assert.equal(list.children.length, 1);
assert.equal(list.children[0].children.length, 2);
assert.equal(list.children[0].children[0].dataset.chatId, "a");
assert.equal(list.children[0].children[1].dataset.deleteChatId, "a");
assert.equal(elements.get("#open-chat-history")!.disabled, false);
console.log("taskpaneChatHistoryView tests passed");
