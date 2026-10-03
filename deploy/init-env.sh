#!/usr/bin/env bash
# Creates backend/.env from the production template with fresh random secrets.
# Safe to re-run: an existing backend/.env is never overwritten.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -f backend/.env ]; then
  echo "backend/.env already exists; leaving it unchanged."
  exit 0
fi

cp deploy/env.production.example backend/.env
chmod 600 backend/.env
sed -i "s|^JWT_SECRET=__GENERATE__|JWT_SECRET=$(openssl rand -hex 48)|" backend/.env
sed -i "s|^ADMIN_SECRET=__GENERATE__|ADMIN_SECRET=$(openssl rand -hex 24)|" backend/.env
sed -i "s|^DATA_ENCRYPTION_KEY=__GENERATE__|DATA_ENCRYPTION_KEY=$(openssl rand -hex 32)|" backend/.env
echo "Created backend/.env with generated secrets. Fill in DEEPSEEK_API_KEY, OPENROUTER_API_KEY and PAYHERE_* next."
