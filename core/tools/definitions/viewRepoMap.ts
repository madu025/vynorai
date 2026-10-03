import { Tool } from "../..";

import { BUILT_IN_GROUP_NAME, BuiltInToolNames } from "../builtIn";

export const viewRepoMapTool: Tool = {
  type: "function",
  displayTitle: "View Repo Map",
  wouldLikeTo: "view the repository map",
  isCurrently: "getting the repository map",
  hasAlready: "viewed the repository map",
  readonly: true,
  isInstant: true,
  group: BUILT_IN_GROUP_NAME,
  function: {
    name: BuiltInToolNames.ViewRepoMap,
    description:
      "View a compact map of the repository: every file with the signatures of its classes, methods and functions. Call this first to find where code lives; it replaces many ls, glob and read_file calls.",
    parameters: {
      type: "object",
      properties: {},
    },
  },
  systemMessageDescription: {
    prefix: `To view the repository map, use the ${BuiltInToolNames.ViewRepoMap} tool. This will provide a visual representation of the project's structure and organization.`,
  },
  // Read-only and local: asking each time would push the model back to ls/read loops.
  defaultToolPolicy: "allowedWithoutPermission",
  toolCallIcon: "MapIcon",
};
