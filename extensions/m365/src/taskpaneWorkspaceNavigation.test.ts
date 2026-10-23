import assert from "node:assert/strict";
import { test } from "node:test";
import { createWorkspaceNavigation } from "./taskpaneWorkspaceNavigation.js";

/** A tiny stand-in for the pane's DOM: four nav buttons and whichever panels are shown. */
function fakePane(shownPanels: string[]) {
  const buttons = ["work", "results", "share", "explore"].map((target) => {
    const attributes: Record<string, string> = {};
    const classes = new Set<string>();
    const listeners: Array<() => void> = [];
    return {
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
      addEventListener: (_: string, listener: () => void) => listeners.push(listener),
      click: () => listeners.forEach((listener) => listener()),
      attributes,
    };
  });
  const body: { dataset: Record<string, string> } = { dataset: {} };
  const document: any = {
    body,
    querySelectorAll: (selector: string) =>
      selector === "#workspace-nav [data-workspace-target]" ? buttons : [],
    querySelector: (selector: string) => {
      const panel = /data-workspace-panel="(\w+)"/.exec(selector)?.[1];
      return panel && shownPanels.includes(panel) ? {} : null;
    },
  };
  return { document, buttons, body };
}

test("Explore is enabled from the start, with no result", () => {
  const { document, buttons } = fakePane([]);
  const unavailable: string[] = [];
  const nav = createWorkspaceNavigation(document, (view) => unavailable.push(view));
  const state = Object.fromEntries(buttons.map((b) => [b.dataset.workspaceTarget, b.disabled]));
  assert.deepEqual(state, { work: false, results: true, share: true, explore: false });
  assert.equal(nav.activate("explore"), true);
  assert.equal(nav.current(), "explore");
  assert.deepEqual(unavailable, []);
});

test("Results and Share stay unavailable until their real panel exists", () => {
  const { document } = fakePane([]);
  const unavailable: string[] = [];
  const nav = createWorkspaceNavigation(document, (view) => unavailable.push(view));
  assert.equal(nav.activate("results"), false);
  assert.equal(nav.activate("share"), false);
  assert.deepEqual(unavailable, ["results", "share"]);
  assert.equal(nav.current(), "work");
});

test("tapping the Explore button opens it and marks it selected", () => {
  const { document, buttons, body } = fakePane([]);
  createWorkspaceNavigation(document, () => {});
  const explore = buttons.find((b) => b.dataset.workspaceTarget === "explore")!;
  explore.click();
  assert.equal(body.dataset.workspaceView, "explore");
  assert.equal(explore.attributes["aria-selected"], "true");
  assert.equal(buttons[0].attributes["aria-selected"], "false");
});
