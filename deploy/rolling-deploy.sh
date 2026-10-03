#!/usr/bin/env bash
# Zero-downtime backend deploy: build once, then replace one worker at a time.
# A worker drains on SIGTERM (/ready -> 503, in-flight streams finish), Caddy
# routes its users to the other worker, and the next worker is only replaced
# once the new one reports healthy.
#
#   cd /opt/vynor && ./deploy/rolling-deploy.sh
set -euo pipefail

COMPOSE="docker compose -f docker-compose.vps.yml"
WORKERS=(vynor-backend vynor-backend-2)

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
echo "Building image…"
$COMPOSE build vynor-backend

for worker in "${WORKERS[@]}"; do
  echo "Replacing $worker…"
  $COMPOSE up -d --no-deps --no-build "$worker"
  wait_healthy "$worker"
done

echo "Rollout complete: $(git log --oneline -1)"
