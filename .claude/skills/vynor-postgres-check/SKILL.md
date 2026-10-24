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

## Fast path: run the suite on the VPS next to a throwaway PostgreSQL

Over an SSH tunnel every query costs a round trip, so one file can take minutes and the whole suite
about 35. Running the tests on the VPS, beside a throwaway PostgreSQL, takes about ten minutes for all
files (three workers). Production data is never involved: the database is a separate container.

- Throwaway PostgreSQL: `docker run -d --name vynor-audit-pg --memory 768m -e POSTGRES_USER=vynor -e POSTGRES_PASSWORD=<throwaway> -p 127.0.0.1:55432:5432 postgres:16-alpine`, plus empty databases `vynor_t1..vynor_t3` (one per worker).
- `pg-vps-sync.sh` copies code only (`backend/src|test|public`, `docs/*.md`, `packages/m365-contracts/src`, `extensions/m365/src`, `core/llm/utils`, `core/util`) to `/tmp/vtest/repo`; `/tmp/vtest/node_modules` is the backend image's `node_modules` plus `tsx` and `typescript`.
- `pg-vps-run.sh` (runs on the VPS) resets the schema, then runs each file in the backend image with `NODE_ENV=test` (the image sets production, which changes route behaviour), `--test-force-exit` (an unclosed `pg` pool otherwise keeps the process alive after all subtests pass) and `--test-concurrency=1`.
- One database per worker, and nothing else may touch `vynor_t1..t3` while a run is going (another run's schema reset kills it and the failures look random). Use another database for ad-hoc runs.
- Environment limits, not product bugs: the image has no `git`, so `gitWorktreeSandbox.test.ts` is run locally instead.
- The typed baseline is applied by `initDb()`; `carryOver.test.ts` needs `DATABASE_URL` to be a superuser (it creates and drops its own databases).
