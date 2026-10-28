/** Pure eligibility decisions for the unified VynorAI Run button. */

export type RunGateReason =
  | "ready"
  | "account_not_ready"
  | "request_required"
  | "selection_required"
  | "request_running"
  | "waiting_for_host"
  | "backend_unavailable"
  | "agent_unavailable";

export type CapabilityState = "idle" | "loading" | "ready" | "unavailable";

export interface RunGateInput {
  signedIn: boolean;
  /** Microsoft is signed in, and the VynorAI account link/capability handshake completed. */
  accountReady?: boolean;
  request: string;
  selection?: { address?: string; rows?: number; columns?: number };
  busy: boolean;
  capabilityState: CapabilityState;
  canInspect?: boolean;
  agentMode: boolean;
  aiAvailable: boolean;
}

export interface RunGateState {
  enabled: boolean;
  reason: RunGateReason;
  message: string;
}

export function evaluateRunGate(input: RunGateInput): RunGateState {
  if (!input.signedIn || input.accountReady === false)
    return {
      enabled: false,
      reason: "account_not_ready",
      message: "Sign in to use VynorAI with Excel.",
    };
  if (!input.request.trim())
    return {
      enabled: false,
      reason: "request_required",
      message: "Describe what you want first.",
    };
  if (
    !input.selection?.address ||
    (input.selection.rows ?? 0) < 1 ||
    (input.selection.columns ?? 0) < 1
  )
    return {
      enabled: false,
      reason: "selection_required",
      message: "Select a rectangular Excel range first.",
    };
  if (input.busy)
    return {
      enabled: false,
      reason: "request_running",
      message: "A request is already running. Wait or cancel it first.",
    };
  if (input.capabilityState === "loading")
    return {
      enabled: false,
      reason: "waiting_for_host",
      message: "Waiting for Excel and account capabilities.",
    };
  if (input.capabilityState === "idle" && input.canInspect === undefined)
    return {
      enabled: false,
      reason: "waiting_for_host",
      message: "Waiting for Excel and account capabilities.",
    };
  if (input.capabilityState === "unavailable" || input.canInspect === false)
    return {
      enabled: false,
      reason: "backend_unavailable",
      message:
        "Excel preview is unavailable. Reconnect VynorAI or check Diagnostics.",
    };
  if (input.agentMode && !input.aiAvailable)
    return {
      enabled: false,
      reason: "agent_unavailable",
      message:
        "Agent workflow is unavailable for this account. Use Local preview.",
    };
  return { enabled: true, reason: "ready", message: "Ready to run." };
}
