/**
 * Carry-over from the retired text-timestamp PostgreSQL schema into the typed baseline. The value
 * conversion tests need no database; the end-to-end tests build a legacy database from the schema
 * fixture and a typed one from the baseline on a real PostgreSQL (DATABASE_URL), and are skipped on
 * SQLite runs.
 */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test, { after, before } from "node:test";
import pg from "pg";
import {
  CARRY_OVER_TABLES,
  DEFAULT_KEPT_EMAIL,
  convertValue,
  parseLegacyTimestamp,
  runCarryOver,
} from "../src/services/pgCarryOver.js";
import { applyPostgresMigrations } from "../src/services/postgresSchema.js";

const { Pool: PgPool } = pg;
/** Pools here are dropped databases' last connections: ignore idle-client errors on shutdown. */
class Pool extends PgPool {
  constructor(config: pg.PoolConfig) {
    super(config);
    this.on("error", () => {});
  }
}
const PG_URL = process.env.DATABASE_URL;
const usePg = Boolean(PG_URL) && process.env.DB_DRIVER !== "sqlite";
const fixture = fs.readFileSync(
  path.join(import.meta.dirname, "fixtures", "legacyPgSchema.sql"),
  "utf8",
);

const col = (over: Partial<Parameters<typeof convertValue>[1]> = {}) => ({
  name: "c",
  dataType: "text",
  nullable: true,
  hasDefault: false,
  maxLength: null,
  ...over,
});

test("legacy timestamps: strict, UTC by default, never guessed", () => {
  assert.equal(
    parseLegacyTimestamp("2026-10-24 13:34:07"),
    "2026-10-24T13:34:07.000Z",
  );
  assert.equal(
    parseLegacyTimestamp("2026-10-24T13:34:07.5Z"),
    "2026-10-24T13:34:07.500Z",
  );
  assert.equal(
    parseLegacyTimestamp("2026-10-24T13:34:07+05:30"),
    "2026-10-24T08:04:07.000Z",
  );
  assert.equal(parseLegacyTimestamp("2026-10-24"), "2026-10-24T00:00:00.000Z");
  for (const bad of [
    "garbage",
    "9999",
    "",
    "not-a-date",
    "2026-02-31",
    "2026-13-01",
    "2026-10-24 25:00:00",
    "1969-12-31",
    "3000-01-01",
    null,
    42,
  ])
    assert.equal(parseLegacyTimestamp(bad), null, String(bad));
});

test("value conversion follows the typed column and never echoes the value", () => {
  assert.deepEqual(
    convertValue(
      "2026-10-24 13:34:07",
      col({ dataType: "timestamp with time zone" }),
    ),
    {
      ok: true,
      value: "2026-10-24T13:34:07.000Z",
    },
  );
  const bad = convertValue(
    "my-secret-value",
    col({ dataType: "timestamp with time zone" }),
  );
  assert.equal(bad.ok, false);
  assert.doesNotMatch(JSON.stringify(bad), /my-secret-value/);
  assert.deepEqual(convertValue("12", col({ dataType: "bigint" })), {
    ok: true,
    value: "12",
  });
  assert.equal(convertValue("1.5", col({ dataType: "bigint" })).ok, false);
  assert.deepEqual(convertValue("12.50", col({ dataType: "numeric" })), {
    ok: true,
    value: 12.5,
  });
  assert.equal(convertValue("x", col({ dataType: "numeric" })).ok, false);
  assert.equal(
    convertValue(
      "a".repeat(11),
      col({ dataType: "character varying", maxLength: 10 }),
    ).ok,
    false,
  );
  assert.equal(convertValue(null, col({ nullable: false })).ok, false);
  assert.deepEqual(
    convertValue(null, col({ nullable: false, hasDefault: true })),
    { ok: true, value: null },
  );
  assert.deepEqual(convertValue(1, col({ dataType: "boolean" })), {
    ok: true,
    value: true,
  });
});

test("only the reviewed tables may keep rows", () => {
  assert.deepEqual([...CARRY_OVER_TABLES].sort(), [
    "admin_staff",
    "m365_identity_links",
    "m365_tenants",
    "model_registry",
    "plan_overrides",
    "provider_api_keys",
    "provider_credentials",
    "subscriptions",
    "users",
  ]);
});

// ---------------------------------------------------------------------------------------------
// End to end on a real PostgreSQL
// ---------------------------------------------------------------------------------------------

const suffix = crypto.randomBytes(4).toString("hex");
const names = {
  old: `co_old_${suffix}`,
  new: `co_new_${suffix}`,
  empty: `co_empty_${suffix}`,
  dirty: `co_dirty_${suffix}`,
  legacyNew: `co_legacynew_${suffix}`,
  blank: `co_blank_${suffix}`,
};
let admin: pg.Pool;
const urlFor = (db: string) => {
  const u = new URL(PG_URL!);
  u.pathname = `/${db}`;
  return u.toString();
};
const KEPT_ID = "kept-user-1";
const KEPT_HASH = crypto.createHash("sha256").update("kept-key").digest("hex");

async function seedOld(): Promise<void> {
  const pool = new Pool({ connectionString: urlFor(names.old), max: 1 });
  try {
    await pool.query(fixture);
    await pool.query(
      `INSERT INTO users (id, email, password_hash, api_key, api_key_hash, api_key_masked, name, is_suspended, email_verified, created_at)
       VALUES ($1, 'SLTSQMS@Gmail.com', 'bcrypt-hash-kept', 'vynor_live_kept', $2, 'vynor_live_k***', 'Kept', 0, 1, '2026-01-02 03:04:05'),
              ('other-1', 'someone@example.test', 'h', 'vynor_live_o1', 'a', 'x', 'O1', 0, 1, '2026-02-02 00:00:00'),
              ('other-2', 'else@example.test', 'h', 'vynor_live_o2', 'b', 'x', 'O2', 1, 0, 'garbage-date')`,
      [KEPT_ID, KEPT_HASH],
    );
    await pool.query(
      `INSERT INTO subscriptions (id, user_id, plan_name, status, order_id, payment_id, amount_minor, amount, currency, valid_until, created_at) VALUES
        ('s-good', $1, 'pro', 'active', 'ord-good', '111', 150000, 1500.5, 'LKR', '2099-01-01 00:00:00', '2026-03-01 00:00:00'),
        ('s-expired', $1, 'pro', 'active', 'ord-exp', '112', 0, 0, 'LKR', '2020-01-01 00:00:00', '2020-01-01 00:00:00'),
        ('s-garbage', $1, 'pro', 'active', 'ord-bad', '113', 0, 0, 'LKR', 'garbage', '2026-03-01 00:00:00'),
        ('s-cancelled', $1, 'pro', 'cancelled', 'ord-can', '114', 0, 0, 'LKR', '2099-01-01 00:00:00', '2026-03-01 00:00:00'),
        ('s-other', 'other-1', 'pro', 'active', 'ord-oth', '115', 0, 0, 'LKR', '2099-01-01 00:00:00', '2026-03-01 00:00:00')`,
      [KEPT_ID],
    );
    await pool.query(
      `INSERT INTO m365_tenants (tenant_id, status, display_name, allowed_scopes, consented_at, created_at, updated_at, ai_enabled, plan_id, seat_limit, subscription_valid_until) VALUES
        ('tenant-kept', 'enabled', 'Kept Org', 'excel.read', 'not-a-date', '2026-04-01 00:00:00', '2026-04-01 00:00:00', 1, 'pro', 5, 'garbage'),
        ('tenant-other', 'enabled', 'Other Org', 'excel.read', NULL, '2026-04-01 00:00:00', '2026-04-01 00:00:00', 1, NULL, 1, NULL)`,
    );
    await pool.query(
      `INSERT INTO m365_identity_links (tenant_id, object_id, user_id, enabled, created_at) VALUES
        ('tenant-kept', 'obj-kept', $1, 1, '2026-04-02 00:00:00'),
        ('tenant-other', 'obj-other', 'other-1', 1, '2026-04-02 00:00:00')`,
      [KEPT_ID],
    );
    await pool.query(
      `INSERT INTO provider_api_keys (id, provider, label, key_encrypted, key_masked, is_active, balance_usd, updated_at) VALUES
        ('pk-1', 'deepseek', 'main', 'enc:v1:AAAA+/==:BBBB', 'sk-***1234', 1, 12.345678, '2026-05-01 00:00:00')`,
    );
    await pool.query(
      `INSERT INTO provider_credentials (provider, key_encrypted, key_masked, updated_by, updated_at) VALUES
        ('openrouter', 'enc:v1:CCCC:DDDD', 'sk-***9999', 'admin', '2026-05-01 00:00:00')`,
    );
    await pool.query(
      `INSERT INTO model_registry (id, openrouter_id, display_name, context_window, min_plan, is_default_chat, is_default_autocomplete, enabled, created_at, updated_at) VALUES
        ('deepseek/deepseek-chat', 'deepseek/deepseek-chat', 'DeepSeek Chat', 64000, 'free', 1, 0, 1, '2026-01-01 00:00:00', '2026-01-01 00:00:00')`,
    );
    await pool.query(
      `INSERT INTO plan_overrides (plan_id, display_name, monthly_tokens, price_lkr, price_usd, is_active, updated_at) VALUES
        ('pro', 'Pro', 5000000, 4990.5, 15.99, 1, '2026-05-01 00:00:00')`,
    );
    await pool.query(
      `INSERT INTO admin_staff (id, name, email, role, created_by, created_at) VALUES
        ('adm-1', 'Owner', 'owner@example.test', 'super_admin', 'seed', '2026-01-01 00:00:00')`,
    );
    // Rows that must never be carried over.
    await pool.query(
      `INSERT INTO usage_logs (id, user_id, model, input_tokens, output_tokens, tokens_used, cached, created_at)
       VALUES ('ul-1', $1, 'm', 1, 1, 2, 0, '2026-06-01 00:00:00')`,
      [KEPT_ID],
    );
    await pool.query(
      `INSERT INTO monthly_usage (id, user_id, plan_name, max_tokens, used_tokens, period_start, period_end)
       VALUES ('mu-1', $1, 'pro', 100, 5, '2026-10-01 00:00:00', '2026-11-01 00:00:00')`,
      [KEPT_ID],
    );
    await pool.query(
      `INSERT INTO security_audit_logs (id, event_type, details, created_at) VALUES ('al-1', 'LOGIN', 'detail', '2026-06-01 00:00:00')`,
    );
  } finally {
    await pool.end();
  }
}

async function applyTypedBaseline(db: string): Promise<void> {
  const pool = new Pool({ connectionString: urlFor(db), max: 2 });
  try {
    await applyPostgresMigrations(pool);
  } finally {
    await pool.end();
  }
}

async function q<T = any>(
  db: string,
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const pool = new Pool({ connectionString: urlFor(db), max: 1 });
  try {
    return (await pool.query(sql, params)).rows as T[];
  } finally {
    await pool.end();
  }
}

before(async () => {
  if (!usePg) return;
  admin = new Pool({ connectionString: PG_URL, max: 1 });
  for (const db of Object.values(names))
    await admin.query(`CREATE DATABASE ${db}`);
  await seedOld();
  for (const db of [names.new, names.empty, names.dirty])
    await applyTypedBaseline(db);
  // A "new" database that is really the old layout.
  const legacy = new Pool({
    connectionString: urlFor(names.legacyNew),
    max: 1,
  });
  await legacy.query(fixture);
  await legacy.end();
});

after(async () => {
  if (!usePg) return;
  for (const db of Object.values(names))
    await admin.query(`DROP DATABASE IF EXISTS ${db} WITH (FORCE)`);
  await admin.end();
});

const pgTest = (name: string, fn: () => Promise<void>) =>
  test(name, { skip: usePg ? false : "needs PostgreSQL (DATABASE_URL)" }, fn);

pgTest(
  "carry-over moves only the kept account and the configuration, with typed columns",
  async () => {
    const report = await runCarryOver({
      oldUrl: urlFor(names.old),
      newUrl: urlFor(names.new),
    });
    assert.equal(report.keptUserFound, true);
    const t = Object.fromEntries(report.tables.map((r) => [r.table, r]));
    assert.equal(t.users.inserted, 1);
    assert.equal(t.subscriptions.read, 3); // active rows of the kept user only
    assert.equal(t.subscriptions.inserted, 1); // only the still-valid one
    assert.equal(t.subscriptions.skipped, 2);
    assert.equal(t.m365_identity_links.inserted, 1);
    assert.equal(t.m365_tenants.inserted, 1);
    assert.equal(t.provider_api_keys.inserted, 1);
    assert.equal(t.provider_credentials.inserted, 1);
    assert.equal(t.model_registry.inserted, 1);
    assert.equal(t.plan_overrides.inserted, 1);
    assert.equal(t.admin_staff.inserted, 1);

    const db = names.new;
    const [user] = await q(db, "SELECT * FROM users");
    assert.equal(user.id, KEPT_ID);
    assert.equal(user.email.toLowerCase(), DEFAULT_KEPT_EMAIL);
    assert.equal(user.password_hash, "bcrypt-hash-kept");
    assert.equal(user.api_key_hash, KEPT_HASH);
    assert.equal((await q(db, "SELECT count(*)::int AS n FROM users"))[0].n, 1);

    // Types really changed.
    const types = await q(
      db,
      "SELECT pg_typeof(created_at)::text AS t FROM users",
    );
    assert.equal(types[0].t, "timestamp with time zone");
    assert.equal(
      new Date(user.created_at).toISOString(),
      "2026-01-02T03:04:05.000Z",
    );

    const [sub] = await q(
      db,
      "SELECT id, pg_typeof(valid_until)::text AS t, pg_typeof(amount)::text AS a, amount::float AS amt FROM subscriptions",
    );
    assert.equal(sub.id, "s-good");
    assert.equal(sub.t, "timestamp with time zone");
    assert.equal(sub.a, "numeric");
    assert.equal(sub.amt, 1500.5);

    // Garbage dates in nullable columns became NULL, with a metadata-only warning.
    const [tenant] = await q(
      db,
      "SELECT tenant_id, consented_at, subscription_valid_until, seat_limit FROM m365_tenants",
    );
    assert.equal(tenant.tenant_id, "tenant-kept");
    assert.equal(tenant.consented_at, null);
    assert.equal(tenant.subscription_valid_until, null);
    assert.ok(
      t.m365_tenants.warnings.some((w) =>
        w.startsWith("m365_tenants.consented_at"),
      ),
    );
    assert.ok(
      t.subscriptions.warnings.some((w) =>
        w.startsWith("subscriptions.valid_until"),
      ),
    );

    // Encrypted secrets are copied byte for byte.
    assert.equal(
      (await q(db, "SELECT key_encrypted FROM provider_api_keys"))[0]
        .key_encrypted,
      "enc:v1:AAAA+/==:BBBB",
    );
    assert.equal(
      (await q(db, "SELECT key_encrypted FROM provider_credentials"))[0]
        .key_encrypted,
      "enc:v1:CCCC:DDDD",
    );
    assert.equal(
      Number(
        (await q(db, "SELECT balance_usd FROM provider_api_keys"))[0]
          .balance_usd,
      ),
      12.345678,
    );
    const [plan] = await q(
      db,
      "SELECT price_lkr::float AS lkr, pg_typeof(price_lkr)::text AS t FROM plan_overrides",
    );
    assert.equal(plan.lkr, 4990.5);
    assert.equal(plan.t, "numeric");

    // Nothing else came along.
    for (const table of [
      "usage_logs",
      "monthly_usage",
      "security_audit_logs",
      "background_tasks",
      "request_economics",
      "email_verifications",
    ])
      assert.equal(
        (await q(db, `SELECT count(*)::int AS n FROM ${table}`))[0].n,
        0,
        table,
      );

    // The report never carries values.
    const text = JSON.stringify(report);
    for (const secret of [
      DEFAULT_KEPT_EMAIL,
      KEPT_HASH,
      "bcrypt-hash-kept",
      "enc:v1",
      "vynor_live_kept",
      "someone@example.test",
    ])
      assert.ok(
        !text.toLowerCase().includes(secret.toLowerCase()),
        `report leaked ${secret}`,
      );
  },
);

pgTest("the old database is only read", async () => {
  const before = await q(
    names.old,
    "SELECT (SELECT count(*) FROM users)::int AS u, (SELECT count(*) FROM subscriptions)::int AS s, (SELECT count(*) FROM usage_logs)::int AS l, (SELECT count(*) FROM provider_api_keys)::int AS k",
  );
  await runCarryOver({ oldUrl: urlFor(names.old), newUrl: urlFor(names.new) });
  const after = await q(
    names.old,
    "SELECT (SELECT count(*) FROM users)::int AS u, (SELECT count(*) FROM subscriptions)::int AS s, (SELECT count(*) FROM usage_logs)::int AS l, (SELECT count(*) FROM provider_api_keys)::int AS k",
  );
  assert.deepEqual(after, before);
});

pgTest("running it again changes nothing", async () => {
  // The first test already populated names.new; a second run is a no-op.
  const first = (await q(names.new, "SELECT count(*)::int AS n FROM users"))[0]
    .n;
  const report = await runCarryOver({
    oldUrl: urlFor(names.old),
    newUrl: urlFor(names.new),
  });
  assert.equal(
    report.tables.reduce((n, r) => n + r.inserted, 0),
    0,
  );
  assert.equal(
    report.tables.find((r) => r.table === "users")!.alreadyPresent,
    1,
  );
  assert.equal(
    (await q(names.new, "SELECT count(*)::int AS n FROM users"))[0].n,
    first,
  );
});

pgTest("a dry run writes nothing", async () => {
  const report = await runCarryOver({
    oldUrl: urlFor(names.old),
    newUrl: urlFor(names.empty),
    dryRun: true,
  });
  assert.equal(report.dryRun, true);
  assert.ok(report.tables.find((r) => r.table === "users")!.inserted === 1);
  assert.equal(
    (await q(names.empty, "SELECT count(*)::int AS n FROM users"))[0].n,
    0,
  );
  assert.equal(
    (
      await q(names.empty, "SELECT count(*)::int AS n FROM provider_api_keys")
    )[0].n,
    0,
  );
});

pgTest("a missing kept account aborts before writing", async () => {
  await assert.rejects(
    runCarryOver({
      oldUrl: urlFor(names.old),
      newUrl: urlFor(names.empty),
      keptEmail: "nobody@example.test",
    }),
    /kept account was not found/,
  );
  assert.equal(
    (await q(names.empty, "SELECT count(*)::int AS n FROM admin_staff"))[0].n,
    0,
  );
});

pgTest(
  "refuses a new database that already holds other user data",
  async () => {
    const pool = new Pool({ connectionString: urlFor(names.dirty), max: 1 });
    await pool.query(
      "INSERT INTO users (id, email, password_hash, api_key) VALUES ('stranger', 'stranger@example.test', 'h', 'vynor_live_s')",
    );
    await pool.end();
    await assert.rejects(
      runCarryOver({ oldUrl: urlFor(names.old), newUrl: urlFor(names.dirty) }),
      /other than the kept account/,
    );
  },
);

pgTest(
  "--init-schema builds the typed baseline in a blank database, then carries over",
  async () => {
    // Without the flag a blank database is refused (no schema_migrations yet).
    await assert.rejects(
      runCarryOver({ oldUrl: urlFor(names.old), newUrl: urlFor(names.blank) }),
      /no schema_migrations/,
    );
    const report = await runCarryOver({
      oldUrl: urlFor(names.old),
      newUrl: urlFor(names.blank),
      initSchema: true,
    });
    assert.equal(report.tables.find((r) => r.table === "users")!.inserted, 1);
    const [row] = await q(
      names.blank,
      "SELECT pg_typeof(created_at)::text AS t FROM users",
    );
    assert.equal(row.t, "timestamp with time zone");
    // initSchema never touches a database that already has tables (the legacy layout stays legacy).
    await assert.rejects(
      runCarryOver({
        oldUrl: urlFor(names.old),
        newUrl: urlFor(names.legacyNew),
        initSchema: true,
      }),
      /not built from the typed baseline|no schema_migrations/,
    );
  },
);

pgTest(
  "refuses a new database that is still the legacy layout, and the same database twice",
  async () => {
    await assert.rejects(
      runCarryOver({
        oldUrl: urlFor(names.old),
        newUrl: urlFor(names.legacyNew),
      }),
      /not built from the typed baseline|no schema_migrations/,
    );
    await assert.rejects(
      runCarryOver({ oldUrl: urlFor(names.old), newUrl: urlFor(names.old) }),
      /same database/,
    );
  },
);
