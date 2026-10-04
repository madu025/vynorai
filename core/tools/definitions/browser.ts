import { ToolPolicy } from "@continuedev/terminal-security";
import { Tool } from "../..";
import { browserSession, isLocalUrl } from "../browser/session";
import { BUILT_IN_GROUP_NAME, BuiltInToolNames } from "../builtIn";

const READ_ONLY = new Set(["snapshot", "logs", "screenshot", "wait", "close"]);

export const browserTool: Tool = {
  type: "function",
  displayTitle: "Browser",
  wouldLikeTo: "use the browser ({{{ action }}} {{{ url }}}{{{ target }}})",
  isCurrently: "using the browser ({{{ action }}})",
  hasAlready: "used the browser ({{{ action }}})",
  readonly: false,
  isInstant: false,
  group: BUILT_IN_GROUP_NAME,
  function: {
    name: BuiltInToolNames.Browser,
    description:
      "Drive a real browser to test and debug web pages, like a developer would. The browser stays open between calls and is shown live to the user in the IDE's VynorAI Browser tab. " +
      "Typical loop: open the URL, read the snapshot, interact using element refs (e1, e2, ...) from the latest snapshot, then check logs for console and network errors. " +
      "Every action except logs/close returns a fresh page snapshot. Use it to verify UI changes on a local dev server, reproduce bugs, and check forms, navigation and errors. " +
      "Refs change after each snapshot; always use refs from the most recent one.",
    parameters: {
      type: "object",
      required: ["action"],
      properties: {
        action: {
          type: "string",
          enum: [
            "open",
            "snapshot",
            "click",
            "type",
            "press",
            "scroll",
            "back",
            "reload",
            "wait",
            "logs",
            "evaluate",
            "screenshot",
            "close",
          ],
          description:
            "open: go to url. snapshot: read the page. click: target. type: text into target (submit=true presses Enter). press: a key like Enter, Tab, Escape. scroll: dy pixels (negative is up). wait: for text or ms. logs: console, page and network errors. evaluate: run a JavaScript expression in the page and return its value. screenshot: save a PNG for the user. close: close the browser.",
        },
        url: {
          type: "string",
          description: "For open: http(s) URL, e.g. http://localhost:3000",
        },
        target: {
          type: "string",
          description:
            "Element ref from the latest snapshot (e.g. e7) or a CSS selector",
        },
        text: {
          type: "string",
          description: "For type: the text. For wait: text to wait for.",
        },
        submit: {
          type: "boolean",
          description: "For type: press Enter afterwards",
        },
        key: { type: "string", description: "For press: key name" },
        dy: { type: "number", description: "For scroll: pixels, default 600" },
        ms: {
          type: "number",
          description: "For wait: milliseconds (max 30000)",
        },
        expression: {
          type: "string",
          description: "For evaluate: a JavaScript expression",
        },
        kind: {
          type: "string",
          enum: ["all", "console", "error", "network"],
          description: "For logs: which entries (default all)",
        },
      },
    },
  },
  defaultToolPolicy: "allowedWithPermission",
  // Reading the page and working on a local dev server need no approval;
  // other sites and running JavaScript ask first (unless the user allowed it).
  evaluateToolCallPolicy: (
    basePolicy: ToolPolicy,
    args: Record<string, unknown>,
  ): ToolPolicy => {
    if (basePolicy === "disabled" || basePolicy === "allowedWithoutPermission")
      return basePolicy;
    const action = String(args.action ?? "");
    if (READ_ONLY.has(action)) return "allowedWithoutPermission";
    if (action === "evaluate") return basePolicy;
    const url =
      action === "open" ? String(args.url ?? "") : browserSession.currentUrl;
    const normalized =
      url && !/^[a-z]+:\/\//i.test(url) ? `http://${url}` : url;
    return isLocalUrl(normalized) ? "allowedWithoutPermission" : basePolicy;
  },
  systemMessageDescription: {
    prefix: `To check a web page in a real browser (shown live to the user), use the ${BuiltInToolNames.Browser} tool, for example:`,
    exampleArgs: [
      ["action", "open"],
      ["url", "http://localhost:3000"],
    ],
  },
  toolCallIcon: "GlobeAltIcon",
};
