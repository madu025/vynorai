export type WorkspaceView = "work" | "results" | "share" | "explore";

export interface WorkspaceNavigation {
  activate(view: WorkspaceView): boolean;
  refresh(): void;
  current(): WorkspaceView;
}

/**
 * Owns only the task-pane view state. The real workbook controllers continue to decide when a
 * preview, verified result or share composer exists; this layer never invents placeholder data.
 */
export function createWorkspaceNavigation(
  document: Document,
  onUnavailable: (view: WorkspaceView) => void,
): WorkspaceNavigation {
  const body = document.body;
  const buttons = new Map<WorkspaceView, HTMLButtonElement>();
  for (const button of document.querySelectorAll<HTMLButtonElement>(
    "#workspace-nav [data-workspace-target]",
  )) {
    const view = button.dataset.workspaceTarget as WorkspaceView;
    if (
      view === "work" ||
      view === "results" ||
      view === "share" ||
      view === "explore"
    )
      buttons.set(view, button);
  }

  const available = (view: WorkspaceView): boolean => {
    // Explore needs no result: its templates and questions come from the selection itself.
    if (view === "work" || view === "explore") return true;
    const selector =
      view === "results"
        ? '[data-workspace-panel="results"]:not([hidden])'
        : '[data-workspace-panel="share"]:not([hidden])';
    return Boolean(document.querySelector(selector));
  };

  const refresh = () => {
    for (const [view, button] of buttons) {
      const enabled = available(view);
      button.disabled = !enabled;
      button.setAttribute("aria-disabled", String(!enabled));
    }
    const current = (body.dataset.workspaceView || "work") as WorkspaceView;
    if (!available(current)) activate("work");
  };

  const activate = (view: WorkspaceView): boolean => {
    if (!available(view)) {
      onUnavailable(view);
      return false;
    }
    body.dataset.workspaceView = view;
    for (const [name, button] of buttons) {
      const selected = name === view;
      button.classList.toggle("active", selected);
      button.setAttribute("aria-selected", String(selected));
      button.tabIndex = selected ? 0 : -1;
    }
    document.querySelector<HTMLElement>("#scroll-area")?.scrollTo({ top: 0 });
    return true;
  };

  for (const [view, button] of buttons)
    button.addEventListener("click", () => activate(view));

  const observedPanels = [
    ...document.querySelectorAll<HTMLElement>("[data-workspace-panel]"),
  ];
  if (typeof MutationObserver !== "undefined" && observedPanels.length)
    new MutationObserver(refresh).observe(document.body, {
      attributes: true,
      attributeFilter: ["hidden"],
      subtree: true,
    });

  body.dataset.workspaceView = "work";
  refresh();
  return {
    activate,
    refresh,
    current: () => (body.dataset.workspaceView || "work") as WorkspaceView,
  };
}
