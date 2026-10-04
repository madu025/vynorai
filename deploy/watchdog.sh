#!/usr/bin/env bash
# VynorAI watchdog: runs every minute from cron on the VPS host.
#
# Known problems are fixed by fixed playbooks (no AI involved):
#   - a backend worker unhealthy for 3 checks -> restart it (Caddy keeps
#     serving from the other worker); at most 3 restarts per worker per hour
#   - postgres / redis / caddy stopped -> start it
#   - disk above 85% -> prune old Docker images, build cache and journal
# Everything else is reported to Telegram: public health failures, low
# memory, DeepSeek balance, TLS expiry, plus a daily summary at 08:00.
#
# Config: /etc/vynor-watchdog.env (root only)
#   TELEGRAM_BOT_TOKEN=...   TELEGRAM_CHAT_ID=...
set -uo pipefail

ENV_FILE=/etc/vynor-watchdog.env
APP_DIR=/opt/vynor
STATE=/var/lib/vynor-watchdog
DEPLOY_LOCK=/run/vynor-deploying
mkdir -p "$STATE"
exec 9>"$STATE/run.lock"
flock -n 9 || exit 0

# shellcheck disable=SC1090
[ -f "$ENV_FILE" ] && . "$ENV_FILE"
: "${TELEGRAM_BOT_TOKEN:?}" "${TELEGRAM_CHAT_ID:?}"

HOST=$(hostname)
send() {
  curl -s -m 10 -o /dev/null \
    "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
    --data-urlencode "chat_id=${TELEGRAM_CHAT_ID}" \
    --data-urlencode "text=$1" || true
}

# Alert once when a problem starts, once when it clears.
issue() { [ -f "$STATE/issue.$1" ] || { send "⚠️ $2"; touch "$STATE/issue.$1"; }; }
resolve() { [ -f "$STATE/issue.$1" ] && { send "✅ $2"; rm -f "$STATE/issue.$1"; }; }

# Consecutive failure counter.
bump() { local n; n=$(($(cat "$STATE/count.$1" 2>/dev/null || echo 0) + 1)); echo "$n" > "$STATE/count.$1"; echo "$n"; }
clear_count() { rm -f "$STATE/count.$1"; }

# Run a check at most once per $2 seconds.
due() {
  local f="$STATE/last.$1" now; now=$(date +%s)
  [ $((now - $(cat "$f" 2>/dev/null || echo 0))) -ge "$2" ] || return 1
  echo "$now" > "$f"
}

# Restarts in the last hour for a container (rate limit for auto-fixes).
restarts_last_hour() {
  local f="$STATE/restarts.$1" cutoff; cutoff=$(($(date +%s) - 3600))
  [ -f "$f" ] || { echo 0; return; }
  awk -v c="$cutoff" '$1 >= c' "$f" > "$f.tmp" && mv "$f.tmp" "$f"
  wc -l < "$f"
}

deploying() { [ -f "$DEPLOY_LOCK" ] && [ $(($(date +%s) - $(stat -c %Y "$DEPLOY_LOCK"))) -lt 900 ]; }

# ── 1. Backend workers ───────────────────────────────────────────────────────
if ! deploying; then
  for c in vynor-backend vynor-backend-2; do
    status=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$c" 2>/dev/null || echo missing)
    if [ "$status" = "healthy" ]; then
      clear_count "$c"
      resolve "$c" "$c is healthy again."
      continue
    fi
    n=$(bump "$c")
    [ "$n" -lt 3 ] && continue
    if [ "$(restarts_last_hour "$c")" -ge 3 ]; then
      issue "$c" "$c is $status and was already restarted 3 times this hour. Auto-fix stopped; needs a look. Last log lines:
$(docker logs --tail 15 "$c" 2>&1 | cut -c1-200)"
      continue
    fi
    docker restart "$c" >/dev/null 2>&1
    date +%s >> "$STATE/restarts.$c"
    clear_count "$c"
    send "🔧 $c was $status for 3 minutes, restarted it (the other worker kept serving)."
    touch "$STATE/issue.$c"
  done
fi

# ── 2. Core services ─────────────────────────────────────────────────────────
for c in vynor-postgres vynor-redis vynor-caddy; do
  if [ "$(docker inspect -f '{{.State.Running}}' "$c" 2>/dev/null)" = "true" ]; then
    resolve "$c" "$c is running again."
  else
    docker start "$c" >/dev/null 2>&1
    issue "$c" "$c was stopped; started it. Check: docker logs $c"
  fi
done

# ── 3. Public health through Caddy ───────────────────────────────────────────
code=$(curl -s -m 10 -o /dev/null -w '%{http_code}' --resolve vynor.lk:443:127.0.0.1 https://vynor.lk/health || echo 000)
if [ "$code" = "200" ]; then
  clear_count public
  resolve public "vynor.lk is answering again."
elif [ "$(bump public)" -ge 3 ] && ! deploying; then
  issue public "vynor.lk/health returned $code for 3 minutes."
fi

# ── 4. Disk ──────────────────────────────────────────────────────────────────
disk=$(df --output=pcent / | tail -1 | tr -dc 0-9)
if [ "$disk" -ge 85 ]; then
  docker image prune -af --filter until=168h >/dev/null 2>&1
  docker builder prune -af --filter until=168h >/dev/null 2>&1
  journalctl --vacuum-size=200M >/dev/null 2>&1
  after=$(df --output=pcent / | tail -1 | tr -dc 0-9)
  if [ "$after" -ge 85 ]; then
    issue disk "Disk is ${after}% full even after cleanup (was ${disk}%)."
  else
    send "🔧 Disk was ${disk}% full; cleaned old images and logs, now ${after}%."
  fi
elif [ "$disk" -lt 80 ]; then
  resolve disk "Disk usage is back to ${disk}%."
fi

# ── 5. Memory ────────────────────────────────────────────────────────────────
avail=$(awk '/MemAvailable/ {a=$2} /MemTotal/ {t=$2} END {printf "%d", a*100/t}' /proc/meminfo)
if [ "$avail" -lt 8 ]; then
  [ "$(bump mem)" -ge 3 ] && issue mem "Only ${avail}% memory available.
$(docker stats --no-stream --format '{{.Name}} {{.MemUsage}}' | sort -k2 -h | tail -5)"
else
  clear_count mem
  resolve mem "Memory is back to ${avail}% available."
fi

# ── 6. DeepSeek balance (hourly) ─────────────────────────────────────────────
if due balance 3600; then
  key=$(grep -E '^DEEPSEEK_API_KEY=' "$APP_DIR/backend/.env" | cut -d= -f2-)
  if [ -n "$key" ]; then
    bal=$(curl -s -m 15 https://api.deepseek.com/user/balance -H "Authorization: Bearer $key" |
      python3 -c 'import json,sys; d=json.load(sys.stdin); print(sum(float(b["total_balance"]) for b in d.get("balance_infos", []) if b.get("currency") == "USD"))' 2>/dev/null)
    if [ -n "$bal" ]; then
      if python3 -c "import sys; sys.exit(0 if float('$bal') < 5 else 1)"; then
        issue balance "DeepSeek balance is \$$bal. Top up soon or requests will fail."
      else
        resolve balance "DeepSeek balance is \$$bal."
      fi
    fi
  fi
fi

# ── 7. TLS certificate (daily) ───────────────────────────────────────────────
if due tls 86400; then
  end=$(echo | openssl s_client -connect 127.0.0.1:443 -servername vynor.lk 2>/dev/null | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2)
  if [ -n "$end" ]; then
    days=$(( ($(date -d "$end" +%s) - $(date +%s)) / 86400 ))
    [ "$days" -lt 14 ] && issue tls "TLS certificate for vynor.lk expires in $days days."
    [ "$days" -ge 14 ] && resolve tls "TLS certificate renewed ($days days left)."
  fi
fi

# ── 8. Daily summary at 08:00 Asia/Colombo ───────────────────────────────────
if [ "$(TZ=Asia/Colombo date +%H)" = "08" ] && due daily 72000; then
  stats=$(docker exec vynor-postgres psql -U vynor -d vynor -tA -F ' ' -c "
    SELECT COUNT(*),
           COALESCE(SUM(credits_charged), 0),
           ROUND(COALESCE(SUM(COALESCE(provider_cost_usd, estimated_cost_usd)), 0)::numeric, 2),
           ROUND(COALESCE(SUM(allocated_revenue_usd), 0)::numeric, 2),
           ROUND(100.0 * SUM(CASE WHEN cache_status = 'hit' THEN 1 ELSE 0 END) / GREATEST(COUNT(*), 1), 1),
           COUNT(DISTINCT user_id)
    FROM request_economics
    WHERE created_at >= NOW() - INTERVAL '24 hours' AND outcome = 'success'" 2>/dev/null)
  newusers=$(docker exec vynor-postgres psql -U vynor -d vynor -tA -c \
    "SELECT COUNT(*) FROM users WHERE created_at >= NOW() - INTERVAL '24 hours'" 2>/dev/null)
  read -r req credits cost rev hit active <<< "$stats"
  send "📊 VynorAI, last 24h
Requests: ${req:-?} · active users: ${active:-?} · new sign-ups: ${newusers:-?}
Credits: ${credits:-?} · cache answers: ${hit:-?}%
Upstream cost: \$${cost:-?} · revenue share: \$${rev:-?}
Disk ${disk}% · memory available ${avail}%"
fi

exit 0
