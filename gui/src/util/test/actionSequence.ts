import { expect } from "vitest";

/**
 * Actions dispatched by fire-and-forget work whose position in the sequence
 * depends only on how many awaits happen to run before it resolves.
 */
const ASYNC_NOISE = new Set(["symbols/updateFromContextItems/fulfilled"]);

const typeOf = (action: unknown): string | undefined =>
  typeof action === "string" ? action : (action as { type?: string })?.type;

/**
 * Exact action-sequence assertion that ignores the position of async-noise
 * actions (but still requires them to occur exactly when expected). Works
 * with action objects or plain action-type strings.
 */
export function expectActionSequence(
  actual: unknown[],
  expected: unknown[],
): void {
  const strip = (list: unknown[]) =>
    list.filter((a) => !ASYNC_NOISE.has(typeOf(a) ?? ""));
  expect(strip(actual)).toEqual(strip(expected));
  for (const type of ASYNC_NOISE) {
    const count = (list: unknown[]) =>
      list.filter((a) => typeOf(a) === type).length;
    expect(count(actual), `occurrences of ${type}`).toBe(count(expected));
  }
}
