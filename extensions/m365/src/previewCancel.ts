/**
 * The Cancel button on the Preview card drops a preview that was never applied. It must never
 * touch the workbook, and it must not run while an apply is in flight or after one has finished
 * (then Undo is the way back).
 */
export interface PreviewCancelState {
  /** A preview (plan) is showing. */
  hasPreview: boolean;
  /** An apply is running right now. */
  applying: boolean;
  /** Something was already applied from this preview. */
  applied: boolean;
}

export function canCancelPreview(state: PreviewCancelState): boolean {
  return state.hasPreview && !state.applying && !state.applied;
}
