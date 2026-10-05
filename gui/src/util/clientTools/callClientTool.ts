import { ContextItem, ToolCallState } from "core";
import { BuiltInToolNames } from "core/tools/builtIn";
import { ContinueError, ContinueErrorReason } from "core/util/errors";
import { IIdeMessenger } from "../../context/IdeMessenger";
import {
  selectApplyStateByToolCallId,
  selectToolCallById,
} from "../../redux/selectors/selectToolCalls";
import { AppThunkDispatch, RootState } from "../../redux/store";
import { editToolImpl } from "./editImpl";
import { multiEditImpl } from "./multiEditImpl";
import { singleFindAndReplaceImpl } from "./singleFindAndReplaceImpl";
import { updateTodoListImpl } from "./updateTodoListImpl";

export interface ClientToolExtras {
  getState: () => RootState;
  dispatch: AppThunkDispatch;
  ideMessenger: IIdeMessenger;
}

export interface ClientToolOutput {
  output: ContextItem[] | undefined;
  respondImmediately: boolean;
}

export interface ClientToolResult extends ClientToolOutput {
  error?: ContinueError;
}

export type ClientToolImpl = (
  args: any,
  toolCallId: string,
  extras: ClientToolExtras,
) => Promise<ClientToolOutput>;

const FILE_EDIT_TOOLS = new Set<string>([
  BuiltInToolNames.EditExistingFile,
  BuiltInToolNames.SingleFindAndReplace,
  BuiltInToolNames.MultiEdit,
]);
const EDIT_SETTLE_POLL_MS = 100;
const EDIT_SETTLE_MAX_MS = 10 * 60_000;

// File edits run one at a time. Each edit reads the file and applies a full
// rewrite through the active editor, so two at once lost one edit on the
// same file and could land in the wrong editor on different files.
let editQueue: Promise<void> = Promise.resolve();

export function editSettled(state: RootState, toolCallId: string): boolean {
  const toolCall = selectToolCallById(state, toolCallId);
  if (!toolCall || toolCall.status !== "calling") return true;
  return selectApplyStateByToolCallId(state, toolCallId)?.status === "closed";
}

async function waitForEditToSettle(
  toolCallId: string,
  getState: () => RootState,
): Promise<void> {
  const deadline = Date.now() + EDIT_SETTLE_MAX_MS;
  while (!editSettled(getState(), toolCallId) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, EDIT_SETTLE_POLL_MS));
  }
}

export async function callClientTool(
  toolCallState: ToolCallState,
  extras: ClientToolExtras,
): Promise<ClientToolResult> {
  if (!FILE_EDIT_TOOLS.has(toolCallState.toolCall.function.name)) {
    return runClientTool(toolCallState, extras);
  }
  const turnAborter = extras.getState().session.streamAborter;
  const previous = editQueue;
  let release!: () => void;
  editQueue = new Promise((resolve) => (release = resolve));
  await previous;
  // Stopped while waiting for the earlier edit: don't touch the file.
  const current = selectToolCallById(
    extras.getState(),
    toolCallState.toolCall.id,
  );
  if (turnAborter.signal.aborted || (current && current.status !== "calling")) {
    release();
    return { respondImmediately: false, output: undefined };
  }
  const result = await runClientTool(toolCallState, extras);
  if (result.respondImmediately) {
    release();
  } else {
    void waitForEditToSettle(toolCallState.toolCall.id, extras.getState).then(
      release,
    );
  }
  return result;
}

async function runClientTool(
  toolCallState: ToolCallState,
  extras: ClientToolExtras,
): Promise<ClientToolResult> {
  const { toolCall, parsedArgs } = toolCallState;
  try {
    let output: ClientToolOutput;
    switch (toolCall.function.name) {
      case BuiltInToolNames.EditExistingFile:
        output = await editToolImpl(parsedArgs, toolCall.id, extras);
        break;
      case BuiltInToolNames.SingleFindAndReplace:
        output = await singleFindAndReplaceImpl(
          parsedArgs,
          toolCall.id,
          extras,
        );
        break;
      case BuiltInToolNames.MultiEdit:
        output = await multiEditImpl(parsedArgs, toolCall.id, extras);
        break;
      case BuiltInToolNames.UpdateTodoList:
        output = await updateTodoListImpl(parsedArgs, toolCall.id, extras);
        break;
      default:
        throw new Error(`Invalid client tool name ${toolCall.function.name}`);
    }
    return output;
  } catch (e) {
    return {
      respondImmediately: true,
      error:
        e instanceof ContinueError
          ? e
          : e instanceof Error
            ? new ContinueError(ContinueErrorReason.Unspecified, e.message)
            : new ContinueError(ContinueErrorReason.Unknown, String(e)),
      output: undefined,
    };
  }
}
