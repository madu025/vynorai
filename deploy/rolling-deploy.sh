#!/usr/bin/env bash
# Zero-downtime backend deploy: build once, then replace one worker at a time.
# A worker drains on SIGTERM (/ready -> 503, in-flight streams finish), Caddy
# routes its users to the other worker, and the next worker is only replaced
# once the new one reports healthy.
#
#   cd /opt/vynor && bash ./deploy/rolling-deploy.sh
set -euo pipefail

COMPOSE="docker compose -f docker-compose.vps.yml"
WORKERS=(vynor-backend vynor-backend-2)

# Tells deploy/watchdog.sh not to restart workers mid-rollout.
touch /run/vynor-deploying
trap 'rm -f /run/vynor-deploying' EXIT

wait_healthy() {
  local name=$1
  for _ in $(seq 1 60); do
    status=$(docker inspect --format '{{.State.Health.Status}}' "$name" 2>/dev/null || echo missing)
    if [ "$status" = "healthy" ]; then
      echo "  $name healthy"
      return 0
    fi
    sleep 2
  done
  echo "  $name did not become healthy; stopping the rollout" >&2
  docker logs --tail 40 "$name" >&2 || true
  return 1
}

git pull -q
# Pick up Caddyfile changes without dropping connections.
if ! reload_output=$(docker exec vynor-caddy caddy reload --config /etc/caddy/deploy/Caddyfile --adapter caddyfile 2>&1); then
  echo "Caddy reload failed; stopping before the build:" >&2
  echo "$reload_output" | tail -20 >&2
  exit 1
fi
echo "$reload_output" | tail -3
echo "Building image…"
$COMPOSE build vynor-backend

# The background worker launches this image through the root-owned runsc
# launcher. Rebuild it in the same rollout, otherwise the worker can run an
# older runner even when the backend image is current.
BACKGROUND_RUNNING=0
if docker inspect vynor-background-worker >/dev/null 2>&1; then
  BACKGROUND_RUNNING=1
  echo "Building background runner image..."
  $COMPOSE --profile background-image build vynor-background-runner-image
fi

for worker in "${WORKERS[@]}"; do
  echo "Replacing $worker…"
  $COMPOSE up -d --no-deps --no-build "$worker"
  wait_healthy "$worker"
done

if [ "$BACKGROUND_RUNNING" -eq 1 ]; then
  echo "Replacing vynor-background-worker..."
  $COMPOSE up -d --no-deps --no-build vynor-background-worker
  sleep 5
  worker_running=$(docker inspect -f '{{.State.Running}}' vynor-background-worker 2>/dev/null || echo false)
  if [ "$worker_running" != "true" ]; then
    echo "  vynor-background-worker is not running after the rollout" >&2
    docker logs --tail 40 vynor-background-worker >&2 || true
    exit 1
  fi
fi

echo "Rollout complete: $(git log --oneline -1)"
