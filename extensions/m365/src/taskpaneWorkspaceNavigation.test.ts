import assert from "node:assert/strict";
import { test } from "node:test";
import { createWorkspaceNavigation } from "./taskpaneWorkspaceNavigation.js";

/** A tiny stand-in for the pane's DOM: four nav buttons and whichever panels are shown. */
function fakePane(shownPanels: string[], devOnlyPanels: string[] = []) {
  const focused = { name: "" };
  const buttons = ["work", "results", "share", "explore"].map((target) => {
    const attributes: Record<string, string> = {};
    const classes = new Set<string>();
    const listeners: Record<string, Array<(event?: any) => void>> = {};
    return {
      id: `tab-${target}`,
      dataset: { workspaceTarget: target },
      disabled: false,
      tabIndex: 0,
      classList: {
        toggle: (name: string, on: boolean) =>
          on ? classes.add(name) : classes.delete(name),
      },
      setAttribute: (name: string, value: string) => {
        attributes[name] = value;
      },
      addEventListener: (type: string, listener: (event?: any) => void) =>
        (listeners[type] ??= []).push(listener),
      click: () => (listeners.click ?? []).forEach((listener) => listener()),
      /** Presses a key on this tab; returns true when the pane handled (prevented) it. */
      press: (key: string) => {
        let handled = false;
        for (const listener of listeners.keydown ?? [])
          listener({ key, preventDefault: () => (handled = true) });
        return handled;
      },
      focus: () => {
        focused.name = target;
      },
      attributes,
    };
  });
  const body: { dataset: Record<string, string> } = { dataset: {} };
  const scrollArea = {
    attributes: {} as Record<string, string>,
    setAttribute: (name: string, value: string) => {
      scrollArea.attributes[name] = value;
    },
    scrollTo: () => undefined,
  };
  const document: any = {
    body,
    querySelectorAll: (selector: string) =>
      selector === "#workspace-nav [data-workspace-target]" ? buttons : [],
    querySelector: (selector: string) => {
      if (selector === "#scroll-area") return scrollArea;
      const panel = /data-workspace-panel="(\w+)"/.exec(selector)?.[1];
      if (!panel) return null;
      // A panel marked data-dev only matches a selector that does not exclude developer panels.
      if (
        devOnlyPanels.includes(panel) &&
        selector.includes(":not([data-dev])")
      )
        return null;
      return shownPanels.includes(panel) || devOnlyPanels.includes(panel)
        ? {}
        : null;
    },
  };
  return { document, buttons, body, focused, scrollArea };
}

test("Explore is enabled from the start, with no result", () => {
  const { document, buttons } = fakePane([]);
  const unavailable: string[] = [];
  const nav = createWorkspaceNavigation(document, (view) =>
    unavailable.push(view),
  );
  const state = Object.fromEntries(
    buttons.map((b) => [b.dataset.workspaceTarget, b.disabled]),
  );
  assert.deepEqual(state, {
    work: false,
    results: true,
    share: true,
    explore: false,
  });
  assert.equal(nav.activate("explore"), true);
  assert.equal(nav.current(), "explore");
  assert.deepEqual(unavailable, []);
});

test("Results and Share stay unavailable until their real panel exists", () => {
  const { document } = fakePane([]);
  const unavailable: string[] = [];
  const nav = createWorkspaceNavigation(document, (view) =>
    unavailable.push(view),
  );
  assert.equal(nav.activate("results"), false);
  assert.equal(nav.activate("share"), false);
  assert.deepEqual(unavailable, ["results", "share"]);
  assert.equal(nav.current(), "work");
});

test("real empty-state panels keep Results and Share reachable", () => {
  const { document, buttons } = fakePane(["results", "share"]);
  createWorkspaceNavigation(document, () => {});
  const state = Object.fromEntries(
    buttons.map((button) => [button.dataset.workspaceTarget, button.disabled]),
  );
  assert.deepEqual(state, {
    work: false,
    results: false,
    share: false,
    explore: false,
  });
});

test("tapping the Explore button opens it and updates the tab panel relationship", () => {
  const { document, buttons, body, scrollArea } = fakePane([]);
  createWorkspaceNavigation(document, () => {});
  const explore = buttons.find((b) => b.dataset.workspaceTarget === "explore")!;
  explore.click();
  assert.equal(body.dataset.workspaceView, "explore");
  assert.equal(explore.attributes["aria-selected"], "true");
  assert.equal(buttons[0].attributes["aria-selected"], "false");
  assert.equal(scrollArea.attributes["aria-labelledby"], "tab-explore");
});

test("a developer-only panel does not make Results or Share available", () => {
  const { document, buttons } = fakePane([], ["results", "share"]);
  const nav = createWorkspaceNavigation(document, () => {});
  const state = Object.fromEntries(
    buttons.map((b) => [b.dataset.workspaceTarget, b.disabled]),
  );
  assert.deepEqual(state, {
    work: false,
    results: true,
    share: true,
    explore: false,
  });
  assert.equal(nav.activate("results"), false);
});

test("the arrow keys move between the enabled tabs and wrap around", () => {
  const { document, buttons, body, focused } = fakePane([]);
  createWorkspaceNavigation(document, () => {});
  const [work, , , explore] = buttons;
  // Results and Share are disabled, so Work and Explore are the only stops.
  assert.equal(work.press("ArrowRight"), true);
  assert.equal(body.dataset.workspaceView, "explore");
  assert.equal(focused.name, "explore");
  assert.equal(explore.press("ArrowRight"), true);
  assert.equal(body.dataset.workspaceView, "work");
  assert.equal(work.press("ArrowLeft"), true);
  assert.equal(body.dataset.workspaceView, "explore");
  assert.equal(explore.press("Home"), true);
  assert.equal(body.dataset.workspaceView, "work");
  assert.equal(work.press("End"), true);
  assert.equal(body.dataset.workspaceView, "explore");
  assert.equal(explore.press("a"), false, "other keys are left alone");
});

test("the arrow keys also reach Results and Share once they exist", () => {
  const { document, body } = fakePane(["results", "share"]);
  const nav = createWorkspaceNavigation(document, () => {});
  const seen: string[] = [];
  for (let i = 0; i < 4; i += 1) {
    const view = nav.current();
    const button = (
      document.querySelectorAll(
        "#workspace-nav [data-workspace-target]",
      ) as any[]
    ).find((b) => b.dataset.workspaceTarget === view);
    button.press("ArrowRight");
    seen.push(body.dataset.workspaceView);
  }
  assert.deepEqual(seen, ["results", "share", "explore", "work"]);
});
