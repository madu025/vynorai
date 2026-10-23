import type { ShareStyle } from "./shareStyle.js";

/**
 * The style picker under "Share as a picture" (#share-styles): one small thumbnail button per
 * style. It is shown only when the card can be drawn in more than one style, and a style the
 * card cannot show is hidden.
 */
export function updateStylePicker(
  root: HTMLElement | null,
  available: readonly ShareStyle[],
  current: ShareStyle,
  thumbnails: Partial<Record<ShareStyle, string>>,
): void {
  if (!root) return;
  root.hidden = available.length < 2;
  for (const button of root.querySelectorAll<HTMLButtonElement>("[data-style]")) {
    const style = button.dataset.style as ShareStyle;
    button.hidden = !available.includes(style);
    button.setAttribute("aria-pressed", String(style === current));
    const image = button.querySelector("img");
    const url = thumbnails[style];
    if (image && url) image.src = url;
  }
}

export function onStylePick(
  root: HTMLElement | null,
  handler: (style: ShareStyle) => void,
): void {
  root?.addEventListener("click", (event) => {
    const button = (event.target as Element | null)?.closest<HTMLButtonElement>(
      "[data-style]",
    );
    if (button?.dataset.style && !button.hidden)
      handler(button.dataset.style as ShareStyle);
  });
}
