/**
 * Where the pane scrolls after a chat is shown: to the newest message (so a restored chat opens
 * at its end, above the request box), or to the top when the chat is empty.
 */
export interface ScrollRoot {
  querySelector(selector: string): {
    lastElementChild?: { scrollIntoView?: (options: object) => void } | null;
    scrollTo?: (options: object) => void;
  } | null;
}
export interface ScrollWindow {
  scrollTo?: (options: object) => void;
}

/** The chat and cards scroll inside #scroll-area (above the request box), not the whole page. */
export function scrollToLatestMessage(root: ScrollRoot, win: ScrollWindow): void {
  const last = root.querySelector("#conversation-history")?.lastElementChild;
  if (last?.scrollIntoView) return last.scrollIntoView({ block: "end" });
  const area = root.querySelector("#scroll-area");
  if (area?.scrollTo) area.scrollTo({ top: 0 });
  else win.scrollTo?.({ top: 0 });
}
