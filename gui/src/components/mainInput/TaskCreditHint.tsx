import { useContext, useEffect, useState } from "react";
import { IdeMessengerContext } from "../../context/IdeMessenger";
import { useAppSelector } from "../../redux/hooks";
import { formatCredits } from "../../redux/util/turnCredits";
import { ToolTip } from "../gui/Tooltip";

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

  useEffect(() => {
    if (isStreaming) return;
    let cancelled = false;
    void ideMessenger
      .request("vynor/usage", undefined)
      .then((res) => {
        if (cancelled || res.status !== "success") return;
        setStats(res.content?.taskCredits ?? null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [isStreaming, ideMessenger]);

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
