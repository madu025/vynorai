/**
 * SQLite (tests, local development) and PostgreSQL (production) must describe the same schema.
 * There is no PostgreSQL in the test environment, so this reads the PostgreSQL migration SQL and
 * compares it with the schema SQLite actually builds: a migration that exists on one engine only,
 * or a table, column, NOT NULL, foreign key or index that differs, fails here instead of in
 * production. Known, reviewed differences are listed explicitly below.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { before, test } from "node:test";

// These tests inspect the SQLite schema, so they stay on SQLite even when DATABASE_URL points at
// PostgreSQL (the PostgreSQL run of the whole suite uses that variable).
process.env.DB_DRIVER = "sqlite";
import { PG_MIGRATIONS } from "../src/services/postgresSchema.js";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vynor-parity-"));
let dbm: typeof import("../src/db.js");

interface Column {
  notNull: boolean;
  intType: boolean;
}
interface ForeignKey {
  column: string;
  table: string;
  onDelete: string;
}
interface TableShape {
  columns: Map<string, Column>;
  foreignKeys: Set<string>;
  hasUnique: boolean;
}

before(async () => {
  process.chdir(tmpDir);
  process.env.NODE_ENV = "test";
  dbm = await import("../src/db.js");
  await dbm.initDb();
});

/** Splits on commas that are not inside parentheses. */
function splitTopLevel(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of body) {
    if (ch === "(") depth += 1;
    if (ch === ")") depth -= 1;
    if (ch === "," && depth === 0) {
      parts.push(current);
      current = "";
    } else current += ch;
  }
  if (current.trim()) parts.push(current);
  return parts
    .map((part) => part.replace(/--.*$/gm, "").trim())
    .filter(Boolean);
}

const CONSTRAINT_START =
  /^(PRIMARY\s+KEY|UNIQUE|FOREIGN\s+KEY|CHECK|CONSTRAINT)\b/i;
const INT_TYPE = /^(INTEGER|INT|BIGINT|SMALLINT|SERIAL|BIGSERIAL)\b/i;

function fkKey(fk: ForeignKey): string {
  return `${fk.column}->${fk.table} ON DELETE ${fk.onDelete}`;
}

function readColumnDefinition(table: TableShape, definition: string): void {
  const match = /^"?([A-Za-z_][A-Za-z0-9_]*)"?\s+(.*)$/s.exec(definition);
  if (!match) return;
  const [, name, rest] = match;
  table.columns.set(name.toLowerCase(), {
    notNull: /\bNOT\s+NULL\b|\bPRIMARY\s+KEY\b/i.test(rest),
    intType: INT_TYPE.test(rest),
  });
  const reference =
    /\bREFERENCES\s+([A-Za-z_][A-Za-z0-9_]*)\s*\([^)]*\)(?:\s+ON\s+DELETE\s+(CASCADE|SET\s+NULL|RESTRICT|NO\s+ACTION))?/i.exec(
      rest,
    );
  if (reference)
    table.foreignKeys.add(
      fkKey({
        column: name.toLowerCase(),
        table: reference[1].toLowerCase(),
        onDelete: (reference[2] ?? "NO ACTION")
          .toUpperCase()
          .replace(/\s+/g, " "),
      }),
    );
  if (/\bUNIQUE\b|\bPRIMARY\s+KEY\b/i.test(rest)) table.hasUnique = true;
}

function parsePostgres(): {
  tables: Map<string, TableShape>;
  indexes: Set<string>;
  sql: string;
} {
  const tables = new Map<string, TableShape>();
  const indexes = new Set<string>();
  const sql = PG_MIGRATIONS.map((m) => m.sql).join("\n");
  for (const create of sql.matchAll(
    /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/gi,
  )) {
    const name = create[1].toLowerCase();
    let depth = 1;
    let index = (create.index ?? 0) + create[0].length;
    const start = index;
    while (index < sql.length && depth > 0) {
      if (sql[index] === "(") depth += 1;
      if (sql[index] === ")") depth -= 1;
      index += 1;
    }
    const table: TableShape = {
      columns: new Map(),
      foreignKeys: new Set(),
      hasUnique: false,
    };
    for (const item of splitTopLevel(sql.slice(start, index - 1))) {
      if (CONSTRAINT_START.test(item)) {
        if (/\bUNIQUE\b|\bPRIMARY\s+KEY\b/i.test(item)) table.hasUnique = true;
        const fk =
          /FOREIGN\s+KEY\s*\(([^)]+)\)\s*REFERENCES\s+([A-Za-z_][A-Za-z0-9_]*)\s*\([^)]*\)(?:\s+ON\s+DELETE\s+(CASCADE|SET\s+NULL|RESTRICT|NO\s+ACTION))?/i.exec(
            item,
          );
        if (fk)
          table.foreignKeys.add(
            fkKey({
              column: fk[1].trim().toLowerCase(),
              table: fk[2].toLowerCase(),
              onDelete: (fk[3] ?? "NO ACTION")
                .toUpperCase()
                .replace(/\s+/g, " "),
            }),
          );
        continue;
      }
      readColumnDefinition(table, item);
    }
    tables.set(name, table);
  }
  for (const alter of sql.matchAll(
    /ALTER\s+TABLE\s+([A-Za-z_][A-Za-z0-9_]*)\s+ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+([^;]+);/gi,
  )) {
    const table = tables.get(alter[1].toLowerCase());
    if (table) readColumnDefinition(table, alter[2].trim());
  }
  for (const index of sql.matchAll(
    /CREATE\s+(?:UNIQUE\s+)?INDEX\s+IF\s+NOT\s+EXISTS\s+([A-Za-z_][A-Za-z0-9_]*)/gi,
  ))
    indexes.add(index[1].toLowerCase());
  return { tables, indexes, sql };
}

async function readSqlite(): Promise<{
  tables: Map<string, TableShape>;
  indexes: Set<string>;
}> {
  const tables = new Map<string, TableShape>();
  const indexes = new Set<string>();
  const names = await dbm.dbAll<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
  );
  for (const { name } of names) {
    const shape: TableShape = {
      columns: new Map(),
      foreignKeys: new Set(),
      hasUnique: false,
    };
    const info = await dbm.dbAll<any>(`PRAGMA table_info("${name}")`);
    for (const column of info)
      shape.columns.set(String(column.name).toLowerCase(), {
        notNull: Boolean(column.notnull) || Boolean(column.pk),
        intType: INT_TYPE.test(String(column.type)),
      });
    const fks = await dbm.dbAll<any>(`PRAGMA foreign_key_list("${name}")`);
    for (const fk of fks)
      shape.foreignKeys.add(
        fkKey({
          column: String(fk.from).toLowerCase(),
          table: String(fk.table).toLowerCase(),
          onDelete: String(fk.on_delete).toUpperCase(),
        }),
      );
    const list = await dbm.dbAll<any>(`PRAGMA index_list("${name}")`);
    for (const index of list) {
      if (String(index.name).startsWith("sqlite_autoindex")) {
        shape.hasUnique = true;
        continue;
      }
      indexes.add(String(index.name).toLowerCase());
      if (index.unique) shape.hasUnique = true;
    }
    if (info.some((column: any) => column.pk)) shape.hasUnique = true;
    tables.set(name.toLowerCase(), shape);
  }
  return { tables, indexes };
}

/**
 * Reviewed differences. Each entry says why it is acceptable; a new difference must be fixed or
 * added here on purpose, never left to surprise production.
 */
const SQLITE_ONLY_TABLES = new Set<string>([
  // Both runners create it themselves before applying migrations (applyPostgresMigrations).
  "schema_migrations",
]);
/** A column present on one engine only, with the reason. */
const REVIEWED_COLUMN_DIFFERENCES = new Set<string>([
  // BIGSERIAL stands in for SQLite's implicit rowid so the audit chain keeps a stable order.
  "zk_compliance_audit_logs.seq exists on PostgreSQL only",
]);
const PG_ONLY_TABLES = new Set<string>([
  // Tables the SQLite tests create from their service on first use (CREATE TABLE IF NOT EXISTS in
  // planManager, modelRegistry, templateVault, ...). Production creates them through migrations.
  "plan_overrides",
  "model_registry",
  "cache_entries",
  "user_rules",
  "user_memory",
  "template_vault",
  "provider_api_keys",
  "routing_feedback",
  "error_reports",
  "zk_compliance_audit_logs",
]);
const SQLITE_ONLY_INDEXES = new Set<string>([
  // SQLite keeps a legacy plain index next to the UNIQUE order_id constraint.
  "idx_users_api_key",
  "idx_subscriptions_order_id",
  // PostgreSQL enforces the same rule with UNIQUE (user_id, period_start) on monthly_usage.
  "idx_monthly_usage_user_period",
  "idx_monthly_usage_user_period_unique",
]);
/** PostgreSQL-only migrations: the sequence behind zk_compliance_audit_logs.seq. */
const PG_ONLY_MIGRATIONS = new Set<string>(["025_zk_audit_sequence"]);

test("every SQLite migration has a PostgreSQL migration of the same version (or a reviewed reason)", async () => {
  const sqliteVersions = (
    await dbm.dbAll<{ version: string }>(
      "SELECT version FROM schema_migrations ORDER BY version",
    )
  ).map((row) => row.version);
  const pgVersions = new Set(PG_MIGRATIONS.map((m) => m.version));
  // Migrations 001-023 were folded into the pg_001..pg_011 baseline; from 024 on versions match.
  const folded = sqliteVersions.filter((v) => Number(v.slice(0, 3)) < 24);
  const unfolded = sqliteVersions.filter((v) => Number(v.slice(0, 3)) >= 24);
  assert.ok(folded.length >= 20, "baseline SQLite migrations are present");
  const missing = unfolded.filter((version) => !pgVersions.has(version));
  assert.deepEqual(
    missing,
    [],
    "add a PostgreSQL migration with the same version in postgresSchema.ts",
  );
  const pgOnly = [...pgVersions].filter(
    (version) =>
      !version.startsWith("pg_") &&
      !sqliteVersions.includes(version) &&
      !PG_ONLY_MIGRATIONS.has(version),
  );
  assert.deepEqual(pgOnly, [], "PostgreSQL migrations without a SQLite twin");
  const duplicates = PG_MIGRATIONS.map((m) => m.version).filter(
    (version, index, all) => all.indexOf(version) !== index,
  );
  assert.deepEqual(duplicates, []);
  // Versions are applied in array order: it must be strictly increasing within each family.
  const numbered = PG_MIGRATIONS.map((m) => m.version).filter(
    (v) => !v.startsWith("pg_"),
  );
  assert.deepEqual([...numbered].sort(), numbered, "migrations are ordered");
});

test("tables, columns, NOT NULL, foreign keys and indexes match between SQLite and PostgreSQL", async () => {
  const sqlite = await readSqlite();
  const pg = parsePostgres();
  const problems: string[] = [];

  for (const name of sqlite.tables.keys())
    if (!pg.tables.has(name) && !SQLITE_ONLY_TABLES.has(name))
      problems.push(`table ${name} exists on SQLite only`);

  for (const [name, shape] of pg.tables) {
    const other = sqlite.tables.get(name);
    if (!other) continue; // PG-only tables are checked in the allow-list test below
    for (const [column, definition] of shape.columns) {
      const twin = other.columns.get(column);
      if (!twin) {
        problems.push(`${name}.${column} exists on PostgreSQL only`);
        continue;
      }
      if (twin.notNull !== definition.notNull)
        problems.push(
          `${name}.${column} NOT NULL differs (sqlite ${twin.notNull}, pg ${definition.notNull})`,
        );
      if (twin.intType !== definition.intType)
        problems.push(`${name}.${column} integer-ness differs`);
    }
    for (const column of other.columns.keys())
      if (!shape.columns.has(column))
        problems.push(`${name}.${column} exists on SQLite only`);
    for (const fk of other.foreignKeys)
      if (!shape.foreignKeys.has(fk))
        problems.push(`${name} foreign key ${fk} missing on PostgreSQL`);
    for (const fk of shape.foreignKeys)
      if (!other.foreignKeys.has(fk))
        problems.push(`${name} foreign key ${fk} missing on SQLite`);
    if (other.hasUnique !== shape.hasUnique)
      problems.push(`${name} UNIQUE/PRIMARY KEY presence differs`);
  }

  for (const index of sqlite.indexes)
    if (!pg.indexes.has(index) && !SQLITE_ONLY_INDEXES.has(index))
      problems.push(`index ${index} exists on SQLite only`);

  const unreviewed = problems.filter(
    (problem) => !REVIEWED_COLUMN_DIFFERENCES.has(problem),
  );
  assert.deepEqual(unreviewed, [], unreviewed.join("\n"));
});

test("PostgreSQL-only tables are the reviewed set, and every statement is idempotent", async () => {
  const sqlite = await readSqlite();
  const pg = parsePostgres();
  const pgOnly = [...pg.tables.keys()]
    .filter((name) => !sqlite.tables.has(name))
    .sort();
  const reviewed = [...PG_ONLY_TABLES].sort();
  assert.deepEqual(
    pgOnly.filter((name) => !PG_ONLY_TABLES.has(name)),
    [],
    "a table exists in PostgreSQL migrations but not on SQLite: add it to SQLite or review it here",
  );
  assert.ok(pg.tables.size > 30 && reviewed.length > 0, "the schema parsed");
  for (const migration of PG_MIGRATIONS) {
    for (const statement of migration.sql.matchAll(
      /CREATE\s+(TABLE|INDEX|UNIQUE\s+INDEX)\s+(?!IF\s+NOT\s+EXISTS)/gi,
    ))
      assert.fail(
        `${migration.version}: ${statement[0].trim()} must use IF NOT EXISTS`,
      );
    for (const alter of migration.sql.matchAll(
      /ALTER\s+TABLE\s+\S+\s+ADD\s+COLUMN\s+(?!IF\s+NOT\s+EXISTS)/gi,
    ))
      assert.fail(
        `${migration.version}: ADD COLUMN must use IF NOT EXISTS (${alter[0].trim()})`,
      );
  }
});

test("running initDb again and re-applying migration 040 changes nothing", async () => {
  const before = await dbm.dbAll<{ version: string }>(
    "SELECT version FROM schema_migrations ORDER BY version",
  );
  await dbm.initDb();
  const after = await dbm.dbAll<{ version: string }>(
    "SELECT version FROM schema_migrations ORDER BY version",
  );
  assert.deepEqual(after, before);
  // Re-running the whole of 040 on an already-migrated database is a no-op, not an error.
  await dbm.dbRun(
    "DELETE FROM schema_migrations WHERE version = '040_security_hardening'",
  );
  await dbm.initDb();
  const rows = await dbm.dbAll(
    "SELECT version FROM schema_migrations WHERE version = '040_security_hardening'",
  );
  assert.equal(rows.length, 1);
});
