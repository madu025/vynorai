/**
 * Refusals of the execution guard that the model can recover from. The GUI
 * recognises them by these exact texts, so they are defined once here.
 */
export const STEP_LIMIT_ERROR = "Autonomous step limit reached";
export const REPEAT_LIMIT_ERROR = "Repeated tool action limit reached";

/**
 * Runaway-loop safety net per task. The GUI pauses a turn when it stops
 * making progress (gui/src/redux/util/agentProgress.ts); this only catches a
 * loop that still looks productive. "Continue" starts a new task.
 *
 * Defined here, not in TaskRuntime (which needs Node modules), because the
 * GUI counts to the same limit when a prompt has no task.
 */
export const MAX_AUTONOMOUS_STEPS = 200;
