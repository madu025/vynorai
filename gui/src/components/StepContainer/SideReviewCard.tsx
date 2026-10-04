import { useAppDispatch, useAppSelector } from "../../redux/hooks";
import { setSideReview } from "../../redux/slices/sessionSlice";

/**
 * "You should know" note under an agent reply: what a second look at the
 * changed files flagged. Only shown when it found something; dismissible.
 */
export default function SideReviewCard({ messageId }: { messageId: string }) {
  const dispatch = useAppDispatch();
  const note = useAppSelector(
    (state) => state.session.sideReviews?.[messageId],
  );

  if (note?.status === "running") {
    return (
      <div
        className="text-description-muted px-2.5 pt-1 text-[10px]"
        data-testid="side-review-running"
      >
        Taking a second look at the changes…
      </div>
    );
  }
  if (note?.status !== "done" || !note.text) return null;

  return (
    <div
      className="border-border bg-input mx-1.5 mt-2 rounded-md border border-solid px-3 py-2 text-xs"
      data-testid="side-review-card"
    >
      <div className="mb-1 flex items-center justify-between">
        <span className="font-semibold">You should know</span>
        <button
          className="text-description-muted cursor-pointer border-none bg-transparent text-xs hover:underline"
          onClick={() =>
            dispatch(
              setSideReview({ messageId, note: { status: "dismissed" } }),
            )
          }
        >
          Dismiss
        </button>
      </div>
      <ul className="m-0 list-none p-0">
        {note.text.split("\n").map((line, i) => (
          <li key={i} className="py-0.5">
            {line.replace(/^- /, "• ")}
          </li>
        ))}
      </ul>
    </div>
  );
}
