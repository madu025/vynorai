# Production database cutover: typed PostgreSQL schema

The production PostgreSQL database was built by a ladder of migrations that stored almost every
date as text, every flag as a 0/1 integer and every price as a float. The typed baseline
(`backend/src/services/postgresSchema.ts`) replaces it: `TIMESTAMPTZ` instants, `DATE` billing days,
`NUMERIC` money, a constrained id domain and CHECK constraints on enums, counters and ids. A
database cannot be converted in place safely, so production moves to a **new database** and only a
short, reviewed list of rows is carried over. The old database stays on the server, renamed, until you
delete it.

The backend refuses to start on a legacy database (`PG_LEGACY_SCHEMA`) and never modifies one, so
the order below matters: build the image, prepare the database, stop the backends, swap, start.

Database steps are in `deploy/typed-db-cutover.sh`. Stopping and starting containers stays manual on
purpose. Nothing in this procedure prints passwords, keys, emails or row values.

## What is kept and what is lost

| Kept (copied, encrypted values byte for byte)                                                                                                                                              | Lost (the new database starts empty)                                                                                 |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| The test account `sltsqms@gmail.com`: user row (id, password hash, API key and hash), its still-valid active subscriptions, its M365 identity links, and the M365 tenants those links name | Every other user, subscription, PayHere order and payment record                                                     |
| `provider_api_keys`, `provider_credentials` (model provider keys)                                                                                                                          | `monthly_usage`, `m365_tenant_usage`, quota holds                                                                    |
| `model_registry`, `plan_overrides`, `admin_staff`                                                                                                                                          | `usage_logs`, `request_economics`, audit logs, error reports                                                         |
|                                                                                                                                                                                            | Background tasks and artifacts, memory, rules, cache, vault templates (re-seeded by the app), web-push subscriptions |
|                                                                                                                                                                                            | Password-reset and email-verification tokens, OTPs                                                                   |

Everything lost remains in the old database and in the pre-cutover dump. Anyone who registered
before the cutover has to register again. The kept account's current-month usage restarts at zero.
Old PayHere payments can no longer be matched by order id (a late IPN for an order that is not in the
new database is rejected as an unknown order).

Rows the carry-over cannot read are dropped, never guessed: a subscription with an unreadable or
past `valid_until`, a date that is not a real calendar date. Nullable columns become NULL; the report
lists `table.column: reason` for each (names only, no values).

## Before the window (no downtime)

On the VPS as root, in `/opt/vynor`. The running containers keep serving the old image throughout.

```bash
cd /opt/vynor

# 1. Remember what is running now, so a rollback can return to exactly this code.
git rev-parse HEAD > backups/pre-typed-schema.sha && cat backups/pre-typed-schema.sha

# 2. Keep the watchdog from restarting workers with the new image against the old database.
touch /run/vynor-deploying

# 3. Fetch the new code and build the image. Do NOT run rolling-deploy.sh yet.
git pull -q
docker compose -f docker-compose.vps.yml build vynor-backend

# 4. Read-only checks, then a fresh verified dump of the live database.
./deploy/typed-db-cutover.sh preflight
./deploy/typed-db-cutover.sh backup        # backups/pre-typed-schema-<time>.dump, listed to prove it reads

# 5. Create vynor_typed, apply the baseline, and dry-run the carry-over (rolled back).
./deploy/typed-db-cutover.sh prepare
```

Read the dry-run report from step 5:

- `users inserted=1` and "kept test account found". If it says NOT found, stop: the email differs.
- `provider_api_keys`, `provider_credentials`, `model_registry`, `plan_overrides`, `admin_staff`
  `read` equal what the admin portal shows.
- `subscriptions skipped` are rows that were expired or unreadable. Anything else surprising: stop.

If anything fails, nothing live has changed. Remove the half-built database with
`docker exec vynor-postgres psql -U vynor -d postgres -c 'DROP DATABASE vynor_typed'` and start over.

## The window (about 5 minutes of downtime)

```bash
cd /opt/vynor

# 6. Stop every writer. Caddy answers 502 until step 9.
docker stop vynor-background-worker vynor-backend vynor-backend-2

# 7. The real copy (writes only to vynor_typed, in one transaction). Re-running it is harmless.
./deploy/typed-db-cutover.sh copy

# 8. Swap names: vynor -> vynor_old_<today>, vynor_typed -> vynor. DATABASE_URL does not change.
./deploy/typed-db-cutover.sh swap --yes

# 9. Start the new code (the image from step 3) and drop the watchdog guard.
./deploy/rolling-deploy.sh        # git pull is a no-op, the build is cached, workers start one by one
rm -f /run/vynor-deploying
```

`rolling-deploy.sh` waits for each worker to report healthy. A worker that logs
`PG_LEGACY_SCHEMA` means step 8 did not happen: the database it sees is still the old one.

## Verify

```bash
curl -fsS https://vynor.lk/health && curl -fsS https://vynor.lk/ready
docker logs --tail 40 vynor-backend           # migrations: pg_baseline_2026_10_typed applied; no errors
docker exec vynor-postgres psql -U vynor -d vynor -Atc \
  "select count(*) from users; select version from schema_migrations;"
```

1. Admin portal: sign in (Cloudflare Access or `ADMIN_SECRET`). Provider keys list shows the carried
   keys (masked); Models and Plans show the carried configuration.
2. The kept account: a request with its API key succeeds (`node --env-file=.env.e2e ...` with the
   E2E key works unchanged, the key hash was copied).
3. M365: open the pane in Excel on the web with the SLTS account; sign-in resolves the carried
   identity link; run one inspect-only request.
4. PayHere (sandbox/live as configured): create a checkout; the pending order appears; do not pay.
5. The next `vynor-pg-backup` run and the 03:00 offsite backup dump the new `vynor` database.
6. Typed columns really are typed:
   `select pg_typeof(created_at) from users limit 1;` returns `timestamp with time zone`.

## Rollback

Possible at any time before the old database is dropped. The new image refuses a legacy database, so
both the database and the code go back:

```bash
cd /opt/vynor
docker stop vynor-background-worker vynor-backend vynor-backend-2
./deploy/typed-db-cutover.sh rollback --yes        # vynor -> vynor_typed_failed_<time>, vynor_old_<date> -> vynor

# Previous code (rolling-deploy.sh would `git pull` straight back to the new code, so do it by hand):
git fetch -q && git checkout "$(cat backups/pre-typed-schema.sha)"
touch /run/vynor-deploying
docker compose -f docker-compose.vps.yml build vynor-backend
docker compose -f docker-compose.vps.yml up -d --no-deps --no-build vynor-backend vynor-backend-2 vynor-background-worker
rm -f /run/vynor-deploying
# Later, when you go forward again: git checkout main
```

Rows written to the typed database after the cutover (new registrations, payments) are in
`vynor_typed_failed_<time>` and are not in the old one; copy them over by hand if you need them.

## After the cutover

- Keep `vynor_old_<date>` and the dump for at least a week. Then remove them:
  `docker exec vynor-postgres psql -U vynor -d postgres -c 'DROP DATABASE vynor_old_<date>'` and delete
  `backups/pre-typed-schema-*.dump`. The dump holds personal data: it follows the privacy policy
  retention (14 days for backups), so do not keep it longer.
- The retired ladder's migration names stay in `LEGACY_PG_VERSIONS` so a stray legacy database is
  recognised and refused. Do not remove them.
- `backend/src/scripts/migrateSqliteToPostgres.ts` (SQLite to PostgreSQL) still applies the baseline
  first and inserts well-formed rows; rows with unreadable dates are rejected by the typed columns
  instead of stored. It is not part of this cutover.

## Failure table

| Symptom                                                       | Cause                         | Action                                                 |
| ------------------------------------------------------------- | ----------------------------- | ------------------------------------------------------ |
| `preflight`: `vynor_typed already exists`                     | An earlier attempt            | Confirm it is yours, drop it, rerun                    |
| `prepare`: "kept account was not found"                       | Email differs                 | Set `KEPT_EMAIL`, rerun                                |
| `copy`: "already holds data" or "other than the kept account" | `vynor_typed` was used        | Drop and rerun `prepare`                               |
| Worker logs `PG_LEGACY_SCHEMA`                                | Backend started before `swap` | Stop it, run `swap --yes`, start again                 |
| `swap`: `vynor_old_<date>` exists                             | Second attempt the same day   | Set `DB_OLD=vynor_old_<date>b`                         |
| Admin portal says unauthorised                                | Cloudflare Access variables   | `ADMIN_SECRET` still works; see ARCHITECTURE_DECISIONS |
