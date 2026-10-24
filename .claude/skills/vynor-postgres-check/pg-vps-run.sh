#!/bin/bash
# Runs on the VPS: pg-vps-run.sh <database> <outfile> <per-file timeout seconds> <test files...>
# Needs the throwaway container vynor-audit-pg (see SKILL.md) and PGPASSWORD_TEST for its password.
DB="$1"; OUT="$2"; TMO="$3"; shift 3
: "${PGPASSWORD_TEST:?set PGPASSWORD_TEST to the throwaway PostgreSQL password}"
: > "$OUT"
for f in "$@"; do
  docker exec vynor-audit-pg psql -U vynor -d "$DB" -qc 'drop schema public cascade; create schema public;' >/dev/null 2>&1
  res=$(docker run --rm --network host --user root -e NODE_ENV=test \
    -e DATABASE_URL="postgres://vynor:$PGPASSWORD_TEST@127.0.0.1:55432/$DB" \
    -v /tmp/vtest/repo:/repo -v /tmp/vtest/node_modules:/repo/backend/node_modules -w /repo/backend \
    --entrypoint sh vynor-backend:local \
    -c "timeout $TMO node node_modules/tsx/dist/cli.mjs --test --test-force-exit --test-concurrency=1 $f" 2>&1)
  code=$?
  p=$(echo "$res" | grep -E "^# pass" | awk '{print $3}'); fl=$(echo "$res" | grep -E "^# fail" | awk '{print $3}')
  echo "$f exit=$code pass=${p:-?} fail=${fl:-?}" >> "$OUT"
  if [ "${fl:-0}" != "0" ] || [ $code -ne 0 ]; then echo "$res" | grep -E "^not ok|error:|Error|expected|actual" | head -8 | sed "s#^#   [$f] #" >> "$OUT"; fi
done
echo DONE >> "$OUT"
