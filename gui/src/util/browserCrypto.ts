/**
 * The browser stand-in for Node's "crypto" in the webview build (see the alias in vite.config.ts).
 * Shared core files import randomFillSync and randomUUID from "crypto" so they work on Node 18,
 * which has no globalThis.crypto; in the webview Vite would otherwise replace that module with an
 * empty stub and the build fails. Both use the browser's CSPRNG, never Math.random.
 */
export function randomFillSync<T extends ArrayBufferView>(buffer: T): T {
  globalThis.crypto.getRandomValues(buffer as unknown as Uint8Array);
  return buffer;
}

export function randomUUID(): string {
  return globalThis.crypto.randomUUID();
}
