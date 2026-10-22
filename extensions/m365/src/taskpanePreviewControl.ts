/**
 * Cancellable preview-run state for the task pane.
 *
 * This module owns only generation/AbortController coordination. It does not read or write Excel,
 * approve a plan, or decide what a request means. Keeping that guard separate makes it safe to
 * reuse from the existing preview controller without changing its approval path.
 */
export interface PreviewRun {
  generation: number;
  abortController: AbortController;
  isStale(): boolean;
}

export interface PreviewController {
  start(): PreviewRun;
  cancel(): void;
  finish(run: PreviewRun): void;
  hasActiveRun(): boolean;
}

export function createPreviewController(
  onVisibilityChange: (visible: boolean) => void,
): PreviewController {
  let generation = 0;
  let active: PreviewRun | undefined;

  const cancel = () => {
    generation += 1;
    active?.abortController.abort();
    active = undefined;
    onVisibilityChange(false);
  };

  return {
    start() {
      cancel();
      const run: PreviewRun = {
        generation,
        abortController: new AbortController(),
        isStale: () =>
          run.generation !== generation || run.abortController.signal.aborted,
      };
      active = run;
      onVisibilityChange(true);
      return run;
    },
    cancel,
    finish(run) {
      if (active !== run) return;
      active = undefined;
      onVisibilityChange(false);
    },
    hasActiveRun: () => Boolean(active),
  };
}
