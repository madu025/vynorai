#!/usr/bin/env sh
# Read-only preflight for enabling VynorAI Background Agents on a VPS.
# It intentionally never prints or exports secret values from backend/.env.
set -eu

ROOT=${1:-/opt/vynor}
ENV_FILE="$ROOT/backend/.env"
SOCKET=${BG_LAUNCHER_SOCKET:-/run/vynor-bg/launcher.sock}
RUNNER_IMAGE=${BG_RUNNER_IMAGE:-vynor-background-runner:local}
FAILED=0

pass() { printf 'PASS %s\n' "$1"; }
fail() { printf 'FAIL %s\n' "$1"; FAILED=1; }

need_env() {
  if [ -f "$ENV_FILE" ] && grep -q "^$1=" "$ENV_FILE"; then
    pass "env:$1 configured"
  else
    fail "env:$1 missing"
  fi
}

if command -v runsc >/dev/null 2>&1; then
  pass "gVisor runsc installed"
else
  fail "gVisor runsc is not installed"
fi

if [ -S "$SOCKET" ]; then
  pass "background launcher socket available"
else
  fail "background launcher socket missing"
fi

for name in \
  BG_ENABLED \
  BG_ARTIFACT_MASTER_KEY \
  BG_MODEL_TOKEN_SECRET \
  BG_QUOTE_SECRET \
  BG_IP_HASH_SALT \
  BG_PATCH_SIGNING_PRIVATE_KEY_BASE64 \
  BG_PATCH_SIGNING_PUBLIC_KEY_BASE64
do
  need_env "$name"
done

if docker image inspect "$RUNNER_IMAGE" >/dev/null 2>&1; then
  pass "sandbox runner image available"
else
  fail "sandbox runner image $RUNNER_IMAGE is not built"
fi

if [ "$FAILED" -ne 0 ]; then
  printf '%s\n' "Background Agents are not ready. Do not enable the compose profile yet."
  exit 1
fi

printf '%s\n' "Background Agents preflight passed. Enable only in a planned staging rollout."
