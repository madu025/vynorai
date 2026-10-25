#!/usr/bin/env bash
# Off-site Postgres backups to Cloudflare R2 (runs daily from cron).
#
#   1. take the newest local dump made by vynor-pg-backup (or make one)
#   2. encrypt it with AES-256 and seal it with a SHA-256 digest that is encrypted together with
#      the dump, so a modified backup fails the restore check (key stays on the VPS, never in R2)
#   3. upload to R2, delete copies older than 14 days (the retention the privacy policy states)
#   4. verify: download the newest copy, decrypt, check the digest, and let pg_restore read it
#   5. report failures (and a weekly success) to Telegram
#
# Config: /etc/vynor-backup.env (root only)
#   R2_ACCOUNT_ID=...  R2_ACCESS_KEY_ID=...  R2_SECRET_ACCESS_KEY=...
#   R2_BUCKET=vynor-backups  BACKUP_ENCRYPTION_KEY=<64 hex chars>
# Restore: bash ./deploy/offsite-backup.sh restore-latest /tmp/vynor.dump
# Cron: call it as `bash /opt/vynor/deploy/offsite-backup.sh` so a lost mode bit (a git pull on a
# filesystem without file modes recreates scripts as 644) cannot silently stop the backups.
set -uo pipefail

ENV_FILE=/etc/vynor-backup.env
LOCAL_DIR=/opt/vynor/backups
KEEP_DAYS=14
# shellcheck disable=SC1090
. "$ENV_FILE"
[ -f /etc/vynor-watchdog.env ] && . /etc/vynor-watchdog.env
: "${R2_ACCOUNT_ID:?}" "${R2_ACCESS_KEY_ID:?}" "${R2_SECRET_ACCESS_KEY:?}" "${R2_BUCKET:?}" "${BACKUP_ENCRYPTION_KEY:?}"

# Secrets never go on a command line (visible in `ps`): the Telegram URL is read from stdin, and the
# encryption key and R2 credentials travel as environment variables that are passed by name.
export BACKUP_ENCRYPTION_KEY
export RCLONE_CONFIG_R2_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID"
export RCLONE_CONFIG_R2_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY"

notify() {
  [ -n "${TELEGRAM_BOT_TOKEN:-}" ] || return 0
  printf 'url = "https://api.telegram.org/bot%s/sendMessage"\n' "$TELEGRAM_BOT_TOKEN" |
    curl -s -m 10 -o /dev/null -K - \
      --data-urlencode "chat_id=${TELEGRAM_CHAT_ID}" --data-urlencode "text=$1" || true
}
fail() { notify "❌ Off-site backup failed: $1"; echo "FAILED: $1" >&2; exit 1; }

# rclone in a throwaway container; config comes from env vars only (credentials passed by name).
rclone() {
  docker run --rm -i \
    -e RCLONE_CONFIG_R2_TYPE=s3 -e RCLONE_CONFIG_R2_PROVIDER=Cloudflare \
    -e RCLONE_CONFIG_R2_ACCESS_KEY_ID -e RCLONE_CONFIG_R2_SECRET_ACCESS_KEY \
    -e RCLONE_CONFIG_R2_ENDPOINT="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com" \
    -e RCLONE_CONFIG_R2_NO_CHECK_BUCKET=true \
    -v /tmp/vynor-offsite:/work rclone/rclone:1.68 "$@"
}

# AES-256-CBC has no built-in integrity check, so every new backup (".enc2") carries a trailer inside
# the encrypted stream: "VYNORBK1" + the SHA-256 of the dump. Without the key nobody can forge a
# valid trailer, and any change to the ciphertext makes the digest check fail. Old ".enc" backups
# have no trailer and are restored with a warning.
SEAL_MAGIC=VYNORBK1
SEAL_LEN=72 # 8 magic bytes + 64 hex digits
aes() { openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass env:BACKUP_ENCRYPTION_KEY "$@"; }

# seal_encrypt <plain-in> <enc-out>
seal_encrypt() {
  { cat "$1"; printf '%s%s' "$SEAL_MAGIC" "$(sha256sum "$1" | cut -d' ' -f1)"; } | aes -out "$2"
}

# seal_decrypt <enc-in> <plain-out>: fails when decryption or the digest check fails
seal_decrypt() {
  local in=$1 out=$2 tmp="$2.sealed" size trailer expected actual
  aes -d -in "$in" -out "$tmp" || { rm -f "$tmp"; return 1; }
  case "$in" in
    *.enc2)
      size=$(stat -c %s "$tmp")
      [ "$size" -gt "$SEAL_LEN" ] || { rm -f "$tmp"; return 1; }
      trailer=$(tail -c "$SEAL_LEN" "$tmp")
      [ "${trailer:0:8}" = "$SEAL_MAGIC" ] || { rm -f "$tmp"; return 1; }
      expected=${trailer:8}
      head -c "$((size - SEAL_LEN))" "$tmp" > "$out"
      rm -f "$tmp"
      actual=$(sha256sum "$out" | cut -d' ' -f1)
      [ "$actual" = "$expected" ] || { rm -f "$out"; return 1; }
      ;;
    *)
      echo "WARNING: legacy backup without an integrity digest" >&2
      mv "$tmp" "$out"
      ;;
  esac
}

mkdir -p /tmp/vynor-offsite && chmod 700 /tmp/vynor-offsite
trap 'rm -rf /tmp/vynor-offsite/*' EXIT

if [ "${1:-}" = "restore-latest" ]; then
  out=${2:?usage: restore-latest /path/to/out.dump}
  latest=$(rclone lsf "r2:${R2_BUCKET}/postgres/" | sort | tail -1)
  [ -n "$latest" ] || fail "no backups in R2"
  rclone copy "r2:${R2_BUCKET}/postgres/${latest}" /work/ || fail "download $latest"
  seal_decrypt "/tmp/vynor-offsite/${latest}" "$out" || fail "decrypt or integrity check of $latest"
  echo "Restored ${latest} to ${out}. Load it with: docker exec -i vynor-postgres pg_restore -U vynor -d vynor --clean < ${out}"
  exit 0
fi

# 1. newest local dump (made in the last 26 hours), else make one now
dump=$(find "$LOCAL_DIR" -name 'vynor-*.dump' -mmin -1560 2>/dev/null | sort | tail -1)
if [ -z "$dump" ]; then
  dump="$LOCAL_DIR/vynor-$(date -u +%Y%m%d-%H%M%S).dump"
  docker exec vynor-postgres pg_dump -U vynor -d vynor -Fc > "$dump" || fail "pg_dump"
fi
name="$(basename "$dump").enc2"

# 2-3. encrypt, seal and upload
seal_encrypt "$dump" "/tmp/vynor-offsite/$name" || fail "encrypt"
size=$(du -h "/tmp/vynor-offsite/$name" | cut -f1)
rclone copy "/work/$name" "r2:${R2_BUCKET}/postgres/" || fail "upload $name"
rclone delete --min-age "${KEEP_DAYS}d" "r2:${R2_BUCKET}/postgres/" || notify "⚠️ Off-site backup: could not prune old copies"
rm -f "/tmp/vynor-offsite/$name"

# 4. verify the uploaded copy restores
rclone copy "r2:${R2_BUCKET}/postgres/$name" /work/ || fail "re-download $name"
seal_decrypt "/tmp/vynor-offsite/$name" /tmp/vynor-offsite/verify.dump || fail "decrypt or integrity check"
tables=$(docker run --rm -i postgres:16-alpine pg_restore --list < /tmp/vynor-offsite/verify.dump 2>/dev/null | grep -c "TABLE DATA" || true)
[ "${tables:-0}" -gt 5 ] || fail "uploaded backup did not read back (tables: ${tables:-0})"
count=$(rclone lsf "r2:${R2_BUCKET}/postgres/" | wc -l)

echo "ok $name $size, $tables tables, $count copies in R2"
# 5. weekly confirmation (Mondays), failures are always reported
[ "$(date +%u)" = "1" ] && notify "🗄️ Off-site backup OK: $name ($size, $tables tables verified), $count daily copies in R2."
exit 0
