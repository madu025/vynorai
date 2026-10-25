import assert from "node:assert/strict";
import test from "node:test";
import {
  createHttpSandboxWorker,
  isFreshWorkerTimestamp,
  registerConfiguredSandboxWorker,
  sandboxWorkerSignature,
} from "../src/services/m365SandboxWorker.js";
import { sandboxAvailability } from "../src/services/m365Sandbox.js";

const SECRET = "s".repeat(32);

test("worker signatures are deterministic and timestamp freshness is bounded", () => {
  const signature = sandboxWorkerSignature(SECRET, "100", "body");
  assert.equal(signature, sandboxWorkerSignature(SECRET, "100", "body"));
  assert.notEqual(signature, sandboxWorkerSignature(SECRET, "101", "body"));
  assert.equal(isFreshWorkerTimestamp("100", 100), true);
  assert.equal(isFreshWorkerTimestamp("100", 191), false);
  assert.equal(isFreshWorkerTimestamp("not-a-number", 100), false);
});

test("worker configuration requires HTTPS and a long shared secret", () => {
  assert.throws(
    () =>
      createHttpSandboxWorker({
        url: "https://worker.example/run",
        secret: "short",
      }),
    /at least 32 characters/,
  );
  assert.throws(
    () =>
      createHttpSandboxWorker({
        url: "http://worker.example/run",
        secret: SECRET,
      }),
    /credential-free HTTPS endpoint/,
  );
  assert.doesNotThrow(() =>
    createHttpSandboxWorker({
      url: "http://127.0.0.1:1/run",
      secret: SECRET,
      allowInsecureHttp: true,
    }),
  );
});

test("startup registration stays unavailable unless both endpoint and secret are configured", () => {
  assert.equal(
    registerConfiguredSandboxWorker({ NODE_ENV: "production" }),
    false,
  );
  assert.equal(sandboxAvailability().available, false);
  assert.equal(
    registerConfiguredSandboxWorker({
      NODE_ENV: "production",
      M365_SANDBOX_WORKER_URL: "https://worker.example/run",
    }),
    false,
  );
  assert.equal(sandboxAvailability().available, false);
  registerConfiguredSandboxWorker({});
});

test("cancellation sends an authenticated bounded cancel envelope", async () => {
  const worker = createHttpSandboxWorker({
    url: "http://127.0.0.1:1/run",
    secret: SECRET,
    allowInsecureHttp: true,
  });
  const originalFetch = globalThis.fetch;
  const calls: Array<{ body: string; headers: Headers }> = [];
  globalThis.fetch = (async (_input, init) => {
    const headers = new Headers(init?.headers);
    const body = String(init?.body ?? "");
    calls.push({ body, headers });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const request = JSON.parse(body) as { requestId: string; jobId: string };
    const responseBody = JSON.stringify({
      contractVersion: "2026-10-24.python-sandbox.v1",
      type: "cancel-result",
      requestId: request.requestId,
      jobId: request.jobId,
      status: "accepted",
    });
    return new Response(responseBody, {
      status: 200,
      headers: {
        "x-vynorai-worker-timestamp": timestamp,
        "x-vynorai-worker-signature": sandboxWorkerSignature(
          SECRET,
          timestamp,
          responseBody,
        ),
      },
    });
  }) as typeof fetch;
  try {
    await worker.cancel("sbx_123e4567-e89b-12d3-a456-426614174000");
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(calls.length, 1);
  const payload = JSON.parse(calls[0].body) as Record<string, unknown>;
  assert.equal(payload.contractVersion, "2026-10-24.python-sandbox.v1");
  assert.equal(payload.type, "cancel");
  assert.equal(payload.jobId, "sbx_123e4567-e89b-12d3-a456-426614174000");
  assert.match(String(payload.requestId), /^[0-9a-f-]{36}$/);
  assert.equal(typeof payload.requestedAt, "string");
  assert.equal(calls[0].headers.get("x-vynorai-worker-signature")?.length, 64);
});

test("cancellation fails closed on an unauthenticated or malformed worker response", async () => {
  const worker = createHttpSandboxWorker({
    url: "http://127.0.0.1:1/run",
    secret: SECRET,
    allowInsecureHttp: true,
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response("{}", {
      status: 200,
      headers: {
        "x-vynorai-worker-timestamp": String(Math.floor(Date.now() / 1000)),
        "x-vynorai-worker-signature": "0".repeat(64),
      },
    })) as typeof fetch;
  try {
    await assert.doesNotReject(() =>
      worker.cancel("sbx_123e4567-e89b-12d3-a456-426614174000"),
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
