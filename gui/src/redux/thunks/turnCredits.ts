import { createAsyncThunk } from "@reduxjs/toolkit";

import { setMessageCredits, setTurnCredits } from "../slices/sessionSlice";
import { ThunkApiType } from "../store";

// The backend settles a request's credits just after its stream ends.
const SETTLE_DELAY_MS = 1200;

/** Current monthly credits used, or null when the model is not VynorAI. */
export async function fetchCreditsUsed(
  extra: ThunkApiType["extra"],
): Promise<number | null> {
  try {
    const res = await extra.ideMessenger.request("vynor/usage", undefined);
    return res.status === "success" && res.content ? res.content.used : null;
  } catch {
    return null;
  }
}

/** Share of the monthly credits already used (0-1), or null if unknown. */
export async function fetchCreditShare(
  extra: ThunkApiType["extra"],
): Promise<number | null> {
  try {
    const res = await extra.ideMessenger.request("vynor/usage", undefined);
    if (res.status !== "success" || !res.content?.limit) return null;
    return res.content.used / res.content.limit;
  } catch {
    return null;
  }
}

/** After a prompt ends, record what it cost under its last reply. */
export const finalizeTurnCredits = createAsyncThunk<
  void,
  { messageId: string },
  ThunkApiType
>(
  "session/finalizeTurnCredits",
  async ({ messageId }, { dispatch, extra, getState }) => {
    const turn = getState().session.turnCredits;
    if (!turn) return;
    await new Promise((r) => setTimeout(r, SETTLE_DELAY_MS));
    const used = await fetchCreditsUsed(extra);
    if (used === null) return;
    const credits = Math.max(0, used - turn.start);
    // A new prompt may have started during the settle delay with its own
    // baseline; never overwrite it with this turn's.
    if (getState().session.turnCredits?.start === turn.start)
      dispatch(setTurnCredits({ start: turn.start, used: credits }));
    dispatch(setMessageCredits({ messageId, credits }));
  },
);
