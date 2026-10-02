import path from "node:path";
import { pathToFileURL } from "node:url";

import { JSDOM } from "jsdom";

const dom = new JSDOM('<!doctype html><div id="root"></div>', {
  url: "https://vynor-webview.invalid/",
});
const browser = dom.window;

for (const key of [
  "window",
  "document",
  "navigator",
  "localStorage",
  "sessionStorage",
  "HTMLElement",
  "Element",
  "Node",
  "MutationObserver",
  "CustomEvent",
  "Event",
  "EventTarget",
  "DOMParser",
  "getComputedStyle",
  "SVGElement",
  "HTMLCanvasElement",
]) {
  Object.defineProperty(globalThis, key, {
    value: browser[key],
    configurable: true,
    writable: true,
  });
}

globalThis.requestAnimationFrame = (callback) =>
  setTimeout(() => callback(Date.now()), 0);
globalThis.cancelAnimationFrame = clearTimeout;
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
globalThis.IntersectionObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
globalThis.matchMedia = () => ({
  matches: false,
  addListener() {},
  removeListener() {},
  addEventListener() {},
  removeEventListener() {},
});
globalThis.vscode = {
  postMessage() {},
  getState() {},
  setState() {},
};
browser.vscode = globalThis.vscode;
browser.ide = "vscode";
browser.windowId = "smoke-test";
browser.vscMachineId = "smoke-test";
browser.vscMediaUrl = "";
browser.fullColorTheme = {};
browser.colorThemeName = "dark-plus";
browser.workspacePaths = [];
browser.isFullScreen = false;

const uncaught = [];
process.on("uncaughtException", (error) => uncaught.push(error));
process.on("unhandledRejection", (error) => uncaught.push(error));

const bundlePath = process.env.VYNOR_WEBVIEW_BUNDLE ?? "dist/assets/index.js";
await import(
  pathToFileURL(path.resolve(bundlePath)).href + `?smoke=${Date.now()}`
);
await new Promise((resolve) => setTimeout(resolve, 2_000));

if (uncaught.length > 0) {
  throw uncaught[0];
}

const root = document.getElementById("root");
if (!root || root.childElementCount === 0) {
  throw new Error("Production webview bundle did not render into #root");
}

console.log(
  `Webview smoke test passed (${root.innerHTML.length} rendered bytes)`,
);
process.exit(0);
