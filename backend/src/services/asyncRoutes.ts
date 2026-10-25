/**
 * Express 4 does not forward a rejected promise from an async route handler to the error middleware.
 * On Node 22 the rejection is unhandled and the whole process exits, which takes every in-flight
 * stream on that worker down with it. This module closes that hole once, for every router, instead of
 * wrapping ~150 handlers one by one:
 *
 * - `installAsyncRouteSafety()` patches `Layer.prototype.handle_request` so a handler that returns a
 *   promise has its rejection passed to `next(err)` (the existing error middleware answers 500).
 * - `installUnhandledRejectionBackstop()` logs (class and message only, never the payload) any other
 *   unhandled rejection and keeps the process alive. A request-scoped failure must not kill a worker.
 *
 * Import this module before any router is created. It is idempotent.
 */
// The backend is emitted as CommonJS. `import.meta.url` cannot be used here because TypeScript
// correctly rejects it for that output target; keep the loader compatible with the existing app
// module format instead of changing the whole backend module system for this patch.
const nodeRequire = eval("require") as (moduleName: string) => unknown;

const PATCH_FLAG = Symbol.for("vynorai.asyncRouteSafety");

type RouteHandler = (req: unknown, res: unknown, next: unknown) => unknown;
interface LayerLike {
  prototype: {
    handle: RouteHandler;
    handle_request: (
      this: { handle: RouteHandler },
      req: unknown,
      res: unknown,
      next: (err?: unknown) => void,
    ) => void;
    [PATCH_FLAG]?: boolean;
  };
}

export function installAsyncRouteSafety(): boolean {
  const Layer = nodeRequire("express/lib/router/layer.js") as LayerLike;
  if (Layer.prototype[PATCH_FLAG]) return false;
  Layer.prototype.handle_request = function handleRequest(req, res, next) {
    const fn = this.handle;
    // Error-handling middleware (4 arguments) is only invoked through handle_error.
    if (fn.length > 3) return next();
    try {
      const result = fn(req, res, next);
      if (
        result &&
        typeof (result as PromiseLike<unknown>).then === "function"
      ) {
        (result as Promise<unknown>).then(undefined, (err: unknown) =>
          next(err),
        );
      }
    } catch (err) {
      next(err);
    }
  };
  Layer.prototype[PATCH_FLAG] = true;
  return true;
}

export function describeRejection(reason: unknown): string {
  if (reason instanceof Error) return `${reason.name}: ${reason.message}`;
  return `non-error rejection (${typeof reason})`;
}

let backstopInstalled = false;

export function installUnhandledRejectionBackstop(): void {
  if (backstopInstalled) return;
  backstopInstalled = true;
  process.on("unhandledRejection", (reason) => {
    console.error(`[UnhandledRejection] ${describeRejection(reason)}`);
  });
}

installAsyncRouteSafety();
installUnhandledRejectionBackstop();
