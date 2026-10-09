import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import crypto from "node:crypto";
import { Readable } from "node:stream";
import type { AddressInfo } from "node:net";

// Setup environment secrets before any imports
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vynor-bg-benchmark-"));
// db.ts opens SQLite at import time under cwd/data; isolate it before any import
// so the test never touches the developer's real backend/data database.
process.chdir(tmpDir);
process.env.BG_QUOTE_SECRET = "q".repeat(48);
process.env.DATA_ENCRYPTION_KEY =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
process.env.BG_ARTIFACT_MASTER_KEY =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
process.env.BG_ARTIFACT_DIR = path.join(tmpDir, "artifacts");
process.env.BG_MODEL_TOKEN_SECRET = "m".repeat(48);

// Mock Redis Factory
function createMockRedis() {
  const kv = new Map<string, string>();
  const zsets = new Map<string, Map<string, number>>();
  const hashes = new Map<string, Map<string, string>>();

  function getZSet(key: string) {
    let z = zsets.get(key);
    if (!z) {
      z = new Map<string, number>();
      zsets.set(key, z);
    }
    return z;
  }

  function getSortedZSetEntries(key: string): [string, number][] {
    const z = zsets.get(key);
    if (!z) return [];
    return Array.from(z.entries()).sort((a, b) => {
      if (a[1] !== b[1]) return a[1] - b[1];
      return a[0].localeCompare(b[0]);
    });
  }

  const mock: any = {
    isReady: true,
    isOpen: true,
    async get(key: string) {
      return kv.get(key) ?? null;
    },
    async set(key: string, value: string, options?: any) {
      if (options?.NX && kv.has(key)) {
        return null;
      }
      kv.set(key, value);
      return "OK";
    },
    async getDel(key: string) {
      const val = kv.get(key) ?? null;
      kv.delete(key);
      return val;
    },
    async del(keys: string | string[]) {
      const arr = Array.isArray(keys) ? keys : [keys];
      let count = 0;
      for (const k of arr) {
        if (kv.delete(k) || zsets.delete(k) || hashes.delete(k)) count++;
      }
      return count;
    },
    async exists(key: string) {
      return kv.has(key) || zsets.has(key) || hashes.has(key) ? 1 : 0;
    },
    async zAdd(
      key: string,
      items: { score: number; value: string }[],
      options?: any,
    ) {
      const z = getZSet(key);
      let count = 0;
      for (const item of items) {
        const exists = z.has(item.value);
        if (options?.XX && !exists) continue;
        if (options?.NX && exists) continue;
        const oldScore = z.get(item.value);
        z.set(item.value, item.score);
        if (options?.CH) {
          if (!exists || oldScore !== item.score) count++;
        } else {
          if (!exists) count++;
        }
      }
      return count;
    },
    async zRem(key: string, ...values: string[]) {
      const z = zsets.get(key);
      if (!z) return 0;
      let count = 0;
      for (const v of values) {
        if (z.delete(v)) count++;
      }
      return count;
    },
    async zCard(key: string) {
      return zsets.get(key)?.size || 0;
    },
    async zRange(key: string, start: number, stop: number) {
      const sorted = getSortedZSetEntries(key);
      const end = stop < 0 ? sorted.length + stop + 1 : stop + 1;
      return sorted.slice(start, end).map(([val]) => val);
    },
    async zRangeByScore(
      key: string,
      min: number | string,
      max: number | string,
    ) {
      const minNum = min === "-inf" ? -Infinity : Number(min);
      const maxNum = max === "+inf" ? Infinity : Number(max);
      const sorted = getSortedZSetEntries(key);
      return sorted
        .filter(([, score]) => score >= minNum && score <= maxNum)
        .map(([val]) => val);
    },
    async zRank(key: string, value: string) {
      const sorted = getSortedZSetEntries(key);
      const idx = sorted.findIndex(([val]) => val === value);
      return idx === -1 ? null : idx;
    },
    async hSet(key: string, field: string, value: string) {
      let h = hashes.get(key);
      if (!h) {
        h = new Map<string, string>();
        hashes.set(key, h);
      }
      const isNew = !h.has(field);
      h.set(field, value);
      return isNew ? 1 : 0;
    },
    multi() {
      const queue: Array<() => Promise<any>> = [];
      const m = {
        zRem(key: string, value: string) {
          queue.push(() => mock.zRem(key, value));
          return m;
        },
        zAdd(key: string, items: any, options?: any) {
          queue.push(() => mock.zAdd(key, items, options));
          return m;
        },
        set(key: string, value: string, options?: any) {
          queue.push(() => mock.set(key, value, options));
          return m;
        },
        async exec() {
          const results = [];
          for (const fn of queue) {
            results.push(await fn());
          }
          return results;
        },
      };
      return m;
    },
    async eval(
      script: string,
      { keys, arguments: args }: { keys: string[]; arguments: string[] },
    ) {
      if (script.includes("ZCARD") && script.includes("ZRANGE")) {
        // claimBackgroundTask script
        const readyKey = keys[0];
        const procKey = keys[1];
        const workersKey = keys[2];
        const leaseExpiry = Number(args[0]);
        const workerId = args[1];
        const maxConcurrency = Number(args[2]);

        const procCount = await mock.zCard(procKey);
        if (procCount >= maxConcurrency) return null;

        const readyItems = await mock.zRange(readyKey, 0, 0);
        const item = readyItems[0];
        if (!item) return null;

        await mock.zRem(readyKey, item);
        await mock.zAdd(procKey, [{ score: leaseExpiry, value: item }]);
        await mock.hSet(workersKey, item, workerId);
        return item;
      }
      if (script.includes("GET") && script.includes("DEL")) {
        // lock release script
        const key = keys[0];
        const expectedToken = args[0];
        if (kv.get(key) === expectedToken) {
          kv.delete(key);
          return 1;
        }
        return 0;
      }
      return null;
    },
    _reset() {
      kv.clear();
      zsets.clear();
      hashes.clear();
    },
  };
  return mock;
}

test("Background Agent Queue: Concurrency Limits, Quote Pricing, LLM Failover & 10-Task Stress Benchmark", async (suite) => {
  const mockRedis = createMockRedis();
  const { setRedisClientForTesting } = await import(
    "../src/services/redisStore.js"
  );
  setRedisClientForTesting(mockRedis);

  const { initDb, dbRun, dbGet, dbAll } = await import("../src/db.js");
  process.chdir(tmpDir);
  await initDb();

  const {
    validateEstimateInput,
    createEstimateQuote,
    verifyEstimateQuote,
    storeEstimateQuote,
    consumeEstimateQuote,
  } = await import("../src/services/backgroundQuote.js");

  const {
    createBackgroundTask,
    uploadBackgroundProject,
    cancelBackgroundTask,
    settleBackgroundTaskReservation,
  } = await import("../src/services/backgroundTasks.js");

  const {
    claimBackgroundTask,
    renewBackgroundLease,
    removeBackgroundTask,
    queuePosition,
  } = await import("../src/services/backgroundQueue.js");

  const { runBackgroundLlm } = await import("../src/services/backgroundLlm.js");
  const { config } = await import("../src/config.js");
  const { BACKGROUND_POLICY_VERSION } = await import(
    "../src/services/backgroundTypes.js"
  );

  const { startPaidCycle } = await import("../src/services/monthlyQuota.js");

  // Helper to provision user and credit balance
  async function provisionUser(userId: string, plan: "pro" | "ultra" = "pro") {
    await dbRun(
      `INSERT INTO users (id, email, password_hash, api_key, api_key_hash) VALUES (?, ?, 'x', ?, ?)
       ON CONFLICT (id) DO UPDATE SET email = excluded.email, api_key = excluded.api_key, api_key_hash = excluded.api_key_hash`,
      [userId, `${userId}@example.com`, `key-${userId}`, `hash-${userId}`],
    );
    const validUntilDate = new Date(Date.now() + 30 * 24 * 60 * 60_000);
    await dbRun(
      `INSERT INTO subscriptions
       (id, user_id, plan_name, status, order_id, currency, valid_until)
       VALUES (?, ?, ?, 'active', ?, 'USD', ?)
       ON CONFLICT (id) DO UPDATE SET plan_name = excluded.plan_name, status = excluded.status,
         order_id = excluded.order_id, currency = excluded.currency, valid_until = excluded.valid_until`,
      [
        `sub-${userId}`,
        userId,
        plan,
        `order-${userId}-${Date.now()}`,
        validUntilDate.toISOString(),
      ],
    );
    await startPaidCycle(userId, plan, validUntilDate);
  }

  // ─── PART 1: QUOTE PRICING & QUOTA RESERVATION INTEGRITY ──────────────────
  await suite.test(
    "Quote Pricing: Dynamic credit calculation, HMAC signing, and atomic single-use hold",
    async (t) => {
      mockRedis._reset();
      const userId = "quote-user-1";
      await provisionUser(userId, "pro", 20_000_000);

      const input = validateEstimateInput({
        prompt:
          "Refactor database migrations to use atomic transactions and benchmark under load",
        language: "en",
        projectFingerprint: "1".repeat(64),
        manifestDigest: "2".repeat(64),
        fileCount: 250,
        uploadBytes: 500_000,
        stacks: ["node", "typescript", "postgres"],
      });

      const { quote, signature } = createEstimateQuote(userId, input);

      // 1. Math verification
      assert.ok(
        quote.modelCredits >= 100_000,
        "Model credits must be at least baseline floor",
      );
      assert.ok(
        quote.computeCredits > 0,
        "Compute credits must reflect expected runtime",
      );
      assert.equal(
        quote.totalCredits,
        quote.modelCredits + quote.computeCredits,
      );
      assert.ok(quote.suggestedCapCredits >= quote.totalCredits);
      assert.ok(quote.maximumCapCredits >= quote.suggestedCapCredits);

      // 2. Cryptographic signature and tamper-proofing
      assert.equal(
        verifyEstimateQuote(quote, signature),
        true,
        "Valid quote signature must verify",
      );
      assert.equal(
        verifyEstimateQuote(
          { ...quote, totalCredits: quote.totalCredits - 1 },
          signature,
        ),
        false,
        "Tampered credit amount must fail signature verification",
      );
      assert.equal(
        verifyEstimateQuote({ ...quote, userId: "impostor" }, signature),
        false,
        "Tampered owner must fail signature verification",
      );

      // 3. Atomic single-use consumption in Redis
      await storeEstimateQuote(quote);
      const firstConsume = await consumeEstimateQuote(quote.quoteId);
      assert.deepEqual(
        firstConsume,
        quote,
        "First quote consumption must return original quote",
      );

      const replayConsume = await consumeEstimateQuote(quote.quoteId);
      assert.equal(
        replayConsume,
        null,
        "Second consumption must return null (replay protection)",
      );
    },
  );

  // ─── PART 2: PER-USER CONCURRENCY LIMIT ENFORCEMENT ───────────────────────
  await suite.test(
    "Concurrency Limits: Enforces plan caps (Pro=1, Ultra=2) and unblocks on completion",
    async (t) => {
      mockRedis._reset();
      const proUser = "concurrency-pro-user";
      await provisionUser(proUser, "pro", 20_000_000);

      const ultraUser = "concurrency-ultra-user";
      await provisionUser(ultraUser, "ultra", 20_000_000);

      const makeQuote = async (uid: string) => {
        const input = validateEstimateInput({
          prompt: `Concurrency stress task for ${uid}`,
          language: "en",
          projectFingerprint: "3".repeat(64),
          manifestDigest: "4".repeat(64),
          fileCount: 50,
          uploadBytes: 25_000,
        });
        const q = createEstimateQuote(uid, input);
        await storeEstimateQuote(q.quote);
        return { input, ...q };
      };

      // --- PRO USER (Limit: 1 active task) ---
      const proQ1 = await makeQuote(proUser);
      const task1 = await createBackgroundTask({
        userId: proUser,
        input: proQ1.input,
        quoteId: proQ1.quote.quoteId,
        quoteSignature: proQ1.signature,
        capCredits: proQ1.quote.suggestedCapCredits,
        idempotencyKey: `idem-pro-1-${Date.now()}`,
        consentAccepted: true,
        policyVersion: BACKGROUND_POLICY_VERSION,
        client: "test-runner",
        ipDigest: "local-ip-digest",
      });
      assert.ok(task1.task.id, "First Pro task created successfully");

      // Attempt second task while task1 is active (status: awaiting_upload)
      const proQ2 = await makeQuote(proUser);
      await assert.rejects(
        async () => {
          await createBackgroundTask({
            userId: proUser,
            input: proQ2.input,
            quoteId: proQ2.quote.quoteId,
            quoteSignature: proQ2.signature,
            capCredits: proQ2.quote.suggestedCapCredits,
            idempotencyKey: `idem-pro-2-${Date.now()}`,
            consentAccepted: true,
            policyVersion: BACKGROUND_POLICY_VERSION,
            client: "test-runner",
            ipDigest: "local-ip-digest",
          });
        },
        /BACKGROUND_CONCURRENCY_LIMIT/,
        "Pro user must be blocked when exceeding 1 concurrent active task",
      );

      // Cancel task1 to free up slot
      await cancelBackgroundTask(proUser, task1.task.id as string);

      // Now second task must succeed
      const proQ3 = await makeQuote(proUser);
      const task2 = await createBackgroundTask({
        userId: proUser,
        input: proQ3.input,
        quoteId: proQ3.quote.quoteId,
        quoteSignature: proQ3.signature,
        capCredits: proQ3.quote.suggestedCapCredits,
        idempotencyKey: `idem-pro-3-${Date.now()}`,
        consentAccepted: true,
        policyVersion: BACKGROUND_POLICY_VERSION,
        client: "test-runner",
        ipDigest: "local-ip-digest",
      });
      assert.ok(
        task2.task.id,
        "Second Pro task succeeds after previous task cancelled",
      );

      // --- ULTRA USER (Limit: 2 active tasks) ---
      const ultraQ1 = await makeQuote(ultraUser);
      const uTask1 = await createBackgroundTask({
        userId: ultraUser,
        input: ultraQ1.input,
        quoteId: ultraQ1.quote.quoteId,
        quoteSignature: ultraQ1.signature,
        capCredits: ultraQ1.quote.suggestedCapCredits,
        idempotencyKey: `idem-ultra-1-${Date.now()}`,
        consentAccepted: true,
        policyVersion: BACKGROUND_POLICY_VERSION,
        client: "test-runner",
        ipDigest: "local-ip-digest",
      });

      const ultraQ2 = await makeQuote(ultraUser);
      const uTask2 = await createBackgroundTask({
        userId: ultraUser,
        input: ultraQ2.input,
        quoteId: ultraQ2.quote.quoteId,
        quoteSignature: ultraQ2.signature,
        capCredits: ultraQ2.quote.suggestedCapCredits,
        idempotencyKey: `idem-ultra-2-${Date.now()}`,
        consentAccepted: true,
        policyVersion: BACKGROUND_POLICY_VERSION,
        client: "test-runner",
        ipDigest: "local-ip-digest",
      });
      assert.ok(
        uTask1.task.id && uTask2.task.id,
        "Ultra user can hold 2 concurrent active tasks",
      );

      // Attempt third task on Ultra user
      const ultraQ3 = await makeQuote(ultraUser);
      await assert.rejects(
        async () => {
          await createBackgroundTask({
            userId: ultraUser,
            input: ultraQ3.input,
            quoteId: ultraQ3.quote.quoteId,
            quoteSignature: ultraQ3.signature,
            capCredits: ultraQ3.quote.suggestedCapCredits,
            idempotencyKey: `idem-ultra-3-${Date.now()}`,
            consentAccepted: true,
            policyVersion: BACKGROUND_POLICY_VERSION,
            client: "test-runner",
            ipDigest: "local-ip-digest",
          });
        },
        /BACKGROUND_CONCURRENCY_LIMIT/,
        "Ultra user must be blocked when exceeding 2 concurrent active tasks",
      );
    },
  );

  // ─── PART 3: UPSTREAM LLM FAILOVER RESILIENCY ─────────────────────────────
  await suite.test(
    "Upstream Failover: Seamless fallback from failed Local GPU to DeepSeek",
    async (t) => {
      // Spin up mock local GPU server and mock DeepSeek server
      let localFailMode = true;
      let localHitCount = 0;
      let deepseekHitCount = 0;

      const mockLocalServer = http.createServer((req, res) => {
        localHitCount++;
        if (localFailMode) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "GPU CUDA Out Of Memory" }));
        } else {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              choices: [
                { message: { content: "Response from Local GPU Server" } },
              ],
            }),
          );
        }
      });

      await new Promise<void>((resolve) => mockLocalServer.listen(0, resolve));
      const localPort = (mockLocalServer.address() as AddressInfo).port;

      // Spin up mock DeepSeek server
      const mockDeepseekServer = http.createServer((req, res) => {
        deepseekHitCount++;
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            choices: [
              { message: { content: "Response from DeepSeek Fallback" } },
            ],
          }),
        );
      });

      await new Promise<void>((resolve) =>
        mockDeepseekServer.listen(0, resolve),
      );
      const deepseekPort = (mockDeepseekServer.address() as AddressInfo).port;

      t.after(() => {
        mockLocalServer.close();
        mockDeepseekServer.close();
      });

      // Configure background LLM env to point to local server
      const origLocalUrl = process.env.LOCAL_LLM_URL;
      const origLocalRoles = process.env.LOCAL_LLM_ROLES;
      const origDeepseekKey = config.aiKeys.deepseek;

      process.env.LOCAL_LLM_URL = `http://127.0.0.1:${localPort}/v1`;
      process.env.LOCAL_LLM_ROLES = "compaction";
      config.aiKeys.deepseek = "test-deepseek-key";

      // Intercept fetch for DeepSeek URL to point to our mock server
      const originalFetch = globalThis.fetch;
      globalThis.fetch = (async (input: any, init?: any) => {
        const urlStr = typeof input === "string" ? input : input?.url || "";
        if (urlStr.startsWith("https://api.deepseek.com")) {
          const rewritten = urlStr.replace(
            "https://api.deepseek.com",
            `http://127.0.0.1:${deepseekPort}`,
          );
          return originalFetch(rewritten, init);
        }
        return originalFetch(input, init);
      }) as any;

      try {
        // SCENARIO 1: Local GPU is failing -> transparent fallback to DeepSeek
        localFailMode = true;
        localHitCount = 0;
        deepseekHitCount = 0;

        const resultFallback = await runBackgroundLlm(
          "compaction",
          [{ role: "user", content: "Summarize compaction logs" }],
          150,
        );

        assert.ok(
          resultFallback,
          "LLM call must succeed despite local GPU failure",
        );
        assert.equal(
          resultFallback.target,
          "deepseek",
          "Must switch target to deepseek",
        );
        assert.equal(resultFallback.text, "Response from DeepSeek Fallback");
        assert.equal(localHitCount, 1, "Must have attempted local GPU first");
        assert.equal(
          deepseekHitCount,
          1,
          "Must have fallen back to DeepSeek second",
        );

        // SCENARIO 2: Local GPU is healthy -> uses local GPU directly
        localFailMode = false;
        localHitCount = 0;
        deepseekHitCount = 0;

        const resultLocal = await runBackgroundLlm(
          "compaction",
          [{ role: "user", content: "Summarize compaction logs" }],
          150,
        );

        assert.ok(resultLocal, "LLM call must succeed on local GPU");
        assert.equal(resultLocal.target, "local", "Must target local server");
        assert.equal(resultLocal.text, "Response from Local GPU Server");
        assert.equal(localHitCount, 1, "Must hit local GPU");
        assert.equal(
          deepseekHitCount,
          0,
          "Must NOT hit DeepSeek when local succeeds",
        );
      } finally {
        globalThis.fetch = originalFetch;
        process.env.LOCAL_LLM_URL = origLocalUrl;
        process.env.LOCAL_LLM_ROLES = origLocalRoles;
        config.aiKeys.deepseek = origDeepseekKey;
      }
    },
  );

  // ─── PART 4: 10 CONCURRENT HEAVY SIMULATION TASKS STRESS & BENCHMARK ──────
  await suite.test(
    "10 Concurrent Heavy Simulation Tasks: End-to-end Queue Stress, Worker Claim Cap & Zero-Leak Settlement",
    async (t) => {
      mockRedis._reset();
      const NUM_TASKS = 10;
      const taskIds: string[] = [];
      const userIds: string[] = [];

      // Provision 10 separate users with Ultra plan (allows concurrent testing)
      for (let i = 0; i < NUM_TASKS; i++) {
        const uid = `bench-user-${i}`;
        userIds.push(uid);
        await provisionUser(uid, "ultra", 50_000_000);
      }

      const startIngest = Date.now();
      const latencies: number[] = [];

      // PHASE 1: Concurrent Submission of 10 Heavy Simulation Tasks
      await Promise.all(
        userIds.map(async (uid, index) => {
          const taskStart = Date.now();
          // Heavy project payload parameters
          const input = validateEstimateInput({
            prompt: `Optimize distributed cluster consensus and simulate network partitions [task-${index}]`,
            language: "en",
            projectFingerprint: crypto
              .createHash("sha256")
              .update(`fp-${index}`)
              .digest("hex"),
            manifestDigest: crypto
              .createHash("sha256")
              .update(`md-${index}`)
              .digest("hex"),
            fileCount: 450 + index * 50,
            uploadBytes: 2_500_000 + index * 100_000,
            stacks: ["node", "rust", "redis", "docker"],
          });

          const { quote, signature } = createEstimateQuote(uid, input);
          await storeEstimateQuote(quote);

          const created = await createBackgroundTask({
            userId: uid,
            input,
            quoteId: quote.quoteId,
            quoteSignature: signature,
            capCredits: quote.suggestedCapCredits,
            idempotencyKey: `idem-heavy-task-${index}-${Date.now()}`,
            consentAccepted: true,
            policyVersion: BACKGROUND_POLICY_VERSION,
            client: "stress-benchmark-client",
            ipDigest: `ip-digest-${index}`,
          });

          // Simulate uploading encrypted project package
          const mockPayload = Buffer.alloc(100_000, `payload-chunk-${index}`);
          const stream = Readable.from(mockPayload);
          const uploaded = await uploadBackgroundProject(
            uid,
            created.task.id as string,
            stream,
          );

          taskIds.push(created.task.id as string);
          latencies.push(Date.now() - taskStart);

          assert.equal(uploaded.task.status, "queued");
        }),
      );

      const ingestDuration = Date.now() - startIngest;
      latencies.sort((a, b) => a - b);
      const p50 = latencies[Math.floor(latencies.length * 0.5)];
      const p95 = latencies[Math.floor(latencies.length * 0.95)];
      const throughput = (NUM_TASKS / (ingestDuration / 1000)).toFixed(2);

      // Verify all 10 tasks entered the ready queue
      const initialReadyCount = await mockRedis.zCard("vynor:bg:v1:ready");
      assert.equal(
        initialReadyCount,
        10,
        "All 10 heavy tasks must be in Redis ready queue",
      );

      // Verify queue position tracking for each task
      for (const tid of taskIds) {
        const pos = await queuePosition(tid);
        assert.ok(
          pos !== null && pos >= 1 && pos <= 10,
          `Queue position for ${tid} must be between 1 and 10`,
        );
      }

      // PHASE 2: Host Concurrency Claim Cap Enforcement (maxConcurrency = 2)
      // Worker 1 and Worker 2 claim slots
      const claimed1 = await claimBackgroundTask("worker-node-1", 60_000, 2);
      const claimed2 = await claimBackgroundTask("worker-node-2", 60_000, 2);
      assert.ok(claimed1, "Worker 1 must claim task");
      assert.ok(claimed2, "Worker 2 must claim task");
      assert.notEqual(claimed1, claimed2, "Workers must claim distinct tasks");

      // Worker 3 attempts to claim: MUST be blocked because maxConcurrency = 2 is reached!
      const claimed3 = await claimBackgroundTask("worker-node-3", 60_000, 2);
      assert.equal(
        claimed3,
        null,
        "Worker 3 must be denied claim when 2 tasks are processing",
      );

      // Lease renewal under load
      const renewed = await renewBackgroundLease(claimed1!, 90_000);
      assert.equal(renewed, true, "Worker 1 lease renewal must succeed");

      // PHASE 3: Complete & Settle all 10 tasks sequentially through the 2-slot pipeline
      let processedCount = 0;
      const activeRunning = [claimed1!, claimed2!];

      while (activeRunning.length > 0) {
        const currentTask = activeRunning.shift()!;
        processedCount++;

        // Complete execution: settle quota reservation
        const row = await dbGet<any>(
          "SELECT * FROM background_tasks WHERE id = ?",
          [currentTask],
        );
        assert.ok(row, "Task row must exist in DB");

        await settleBackgroundTaskReservation(row, row.estimate_credits);
        await removeBackgroundTask(currentTask);
        await dbRun(
          "UPDATE background_tasks SET status = 'completed', ended_at = CURRENT_TIMESTAMP WHERE id = ?",
          [currentTask],
        );

        // Now that a slot is free, attempt to claim next task
        const nextTask = await claimBackgroundTask(
          `worker-node-${processedCount}`,
          60_000,
          2,
        );
        if (nextTask) {
          activeRunning.push(nextTask);
        }
      }

      assert.equal(
        processedCount,
        10,
        "All 10 heavy tasks must be claimed, processed, and completed",
      );

      // PHASE 4: Ledger Audit & Quota Hold Integrity Verification
      const finalReadyCount = await mockRedis.zCard("vynor:bg:v1:ready");
      const finalProcessingCount = await mockRedis.zCard(
        "vynor:bg:v1:processing",
      );
      assert.equal(
        finalReadyCount,
        0,
        "Ready queue must be completely drained",
      );
      assert.equal(
        finalProcessingCount,
        0,
        "Processing set must be completely drained",
      );

      // Check billing ledger entries: Each task must have reserve and settle ledger entries
      const ledgerRows = await dbAll<any>(
        "SELECT task_id, event_type, credits FROM background_billing_ledger WHERE task_id IN (" +
          taskIds.map(() => "?").join(",") +
          ")",
        taskIds,
      );

      const reserves = ledgerRows.filter((r) => r.event_type === "reserve");
      assert.equal(
        reserves.length,
        10,
        "All 10 tasks must have an authoritative reserve ledger record",
      );

      // Verify ZERO dangling active quota holds in DB
      const taskRows = await dbAll<any>(
        "SELECT quota_reservation_id FROM background_tasks WHERE id IN (" +
          taskIds.map(() => "?").join(",") +
          ")",
        taskIds,
      );
      const reservationIds = taskRows
        .map((t) => t.quota_reservation_id)
        .filter(Boolean);
      const activeHolds =
        reservationIds.length > 0
          ? await dbAll<any>(
              "SELECT * FROM quota_reservations WHERE id IN (" +
                reservationIds.map(() => "?").join(",") +
                ")",
              reservationIds,
            )
          : [];
      assert.equal(
        activeHolds.length,
        0,
        "There must be 0 lingering active quota holds (zero leakage)",
      );

      // Log benchmark summary metrics for user visibility
      console.log("\n=======================================================");
      console.log("🚀 BACKGROUND AGENT 10-TASK STRESS BENCHMARK RESULTS 🚀");
      console.log("=======================================================");
      console.log(
        `• Concurrent Tasks Completed: ${NUM_TASKS} / ${NUM_TASKS} (100% Success)`,
      );
      console.log(`• Total Ingestion Duration:   ${ingestDuration} ms`);
      console.log(`• Ingestion Throughput:        ${throughput} tasks/sec`);
      console.log(`• Latency P50:                 ${p50} ms`);
      console.log(`• Latency P95:                 ${p95} ms`);
      console.log(
        `• Host Concurrency Cap:       2 concurrent workers strictly enforced`,
      );
      console.log(`• Quota Holds Settled:         10 / 10 (0 credit leakage)`);
      console.log(`• Error / Drop Rate:           0.00%`);
      console.log("=======================================================\n");
    },
  );
});
