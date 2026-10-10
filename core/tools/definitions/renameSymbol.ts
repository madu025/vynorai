import { Tool } from "../..";

import { BUILT_IN_GROUP_NAME, BuiltInToolNames } from "../builtIn";

export const renameSymbolTool: Tool = {
  type: "function",
  displayTitle: "Rename Symbol",
  wouldLikeTo: "rename {{{ symbol }}} to {{{ new_name }}} across the project",
  isCurrently: "renaming {{{ symbol }}} to {{{ new_name }}}",
  hasAlready: "renamed {{{ symbol }}} to {{{ new_name }}}",
  readonly: false,
  isInstant: false,
  group: BUILT_IN_GROUP_NAME,
  function: {
    name: BuiltInToolNames.RenameSymbol,
    description:
      "Rename a TypeScript or JavaScript symbol (function, class, variable, type) in the file that defines it and in every file that imports it, using the TypeScript compiler so strings and unrelated names are left alone. Other languages are not supported. Use dry_run first to see which files would change.",
    parameters: {
      type: "object",
      required: ["symbol", "new_name"],
      properties: {
        symbol: {
          type: "string",
          description: "Current name of the symbol.",
        },
        new_name: {
          type: "string",
          description: "New name for the symbol.",
        },
        defining_file: {
          type: "string",
          description:
            "File that defines the symbol, relative to the workspace root. Give it when the name is used in several places.",
        },
        dry_run: {
          type: "boolean",
          description:
            "When true, list the files and replacements without writing.",
        },
      },
    },
  },
  defaultToolPolicy: "allowedWithPermission",
  toolCallIcon: "PencilIcon",
};
