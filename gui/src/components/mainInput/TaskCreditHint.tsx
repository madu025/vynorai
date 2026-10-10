import { useContext, useEffect, useState } from "react";
import { IdeMessengerContext } from "../../context/IdeMessenger";
import { useAppSelector } from "../../redux/hooks";
import { formatCredits } from "../../redux/util/turnCredits";
import { ToolTip } from "../gui/Tooltip";

// Average credits of the small benchmark tasks (backend/bench-results/baseline-2026-10-10.md:
// 199,269 credits over 80 runs). Rounded; refresh it when the benchmark baseline changes.
const NEW_USER_SMALL_TASK_CREDITS = 2500;

/**
 * Pre-task estimate from the user's own history: what a typical prompt and a
 * large one cost over the last 30 days. Refreshed after each finished turn.
 */
export function TaskCreditHint() {
  const ideMessenger = useContext(IdeMessengerContext);
  const isStreaming = useAppSelector((state) => state.session.isStreaming);
  const [stats, setStats] = useState<{ median: number; p90: number } | null>(
    null,
  );
  // Signed in, but no finished tasks in the last 30 days yet.
  const [isNewUser, setIsNewUser] = useState(false);

  useEffect(() => {
    if (isStreaming) return;
    let cancelled = false;
    void ideMessenger
      .request("vynor/usage", undefined)
      .then((res) => {
        if (cancelled || res.status !== "success") return;
        setStats(res.content?.taskCredits ?? null);
        setIsNewUser(Boolean(res.content) && !res.content?.taskCredits);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [isStreaming, ideMessenger]);

  if (!stats && isNewUser) {
    return (
      <ToolTip
        place="top"
        content={`Estimate until you have your own history: small tasks (fix a function, add a test) used about ${formatCredits(NEW_USER_SMALL_TASK_CREDITS)} credits in our benchmark. Work across many files uses more. This is replaced by your own numbers after your first tasks.`}
      >
        <span
          className="text-description-muted xs:inline hidden whitespace-nowrap"
          data-testid="task-credit-hint-estimate"
        >
          ~{formatCredits(NEW_USER_SMALL_TASK_CREDITS)}/small task
        </span>
      </ToolTip>
    );
  }
  if (!stats) return null;
  return (
    <ToolTip
      place="top"
      content={`Your typical task uses about ${formatCredits(stats.median)} credits; larger ones about ${formatCredits(stats.p90)} (last 30 days). Set a limit in Settings → Credit Limit per Task.`}
    >
      <span
        className="text-description-muted xs:inline hidden whitespace-nowrap"
        data-testid="task-credit-hint"
      >
        ~{formatCredits(stats.median)}/task
      </span>
    </ToolTip>
  );
}
