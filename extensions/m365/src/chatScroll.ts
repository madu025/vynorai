/**
 * Where the pane scrolls after a chat is shown: to the newest message (so a restored chat opens
 * at its end, above the request box), or to the top when the chat is empty.
 */
export interface ScrollRoot {
  querySelector(selector: string): {
    lastElementChild?: { scrollIntoView?: (options: object) => void } | null;
  } | null;
}
export interface ScrollWindow {
  scrollTo?: (options: object) => void;
}

export function scrollToLatestMessage(root: ScrollRoot, win: ScrollWindow): void {
  const last = root.querySelector("#conversation-history")?.lastElementChild;
  if (last?.scrollIntoView) last.scrollIntoView({ block: "end" });
  else win.scrollTo?.({ top: 0 });
}
