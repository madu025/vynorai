#!/usr/bin/env bash
# One-time move of production PostgreSQL from the retired text-timestamp schema to the typed
# baseline. Database steps only: stopping and starting the backend containers stays in
# docs/DB_CUTOVER_RUNBOOK.md so every outage step is a deliberate human command.
#
#   ./deploy/typed-db-cutover.sh preflight   read-only checks
#   ./deploy/typed-db-cutover.sh backup      final verified dump of the live database
#   ./deploy/typed-db-cutover.sh prepare     create the new database, apply the baseline, dry-run the copy
#   ./deploy/typed-db-cutover.sh copy        the real carry-over (run after the backends are stopped)
#   ./deploy/typed-db-cutover.sh swap --yes  rename: live -> vynor_old_<date>, new -> live
#   ./deploy/typed-db-cutover.sh rollback --yes   rename back
#
# Nothing here prints passwords, keys, emails or row values. Every name below can be overridden
# through the environment, which is how the script is rehearsed against a throwaway PostgreSQL.
set -euo pipefail

PG_CONTAINER="${PG_CONTAINER:-vynor-postgres}"
PG_USER="${PG_USER:-vynor}"
DB_LIVE="${DB_LIVE:-vynor}"
DB_NEW="${DB_NEW:-vynor_typed}"
DB_OLD="${DB_OLD:-vynor_old_$(date +%Y%m%d)}"
BACKEND_CONTAINER="${BACKEND_CONTAINER:-vynor-backend}"
IMAGE="${IMAGE:-vynor-backend:local}"
BACKUP_DIR="${BACKUP_DIR:-/opt/vynor/backups}"
KEPT_EMAIL="${KEPT_EMAIL:-sltsqms@gmail.com}"
# Command that runs the carry-over script. Default: the freshly built backend image.
CARRYOVER_RUN="${CARRYOVER_RUN:-}"

die() { echo "ERROR: $*" >&2; exit 1; }
psql_admin() { docker exec -i "$PG_CONTAINER" psql -U "$PG_USER" -d postgres -v ON_ERROR_STOP=1 -qAt "$@"; }
db_exists() { [ "$(psql_admin -c "SELECT 1 FROM pg_database WHERE datname = '$1'")" = "1" ]; }

# The live DATABASE_URL, read from the running backend (never printed).
live_url() {
  if [ -n "${OLD_DATABASE_URL:-}" ]; then printf '%s' "$OLD_DATABASE_URL"; return; fi
  # docker inspect reads the container config, so it also works after the backends are stopped.
  docker inspect "$BACKEND_CONTAINER" --format '{{range .Config.Env}}{{println .}}{{end}}' | sed -n 's/^DATABASE_URL=//p'
}
# Same server and credentials, different database name (query string kept).
with_db() { printf '%s' "$1" | sed -E "s#^([a-z]+://[^/]+)/[^?]*#\1/$2#"; }

network_of_postgres() {
  docker inspect "$PG_CONTAINER" --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}' | awk '{print $1}'
}

run_carry_over() { # $@ = extra flags
  local old new
  old="$(with_db "$(live_url)" "$DB_LIVE")"
  new="$(with_db "$old" "$DB_NEW")"
  if [ -n "$CARRYOVER_RUN" ]; then
    OLD_DATABASE_URL="$old" NEW_DATABASE_URL="$new" KEPT_EMAIL="$KEPT_EMAIL" bash -c "$CARRYOVER_RUN $*"
  else
    docker run --rm --network "$(network_of_postgres)" \
      -e OLD_DATABASE_URL="$old" -e NEW_DATABASE_URL="$new" -e KEPT_EMAIL="$KEPT_EMAIL" \
      --entrypoint node "$IMAGE" dist/scripts/carryOver.js "$@"
  fi
}

cmd_preflight() {
  docker inspect "$PG_CONTAINER" >/dev/null 2>&1 || die "no $PG_CONTAINER container"
  db_exists "$DB_LIVE" || die "live database $DB_LIVE not found"
  db_exists "$DB_NEW" && die "$DB_NEW already exists; drop it only if you are sure it is a failed earlier attempt"
  db_exists "$DB_OLD" && die "$DB_OLD already exists"
  echo "ok: $PG_CONTAINER has $DB_LIVE; $DB_NEW and $DB_OLD are free"
  if [ -z "$CARRYOVER_RUN" ]; then
    docker run --rm --entrypoint sh "$IMAGE" -c 'test -f dist/scripts/carryOver.js' \
      || die "image $IMAGE has no dist/scripts/carryOver.js: build the new image first"
    echo "ok: $IMAGE contains the carry-over script"
  fi
  df -h "$BACKUP_DIR" 2>/dev/null | tail -1 || true
  echo "live database size: $(psql_admin -c "SELECT pg_size_pretty(pg_database_size('$DB_LIVE'))")"
}

cmd_backup() {
  mkdir -p "$BACKUP_DIR"
  local file="$BACKUP_DIR/pre-typed-schema-$(date +%Y%m%d-%H%M%S).dump"
  umask 077
  docker exec "$PG_CONTAINER" pg_dump -U "$PG_USER" -d "$DB_LIVE" -Fc > "$file"
  # A dump that cannot be listed is not a backup.
  local entries
  entries="$(docker exec -i "$PG_CONTAINER" pg_restore --list < "$file" | grep -c 'TABLE DATA' || true)"
  [ "$entries" -ge 10 ] || die "the dump lists only $entries tables of data; not trusting it"
  chmod 600 "$file"
  echo "backup ok: $file ($(du -h "$file" | cut -f1), $entries table-data entries)"
}

cmd_prepare() {
  db_exists "$DB_NEW" && die "$DB_NEW already exists"
  psql_admin -c "CREATE DATABASE \"$DB_NEW\" OWNER \"$PG_USER\""
  echo "created $DB_NEW; applying the typed baseline and dry-running the carry-over"
  run_carry_over --init-schema --dry-run
}

cmd_copy() {
  echo "REAL carry-over into $DB_NEW (the backends must already be stopped)"
  run_carry_over
}

kill_connections() {
  psql_admin -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname IN ('$DB_LIVE', '$DB_NEW', '$DB_OLD') AND pid <> pg_backend_pid()" >/dev/null
}

cmd_swap() {
  [ "${1:-}" = "--yes" ] || die "swap renames databases; re-run with --yes once the backends are stopped"
  db_exists "$DB_NEW" || die "$DB_NEW not found; run prepare and copy first"
  db_exists "$DB_OLD" && die "$DB_OLD already exists"
  kill_connections
  psql_admin -c "ALTER DATABASE \"$DB_LIVE\" RENAME TO \"$DB_OLD\"" -c "ALTER DATABASE \"$DB_NEW\" RENAME TO \"$DB_LIVE\""
  echo "swapped: the typed database is now $DB_LIVE; the old one is kept as $DB_OLD"
}

cmd_rollback() {
  [ "${1:-}" = "--yes" ] || die "rollback renames databases; re-run with --yes once the backends are stopped"
  db_exists "$DB_OLD" || die "$DB_OLD not found; nothing to roll back to"
  local failed="${DB_LIVE}_typed_failed_$(date +%Y%m%d%H%M%S)"
  kill_connections
  psql_admin -c "ALTER DATABASE \"$DB_LIVE\" RENAME TO \"$failed\"" -c "ALTER DATABASE \"$DB_OLD\" RENAME TO \"$DB_LIVE\""
  echo "rolled back: $DB_LIVE is the old database again; the typed one is kept as $failed"
  echo "also redeploy the previous code (see docs/DB_CUTOVER_RUNBOOK.md): the new image refuses a legacy database"
}

case "${1:-}" in
  preflight) cmd_preflight ;;
  backup) cmd_backup ;;
  prepare) cmd_prepare ;;
  copy) cmd_copy ;;
  swap) shift; cmd_swap "$@" ;;
  rollback) shift; cmd_rollback "$@" ;;
  *) sed -n '2,13p' "$0"; exit 2 ;;
esac
