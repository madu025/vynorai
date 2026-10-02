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
      "Open one user-approved HTTP(S) origin in a clean browser, collect console/page errors, inspect accessibility-relevant document metadata, and save a screenshot. Navigation to other origins is blocked.",
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
      },
    },
  },
  defaultToolPolicy: "allowedWithPermission",
  toolCallIcon: "GlobeAltIcon",
};
