/**
 * Office task panes run in a sandboxed iframe where window.confirm is blocked in Excel, Word and
 * PowerPoint for the web (it returns false without showing anything). This in-pane dialog is the
 * replacement: it resolves true only when the person presses the confirm button.
 */
/** A short structured summary shown instead of a sentence: a title, figure tiles and small tags. */
export interface PaneCard {
  title: string;
  tiles: { label: string; value: string; warn?: boolean }[];
  tags: { text: string; warn?: boolean }[];
}

function cardNode(card: PaneCard): HTMLElement {
  const wrap = document.createElement("div");
  wrap.style.cssText = "margin:0 0 14px";
  const title = document.createElement("strong");
  title.textContent = card.title;
  title.style.cssText = "display:block;font-size:15px;margin-bottom:10px";
  const tiles = document.createElement("div");
  tiles.style.cssText =
    "display:grid;grid-template-columns:repeat(auto-fit,minmax(84px,1fr));gap:8px;margin-bottom:10px";
  for (const tile of card.tiles) {
    const cell = document.createElement("div");
    cell.style.cssText =
      "border:1px solid #dbe2ea;border-radius:10px;padding:7px 9px;background:#f5f7fa;min-width:0";
    const label = document.createElement("small");
    label.textContent = tile.label;
    label.style.cssText = "display:block;color:#5b6b7f;font-size:11px";
    const value = document.createElement("b");
    value.textContent = tile.value;
    value.style.cssText = `font:600 14px ui-monospace,monospace;overflow-wrap:anywhere;${tile.warn ? "color:#9a6700" : ""}`;
    cell.append(label, value);
    tiles.appendChild(cell);
  }
  const tags = document.createElement("div");
  tags.style.cssText = "display:flex;gap:6px;flex-wrap:wrap";
  for (const tag of card.tags) {
    const pill = document.createElement("span");
    pill.textContent = tag.text;
    pill.style.cssText = `border-radius:99px;padding:2px 9px;font-size:11px;font-weight:600;${tag.warn ? "background:#fff3d6;color:#9a6700" : "background:#e2f5ea;color:#0f6b3a"}`;
    tags.appendChild(pill);
  }
  wrap.append(title, tiles, tags);
  return wrap;
}

export function askInPane(
  message: string,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  card?: PaneCard,
): Promise<boolean> {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.style.cssText =
      "position:fixed;inset:0;z-index:50;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(15,23,42,.45)";
    const box = document.createElement("div");
    box.style.cssText =
      "max-width:320px;width:100%;padding:18px;border-radius:16px;background:#fff;color:#1b2a41;box-shadow:0 12px 32px rgba(15,23,42,.25);font:14px/1.45 system-ui,sans-serif";
    const text = document.createElement("p");
    text.style.cssText =
      "margin:0 0 14px;white-space:pre-wrap;max-height:50vh;overflow:auto";
    text.textContent = message;
    const row = document.createElement("div");
    row.style.cssText = "display:flex;gap:8px;justify-content:flex-end";
    const finish = (value: boolean) => {
      overlay.remove();
      resolve(value);
    };
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.textContent = cancelLabel;
    cancel.style.cssText =
      "padding:8px 12px;border:1px solid #dbe2ea;border-radius:10px;background:transparent;cursor:pointer";
    cancel.addEventListener("click", () => finish(false));
    const ok = document.createElement("button");
    ok.type = "button";
    ok.textContent = confirmLabel;
    ok.style.cssText =
      "padding:8px 14px;border:0;border-radius:10px;background:#123a6b;color:#fff;font-weight:600;cursor:pointer";
    ok.addEventListener("click", () => finish(true));
    overlay.addEventListener("keydown", (event) => {
      if (event.key === "Escape") finish(false);
    });
    row.append(cancel, ok);
    box.append(card ? cardNode(card) : text, row);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    cancel.focus();
  });
}
