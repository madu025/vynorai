/**
 * Another try for a busy or unreachable service (502/503/504/429, Cloudflare 520-523 and 525, network): the agent makes many
 * model calls per request, and one provider hiccup should not lose the whole run. Refusals
 * (quota, consent, sign-in) and a Stop are never retried.
 */
// 521-523 and 525 are Cloudflare saying it could not reach or handshake with the server: the request
// never ran, so another try is safe. 520 (unknown error, the connection may have dropped after the
// server did the work) and 524 (it waited too long) are not retried: they could repeat a billed model call.
const TRANSIENT = new Set([
  "HTTP_502",
  "HTTP_503",
  "HTTP_504",
  "HTTP_429",
  "HTTP_521",
  "HTTP_522",
  "HTTP_523",
  "HTTP_525",
  "NETWORK_ERROR",
]);

export function isTransient(
  error: unknown,
  options: { network?: boolean } = {},
): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code !== "string" || !TRANSIENT.has(code)) return false;
  // A dropped connection may have happened after the server did (and billed) the work.
  return code !== "NETWORK_ERROR" || options.network !== false;
}

export async function retryTransient<T>(
  run: () => Promise<T>,
  options: {
    tries?: number;
    delays?: number[];
    wait?: (ms: number) => Promise<void>;
    shouldStop?: () => boolean;
    /** Set false for a billed call: a lost connection is then not retried (default true). */
    retryNetworkErrors?: boolean;
  } = {},
): Promise<T> {
  const tries = options.tries ?? 3;
  const delays = options.delays ?? [1000, 3000];
  const wait =
    options.wait ??
    ((ms: number) => new Promise<void>((done) => setTimeout(done, ms)));
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      if (
        attempt >= tries ||
        options.shouldStop?.() ||
        !isTransient(error, { network: options.retryNetworkErrors })
      )
        throw error;
      await wait(delays[Math.min(attempt - 1, delays.length - 1)]);
    }
  }
}
