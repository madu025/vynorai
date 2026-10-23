import {
  historyList,
  type ChatMessage,
  type ChatStore,
} from "./chatSessions.js";
import { localizeMessage, translate, type Language } from "./i18n.js";
import {
  buildAnswerCard,
  recallAnswerResults,
  type AnswerCardData,
} from "./answerCard.js";
import { nextSteps } from "./followUps.js";
import { clampReply } from "./replyClamp.js";
import type { WorkspaceSchema } from "./smartWorkspace.js";
import { stripRanges } from "./selectionChip.js";

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
  /** The table facts for next-step chips under the latest answer. */
  schema?: WorkspaceSchema;
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
  const lastIndex = messages.length - 1;
  const lastMessage = messages[lastIndex];
  let steps: ReturnType<typeof nextSteps> = [];
  if (lastMessage && lastMessage.kind === "assistant") {
    const lastUser = [...messages].reverse().find((m) => m.kind === "user");
    steps = nextSteps({
      questions: buildAnswerCard({
        reply: localizeMessage(
          options.textLanguage ?? language,
          lastMessage.text,
        ),
        results: recallAnswerResults(lastMessage.text),
      }).chips,
      schema: options.schema,
      asked: lastUser?.text,
    });
  }
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
    const card =
      message.kind === "assistant"
        ? buildAnswerCard({
            reply: shown,
            results: recallAnswerResults(message.text),
          })
        : undefined;
    const drawn = card && !card.fallbackText ? card : undefined;
    const clamped =
      message.kind === "assistant" && !drawn ? clampReply(shown) : undefined;
    if (drawn) {
      body.append(
        renderAnswerCard(
          document,
          steps.length && index === lastIndex ? { ...drawn, chips: [] } : drawn,
          language,
          instruction,
        ),
        hiddenText(document, shown),
      );
    } else if (clamped && clamped.hiddenCount > 0) {
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
  if (steps.length) {
    const row = document.createElement("div");
    row.className = "next-steps";
    row.setAttribute("role", "group");
    row.setAttribute(
      "aria-label",
      translate(language, "next_steps", "Next steps"),
    );
    for (const step of steps) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "next-step";
      chip.textContent = step.label;
      chip.title = step.text;
      chip.addEventListener("click", () => {
        if (!instruction) return;
        instruction.value = step.text;
        instruction.dispatchEvent(new Event("input"));
        instruction.focus();
      });
      row.append(chip);
    }
    history.appendChild(row);
  }
}

/** The full reply, kept for screen readers and copy while the card is what people see. */
function hiddenText(document: Document, text: string): HTMLElement {
  const span = document.createElement("span");
  span.className = "sr-only";
  span.textContent = text;
  return span;
}

/** Draws the card: title, tiles, bars or a table, warning pills and follow-up chips. */
export function renderAnswerCard(
  document: Document,
  card: AnswerCardData,
  language: Language,
  instruction: HTMLTextAreaElement | null,
): HTMLElement {
  const el = (tag: string, className?: string, text?: string) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const root = el("div", "answer-card");
  root.setAttribute("aria-hidden", "true");
  {
    const heading = el("h3", "ac-title", stripRanges(card.title));
    heading.title = card.title;
    root.append(heading);
  }
  if (card.tiles.length) {
    const tiles = el("div", "ac-tiles");
    for (const tile of card.tiles) {
      const box = el("div", "ac-tile");
      box.append(
        el(
          "small",
          undefined,
          translate(language, "card_" + tile.label.toLowerCase(), tile.label),
        ),
        el("b", undefined, tile.value),
      );
      tiles.append(box);
    }
    root.append(tiles);
  }
  if (card.bars.length) {
    const bars = el("div", "ac-bars");
    for (const bar of card.bars) {
      const row = el("div", "ac-bar");
      const fill = el("i");
      fill.style.width = Math.max(2, Math.round(bar.ratio * 100)) + "%";
      const track = el("span", "ac-track");
      track.append(fill);
      row.append(
        el("span", "ac-label", bar.label),
        track,
        el("span", "ac-value", bar.value),
      );
      bars.append(row);
    }
    root.append(bars);
  }
  if (card.table) {
    const wrap = el("div", "ac-tablewrap");
    const table = el("table", "ac-table");
    const head = el("tr");
    for (const h of card.table.headers) head.append(el("th", undefined, h));
    table.append(head);
    for (const r of card.table.rows) {
      const tr = el("tr");
      for (const cell of r)
        tr.append(el("td", /^-?[d,.]+$/.test(cell) ? "n" : undefined, cell));
      table.append(tr);
    }
    wrap.append(table);
    root.append(wrap);
  }
  if (card.pills.length) {
    const pills = el("div", "ac-pills");
    for (const pill of card.pills) {
      const node = el("span", "ac-pill " + pill.tone, stripRanges(pill.text));
      node.title = pill.text;
      pills.append(node);
    }
    root.append(pills);
  }
  if (card.more.length) {
    const rest = el("div", "ac-more");
    rest.hidden = true;
    for (const text of card.more) rest.append(el("p", undefined, text));
    const toggle = el(
      "button",
      "reply-more",
      `${translate(language, "show_more", "Show more")} (${card.more.length})`,
    ) as HTMLButtonElement;
    toggle.type = "button";
    toggle.setAttribute("aria-expanded", "false");
    toggle.addEventListener("click", () => {
      const open = toggle.getAttribute("aria-expanded") !== "true";
      rest.hidden = !open;
      toggle.setAttribute("aria-expanded", String(open));
      toggle.textContent = open
        ? translate(language, "show_less", "Show less")
        : `${translate(language, "show_more", "Show more")} (${card.more.length})`;
    });
    root.removeAttribute("aria-hidden");
    root.append(toggle, rest);
  }
  if (card.chips.length) {
    const chips = el("div", "ac-chips");
    for (const text of card.chips) {
      const chip = el("button", "ac-chip", text) as HTMLButtonElement;
      chip.type = "button";
      chip.addEventListener("click", () => {
        if (!instruction) return;
        instruction.value = text;
        instruction.focus();
      });
      chips.append(chip);
    }
    // Chips are controls: they stay reachable even though the card text is read from the hidden copy.
    root.removeAttribute("aria-hidden");
    root.append(chips);
  }
  return root;
}
