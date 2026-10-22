/**
 * Runs analysis code the agent writes (JavaScript) on the device, in a Web Worker with no network.
 * The worker gets a copy of the cells, returns one JSON value, and is ended after a short time
 * limit. Nothing here can write to the workbook: results go back to the agent as data, and any
 * change still has to be staged and approved like every other change.
 */

export const RUN_CODE_MAX_CELLS = 2_500_000;
/** Separate column blocks per run_code call (B:B,H:H). */
export const RUN_CODE_MAX_AREAS = 8;
export const RUN_CODE_MAX_CHARS = 8_000;
export const RUN_CODE_TIMEOUT_MS = 5_000;
export const RUN_CODE_RESULT_CHARS = 6_000;
/** run_code calls per request, like the calculate limit. */
export const RUN_CODE_PER_REQUEST = 4;

/** Everything a worker could use to send data off the device or start more code. */
export const BLOCKED_GLOBALS = [
  "fetch",
  "XMLHttpRequest",
  "WebSocket",
  "WebSocketStream",
  "EventSource",
  "WebTransport",
  "importScripts",
  "Worker",
  "SharedWorker",
  "BroadcastChannel",
  "indexedDB",
  "caches",
  "navigator",
  "require",
  "process",
] as const;

export type SandboxInput = {
  headers: string[];
  rows: unknown[][];
  code: string;
};

export type SandboxOutcome =
  | { ok: true; result: unknown; truncated?: boolean }
  | { ok: false; error: string };

/**
 * The code that runs inside the worker, as plain JavaScript text (a bundler must not rename or
 * wrap anything in it, so it is not written as a function here).
 */
const WORKER_MAIN = String.raw`(function (scope, blocked) {
  "use strict";
  // Remove every network and code-loading API from the scope and its prototypes, for good.
  for (const name of blocked) {
    let target = scope;
    while (target) {
      try {
        if (Object.prototype.hasOwnProperty.call(target, name))
          Object.defineProperty(target, name, { value: undefined, writable: false, configurable: false });
      } catch (error) {
        try { target[name] = undefined; } catch (ignored) {}
      }
      target = Object.getPrototypeOf(target);
    }
  }
  const send = scope.postMessage.bind(scope);
  const toJson = (value) => JSON.stringify(value, (key, item) => {
    if (typeof item === "number" && !Number.isFinite(item)) return String(item);
    if (typeof item === "bigint") return String(item);
    if (item instanceof Map) return Object.fromEntries(item);
    if (item instanceof Set) return [...item];
    if (typeof item === "function") return undefined;
    return item;
  });
  scope.onmessage = async (event) => {
    scope.onmessage = null;
    const data = (event && event.data) || {};
    const headers = data.headers, rows = data.rows, code = data.code;
    try {
      // Objects per row only when the code uses them: they cost time on large ranges.
      const records = /\brecords\b/.test(code) ? rows.map((row) => {
        const record = {};
        headers.forEach((name, index) => { record[name] = row[index]; });
        return record;
      }) : [];
      const col = (name) => {
        const index = headers.indexOf(name);
        if (index < 0) throw new Error("No column named " + name + ".");
        return rows.map((row) => row[index]);
      };
      const num = (value) => {
        if (typeof value === "number") return value;
        const parsed = Number(String(value == null ? "" : value).replace(/[,\s]/g, ""));
        return Number.isFinite(parsed) ? parsed : NaN;
      };
      const run = new Function("headers", "rows", "records", "col", "num", '"use strict";\n' + code);
      const value = await run(headers, rows, records, col, num);
      const text = toJson(value === undefined ? null : value);
      send({ ok: true, json: text === undefined ? "null" : text });
    } catch (error) {
      send({ ok: false, error: String((error && error.message) || error).slice(0, 300) });
    }
  };
})`;

/** The worker's whole source. `prelude` lets the Node tests give it a `self`. */
export function workerSource(prelude = ""): string {
  return `${prelude}\n${WORKER_MAIN}(self, ${JSON.stringify(BLOCKED_GLOBALS)});`;
}

export type SandboxWorker = {
  postMessage(data: unknown): void;
  terminate(): void;
  onmessage: ((event: { data: any }) => void) | null;
  onerror: ((event: any) => void) | null;
};

/** In the add-in: a Worker from a blob URL. */
export function browserWorker(source: string): SandboxWorker {
  const url = URL.createObjectURL(
    new Blob([source], { type: "text/javascript" }),
  );
  const worker = new Worker(url);
  URL.revokeObjectURL(url);
  return worker as unknown as SandboxWorker;
}

/** Checks the agent's code before it runs: size, and a `return` so a value comes back. */
export function checkCode(code: unknown): string {
  const text = String(code ?? "").trim();
  if (!text) throw new Error("Give the code to run.");
  if (text.length > RUN_CODE_MAX_CHARS)
    throw new Error(
      `The code is longer than ${RUN_CODE_MAX_CHARS} characters.`,
    );
  if (!/\breturn\b/.test(text))
    throw new Error("The code must return its result with `return`.");
  return text;
}

/** Splits a block of cells into header names and data rows. */
export function splitHeaders(
  values: unknown[][],
  hasHeaders: boolean,
): { headers: string[]; rows: unknown[][] } {
  const width = values.reduce((max, row) => Math.max(max, row.length), 0);
  const letters = (index: number) => {
    let name = "";
    for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26))
      name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
    return name;
  };
  if (!hasHeaders || !values.length)
    return {
      headers: Array.from({ length: width }, (_, index) => letters(index)),
      rows: values,
    };
  const seen = new Map<string, number>();
  const headers = Array.from({ length: width }, (_, index) => {
    const base = String(values[0][index] ?? "").trim() || letters(index);
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    return count > 1 ? `${base} ${count}` : base;
  });
  return { headers, rows: values.slice(1) };
}

/** Runs the code on the cells in a fresh worker and ends the worker on result, error or time-out. */
export function runSandboxedCode(
  input: SandboxInput,
  options: {
    createWorker?: (source: string) => SandboxWorker;
    source?: string;
    timeoutMs?: number;
  } = {},
): Promise<SandboxOutcome> {
  const cells = input.rows.reduce((sum, row) => sum + row.length, 0);
  if (cells > RUN_CODE_MAX_CELLS)
    return Promise.resolve({
      ok: false,
      error: `The range has ${cells} cells; run_code reads at most ${RUN_CODE_MAX_CELLS}.`,
    });
  const create = options.createWorker ?? browserWorker;
  const timeoutMs = options.timeoutMs ?? RUN_CODE_TIMEOUT_MS;
  return new Promise((resolve) => {
    let worker: SandboxWorker;
    try {
      worker = create(options.source ?? workerSource());
    } catch (error) {
      resolve({
        ok: false,
        error: `Code cannot run here: ${String((error as Error)?.message ?? error)}`,
      });
      return;
    }
    let done = false;
    const finish = (outcome: SandboxOutcome) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      worker.terminate();
      resolve(outcome);
    };
    const timer = setTimeout(
      () =>
        finish({
          ok: false,
          error: `The code ran longer than ${timeoutMs / 1000} seconds and was stopped.`,
        }),
      timeoutMs,
    );
    worker.onmessage = (event) => {
      const data = event?.data;
      if (data?.ok === true && typeof data.json === "string") {
        const truncated = data.json.length > RUN_CODE_RESULT_CHARS;
        if (truncated)
          return finish({
            ok: true,
            result: `${data.json.slice(0, RUN_CODE_RESULT_CHARS)}...(cut: return a smaller summary)`,
            truncated: true,
          });
        try {
          return finish({ ok: true, result: JSON.parse(data.json) });
        } catch {
          return finish({ ok: false, error: "The result is not valid JSON." });
        }
      }
      finish({
        ok: false,
        error: String(data?.error ?? "The code failed.").slice(0, 300),
      });
    };
    worker.onerror = (event) =>
      finish({
        ok: false,
        error: String(event?.message ?? "The code failed.").slice(0, 300),
      });
    worker.postMessage({
      headers: input.headers,
      rows: input.rows,
      code: input.code,
    });
  });
}
