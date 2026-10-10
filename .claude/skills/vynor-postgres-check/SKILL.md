---
name: vynor-postgres-check
description: Run the backend tests against a real PostgreSQL 16 (production uses it; local tests use SQLite) and fix SQLite-only SQL. Use after changing backend SQL, migrations or src/db.ts, and before any backend deploy.
---

# PostgreSQL parity check

Production runs PostgreSQL 16 (`DATABASE_URL`). Local tests use SQLite, so SQLite-only SQL passes tests and
fails in production. Never run the suite against the production database: tests insert, change and delete rows.

## Run it (local Docker, same image as production)

```
docker run -d --name vynor-test-pg -e POSTGRES_USER=vynor -e POSTGRES_PASSWORD=testpw \
  -e POSTGRES_DB=vynor_test -p 55432:5432 postgres:16-alpine
cd backend
DATABASE_URL=postgres://vynor:testpw@127.0.0.1:55432/vynor_test npx tsx --test --test-concurrency=1 test/<file>.test.ts
```

- Run one file at a time with `timeout`, and reset the schema between files:
  `docker exec vynor-test-pg psql -U vynor -d vynor_test -c "drop schema public cascade; create schema public;"`.
  Leftover rows from an earlier run cause false failures (`duplicate key`).
- A file that prints all subtests as passing but never exits is an unclosed `pg` pool, not a product bug.
- Remove the container afterwards: `docker rm -f vynor-test-pg`.

## SQLite-only things that break on PostgreSQL

| SQLite                                   | Use instead                                                              |
| ---------------------------------------- | ------------------------------------------------------------------------ |
| `ORDER BY rowid`                         | an explicit sequence column (`seq BIGSERIAL`), chosen by `usingPostgres` |
| `INSERT OR REPLACE` / `INSERT OR IGNORE` | `INSERT ... ON CONFLICT (key) DO UPDATE / DO NOTHING`                    |
| `?` placeholders with `$1` mixing        | keep `?` only; the driver converts                                       |
| `PRAGMA`, `sqlite_master`                | guard with `usingPostgres`                                               |

New tables need a migration in `backend/src/services/postgresSchema.ts` AND the SQLite schema in `src/db.ts`.
A test that uses SQLite-only SQL for its own setup should be made portable, not skipped.
