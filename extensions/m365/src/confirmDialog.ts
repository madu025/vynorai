/**
 * Office task panes run in a sandboxed iframe where window.confirm is blocked in Excel, Word and
 * PowerPoint for the web (it returns false without showing anything). This in-pane dialog is the
 * replacement: it resolves true only when the person presses the confirm button.
 */
export function askInPane(
  message: string,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
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
    text.style.margin = "0 0 14px";
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
    box.append(text, row);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    cancel.focus();
  });
}
