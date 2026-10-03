import pg from "pg";

/**
 * PostgreSQL driver behind db.ts. Application SQL is written once in the
 * portable subset both engines accept; translatePostgresSql() bridges the few
 * dialect differences that remain in hand-written queries.
 */

const { Pool, types } = pg;

// Return numbers, not strings, for BIGINT/NUMERIC so credit math, COUNT(*)
// and SUM() behave exactly as they did on SQLite.
types.setTypeParser(20, (v) => Number(v)); // int8
types.setTypeParser(1700, (v) => Number(v)); // numeric
// DATE(created_at) must stay the plain "YYYY-MM-DD" string SQLite returned.
types.setTypeParser(1082, (v) => v);

/** SQLite's CURRENT_TIMESTAMP format: UTC "YYYY-MM-DD HH:MM:SS" text. */
export const PG_NOW_TEXT =
  "to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')";

let pool: pg.Pool | null = null;
let ready = false;

export function postgresConfigured(): boolean {
  return (
    Boolean(process.env.DATABASE_URL) && process.env.DB_DRIVER !== "sqlite"
  );
}

export function postgresReady(): boolean {
  return ready;
}

export function getPool(): pg.Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: Number(process.env.PG_POOL_MAX || 20),
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 30_000,
      ssl:
        process.env.PG_SSL === "require"
          ? { rejectUnauthorized: true }
          : undefined,
    });
    pool.on("error", (err) =>
      console.error("[Postgres] idle client error:", err.message),
    );
  }
  return pool;
}

export function markPostgresReady(value: boolean): void {
  ready = value;
}

export async function closePostgres(): Promise<void> {
  if (pool) await pool.end();
  pool = null;
  ready = false;
}

/** Applies `fn` to the SQL outside single-quoted string literals. */
function outsideStrings(sql: string, fn: (code: string) => string): string {
  return sql
    .split(/('(?:[^']|'')*')/)
    .map((part, i) => (i % 2 === 1 ? part : fn(part)))
    .join("");
}

/**
 * SQLite → PostgreSQL for application queries:
 * - `?` placeholders → `$1..$n`
 * - `CURRENT_TIMESTAMP` → SQLite-format UTC text (date columns are TEXT)
 * - two-argument scalar `MAX(0, x)` → `GREATEST(0, x)`
 * - camelCase aliases are quoted (Postgres folds unquoted names to lowercase),
 *   including where the alias is referenced again, e.g. in ORDER BY
 */
export function translatePostgresSql(sql: string): string {
  const aliases = new Set<string>();
  outsideStrings(sql, (code) => {
    for (const m of code.matchAll(
      /\b[Aa][Ss]\s+([a-z][a-z0-9]*[A-Z][A-Za-z0-9]*)\b/g,
    )) {
      aliases.add(m[1]);
    }
    return code;
  });

  let index = 0;
  return outsideStrings(sql, (code) => {
    let out = code
      .replace(/\?/g, () => `$${++index}`)
      .replace(/\bCURRENT_TIMESTAMP\b/gi, PG_NOW_TEXT)
      .replace(/\bMAX\(\s*0\s*,/gi, "GREATEST(0,");
    for (const alias of aliases) {
      out = out.replace(
        new RegExp(`(?<!["\\w.])${alias}(?!["\\w])`, "g"),
        `"${alias}"`,
      );
    }
    return out;
  });
}

export async function pgGet<T = any>(
  sql: string,
  params: any[] = [],
): Promise<T | undefined> {
  const result = await getPool().query(translatePostgresSql(sql), params);
  return result.rows[0] as T | undefined;
}

export async function pgAll<T = any>(
  sql: string,
  params: any[] = [],
): Promise<T[]> {
  const result = await getPool().query(translatePostgresSql(sql), params);
  return result.rows as T[];
}

export async function pgRun(
  sql: string,
  params: any[] = [],
): Promise<{ lastID: number; changes: number }> {
  const result = await getPool().query(translatePostgresSql(sql), params);
  return { lastID: 0, changes: result.rowCount ?? 0 };
}
