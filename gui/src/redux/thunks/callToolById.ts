import { createAsyncThunk, unwrapResult } from "@reduxjs/toolkit";
import { ContextItem, McpUiState } from "core";
import { CLIENT_TOOLS_IMPLS } from "core/tools/builtIn";
import { ContinueError, ContinueErrorReason } from "core/util/errors";
import { classifyToolRisk } from "core/agent/toolRisk";
import type { HookRunResult } from "core/hooks/types";

import { callClientTool } from "../../util/clientTools/callClientTool";
import { selectSelectedChatModel } from "../slices/configSlice";
import {
  acceptToolCall,
  errorToolCall,
  setActiveTaskState,
  setInactive,
  setToolCallCalling,
  updateToolCallOutput,
} from "../slices/sessionSlice";
import { ThunkApiType } from "../store";
import { findToolCallById, logToolUsage } from "../util";
import { streamResponseAfterToolCall } from "./streamResponseAfterToolCall";
import { verificationFromToolResult } from "../util/verificationEvidence";
import { runHooks, toolOutputText } from "../util/hooks";
import {
  guardErrorForModel,
  isRecoverableGuardError,
} from "../util/toolRoundBudget";

export const callToolById = createAsyncThunk<
  void,
  { toolCallId: string; isAutoApproved?: boolean; depth?: number },
  ThunkApiType
>("chat/callTool", async (inputs, { dispatch, extra, getState }) => {
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

  const selectedChatModel = selectSelectedChatModel(state);

  if (!selectedChatModel) {
    throw new Error("No model selected");
  }

  // A loop or step-limit refusal goes back to the model as this tool's error
  // so it can change approach; anything else (workspace changed, canceled)
  // still fails the turn.
  let guardRefusal: string | undefined;
  if (state.session.activeTaskId) {
    const signature = JSON.stringify({
      tool: toolCallState.toolCall.function.name,
      arguments: toolCallState.processedArgs ?? toolCallState.parsedArgs ?? {},
    });
    const authorization = await extra.ideMessenger.request(
      "agent/task/authorizeAction",
      {
        taskId: state.session.activeTaskId,
        signature,
      },
    );
    if (authorization.status === "error") {
      if (!isRecoverableGuardError(authorization.error)) {
        throw new Error(
          `Agent safety guard blocked tool execution: ${authorization.error}`,
        );
      }
      guardRefusal = guardErrorForModel(authorization.error);
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
    );
    if (authorization.status === "error")
      throw new Error(
        `Subagent authority blocked tool execution: ${authorization.error}`,
      );
  }

  if (state.session.activeTaskId && !guardRefusal) {
    try {
      await extra.ideMessenger.request("agent/task/recordApproval", {
        taskId: state.session.activeTaskId,
        toolCallId,
        toolName: toolCallState.toolCall.function.name,
        risk: classifyToolRisk(toolCallState.toolCall.function.name),
        decision: "approved",
        scope: JSON.stringify(
          toolCallState.processedArgs ?? toolCallState.parsedArgs ?? {},
        ),
      });
      if (!isAutoApproved) {
        const transition = await extra.ideMessenger.request(
          "agent/task/transition",
          {
            taskId: state.session.activeTaskId,
            state: "executing",
            reason: "Approved tool execution started",
          },
        );
        if (transition.status === "success") {
          dispatch(setActiveTaskState(transition.content.state));
        }
      }
    } catch {
      // Tool execution remains available if local audit persistence is unavailable.
    }
  }

  dispatch(
    setToolCallCalling({
      toolCallId,
    }),
  );

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
    const result = await extra.ideMessenger.request("tools/call", {
      toolCall: toolCallState.toolCall,
      delegation,
    });
    if (result.status === "error") {
      throw new Error(result.error);
    } else {
      output = result.content.contextItems;
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
  if (!preHook.blocked && !guardRefusal) {
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
    const rawArgs =
      toolCallState.processedArgs ?? toolCallState.parsedArgs ?? {};
    const evidence = verificationFromToolResult({
      toolName: toolCallState.toolCall.function.name,
      command:
        typeof (rawArgs as Record<string, unknown>).command === "string"
          ? ((rawArgs as Record<string, unknown>).command as string)
          : undefined,
      output,
      failed: Boolean(error),
    });
    if (evidence) {
      try {
        await extra.ideMessenger.request("agent/task/recordVerification", {
          taskId: state.session.activeTaskId,
          result: evidence,
        });
      } catch {
        // Verification journaling must not hide the actual tool result.
      }
    }
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

    // Send to the LLM to continue the conversation
    const wrapped = await dispatch(
      streamResponseAfterToolCall({
        toolCallId,
        depth,
      }),
    );
    unwrapResult(wrapped);
  } else {
    dispatch(setInactive());
  }
});
