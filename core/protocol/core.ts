import {
  BlockType,
  ConfigResult,
  DevDataLogEvent,
  ModelRole,
} from "@continuedev/config-yaml";
import { ToolPolicy } from "@continuedev/terminal-security";

import {
  AutocompleteInput,
  RecentlyEditedRange,
} from "../autocomplete/util/types";
import { ProfileDescription } from "../config/ProfileLifecycleManager";
import { SharedConfigSchema } from "../config/sharedConfig";
import { GlobalContextModelSelections } from "../util/GlobalContext";
import type { HookPayload, HookRunResult } from "../hooks/types";

import {
  BaseSessionMetadata,
  BrowserSerializedContinueConfig,
  ChatMessage,
  CompiledMessagesResult,
  CompleteOnboardingPayload,
  ContextItem,
  ContextItemWithId,
  ContextSubmenuItem,
  DiffLine,
  DocsIndexingDetails,
  ExperimentalModelRoles,
  FileSymbolMap,
  IdeSettings,
  LLMFullCompletionOptions,
  McpUiState,
  MessageOption,
  ModelDescription,
  PromptLog,
  RangeInFile,
  RangeInFileWithNextEditInfo,
  SerializedContinueConfig,
  Session,
  SiteIndexingConfig,
  SlashCommandDescWithSource,
  StreamDiffLinesPayload,
  ToolCall,
} from "../";
import { AutocompleteCodeSnippet } from "../autocomplete/snippets/types";
import { GetLspDefinitionsFunction } from "../autocomplete/types";
import { ConfigHandler } from "../config/ConfigHandler";
import { ProcessedItem } from "../nextEdit/NextEditPrefetchQueue";
import { NextEditOutcome } from "../nextEdit/types";
import { ContinueErrorReason } from "../util/errors";
import type {
  VerificationCommandCandidate,
  WorkspaceSnapshot,
} from "../workspace/types";
import type {
  AgentTask,
  AgentTaskBudget,
  ImplementationSubagent,
  ImplementationSubagentRole,
  SubagentAuthority,
  TaskState,
  ToolRisk,
  VerificationResult,
} from "../agent/types";
import type {
  AgentNextAction,
  ProposedPlanStep,
} from "../agent/AgentOrchestrator";

export enum OnboardingModes {
  API_KEY = "API Key",
  LOCAL = "Local",
}

export interface ListHistoryOptions {
  offset?: number;
  limit?: number;
  workspaceDirectory?: string;
}

export type ToCoreFromIdeOrWebviewProtocol = {
  // Special
  ping: [string, string];
  abort: [undefined, void];
  cancelApply: [undefined, void];

  // Workspace identity and readiness
  "workspace/getSnapshot": [undefined, WorkspaceSnapshot];
  "workspace/refreshSnapshot": [undefined, WorkspaceSnapshot];
  "workspace/invalidate": [{ reason?: string } | undefined, void];
  "workspace/getVerificationPlan": [undefined, VerificationCommandCandidate[]];
  "agent/task/start": [
    {
      sessionId: string;
      goal: string;
      budget?: Partial<
        Pick<
          AgentTaskBudget,
          "maxInputTokens" | "maxOutputTokens" | "maxCostUsd"
        >
      >;
    },
    AgentTask,
  ];
  "agent/task/get": [{ taskId: string }, AgentTask | undefined];
  "agent/task/transition": [
    { taskId: string; state: TaskState; reason?: string },
    AgentTask,
  ];
  "agent/task/recordApproval": [
    {
      taskId: string;
      toolCallId: string;
      toolName: string;
      risk: ToolRisk;
      decision: "approved" | "denied";
      scope: string;
    },
    AgentTask,
  ];
  "agent/task/recordVerification": [
    {
      taskId: string;
      result: Omit<VerificationResult, "id" | "createdAt">;
    },
    AgentTask,
  ];
  "agent/task/consumeBudget": [
    {
      taskId: string;
      inputTokens: number;
      outputTokens: number;
      costUsd?: number;
    },
    AgentTask,
  ];
  "agent/subagent/create": [
    {
      taskId: string;
      role: ImplementationSubagentRole;
      objective: string;
      authority: SubagentAuthority;
      fileScope: string[];
      dependsOn?: string[];
      budget?: Partial<
        Pick<
          AgentTaskBudget,
          "maxInputTokens" | "maxOutputTokens" | "maxCostUsd"
        >
      >;
    },
    ImplementationSubagent,
  ];
  "agent/subagent/start": [
    { taskId: string; subagentId: string },
    ImplementationSubagent,
  ];
  "agent/subagent/authorize": [
    {
      taskId: string;
      subagentId: string;
      capability: keyof SubagentAuthority;
      resource?: string;
    },
    boolean,
  ];
  "agent/subagent/authorizeTool": [
    {
      taskId: string;
      subagentId: string;
      toolName: string;
      args: Record<string, unknown>;
    },
    boolean,
  ];
  "agent/subagent/consumeBudget": [
    {
      taskId: string;
      subagentId: string;
      inputTokens: number;
      outputTokens: number;
      costUsd?: number;
    },
    ImplementationSubagent,
  ];
  "agent/subagent/complete": [
    {
      taskId: string;
      subagentId: string;
      summary: string;
      changedFiles: string[];
      verification: VerificationResult[];
      residualRisks?: string[];
    },
    ImplementationSubagent,
  ];
  "agent/subagent/mergeQueue": [{ taskId: string }, ImplementationSubagent[]];
  "agent/plan/create": [
    { taskId: string; steps: ProposedPlanStep[] },
    AgentTask,
  ];
  "agent/plan/next": [{ taskId: string }, AgentNextAction];
  "agent/plan/startStep": [
    { taskId: string; stepId: string; approved?: boolean },
    AgentTask,
  ];
  "agent/plan/completeStep": [
    { taskId: string; stepId: string; scope?: string },
    AgentTask,
  ];
  "agent/plan/failStep": [
    { taskId: string; stepId: string; failureCode: string },
    AgentTask,
  ];
  "agent/task/authorizeAction": [
    { taskId: string; signature: string },
    AgentTask,
  ];
  "agent/task/cancel": [{ taskId: string; reason?: string }, AgentTask];
  "agent/task/resume": [{ taskId: string }, AgentTask];
  "agent/task/listResumable": [{ sessionId?: string } | undefined, AgentTask[]];

  // History
  "history/list": [ListHistoryOptions, BaseSessionMetadata[]];
  "history/delete": [{ id: string }, void];
  "history/load": [{ id: string }, Session];
  "history/save": [Session, void];
  "history/share": [{ id: string; outputDir?: string }, void];
  "history/clear": [undefined, void];
  /** Whose history is visible (see HistoryManager.accountKey). */
  "history/account": [undefined, string | null];
  /** VynorAI monthly credit usage for the selected chat model's account (null if not VynorAI). */
  "vynor/usage": [
    undefined,
    {
      used: number;
      limit: number;
      plan: string;
      /** Credits this user's prompts typically cost (last 30 days). */
      taskCredits?: { median: number; p90: number; samples: number } | null;
    } | null,
  ];
  /** Helpful / unhelpful on a VynorAI answer; trains the Auto router. */
  "vynor/feedback": [{ prompt: string; signal: "helpful" | "unhelpful" }, void];
  /** Opt-in error report (message and stack only) to VynorAI. */
  "vynor/errorReport": [
    { source: string; message: string; stack?: string; client?: string },
    void,
  ];
  "devdata/log": [DevDataLogEvent, void];
  "config/addOpenAiKey": [string, void];
  "config/addModel": [
    {
      model: SerializedContinueConfig["models"][number];
      role?: keyof ExperimentalModelRoles;
    },
    void,
  ];
  "config/addLocalWorkspaceBlock": [
    { blockType: BlockType; baseFilename?: string },
    void,
  ];
  "config/addGlobalRule": [undefined | { baseFilename?: string }, void];
  "config/deleteRule": [{ filepath: string }, void];
  "config/newPromptFile": [undefined, void];
  "config/newAssistantFile": [undefined, void];
  "config/ideSettingsUpdate": [IdeSettings, void];
  "config/getSerializedProfileInfo": [
    undefined,
    {
      result: ConfigResult<BrowserSerializedContinueConfig>;
      profileId: string | null;
      profiles: ProfileDescription[];
    },
  ];
  "config/deleteModel": [{ title: string }, void];
  "config/refreshProfiles": [
    (
      | undefined
      | {
          reason?: string;
          selectProfileId?: string;
        }
    ),
    void,
  ];
  "config/openProfile": [{ profileId: string | undefined }, void];
  "config/updateSharedConfig": [SharedConfigSchema, SharedConfigSchema];
  "config/updateSelectedModel": [
    {
      profileId: string;
      role: ModelRole;
      title: string | null;
    },
    GlobalContextModelSelections,
  ];
  "context/getContextItems": [
    {
      name: string;
      query: string;
      fullInput: string;
      selectedCode: RangeInFile[];
      isInAgentMode: boolean;
    },
    ContextItemWithId[],
  ];

  "mcp/reloadServer": [
    {
      id: string;
    },
    void,
  ];
  "mcp/setServerEnabled": [{ id: string; enabled: boolean }, void];
  "mcp/getPrompt": [
    {
      serverName: string;
      promptName: string;
      args?: Record<string, string>;
    },
    {
      prompt: string;
      description: string | undefined;
    },
  ];
  "mcp/startAuthentication": [
    {
      serverId: string;
      serverUrl: string;
    },
    void,
  ];
  "mcp/removeAuthentication": [
    {
      serverId: string;
      serverUrl: string;
    },
    void,
  ];
  "context/getSymbolsForFiles": [{ uris: string[] }, FileSymbolMap];
  "context/loadSubmenuItems": [{ title: string }, ContextSubmenuItem[]];
  "autocomplete/complete": [AutocompleteInput, string[]];
  "context/addDocs": [SiteIndexingConfig, void];
  "context/removeDocs": [Pick<SiteIndexingConfig, "startUrl">, void];
  "context/indexDocs": [{ reIndex: boolean }, void];
  "autocomplete/cancel": [undefined, void];
  "autocomplete/accept": [{ completionId: string }, void];
  "nextEdit/predict": [
    {
      input: AutocompleteInput;
      options?: {
        withChain?: boolean;
        usingFullFileDiff?: boolean;
      };
    },
    NextEditOutcome | undefined,
  ];
  "nextEdit/reject": [{ completionId: string }, void];
  "nextEdit/accept": [{ completionId: string }, void];
  "nextEdit/startChain": [undefined, void];
  "nextEdit/deleteChain": [undefined, void];
  "nextEdit/isChainAlive": [undefined, boolean];
  "nextEdit/queue/getProcessedCount": [undefined, number];
  "nextEdit/queue/dequeueProcessed": [undefined, ProcessedItem | null];
  "nextEdit/queue/processOne": [
    {
      ctx: {
        completionId: string;
        manuallyPassFileContents?: string;
        manuallyPassPrefix?: string;
        selectedCompletionInfo?: {
          text: string;
          range: Range;
        };
        isUntitledFile: boolean;
        recentlyVisitedRanges: AutocompleteCodeSnippet[];
        recentlyEditedRanges: RecentlyEditedRange[];
      };
      recentlyVisitedRanges: AutocompleteCodeSnippet[];
      recentlyEditedRanges: RecentlyEditedRange[];
    },
    void,
  ];
  "nextEdit/queue/clear": [undefined, void];
  "nextEdit/queue/abort": [undefined, void];
  "llm/complete": [
    {
      prompt: string;
      completionOptions: LLMFullCompletionOptions;
      title: string;
    },
    string,
  ];
  "llm/listModels": [{ title: string }, string[] | undefined];
  "llm/streamChat": [
    {
      messages: ChatMessage[];
      completionOptions: LLMFullCompletionOptions;
      title: string;
      /** Selects an isolated configured model role. Defaults to chat. */
      role?: "chat" | "subagent";
      messageOptions?: MessageOption;
      legacySlashCommandData?: {
        command: SlashCommandDescWithSource;
        input: string;
        contextItems: ContextItemWithId[];
        historyIndex: number;
        selectedCode: RangeInFile[];
      };
    },
    AsyncGenerator<ChatMessage, PromptLog>,
  ];
  streamDiffLines: [StreamDiffLinesPayload, AsyncGenerator<DiffLine>];
  getDiffLines: [{ oldContent: string; newContent: string }, DiffLine[]];
  "llm/compileChat": [
    { messages: ChatMessage[]; options: LLMFullCompletionOptions },
    CompiledMessagesResult,
  ];
  "chatDescriber/describe": [
    {
      text: string;
    },
    string | undefined,
  ];
  "hooks/run": [HookPayload, HookRunResult];
  "tools/abort": [undefined, void];
  "conversation/compact": [
    {
      index: number;
      sessionId: string;
    },
    string | undefined,
  ];
  "stats/getTokensPerDay": [
    undefined,
    { day: string; promptTokens: number; generatedTokens: number }[],
  ];
  "stats/getTokensPerModel": [
    undefined,
    { model: string; promptTokens: number; generatedTokens: number }[],
  ];
  "tts/kill": [undefined, void];

  // Codebase indexing
  "index/setPaused": [boolean, void];
  "index/forceReIndex": [
    undefined | { dirs?: string[]; shouldClearIndexes?: boolean },
    void,
  ];
  "index/indexingProgressBarInitialized": [undefined, void];
  "onboarding/complete": [CompleteOnboardingPayload, void];

  // File changes
  "files/changed": [{ uris?: string[] }, void];
  "files/opened": [{ uris?: string[] }, void];
  "files/created": [{ uris?: string[] }, void];
  "files/deleted": [{ uris?: string[] }, void];
  "files/closed": [{ uris?: string[] }, void];
  "files/smallEdit": [
    {
      actions: RangeInFileWithNextEditInfo[];
      configHandler: ConfigHandler;
      getDefsFromLspFunction: GetLspDefinitionsFunction;
      recentlyEditedRanges: RecentlyEditedRange[];
      recentlyVisitedRanges: AutocompleteCodeSnippet[];
    },
    void,
  ];

  // Docs etc. Indexing. TODO move codebase to this
  "indexing/reindex": [{ type: string; id: string }, void];
  "indexing/abort": [{ type: string; id: string }, void];
  "indexing/setPaused": [{ type: string; id: string; paused: boolean }, void];
  "docs/getSuggestedDocs": [undefined, void];
  "docs/initStatuses": [undefined, void];
  "docs/getDetails": [{ startUrl: string }, DocsIndexingDetails];
  "docs/getIndexedPages": [{ startUrl: string }, string[]];
  addAutocompleteModel: [{ model: ModelDescription }, void];

  "auth/getAuthUrl": [{ useOnboarding: boolean }, { url: string }];
  "tools/call": [
    {
      toolCall: ToolCall;
      delegation?: { taskId: string; subagentId: string };
    },
    {
      contextItems: ContextItem[];
      errorMessage?: string;
      errorReason?: ContinueErrorReason;
      mcpUiState?: McpUiState;
    },
  ];
  "tools/evaluatePolicy": [
    {
      toolName: string;
      basePolicy: ToolPolicy;
      parsedArgs: Record<string, unknown>;
      processedArgs?: Record<string, unknown>;
    },
    { policy: ToolPolicy; displayValue?: string },
  ];
  "tools/preprocessArgs": [
    { toolName: string; args: Record<string, unknown> },
    {
      preprocessedArgs?: Record<string, unknown>;
      errorReason?: ContinueErrorReason;
      errorMessage?: string;
    },
  ];
  "clipboardCache/add": [{ content: string }, void];
  isItemTooBig: [{ item: ContextItemWithId }, boolean];
  "process/markAsBackgrounded": [{ toolCallId: string }, void];
  "process/isBackgrounded": [{ toolCallId: string }, boolean];
  "process/killTerminalProcess": [{ toolCallId: string }, void];
  "mdm/setLicenseKey": [{ licenseKey: string }, boolean];
  "models/fetch": [
    { provider: string; apiKey?: string; apiBase?: string },
    {
      name: string;
      modelId?: string;
      description?: string;
      icon?: string;
      popular?: boolean;
      contextLength?: number;
      maxTokens?: number;
      supportsTools?: boolean;
    }[],
  ];
};
