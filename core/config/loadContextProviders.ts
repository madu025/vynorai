import {
  AssistantUnrolledNonNullable,
  ConfigValidationError,
} from "@continuedev/config-yaml";
import { IContextProvider, IdeType } from "..";
import { contextProviderClassFromName } from "../context/providers";
import CodebaseContextProvider from "../context/providers/CodebaseContextProvider";
import CurrentFileContextProvider from "../context/providers/CurrentFileContextProvider";
import DiffContextProvider from "../context/providers/DiffContextProvider";
import DocsContextProvider from "../context/providers/DocsContextProvider";
import FileContextProvider from "../context/providers/FileContextProvider";
import FileTreeContextProvider from "../context/providers/FileTreeContextProvider";
import OpenFilesContextProvider from "../context/providers/OpenFilesContextProvider";
import ProblemsContextProvider from "../context/providers/ProblemsContextProvider";
import RepoMapContextProvider from "../context/providers/RepoMapContextProvider";
import RulesContextProvider from "../context/providers/RulesContextProvider";
import TerminalContextProvider from "../context/providers/TerminalContextProvider";
import URLContextProvider from "../context/providers/URLContextProvider";

/*
    Loads context providers based on configuration
    - default providers will always be loaded, using config params if present
    - other providers will be loaded if configured

    NOTE the MCPContextProvider is added in doLoadConfig if any resources are present
*/
export function loadConfigContextProviders(
  configContext: AssistantUnrolledNonNullable["context"],
  hasDocs: boolean,
  ideType: IdeType,
): {
  providers: IContextProvider[];
  errors: ConfigValidationError[];
} {
  const providers: IContextProvider[] = [];
  const errors: ConfigValidationError[] = [];

  const defaultProviders: IContextProvider[] = [
    new FileContextProvider({}),
    new CurrentFileContextProvider({}),
    new DiffContextProvider({}),
    new TerminalContextProvider({}),
    new ProblemsContextProvider({}),
    new RulesContextProvider({}),
    // Used only when the user @-mentions them, so no per-request tokens.
    new OpenFilesContextProvider({}),
    new RepoMapContextProvider({}),
    new URLContextProvider({}),
  ];

  // VS Code-compatible hosts (VS Code, Cursor, Antigravity) must be able to
  // resolve automatic workspace context even when the user has no explicit
  // `context:` section. Without these providers, GUI requests for `tree` and
  // `codebase` are silently dropped and the model behaves like a generic chat.
  if (ideType === "vscode") {
    defaultProviders.push(
      new FileTreeContextProvider({}),
      new CodebaseContextProvider({}),
    );
  }

  // Add from config
  if (configContext) {
    for (const config of configContext) {
      const cls = contextProviderClassFromName(config.provider) as any;
      if (
        !cls &&
        !defaultProviders.find((p) => p.description.title === config.provider)
      ) {
        errors.push({
          fatal: false,
          message: `Unknown context provider ${config.provider}`,
        });
        continue;
      }
      providers.push(
        new cls({
          name: config.name,
          ...config.params,
        }),
      );
    }
  }

  // Add from defaults if not found in config
  for (const defaultProvider of defaultProviders) {
    if (
      !providers.find(
        (p) => p.description.title === defaultProvider.description.title,
      )
    ) {
      providers.push(defaultProvider);
    }
  }

  if (hasDocs && !providers?.some((cp) => cp.description.title === "docs")) {
    providers.push(new DocsContextProvider({}));
  }

  // @problems and @terminal are not supported in jetbrains
  const filteredProviders = providers.filter((pv) => {
    if (ideType === "jetbrains") {
      return (
        pv.description.title !== TerminalContextProvider.description.title &&
        pv.description.title !== ProblemsContextProvider.description.title
      );
    }
    return true;
  });

  return {
    providers: filteredProviders,
    errors,
  };
}
