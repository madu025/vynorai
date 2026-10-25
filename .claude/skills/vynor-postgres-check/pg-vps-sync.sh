#!/bin/bash
# Copies the code the backend tests need to the VPS test area (no secrets, no node_modules).
# Usage: VPS=root@host KEY=~/.ssh/key ./pg-vps-sync.sh   (run from the repository root)
set -euo pipefail
: "${VPS:?set VPS=user@host}" "${KEY:?set KEY=path to the ssh key}"
ssh -i "$KEY" "$VPS" "rm -rf /tmp/vtest/repo/backend/src /tmp/vtest/repo/backend/test /tmp/vtest/repo/backend/public /tmp/vtest/repo/docs /tmp/vtest/repo/packages /tmp/vtest/repo/extensions /tmp/vtest/repo/core; mkdir -p /tmp/vtest/repo/backend"
tar -c --exclude=node_modules --exclude=.env --exclude='*.db' --exclude='*.sqlite*' \
  backend/src backend/test backend/public backend/package.json backend/tsconfig.json \
  docs/*.md CODEMAP.md AGENTS.md README.md packages/m365-contracts/src extensions/m365/src core/llm/utils core/util \
  | ssh -i "$KEY" "$VPS" "tar -x -C /tmp/vtest/repo && ln -sfn /tmp/vtest/node_modules /tmp/vtest/repo/backend/node_modules"
