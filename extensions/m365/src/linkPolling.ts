/**
 * Polling rules for the "Connect VynorAI account" hand-off. The one-time code lives ten minutes on
 * the server, so the pane checks every two seconds for at most that long and then stops (it never
 * polls forever). Kept free of Office.js and the DOM so it is easy to test.
 */
import { isTransient, retryTransient } from "./retryTransient.js";

export const LINK_POLL_INTERVAL_MS = 2000;
/** 120 checks x 2 s = 240 s: long enough for a sign-in plus email confirmation round trip. */
export const LINK_POLL_MAX_ATTEMPTS = 120;

export interface LinkPollState {
  linked: boolean;
  state?: "pending" | "linked" | "expired" | "none";
}

export type LinkPollOutcome = "linked" | "expired" | "continue";

/** What one status answer means. Anything unexpected keeps waiting rather than guessing. */
export function linkPollOutcome(state: LinkPollState): LinkPollOutcome {
  if (state.linked || state.state === "linked") return "linked";
  if (state.state === "expired") return "expired";
  return "continue";
}

/**
 * One status check that survives a hiccup: a busy service or a dropped connection gets one more try,
 * and if it still fails the check is skipped (undefined) so the poll keeps waiting. The person is
 * signing in on another page for minutes; one bad answer must not end the wait. A refusal such as an
 * expired sign-in (401) is not transient and still throws.
 */
export async function checkLinkStatus(
  fetchStatus: () => Promise<LinkPollState>,
  options: { wait?: (ms: number) => Promise<void> } = {},
): Promise<LinkPollState | undefined> {
  try {
    return await retryTransient(fetchStatus, {
      tries: 2,
      delays: [500],
      wait: options.wait,
    });
  } catch (error) {
    if (isTransient(error)) return undefined;
    throw error;
  }
}

/** Whole seconds left for a countdown, never negative; an unreadable date counts as expired. */
export function secondsUntil(
  expiresAt: string,
  now: number = Date.now(),
): number {
  const at = Date.parse(expiresAt);
  if (!Number.isFinite(at)) return 0;
  return Math.max(0, Math.ceil((at - now) / 1000));
}
