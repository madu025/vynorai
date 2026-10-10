import { Tool } from "../..";

import { BUILT_IN_GROUP_NAME, BuiltInToolNames } from "../builtIn";

export const applyDiffTool: Tool = {
  type: "function",
  displayTitle: "Apply Diff",
  wouldLikeTo: "apply a multi-file diff to the workspace",
  isCurrently: "applying a multi-file diff",
  hasAlready: "applied a multi-file diff",
  readonly: false,
  isInstant: false,
  group: BUILT_IN_GROUP_NAME,
  function: {
    name: BuiltInToolNames.ApplyDiff,
    description:
      "Apply a unified diff that may touch several files in one step. Context lines are matched even when line numbers have drifted, JavaScript/TypeScript results are syntax-checked first, and nothing is written unless every file applies (all or nothing). Prefer multi_edit for several edits in one file. Use dry_run to check a diff without writing.",
    parameters: {
      type: "object",
      required: ["diff"],
      properties: {
        diff: {
          type: "string",
          description:
            "Unified diff text. Paths are relative to the workspace root; a new file uses /dev/null as its old side.",
        },
        dry_run: {
          type: "boolean",
          description:
            "When true, validate and report what would change without writing any file.",
        },
      },
    },
  },
  defaultToolPolicy: "allowedWithPermission",
  toolCallIcon: "PencilIcon",
};
