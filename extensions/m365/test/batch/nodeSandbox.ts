/** The add-in's code sandbox (src/codeSandbox.ts) in a Node worker, for tests and live runs. */
import { Worker } from "node:worker_threads";
import type { SandboxWorker } from "../../src/codeSandbox.js";

/** Gives the Node worker what a browser worker has: `self`, postMessage and onmessage. */
export const NODE_PRELUDE = `
const { parentPort } = require("node:worker_threads");
globalThis.self = globalThis;
globalThis.postMessage = (message) => parentPort.postMessage(message);
parentPort.on("message", (data) => globalThis.onmessage && globalThis.onmessage({ data }));
`;

export function nodeSandboxWorker(source: string): SandboxWorker {
  const worker = new Worker(source, { eval: true });
  const shim: SandboxWorker = {
    onmessage: null,
    onerror: null,
    postMessage: (data) => worker.postMessage(data),
    terminate: () => void worker.terminate(),
  };
  worker.on("message", (data) => shim.onmessage?.({ data }));
  worker.on("error", (error) => shim.onerror?.(error));
  return shim;
}
