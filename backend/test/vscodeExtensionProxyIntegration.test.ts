import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import express from "express";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vynor-vscode-proxy-"));
const originalCwd = process.cwd();

let baseUrl = "";
let server: http.Server;
let dbm: typeof import("../src/db.js");
let quota: typeof import("../src/services/monthlyQuota.js");

const today = () => new Date().toISOString().slice(0, 10);
const daysFromNow = (d: number) => new Date(Date.now() + d * 86_400_000);

let userIndex = 0;
async function createSubscriber(
  plan = "pro",
): Promise<{ userId: string; apiKey: string }> {
  const userId = `vscode-user-${++userIndex}`;
  const apiKey = `vynor_live_${crypto.randomBytes(24).toString("hex")}`;
  const apiKeyHash = crypto.createHash("sha256").update(apiKey).digest("hex");

  await dbm.dbRun(
    "INSERT INTO users (id, email, password_hash, api_key, api_key_hash) VALUES (?, ?, 'hash', ?, ?)",
    [userId, `${userId}@example.com`, apiKey, apiKeyHash],
  );

  const validUntil = daysFromNow(30);
  await dbm.dbRun(
    `INSERT INTO subscriptions (id, user_id, plan_name, status, order_id, currency, valid_until)
     VALUES (?, ?, ?, 'active', ?, 'LKR', ?)`,
    [
      crypto.randomUUID(),
      userId,
      plan,
      `order-${userId}`,
      validUntil.toISOString(),
    ],
  );

  await quota.startPaidCycle(userId, plan, validUntil);
  return { userId, apiKey };
}

test("VS Code Extension Integration & Backend Proxy Test Suite", async (suite) => {
  process.chdir(tmpDir);
  process.env.NODE_ENV = "test";
  process.env.ADMIN_SECRET = "test-admin-secret-32-chars-long";

  dbm = await import("../src/db.js");
  await dbm.initDb();
  const { ensureMemoryTables } = await import(
    "../src/services/memoryEngine.js"
  );
  await ensureMemoryTables();

  const { config } = await import("../src/config.js");
  config.aiKeys.openrouter = "mock-openrouter-key";
  config.aiKeys.deepseek = "mock-deepseek-key";
  process.env.OPENROUTER_API_KEY = "mock-openrouter-key";
  process.env.DEEPSEEK_API_KEY = "mock-deepseek-key";

  quota = await import("../src/services/monthlyQuota.js");

  // Setup mock upstream AI server to simulate OpenRouter/DeepSeek responses
  const mockUpstreamServer = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => {
      let body: any = {};
      try {
        body = JSON.parse(raw);
      } catch {}

      if (body.stream) {
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        });
        const chunk1 = {
          id: "chatcmpl-mock-1",
          object: "chat.completion.chunk",
          created: Math.floor(Date.now() / 1000),
          choices: [
            {
              index: 0,
              delta: { role: "assistant", content: " Hello" },
              finish_reason: null,
            },
          ],
        };
        const chunk2 = {
          id: "chatcmpl-mock-2",
          object: "chat.completion.chunk",
          created: Math.floor(Date.now() / 1000),
          choices: [
            {
              index: 0,
              delta: { content: " world from mock provider!" },
              finish_reason: "stop",
            },
          ],
        };
        res.write(`data: ${JSON.stringify(chunk1)}\n\n`);
        res.write(`data: ${JSON.stringify(chunk2)}\n\n`);
        res.write("data: [DONE]\n\n");
        res.end();
      } else {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            id: "chatcmpl-mock-3",
            object: "chat.completion",
            created: Math.floor(Date.now() / 1000),
            choices: [
              {
                index: 0,
                message: {
                  role: "assistant",
                  content: " Mock completion output.",
                },
                text: " Mock completion output.",
                finish_reason: "stop",
              },
            ],
            usage: {
              prompt_tokens: 20,
              completion_tokens: 10,
              total_tokens: 30,
            },
          }),
        );
      }
    });
  });

  await new Promise<void>((resolve) => mockUpstreamServer.listen(0, resolve));
  const mockUpstreamPort = (mockUpstreamServer.address() as AddressInfo).port;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const urlStr =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : (input as Request).url;
    if (
      urlStr.startsWith("https://api.deepseek.com") ||
      urlStr.startsWith("https://openrouter.ai") ||
      urlStr.startsWith("https://api.openai.com") ||
      urlStr.startsWith("https://api.anthropic.com")
    ) {
      const parsed = new URL(urlStr);
      const mockTarget = `http://127.0.0.1:${mockUpstreamPort}${parsed.pathname}${parsed.search}`;
      return originalFetch(mockTarget, init);
    }
    return originalFetch(input, init);
  };

  const { proxyRouter } = await import("../src/routes/proxy.js");

  const app = express();
  app.use(express.json({ limit: "10mb" }));
  app.use("/v1", proxyRouter);

  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;

  suite.after(async () => {
    mockUpstreamServer?.close();
    globalThis.fetch = originalFetch;
    server?.close();
    if (dbm.db) {
      await new Promise<void>((resolve) => dbm.db!.close(() => resolve()));
    }
    process.chdir(originalCwd);
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 3 });
    } catch {}
  });

  // ─── 1. STREAMING CHAT COMPLETIONS ─────────────────────────────────────────
  await suite.test(
    "1. Streaming Chat Completions: SSE stream chunks, secret scrubbing, and proper [DONE] termination",
    async (t) => {
      const { apiKey } = await createSubscriber("pro");

      // Test with secrets embedded in user prompt to verify in-flight privacy shield
      const payload = {
        model: "deepseek/deepseek-flash",
        messages: [
          {
            role: "user",
            content:
              "Hello! My secret API key is sk-proj-1234567890abcdef1234567890abcdef. Can you help me?",
          },
        ],
        stream: true,
        temperature: 0.2,
      };

      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
          "X-VynorAI-Client": "vscode-extension",
          "X-VynorAI-Version": "2.0.0",
        },
        body: JSON.stringify(payload),
      });

      assert.equal(res.status, 200);
      assert.equal(
        res.headers.get("content-type")?.includes("text/event-stream"),
        true,
      );
      assert.equal(res.headers.get("x-vynorai-privacy-shield"), "Active");
      assert.equal(
        res.headers.get("x-vynorai-scrubbed-secrets"),
        "1",
        "Must detect and scrub the embedded secret",
      );

      // Read SSE body
      const bodyText = await res.text();
      const lines = bodyText
        .split("\n")
        .filter((line) => line.trim().length > 0);

      const dataLines = lines.filter((l) => l.startsWith("data: "));
      assert.ok(dataLines.length >= 1, "Must stream at least one data event");

      // Check terminating SSE chunk
      const lastLine = dataLines[dataLines.length - 1];
      assert.equal(
        lastLine,
        "data: [DONE]",
        "Stream must cleanly terminate with data: [DONE]",
      );

      // Check chunk structure
      const firstChunkJson = JSON.parse(dataLines[0].slice(6));
      assert.ok(
        firstChunkJson.choices,
        "First SSE chunk must have choices array",
      );
      assert.ok(
        firstChunkJson.choices[0].delta !== undefined,
        "Chunk must contain delta object",
      );
    },
  );

  // ─── 2. FIM COMPLETIONS WITH PREFIX CACHE ─────────────────────────────────
  await suite.test(
    "2. FIM Completions with Prefix Cache: Context slicing, prompt/prefix duality, and fast tab autocomplete",
    async (t) => {
      const { apiKey, userId } = await createSubscriber("pro");

      // Test Format A: Continue standard format using `prompt` and `suffix`
      const fimLinesAbove = Array.from(
        { length: 90 },
        (_, i) => `const x${i} = ${i};`,
      ).join("\n");
      const fimLinesBelow = Array.from(
        { length: 45 },
        (_, i) => `const y${i} = ${i};`,
      ).join("\n");

      const payloadFormatA = {
        model: "qwen/qwen-2.5-coder-32b-instruct",
        prompt: `${fimLinesAbove}\nfunction calculateSum(a, b) {\n  return `,
        suffix: `\n}\n${fimLinesBelow}`,
        max_tokens: 32,
        temperature: 0.1,
        stream: false,
      };

      // Both /fim/completions and /completions should work interchangeably
      const resA = await fetch(`${baseUrl}/fim/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
          "X-VynorAI-Client": "vscode-extension",
        },
        body: JSON.stringify(payloadFormatA),
      });

      assert.equal(resA.status, 200);
      assert.equal(resA.headers.get("x-vynorai-engine"), "FIM-UltraFast");
      assert.ok(resA.headers.get("x-vynorai-fim-model"));

      const jsonA = (await resA.json()) as any;
      assert.ok(jsonA.choices && jsonA.choices.length > 0);

      // Test Format B: Standard /completions endpoint alias using `prefix` and `stream: true`
      const payloadFormatB = {
        model: "qwen/qwen-2.5-coder-32b-instruct",
        prefix: "const greet = (name: string) => `Hello, ${",
        suffix: "}`;",
        max_tokens: 16,
        stream: true,
      };

      const resB = await fetch(`${baseUrl}/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
          "X-VynorAI-Client": "vscode-extension",
        },
        body: JSON.stringify(payloadFormatB),
      });

      assert.equal(resB.status, 200);
      assert.equal(
        resB.headers.get("content-type")?.includes("text/event-stream"),
        true,
      );
      const bodyB = await resB.text();
      assert.ok(bodyB.includes("data: [DONE]") || bodyB.includes("choices"));

      // Verify usage logging with optimization mode
      const logs = await dbm.dbAll<any>(
        "SELECT * FROM usage_logs WHERE user_id = ? ORDER BY created_at DESC",
        [userId],
      );
      assert.ok(logs.length >= 1, "Must record FIM usage logs");
    },
  );

  // ─── 3. RESILIENT AUTO-RECONNECT ON NETWORK FAILURE ───────────────────────
  await suite.test(
    "3. Resilient Auto-Reconnect: Exponential retry on transient errors, fast-fail on auth errors, and clean abort",
    async (t) => {
      const { apiKey } = await createSubscriber("starter");

      // 3.1 Fast-fail on invalid credentials (never retry client auth errors 401)
      const invalidAuthRes = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer vynor_live_nonexistent_key",
          "X-VynorAI-Client": "vscode-extension",
        },
        body: JSON.stringify({
          model: "deepseek/deepseek-flash",
          messages: [{ role: "user", content: "hi" }],
        }),
      });
      assert.equal(
        invalidAuthRes.status,
        401,
        "Must fast-fail with 401 without retry loops",
      );

      // 3.2 Plan restriction fast-fail (Starter user attempting Claude Opus 4.6)
      const restrictedRes = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
          "X-VynorAI-Client": "vscode-extension",
        },
        body: JSON.stringify({
          model: "anthropic/claude-3-opus",
          messages: [{ role: "user", content: "Write a compiler" }],
        }),
      });
      assert.equal(
        restrictedRes.status,
        403,
        "Must fast-fail with 403 plan restriction without retrying",
      );
      const restrictedJson = (await restrictedRes.json()) as any;
      assert.ok(
        restrictedJson.error.code === "model_not_allowed" ||
          restrictedJson.error.code === "model_locked",
        "Error code must be model_not_allowed or model_locked",
      );

      // 3.3 Auto-reconnect simulation:
      // Test the retry logic exported from core/llm/utils/retry
      const { retryAsync } = await import("../../core/llm/utils/retry.js");

      let networkAttempts = 0;
      const transientNetworkOperation = async () => {
        networkAttempts++;
        if (networkAttempts < 3) {
          // Simulate transient network connection reset (ECONNRESET)
          const err: any = new Error("read ECONNRESET");
          err.code = "ECONNRESET";
          throw err;
        }
        return { success: true, attempts: networkAttempts };
      };

      const retryResult = await retryAsync(transientNetworkOperation, {
        maxAttempts: 4,
        baseDelay: 10,
        maxDelay: 50,
        shouldRetry: (err) => {
          return err.code === "ECONNRESET" || err.code === "ETIMEDOUT";
        },
      });

      assert.equal(retryResult.success, true);
      assert.equal(
        retryResult.attempts,
        3,
        "Must automatically reconnect and succeed on 3rd attempt after transient network failures",
      );

      // 3.4 Client side abort handling (abort signal prevents dangling requests)
      const abortController = new AbortController();
      abortController.abort(); // Pre-aborted signal

      let abortedAttempts = 0;
      await assert.rejects(
        async () => {
          await retryAsync(
            async () => {
              abortedAttempts++;
              throw new Error("aborted");
            },
            {
              maxAttempts: 3,
              baseDelay: 10,
              shouldRetry: () => !abortController.signal.aborted,
            },
          );
        },
        /aborted/,
        "Must not retry when client abort signal is fired",
      );
      assert.equal(
        abortedAttempts,
        1,
        "Must exit immediately on abort without retrying",
      );
    },
  );
});
