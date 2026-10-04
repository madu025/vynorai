#!/usr/bin/env bash
# Off-site Postgres backups to Cloudflare R2 (runs daily from cron).
#
#   1. take the newest local dump made by vynor-pg-backup (or make one)
#   2. encrypt it with AES-256 (key stays on the VPS, never in R2)
#   3. upload to R2, delete copies older than 30 days
#   4. verify: download the newest copy, decrypt, and let pg_restore read it
#   5. report failures (and a weekly success) to Telegram
#
# Config: /etc/vynor-backup.env (root only)
#   R2_ACCOUNT_ID=...  R2_ACCESS_KEY_ID=...  R2_SECRET_ACCESS_KEY=...
#   R2_BUCKET=vynor-backups  BACKUP_ENCRYPTION_KEY=<64 hex chars>
# Restore: ./deploy/offsite-backup.sh restore-latest /tmp/vynor.dump
set -uo pipefail

ENV_FILE=/etc/vynor-backup.env
LOCAL_DIR=/opt/vynor/backups
KEEP_DAYS=30
# shellcheck disable=SC1090
. "$ENV_FILE"
[ -f /etc/vynor-watchdog.env ] && . /etc/vynor-watchdog.env
: "${R2_ACCOUNT_ID:?}" "${R2_ACCESS_KEY_ID:?}" "${R2_SECRET_ACCESS_KEY:?}" "${R2_BUCKET:?}" "${BACKUP_ENCRYPTION_KEY:?}"

notify() {
  [ -n "${TELEGRAM_BOT_TOKEN:-}" ] || return 0
  curl -s -m 10 -o /dev/null "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
    --data-urlencode "chat_id=${TELEGRAM_CHAT_ID}" --data-urlencode "text=$1" || true
}
fail() { notify "❌ Off-site backup failed: $1"; echo "FAILED: $1" >&2; exit 1; }

# rclone in a throwaway container; config comes from env vars only.
rclone() {
  docker run --rm -i \
    -e RCLONE_CONFIG_R2_TYPE=s3 -e RCLONE_CONFIG_R2_PROVIDER=Cloudflare \
    -e RCLONE_CONFIG_R2_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" \
    -e RCLONE_CONFIG_R2_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" \
    -e RCLONE_CONFIG_R2_ENDPOINT="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com" \
    -e RCLONE_CONFIG_R2_NO_CHECK_BUCKET=true \
    -v /tmp/vynor-offsite:/work rclone/rclone:1.68 "$@"
}
encrypt() { openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass "pass:${BACKUP_ENCRYPTION_KEY}" "$@"; }

mkdir -p /tmp/vynor-offsite && chmod 700 /tmp/vynor-offsite
trap 'rm -rf /tmp/vynor-offsite/*' EXIT

if [ "${1:-}" = "restore-latest" ]; then
  out=${2:?usage: restore-latest /path/to/out.dump}
  latest=$(rclone lsf "r2:${R2_BUCKET}/postgres/" | sort | tail -1)
  [ -n "$latest" ] || fail "no backups in R2"
  rclone copy "r2:${R2_BUCKET}/postgres/${latest}" /work/ || fail "download $latest"
  encrypt -d -in "/tmp/vynor-offsite/${latest}" -out "$out" || fail "decrypt $latest"
  echo "Restored ${latest} to ${out}. Load it with: docker exec -i vynor-postgres pg_restore -U vynor -d vynor --clean < ${out}"
  exit 0
fi

# 1. newest local dump (made in the last 26 hours), else make one now
dump=$(find "$LOCAL_DIR" -name 'vynor-*.dump' -mmin -1560 2>/dev/null | sort | tail -1)
if [ -z "$dump" ]; then
  dump="$LOCAL_DIR/vynor-$(date -u +%Y%m%d-%H%M%S).dump"
  docker exec vynor-postgres pg_dump -U vynor -d vynor -Fc > "$dump" || fail "pg_dump"
fi
name="$(basename "$dump").enc"

# 2-3. encrypt and upload
encrypt -in "$dump" -out "/tmp/vynor-offsite/$name" || fail "encrypt"
size=$(du -h "/tmp/vynor-offsite/$name" | cut -f1)
rclone copy "/work/$name" "r2:${R2_BUCKET}/postgres/" || fail "upload $name"
rclone delete --min-age "${KEEP_DAYS}d" "r2:${R2_BUCKET}/postgres/" || notify "⚠️ Off-site backup: could not prune old copies"
rm -f "/tmp/vynor-offsite/$name"

# 4. verify the uploaded copy restores
rclone copy "r2:${R2_BUCKET}/postgres/$name" /work/ || fail "re-download $name"
encrypt -d -in "/tmp/vynor-offsite/$name" -out /tmp/vynor-offsite/verify.dump || fail "decrypt check"
tables=$(docker run --rm -i postgres:16-alpine pg_restore --list < /tmp/vynor-offsite/verify.dump 2>/dev/null | grep -c "TABLE DATA" || true)
[ "${tables:-0}" -gt 5 ] || fail "uploaded backup did not read back (tables: ${tables:-0})"
count=$(rclone lsf "r2:${R2_BUCKET}/postgres/" | wc -l)

echo "ok $name $size, $tables tables, $count copies in R2"
# 5. weekly confirmation (Mondays), failures are always reported
[ "$(date +%u)" = "1" ] && notify "🗄️ Off-site backup OK: $name ($size, $tables tables verified), $count daily copies in R2."
exit 0
