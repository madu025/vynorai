import { createAsyncThunk, unwrapResult } from "@reduxjs/toolkit";
import { ContextItem, McpUiState } from "core";
import { CLIENT_TOOLS_IMPLS } from "core/tools/builtIn";
import { ContinueError, ContinueErrorReason } from "core/util/errors";
import { classifyToolRisk } from "core/agent/toolRisk";
import type { HookRunResult } from "core/hooks/types";

import { callClientTool } from "../../util/clientTools/callClientTool";
import { selectCurrentToolCalls } from "../selectors/selectToolCalls";
import { selectSelectedChatModel } from "../slices/configSlice";
import {
  acceptToolCall,
  errorToolCall,
  setActiveTaskState,
  setInactive,
  setToolCallCalling,
  updateToolCallOutput,
} from "../slices/sessionSlice";
import { DEFAULT_PERMISSION_MODE } from "../slices/uiSlice";
import { ThunkApiType } from "../store";
import { findToolCallById, logToolUsage } from "../util";
import { streamResponseAfterToolCall } from "./streamResponseAfterToolCall";
import {
  commandOf,
  verificationFromToolResult,
} from "../util/verificationEvidence";
import { runHooks, toolOutputText } from "../util/hooks";
import {
  guardErrorForModel,
  isRecoverableGuardError,
} from "../util/agentProgress";

type CallToolInputs = {
  toolCallId: string;
  isAutoApproved?: boolean;
  depth?: number;
};

// A core tool can involve an external process. Never leave the webview in a
// streaming state forever if that process or its protocol response stalls.
// The normal error path below records the failure as the tool's error so the
// model can continue.
const CORE_TOOL_TIMEOUT_MS = 120_000;
const AGENT_RUNTIME_REQUEST_TIMEOUT_MS = 15_000;
const PRIVACY_PLACEHOLDER = /__PII_(?:EMAIL|PHONE|NIC|CARD)_\d+__/;
const MUTATING_TOOLS = new Set([
  "edit_existing_file",
  "single_find_and_replace",
  "multi_edit",
  "create_new_file",
  "create_rule_block",
  "apply_diff",
  "rename_symbol",
]);

function changedFilesForTool(toolCallState: any): string[] {
  if (!MUTATING_TOOLS.has(toolCallState.toolCall.function.name)) return [];
  const args = toolCallState.parsedArgs ?? {};
  const filepath = typeof args.filepath === "string" ? args.filepath : "";
  return filepath ? [filepath] : [];
}

export function hasUnrestoredPrivacyPlaceholder(value: unknown): boolean {
  try {
    return PRIVACY_PLACEHOLDER.test(JSON.stringify(value));
  } catch {
    return false;
  }
}

export const callToolById = createAsyncThunk<
  void,
  CallToolInputs,
  ThunkApiType
>("chat/callTool", async (inputs, thunkApi) => {
  try {
    await callToolByIdImpl(inputs, thunkApi);
  } catch (e) {
    // Safety net: an unexpected failure before the tool finished used to
    // leave it in "generated"/"calling" with the turn silently stopped.
    // Record it as the tool's error and let the model continue.
    const { dispatch, getState } = thunkApi;
    const call = findToolCallById(
      getState().session.history,
      inputs.toolCallId,
    );
    if (!call || !["generated", "calling"].includes(call.status)) throw e;
    const message = e instanceof Error ? e.message : String(e);
    dispatch(
      updateToolCallOutput({
        toolCallId: inputs.toolCallId,
        contextItems: [
          {
            icon: "problems",
            name: "Tool Call Error",
            description: "Tool Call Failed",
            content: `${call.toolCall.function.name} could not run: ${message}`,
            hidden: false,
          },
        ],
      }),
    );
    dispatch(errorToolCall({ toolCallId: inputs.toolCallId }));
    unwrapResult(
      await dispatch(
        streamResponseAfterToolCall({
          toolCallId: inputs.toolCallId,
          depth: inputs.depth ?? 0,
        }),
      ),
    );
  }
});

async function callToolByIdImpl(
  inputs: CallToolInputs,
  {
    dispatch,
    extra,
    getState,
  }: Pick<
    Parameters<
      Parameters<typeof createAsyncThunk<void, CallToolInputs, ThunkApiType>>[1]
    >[1],
    "dispatch" | "extra" | "getState"
  >,
): Promise<void> {
  const { toolCallId, isAutoApproved, depth = 0 } = inputs;

  const state = getState();
  const toolCallState = findToolCallById(state.session.history, toolCallId);
  if (!toolCallState) {
    console.warn(`Tool call with ID ${toolCallId} not found`);
    return;
  }

  if (toolCallState.status !== "generated") {
    return;
  }
  // Claim the call before any await: a double-click, key repeat, or Approve
  // on a call that is already auto-running must not run it a second time.
  dispatch(setToolCallCalling({ toolCallId }));
  // Stop aborts (and replaces) this aborter. A tool that finishes after Stop
  // records its result but must not start another billed round.
  const turnAborter = state.session.streamAborter;

  const selectedChatModel = selectSelectedChatModel(state);

  if (!selectedChatModel) {
    throw new Error("No model selected");
  }

  // A loop or step-limit refusal goes back to the model as this tool's error
  // so it can change approach; anything else (workspace changed, canceled)
  // still fails the turn.
  let guardRefusal: string | undefined;
  const combinedArgs = {
    ...(toolCallState.parsedArgs ?? {}),
    ...(toolCallState.processedArgs ?? {}),
  };
  if (hasUnrestoredPrivacyPlaceholder(combinedArgs)) {
    guardRefusal =
      "Privacy safety blocked this tool call because a __PII_* placeholder was not restored. Do not write or execute the placeholder. Re-read the relevant source, then retry the call with the value returned by the service.";
  }
  if (state.session.activeTaskId) {
    const signature = JSON.stringify({
      tool: toolCallState.toolCall.function.name,
      // Both: preprocessing alone is `{ resolvedPath: null }` for every path
      // that does not exist, so different calls would count as one repeated.
      arguments: {
        ...(toolCallState.parsedArgs ?? {}),
        ...(toolCallState.processedArgs ?? {}),
      },
    });
    const authorization = await extra.ideMessenger.request(
      "agent/task/authorizeAction",
      {
        taskId: state.session.activeTaskId,
        signature,
      },
      AGENT_RUNTIME_REQUEST_TIMEOUT_MS,
    );
    if (authorization.status === "error" && !guardRefusal) {
      // Never leave the call hanging in "generated": any guard refusal goes
      // back to the model (and the user sees it) as this tool's error.
      guardRefusal = isRecoverableGuardError(authorization.error)
        ? guardErrorForModel(authorization.error)
        : `Agent safety guard blocked this tool call: ${authorization.error}. Stop and tell the user what happened.`;
    }
  }

  const delegation =
    state.session.activeTaskId && state.session.activeImplementationSubagentId
      ? {
          taskId: state.session.activeTaskId,
          subagentId: state.session.activeImplementationSubagentId,
        }
      : undefined;
  if (delegation) {
    const authorization = await extra.ideMessenger.request(
      "agent/subagent/authorizeTool",
      {
        ...delegation,
        toolName: toolCallState.toolCall.function.name,
        args: {
          ...(toolCallState.parsedArgs ?? {}),
          ...(toolCallState.processedArgs ?? {}),
        },
      },
      AGENT_RUNTIME_REQUEST_TIMEOUT_MS,
    );
    // Returned to the model as the tool's error, never thrown: a throw here
    // left the call stuck in "generated" with the turn silently stopped.
    if (authorization.status === "error" && !guardRefusal)
      guardRefusal = `Subagent authority blocked this tool call: ${authorization.error}`;
  }

  if (state.session.activeTaskId && !guardRefusal) {
    try {
      await extra.ideMessenger.request(
        "agent/task/recordApproval",
        {
          taskId: state.session.activeTaskId,
          toolCallId,
          toolName: toolCallState.toolCall.function.name,
          risk: classifyToolRisk(toolCallState.toolCall.function.name),
          decision: "approved",
          // Both, as for the guard signature: preprocessing alone can hold
          // nothing of what the model asked for.
          scope: JSON.stringify({
            ...(toolCallState.parsedArgs ?? {}),
            ...(toolCallState.processedArgs ?? {}),
          }),
        },
        AGENT_RUNTIME_REQUEST_TIMEOUT_MS,
      );
      if (!isAutoApproved) {
        const transition = await extra.ideMessenger.request(
          "agent/task/transition",
          {
            taskId: state.session.activeTaskId,
            state: "executing",
            reason: "Approved tool execution started",
          },
          AGENT_RUNTIME_REQUEST_TIMEOUT_MS,
        );
        if (transition.status === "success") {
          dispatch(setActiveTaskState(transition.content.state));
        }
      }
    } catch {
      // Tool execution remains available if local audit persistence is unavailable.
    }
  }

  let output: ContextItem[] | undefined = undefined;
  let mcpUiState: McpUiState | undefined = undefined;
  let error: ContinueError | undefined = undefined;
  let streamResponse: boolean;

  // PreToolUse hooks run for every tool (client and core). A blocking hook
  // returns its reason to the model as the tool's error so it can adapt.
  const toolName = toolCallState.toolCall.function.name;
  const toolInput = {
    ...(toolCallState.parsedArgs ?? {}),
    ...(toolCallState.processedArgs ?? {}),
  };
  const preHook: HookRunResult = guardRefusal
    ? { blocked: false, warnings: [], ran: 0 }
    : await runHooks(extra.ideMessenger, {
        event: "PreToolUse",
        sessionId: state.session.id,
        toolName,
        toolInput,
      });

  // IMPORTANT:
  // Errors that occur while calling tool call implementations
  // Are caught and passed in output as context items
  // Errors that occur outside specifically calling the tool
  // Should not be caught here - should be handled as normal stream errors
  if (guardRefusal) {
    error = new ContinueError(ContinueErrorReason.Unspecified, guardRefusal);
    streamResponse = true;
  } else if (preHook.blocked) {
    error = new ContinueError(
      ContinueErrorReason.Unspecified,
      `Blocked by a PreToolUse hook: ${preHook.reason}`,
    );
    streamResponse = true;
  } else if (
    CLIENT_TOOLS_IMPLS.find(
      (toolName) => toolName === toolCallState.toolCall.function.name,
    )
  ) {
    // Tool is called on client side
    const {
      output: clientToolOutput,
      respondImmediately,
      error: clientToolError,
    } = await callClientTool(toolCallState, {
      dispatch,
      ideMessenger: extra.ideMessenger,
      getState,
    });
    output = clientToolOutput;
    error = clientToolError;
    streamResponse = respondImmediately;
  } else {
    // Tool is called on core side
    const result = await extra.ideMessenger.request(
      "tools/call",
      {
        toolCall: toolCallState.toolCall,
        sessionId: state.session.id,
        delegation,
      },
      CORE_TOOL_TIMEOUT_MS,
    );
    if (result.status === "error") {
      // A failed call is the tool's error for the model to handle, not a
      // thrown exception that leaves the turn hanging.
      output = [];
      error = new ContinueError(ContinueErrorReason.Unspecified, result.error);
    } else {
      output = Array.isArray(result.content?.contextItems)
        ? result.content.contextItems
        : [];
      mcpUiState = result.content.mcpUiState;
      error = result.content.errorMessage
        ? new ContinueError(
            result.content.errorReason || ContinueErrorReason.Unspecified,
            result.content.errorMessage,
          )
        : undefined;
    }
    streamResponse = true;
  }

  // PostToolUse hooks see the result; a blocking (exit 2) hook's reason is
  // fed back to the model alongside the output, e.g. "lint failed: ...".
  const hookFeedback: ContextItem[] = [];
  // An edit still being applied has not changed the file yet: its
  // PostToolUse hook runs when the apply closes (handleApplyStateUpdate), so
  // a lint hook checks the edited file, not the old one.
  const editStillApplying = !streamResponse && !error;
  if (!preHook.blocked && !guardRefusal && !editStillApplying) {
    const postHook = await runHooks(extra.ideMessenger, {
      event: "PostToolUse",
      sessionId: state.session.id,
      toolName,
      toolInput,
      toolOutput: toolOutputText(output),
      toolError: error?.message,
    });
    if (postHook.blocked) {
      hookFeedback.push({
        icon: "problems",
        name: "Hook feedback",
        description: "PostToolUse hook",
        content: `A PostToolUse hook reported: ${postHook.reason}`,
        hidden: false,
      });
    }
  }

  if (error) {
    dispatch(
      updateToolCallOutput({
        toolCallId,
        contextItems: [
          {
            icon: "problems",
            name: "Tool Call Error",
            description: "Tool Call Failed",
            content: `${toolCallState.toolCall.function.name} failed with the message: ${error.message}\n\nPlease try something else or request further instructions.`,
            hidden: false,
          },
          ...hookFeedback,
        ],
      }),
    );
  } else if (output?.length || hookFeedback.length) {
    dispatch(
      updateToolCallOutput({
        toolCallId,
        contextItems: [...(output ?? []), ...hookFeedback],
        mcpUiState,
      }),
    );
  }

  if (state.session.activeTaskId) {
    const changedFiles = !error ? changedFilesForTool(toolCallState) : [];
    if (changedFiles.length) {
      try {
        await extra.ideMessenger.request(
          "agent/task/recordMutation",
          { taskId: state.session.activeTaskId, changedFiles },
          AGENT_RUNTIME_REQUEST_TIMEOUT_MS,
        );
      } catch {
        // A local ledger outage must not hide the actual tool result.
      }
    }
    const evidence = verificationFromToolResult({
      toolName: toolCallState.toolCall.function.name,
      command: commandOf(toolCallState),
      output,
      failed: Boolean(error),
    });
    if (evidence) {
      try {
        await extra.ideMessenger.request(
          "agent/task/recordVerification",
          {
            taskId: state.session.activeTaskId,
            result: evidence,
          },
          AGENT_RUNTIME_REQUEST_TIMEOUT_MS,
        );
      } catch {
        // Verification journaling must not hide the actual tool result.
      }
    }

    // A failed tool call or a failing check is feedback for the model, not a
    // failed plan step. Failing the step here ended the whole task on the
    // second tool error (two edits with a missing `filepath` in a 27 call
    // build), after which every tool was refused with "Task is terminal" and
    // the agent could not repair its own failing tests. Loops are bounded by
    // the repeated-action guard, the step limit and the progress pause.
  }

  if (streamResponse) {
    if (error) {
      logToolUsage(toolCallState, false, false, extra.ideMessenger, output);
      dispatch(
        errorToolCall({
          toolCallId,
        }),
      );
    } else {
      logToolUsage(toolCallState, true, true, extra.ideMessenger, output);
      dispatch(
        acceptToolCall({
          toolCallId,
        }),
      );
    }

    if (turnAborter.signal.aborted) return;

    // Send to the LLM to continue the conversation
    const wrapped = await dispatch(
      streamResponseAfterToolCall({
        toolCallId,
        depth,
      }),
    );
    unwrapResult(wrapped);
  } else {
    // Edit tools continue from the apply path. Go idle only while this edit
    // is still applying and no sibling is running: going idle mid-batch let a
    // queued message start, and once the apply has closed its continuation
    // owns the stream.
    const current = selectCurrentToolCalls(getState());
    const stillApplying =
      current.find((tc) => tc.toolCallId === toolCallId)?.status === "calling";
    const siblingRunning = current.some(
      (tc) => tc.toolCallId !== toolCallId && tc.status === "calling",
    );
    // An edit that is accepted by itself is still the agent working: the
    // turn stays active until the apply closes and the next round starts. It
    // goes idle only where the user has to accept the diff.
    const ui = getState().ui;
    const acceptedByItself =
      (ui.permissionMode ?? DEFAULT_PERMISSION_MODE) !== "ask" ||
      ui.toolSettings[toolCallState.toolCall.function.name] ===
        "allowedWithoutPermission";
    if (stillApplying && !siblingRunning && !acceptedByItself) {
      dispatch(setInactive());
    }
  }
}
