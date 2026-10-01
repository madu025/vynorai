import assert from "node:assert/strict";
import test from "node:test";
import {
  IDE_AUTH_TTL_SECONDS,
  IdeAuthorizationCodeStore,
  IdeAuthStoreUnavailableError,
} from "../src/services/ideAuthCodes.js";

const STATE = "a".repeat(64);

test("memory codes are single-use and reject replay", async () => {
  const store = new IdeAuthorizationCodeStore(async () => null);
  const code = await store.issue("user-1", STATE);

  assert.deepEqual(await store.consume(code, STATE), { userId: "user-1" });
  assert.equal(await store.consume(code, STATE), undefined);
});

test("a state mismatch consumes and invalidates the code", async () => {
  const store = new IdeAuthorizationCodeStore(async () => null);
  const code = await store.issue("user-1", STATE);

  assert.equal(await store.consume(code, "b".repeat(64)), undefined);
  assert.equal(await store.consume(code, STATE), undefined);
});

test("expired memory codes are rejected and pruned", async () => {
  let now = 1_000;
  const store = new IdeAuthorizationCodeStore(async () => null, {
    now: () => now,
  });
  const code = await store.issue("user-1", STATE);
  now += IDE_AUTH_TTL_SECONDS * 1_000 + 1;

  assert.equal(await store.consume(code, STATE), undefined);
  assert.equal(store.localEntryCount(), 0);
});

test("memory fallback remains bounded", async () => {
  let byte = 0;
  const store = new IdeAuthorizationCodeStore(async () => null, {
    maxLocalEntries: 2,
    randomBytes: (size) => Buffer.alloc(size, (byte += 1)),
  });

  await store.issue("user-1", STATE);
  await store.issue("user-2", STATE);
  await store.issue("user-3", STATE);
  assert.equal(store.localEntryCount(), 2);
});

test("Redis GETDEL permits only one concurrent exchange", async () => {
  const values = new Map<string, string>();
  const redis = {
    async set(key: string, value: string) {
      if (values.has(key)) return null;
      values.set(key, value);
      return "OK";
    },
    async getDel(key: string) {
      const value = values.get(key) ?? null;
      values.delete(key);
      return value;
    },
  };
  const store = new IdeAuthorizationCodeStore(async () => redis);
  const code = await store.issue("user-1", STATE);
  const results = await Promise.all([
    store.consume(code, STATE),
    store.consume(code, STATE),
  ]);

  assert.equal(results.filter(Boolean).length, 1);
});

test("distributed-required mode fails closed without Redis", async () => {
  const store = new IdeAuthorizationCodeStore(async () => null, {
    requireDistributed: true,
  });

  await assert.rejects(
    () => store.issue("user-1", STATE),
    IdeAuthStoreUnavailableError,
  );
  await assert.rejects(
    () => store.consume("c".repeat(64), STATE),
    IdeAuthStoreUnavailableError,
  );
});
