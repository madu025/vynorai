/**
 * Another try for a busy or unreachable service (502/503/504/429, network): the agent makes many
 * model calls per request, and one provider hiccup should not lose the whole run. Refusals
 * (quota, consent, sign-in) and a Stop are never retried.
 */
const TRANSIENT = new Set(["HTTP_502", "HTTP_503", "HTTP_504", "HTTP_429", "NETWORK_ERROR"]);

export function isTransient(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" && TRANSIENT.has(code);
}

export async function retryTransient<T>(
  run: () => Promise<T>,
  options: {
    tries?: number;
    delays?: number[];
    wait?: (ms: number) => Promise<void>;
    shouldStop?: () => boolean;
  } = {},
): Promise<T> {
  const tries = options.tries ?? 3;
  const delays = options.delays ?? [1000, 3000];
  const wait = options.wait ?? ((ms: number) => new Promise<void>((done) => setTimeout(done, ms)));
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      if (attempt >= tries || options.shouldStop?.() || !isTransient(error)) throw error;
      await wait(delays[Math.min(attempt - 1, delays.length - 1)]);
    }
  }
}
