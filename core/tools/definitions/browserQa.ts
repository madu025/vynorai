import { Tool } from "../..";
import { BUILT_IN_GROUP_NAME, BuiltInToolNames } from "../builtIn";

export const browserQaTool: Tool = {
  type: "function",
  displayTitle: "Browser QA",
  wouldLikeTo: "verify {{{ url }}} in an isolated browser",
  isCurrently: "verifying {{{ url }}} in a browser",
  hasAlready: "verified {{{ url }}} in a browser",
  readonly: true,
  group: BUILT_IN_GROUP_NAME,
  function: {
    name: BuiltInToolNames.BrowserQa,
    description:
      "Open one user-approved HTTP(S) origin in a clean browser, run a bounded interaction workflow, collect console/network/accessibility evidence, and save a screenshot. Top-level navigation to other origins is blocked. Typed values are never returned in the report.",
    parameters: {
      type: "object",
      required: ["url"],
      properties: {
        url: { type: "string", description: "User-approved URL to verify" },
        viewport: {
          type: "string",
          enum: ["desktop", "tablet", "mobile"],
          description: "Viewport preset (default desktop)",
        },
        actions: {
          type: "array",
          maxItems: 20,
          description: "Optional bounded UI workflow, executed in order",
          items: {
            type: "object",
            required: ["type", "selector"],
            properties: {
              type: {
                type: "string",
                enum: ["click", "type", "select", "waitFor", "press"],
              },
              selector: { type: "string", description: "CSS selector" },
              value: {
                type: "string",
                description: "Text, select value, or keyboard key",
              },
              timeoutMs: {
                type: "number",
                minimum: 100,
                maximum: 5000,
              },
            },
          },
        },
        baseline: {
          type: "string",
          enum: ["none", "record", "compare"],
          description: "Record or compare a local screenshot fingerprint",
        },
      },
    },
  },
  defaultToolPolicy: "allowedWithPermission",
  toolCallIcon: "GlobeAltIcon",
};
