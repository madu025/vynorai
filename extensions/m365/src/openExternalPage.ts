/**
 * Opens a page in a new browser tab from the task pane.
 *
 * `window.open(url, "_blank", "noopener")` always returns null (HTML spec), so a result check cannot
 * tell "opened" from "blocked". Open without the feature string and cut the link to this window
 * afterwards instead: the new page still cannot reach us through `window.opener`.
 */
export interface OpenerWindow {
  open(url: string, target?: string): { opener: unknown } | null;
}

/** True when the browser returned a window handle (the tab opened); false when a blocker stopped it. */
export function openExternalPage(host: OpenerWindow, url: string): boolean {
  const opened = host.open(url, "_blank");
  if (!opened) return false;
  try {
    opened.opener = null;
  } catch {
    /* a cross-origin handle may refuse the write; the page is already open */
  }
  return true;
}
