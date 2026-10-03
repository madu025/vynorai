#!/usr/bin/env bash
# Creates backend/.env and deploy/postgres.env with fresh random secrets.
# Safe to re-run: existing values are never overwritten; missing ones are added.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -f backend/.env ]; then
  cp deploy/env.production.example backend/.env
  chmod 600 backend/.env
  sed -i "s|^JWT_SECRET=__GENERATE__|JWT_SECRET=$(openssl rand -hex 48)|" backend/.env
  sed -i "s|^ADMIN_SECRET=__GENERATE__|ADMIN_SECRET=$(openssl rand -hex 24)|" backend/.env
  sed -i "s|^DATA_ENCRYPTION_KEY=__GENERATE__|DATA_ENCRYPTION_KEY=$(openssl rand -hex 32)|" backend/.env
  echo "Created backend/.env with generated secrets."
fi

# PostgreSQL: the password lives in deploy/postgres.env (read by the database
# containers only); the backend gets it inside DATABASE_URL.
if [ ! -f deploy/postgres.env ]; then
  echo "POSTGRES_PASSWORD=$(openssl rand -hex 24)" > deploy/postgres.env
  chmod 600 deploy/postgres.env
  echo "Created deploy/postgres.env."
fi
if ! grep -q '^DATABASE_URL=' backend/.env; then
  pg_password=$(sed -n 's/^POSTGRES_PASSWORD=//p' deploy/postgres.env)
  {
    echo ""
    echo "# PostgreSQL (docker-compose.vps.yml service vynor-postgres)"
    echo "DATABASE_URL=postgres://vynor:${pg_password}@vynor-postgres:5432/vynor"
  } >> backend/.env
  echo "Added DATABASE_URL to backend/.env."
fi

echo "Next: set the provider keys in the admin portal (Provider Keys) and PAYHERE_* in backend/.env."
