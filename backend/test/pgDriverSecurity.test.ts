import assert from "node:assert/strict";
import test from "node:test";
import {
  isPrivatePostgresHost,
  parseInt8,
  postgresSslOption,
} from "../src/services/pgDriver.js";

test("TLS is required for any host that is not loopback or the private container network", () => {
  const url = (host: string) => `postgres://vynor:pw@${host}:5432/vynor`;
  for (const host of [
    "db.example.com",
    "203.0.113.7",
    "pg.abc123.supabase.co",
    "8.8.8.8",
    "172.32.0.1",
  ])
    assert.deepEqual(
      postgresSslOption(url(host), {} as NodeJS.ProcessEnv),
      { rejectUnauthorized: true },
      host,
    );
  for (const host of [
    "localhost",
    "127.0.0.1",
    "[::1]",
    "vynor-postgres",
    "postgres",
    "10.1.2.3",
    "172.18.0.2",
    "192.168.1.5",
    "db.internal",
  ])
    assert.equal(
      postgresSslOption(url(host), {} as NodeJS.ProcessEnv),
      undefined,
      host,
    );
});

test("PG_SSL overrides the host rule, and an explicit sslmode is left to the driver", () => {
  const remote = "postgres://u:p@db.example.com:5432/v";
  assert.equal(
    postgresSslOption(remote, { PG_SSL: "disable" } as NodeJS.ProcessEnv),
    undefined,
  );
  assert.deepEqual(
    postgresSslOption("postgres://u:p@postgres:5432/v", {
      PG_SSL: "require",
    } as NodeJS.ProcessEnv),
    { rejectUnauthorized: true },
  );
  assert.equal(
    postgresSslOption(`${remote}?sslmode=verify-full`, {} as NodeJS.ProcessEnv),
    undefined,
  );
  // An unparsable URL never silently enables or disables anything on its own.
  assert.equal(
    postgresSslOption("not a url", {} as NodeJS.ProcessEnv),
    undefined,
  );
  assert.equal(
    postgresSslOption(undefined, {} as NodeJS.ProcessEnv),
    undefined,
  );
});

test("private host detection is strict about public look-alikes", () => {
  assert.equal(isPrivatePostgresHost("172.15.0.1"), false);
  assert.equal(isPrivatePostgresHost("172.16.0.1"), true);
  assert.equal(isPrivatePostgresHost("10.example.com"), false);
  assert.equal(isPrivatePostgresHost("localhost.evil.com"), false);
});

test("int8 values stay exact: safe integers become numbers, larger ones stay strings", () => {
  assert.equal(parseInt8("42"), 42);
  assert.equal(parseInt8("-7"), -7);
  assert.equal(parseInt8("9007199254740991"), 9007199254740991);
  assert.equal(parseInt8("9007199254740993"), "9007199254740993");
  assert.equal(parseInt8("-9223372036854775808"), "-9223372036854775808");
});
