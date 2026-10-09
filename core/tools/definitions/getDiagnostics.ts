import { Tool } from "../..";

import { BUILT_IN_GROUP_NAME, BuiltInToolNames } from "../builtIn";

export const getDiagnosticsTool: Tool = {
  type: "function",
  displayTitle: "Diagnostics",
  wouldLikeTo:
    "check the editor's errors and warnings{{{ ' for ' + filepath }}}",
  isCurrently: "reading the editor's errors and warnings",
  hasAlready: "read the editor's errors and warnings",
  readonly: true,
  isInstant: true,
  group: BUILT_IN_GROUP_NAME,
  function: {
    name: BuiltInToolNames.GetDiagnostics,
    description:
      "Get the errors and warnings the editor's language servers report for a file (type errors, lint). Use it after editing a file to check the change compiles, instead of running the build.",
    parameters: {
      type: "object",
      properties: {
        filepath: {
          type: "string",
          description:
            "File to check, relative to the workspace root or absolute. Defaults to the file open in the editor.",
        },
      },
    },
  },
  systemMessageDescription: {
    prefix: `After editing a file, use the ${BuiltInToolNames.GetDiagnostics} tool to see the editor's errors and warnings for it before running a full build.`,
  },
  defaultToolPolicy: "allowedWithoutPermission",
  toolCallIcon: "ExclamationTriangleIcon",
};
