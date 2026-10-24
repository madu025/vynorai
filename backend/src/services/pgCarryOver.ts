import pg from "pg";
import {
  PG_BASELINE_VERSION,
  applyPostgresMigrations,
} from "./postgresSchema.js";
import { postgresSslOption } from "./pgDriver.js";

/**
 * One-time move from the retired text-timestamp PostgreSQL database to a new database built from the
 * typed baseline (postgresSchema.ts). Only a deliberately small set of rows is carried over; every
 * other table stays empty, so the new database starts clean.
 *
 *   kept test account   the users row whose email matches, its still-valid active subscriptions and
 *                       its M365 identity links, plus the M365 tenants those links point at
 *   configuration       provider_api_keys, provider_credentials (encrypted secrets are copied
 *                       byte for byte, never decrypted), model_registry, plan_overrides, admin_staff
 *
 * Safety rules: the old database is only read, inside a READ ONLY transaction. The new database is
 * written in one transaction and must hold no user data besides the kept account. Re-running is
 * harmless (ON CONFLICT DO NOTHING). The report carries table names and counts only, never row
 * values, emails, hashes or keys.
 */

const { Pool } = pg;

export const DEFAULT_KEPT_EMAIL = "sltsqms@gmail.com";

/** Tables that may hold rows after a carry-over. Everything else must be empty. */
export const CARRY_OVER_TABLES = [
  "users",
  "m365_tenants",
  "m365_identity_links",
  "subscriptions",
  "provider_api_keys",
  "provider_credentials",
  "model_registry",
  "plan_overrides",
  "admin_staff",
] as const;

export interface CarryOverOptions {
  oldUrl: string;
  newUrl: string;
  keptEmail?: string;
  /** Do everything, then roll the new database back. */
  dryRun?: boolean;
  /** Treat subscriptions that end before this instant as expired. Defaults to now. */
  now?: Date;
  /** Fail when the kept account is not in the old database. Defaults to true. */
  requireKeptUser?: boolean;
  /**
   * Apply the typed baseline first when the new database is completely empty. This commits even
   * on a dry run (a new, unused database), and never touches a database that already has tables.
   */
  initSchema?: boolean;
}

export interface CarryOverTableReport {
  table: string;
  read: number;
  inserted: number;
  alreadyPresent: number;
  skipped: number;
  /** Metadata-only notes: "table.column: reason". Never a value. */
  warnings: string[];
}

export interface CarryOverReport {
  dryRun: boolean;
  keptUserFound: boolean;
  tables: CarryOverTableReport[];
}

interface ColumnInfo {
  name: string;
  dataType: string;
  nullable: boolean;
  hasDefault: boolean;
  maxLength: number | null;
}

export type Converted =
  | { ok: true; value: unknown }
  | { ok: false; reason: string };

const TIMESTAMP_RE =
  /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?)?\s*(Z|[+-]\d{2}(?::?\d{2})?)?$/;

/**
 * Strict reader for the date text the old schema stored ("2026-10-24 13:34:07" or an ISO string).
 * Text without a zone is UTC, as the old database wrote it. Anything else, including impossible
 * calendar dates and years outside 1970-2999, is rejected, never guessed.
 */
export function parseLegacyTimestamp(value: unknown): string | null {
  if (value instanceof Date)
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (typeof value !== "string") return null;
  const m = TIMESTAMP_RE.exec(value.trim());
  if (!m) return null;
  const [, y, mo, d, h = "00", mi = "00", s = "00", frac = "", zone = "Z"] = m;
  const year = Number(y);
  if (year < 1970 || year > 2999) return null;
  let offset = zone;
  if (zone !== "Z") {
    const digits = zone.slice(1).replace(":", "");
    offset = `${zone[0]}${digits.slice(0, 2)}:${digits.slice(2) || "00"}`;
  }
  const iso = `${y}-${mo}-${d}T${h}:${mi}:${s}.${(frac + "000").slice(0, 3)}${offset}`;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  // new Date() rolls 2026-02-31 over to March; compare the calendar parts to catch that.
  const utc = new Date(`${y}-${mo}-${d}T00:00:00.000Z`);
  if (
    Number.isNaN(utc.getTime()) ||
    utc.getUTCMonth() + 1 !== Number(mo) ||
    utc.getUTCDate() !== Number(d) ||
    Number(h) > 23 ||
    Number(mi) > 59 ||
    Number(s) > 59
  )
    return null;
  return date.toISOString();
}

/** Converts one old-schema value to what the typed column needs. Reasons never contain the value. */
export function convertValue(value: unknown, column: ColumnInfo): Converted {
  if (value === null || value === undefined)
    return column.nullable || column.hasDefault
      ? { ok: true, value: null }
      : { ok: false, reason: "null in a NOT NULL column" };
  switch (column.dataType) {
    case "timestamp with time zone": {
      const iso = parseLegacyTimestamp(value);
      return iso
        ? { ok: true, value: iso }
        : { ok: false, reason: "unreadable timestamp" };
    }
    case "date": {
      // A billing day: keep the calendar day of the instant the old schema stored.
      const iso = parseLegacyTimestamp(value);
      return iso
        ? { ok: true, value: iso.slice(0, 10) }
        : { ok: false, reason: "unreadable date" };
    }
    case "smallint":
    case "integer":
    case "bigint": {
      if (typeof value === "string" && /^-?\d{1,19}$/.test(value.trim()))
        return { ok: true, value: value.trim() };
      if (typeof value === "number" && Number.isInteger(value))
        return { ok: true, value };
      if (typeof value === "boolean") return { ok: true, value: value ? 1 : 0 };
      return { ok: false, reason: "not a whole number" };
    }
    case "numeric":
    case "double precision":
    case "real": {
      const n = typeof value === "number" ? value : Number(String(value));
      return Number.isFinite(n)
        ? { ok: true, value: n }
        : { ok: false, reason: "not a number" };
    }
    case "boolean": {
      if (value === true || value === 1 || value === "1" || value === "t")
        return { ok: true, value: true };
      if (value === false || value === 0 || value === "0" || value === "f")
        return { ok: true, value: false };
      return { ok: false, reason: "not a boolean" };
    }
    case "character varying":
    case "character":
    case "text": {
      const text = String(value);
      if (column.maxLength !== null && text.length > column.maxLength)
        return { ok: false, reason: "longer than the column allows" };
      return { ok: true, value: text };
    }
    default:
      return { ok: true, value };
  }
}

/** A table or column name taken from the catalog or the reviewed table list, double-quoted. */
function quoteIdent(name: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(name))
    throw new Error("Refusing an unexpected identifier.");
  return `"${name}"`;
}

async function columnsOf(
  client: pg.PoolClient,
  table: string,
): Promise<ColumnInfo[]> {
  const result = await client.query(
    `SELECT column_name, data_type, is_nullable, column_default, character_maximum_length
       FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1
      ORDER BY ordinal_position`,
    [table],
  );
  return result.rows.map((r) => ({
    name: r.column_name,
    dataType: r.data_type,
    nullable: r.is_nullable === "YES",
    hasDefault: r.column_default !== null,
    maxLength: r.character_maximum_length,
  }));
}

function sameDatabase(a: string, b: string): boolean {
  try {
    const x = new URL(a);
    const y = new URL(b);
    return (
      x.hostname === y.hostname &&
      (x.port || "5432") === (y.port || "5432") &&
      x.pathname === y.pathname
    );
  } catch {
    return a === b;
  }
}

async function assertNewDatabaseReady(
  client: pg.PoolClient,
  keptEmail: string,
): Promise<void> {
  const reg = await client.query(
    "SELECT to_regclass('public.schema_migrations') AS m",
  );
  if (!reg.rows[0].m)
    throw new Error(
      "The new database has no schema_migrations table: start the backend once against it so the typed baseline is applied, then run the carry-over.",
    );
  const versions = (
    await client.query("SELECT version FROM schema_migrations")
  ).rows.map((r) => r.version);
  if (!versions.includes(PG_BASELINE_VERSION))
    throw new Error(
      "The new database is not built from the typed baseline; refusing to write into it.",
    );
  const tables = (
    await client.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'",
    )
  ).rows.map((r) => r.table_name as string);
  const allowed = new Set<string>([...CARRY_OVER_TABLES, "schema_migrations"]);
  for (const table of tables) {
    if (allowed.has(table)) continue;
    const n = Number(
      (await client.query(`SELECT count(*) AS n FROM ${quoteIdent(table)}`))
        .rows[0].n,
    );
    if (n > 0)
      throw new Error(
        `The new database already holds data in ${table}; a carry-over only runs into a clean database.`,
      );
  }
  const others = Number(
    (
      await client.query(
        "SELECT count(*) AS n FROM users WHERE lower(email) <> lower($1)",
        [keptEmail],
      )
    ).rows[0].n,
  );
  if (others > 0)
    throw new Error(
      "The new database already has user accounts other than the kept account; refusing to carry over.",
    );
}

interface Spec {
  table: (typeof CARRY_OVER_TABLES)[number];
  select: (ctx: Ctx) => { sql: string; params: unknown[] } | null;
  /** Row filter applied after type conversion (receives converted values). */
  keep?: (row: Record<string, unknown>, ctx: Ctx) => boolean;
}

interface Ctx {
  keptEmail: string;
  keptUserIds: string[];
  tenantIds: string[];
  now: Date;
}

const SPECS: Spec[] = [
  {
    table: "users",
    select: (c) => ({
      sql: "SELECT * FROM users WHERE lower(email) = lower($1)",
      params: [c.keptEmail],
    }),
  },
  {
    table: "m365_identity_links",
    select: (c) => ({
      sql: "SELECT * FROM m365_identity_links WHERE user_id = ANY($1)",
      params: [c.keptUserIds],
    }),
  },
  {
    table: "m365_tenants",
    select: (c) =>
      c.tenantIds.length
        ? {
            sql: "SELECT * FROM m365_tenants WHERE tenant_id = ANY($1)",
            params: [c.tenantIds],
          }
        : null,
  },
  {
    table: "subscriptions",
    select: (c) => ({
      sql: "SELECT * FROM subscriptions WHERE user_id = ANY($1) AND status = 'active'",
      params: [c.keptUserIds],
    }),
    // Only subscriptions that are still valid; an expired or unreadable end date is dropped.
    keep: (row, c) => {
      const until = Date.parse(String(row.valid_until));
      return Number.isFinite(until) && until > c.now.getTime();
    },
  },
  {
    table: "provider_api_keys",
    select: () => ({ sql: "SELECT * FROM provider_api_keys", params: [] }),
  },
  {
    table: "provider_credentials",
    select: () => ({ sql: "SELECT * FROM provider_credentials", params: [] }),
  },
  {
    table: "model_registry",
    select: () => ({ sql: "SELECT * FROM model_registry", params: [] }),
  },
  {
    table: "plan_overrides",
    select: () => ({ sql: "SELECT * FROM plan_overrides", params: [] }),
  },
  {
    table: "admin_staff",
    select: () => ({ sql: "SELECT * FROM admin_staff", params: [] }),
  },
];

export async function runCarryOver(
  options: CarryOverOptions,
): Promise<CarryOverReport> {
  const keptEmail = (options.keptEmail ?? DEFAULT_KEPT_EMAIL).trim();
  if (!keptEmail) throw new Error("A kept account email is required.");
  if (sameDatabase(options.oldUrl, options.newUrl))
    throw new Error(
      "The old and new database URLs point at the same database.",
    );

  const oldPool = new Pool({
    connectionString: options.oldUrl,
    max: 1,
    ssl: postgresSslOption(options.oldUrl),
  });
  const newPool = new Pool({
    connectionString: options.newUrl,
    max: 1,
    ssl: postgresSslOption(options.newUrl),
  });
  // A server-side disconnect of an idle client must not crash the process with an unhandled event.
  for (const pool of [oldPool, newPool]) pool.on("error", () => {});
  if (options.initSchema) {
    const empty = await newPool.query(
      "SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public'",
    );
    if (empty.rows[0].n === 0) await applyPostgresMigrations(newPool);
  }
  const oldClient = await oldPool.connect();
  const newClient = await newPool.connect();
  const report: CarryOverReport = {
    dryRun: Boolean(options.dryRun),
    keptUserFound: false,
    tables: [],
  };
  try {
    await oldClient.query(
      "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
    );
    await newClient.query("BEGIN");
    await assertNewDatabaseReady(newClient, keptEmail);

    const ctx: Ctx = {
      keptEmail,
      keptUserIds: [],
      tenantIds: [],
      now: options.now ?? new Date(),
    };

    for (const spec of SPECS) {
      const tableReport: CarryOverTableReport = {
        table: spec.table,
        read: 0,
        inserted: 0,
        alreadyPresent: 0,
        skipped: 0,
        warnings: [],
      };
      report.tables.push(tableReport);

      const query = spec.select(ctx);
      if (!query) continue;
      const source = await oldClient.query(query.sql, query.params);
      tableReport.read = source.rowCount ?? 0;

      const columns = await columnsOf(newClient, spec.table);
      const byName = new Map(columns.map((c) => [c.name, c]));

      for (const row of source.rows as Record<string, unknown>[]) {
        const names: string[] = [];
        const values: unknown[] = [];
        const converted: Record<string, unknown> = {};
        let drop = false;
        for (const [name, raw] of Object.entries(row)) {
          const column = byName.get(name);
          if (!column) continue; // a column the typed schema no longer has
          const result = convertValue(raw, column);
          if (result.ok) {
            converted[name] = result.value;
            names.push(name);
            values.push(result.value);
            continue;
          }
          const where = `${spec.table}.${name}`;
          if (column.nullable) {
            tableReport.warnings.push(
              `${where}: ${result.reason}, stored as NULL`,
            );
            converted[name] = null;
            names.push(name);
            values.push(null);
          } else if (column.hasDefault) {
            tableReport.warnings.push(
              `${where}: ${result.reason}, default used`,
            );
          } else {
            tableReport.warnings.push(
              `${where}: ${result.reason}, row skipped`,
            );
            drop = true;
            break;
          }
        }
        if (drop || (spec.keep && !spec.keep(converted, ctx))) {
          tableReport.skipped += 1;
          continue;
        }
        const placeholders = names.map((_, i) => `$${i + 1}`).join(", ");
        const result = await newClient.query(
          `INSERT INTO ${quoteIdent(spec.table)} (${names.map(quoteIdent).join(", ")})
           VALUES (${placeholders}) ON CONFLICT DO NOTHING`,
          values,
        );
        if ((result.rowCount ?? 0) > 0) tableReport.inserted += 1;
        else tableReport.alreadyPresent += 1;

        if (spec.table === "users" && typeof converted.id === "string") {
          ctx.keptUserIds.push(converted.id);
          report.keptUserFound = true;
        }
        if (
          spec.table === "m365_identity_links" &&
          typeof converted.tenant_id === "string" &&
          !ctx.tenantIds.includes(converted.tenant_id)
        )
          ctx.tenantIds.push(converted.tenant_id);
      }

      if (
        spec.table === "users" &&
        !report.keptUserFound &&
        options.requireKeptUser !== false
      )
        throw new Error(
          "The kept account was not found in the old database; nothing was written.",
        );
    }

    // The new database must now hold exactly what was read, minus what was deliberately skipped.
    for (const t of report.tables) {
      const count = Number(
        (
          await newClient.query(
            `SELECT count(*) AS n FROM ${quoteIdent(t.table)}`,
          )
        ).rows[0].n,
      );
      if (count < t.inserted + t.alreadyPresent)
        throw new Error(`Row count check failed for ${t.table}; rolling back.`);
    }

    if (options.dryRun) await newClient.query("ROLLBACK");
    else await newClient.query("COMMIT");
    await oldClient.query("ROLLBACK");
    return report;
  } catch (error) {
    await newClient.query("ROLLBACK").catch(() => {});
    await oldClient.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    oldClient.release();
    newClient.release();
    await oldPool.end();
    await newPool.end();
  }
}
