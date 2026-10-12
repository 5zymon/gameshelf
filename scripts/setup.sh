#!/usr/bin/env bash
# One-command local setup for GameShelf. Idempotent — safe to re-run.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "==> 1/6 Installing dependencies"
npm install

echo "==> 2/6 Creating .env (only if missing)"
if [ ! -f .env ]; then
  cp .env.example .env
  if grep -q '^SESSION_SECRET=change-me' .env; then
    secret="$(node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))")"
    tmp="$(mktemp)"; sed "s|^SESSION_SECRET=.*|SESSION_SECRET=${secret}|" .env > "$tmp" && mv "$tmp" .env
    echo "    Generated a random SESSION_SECRET."
  fi
else
  echo "    .env already exists — leaving it untouched."
fi

echo "==> 3/6 Starting MySQL"
docker compose up -d mysql

echo "==> 4/6 Waiting for MySQL to become healthy"
for _ in $(seq 1 60); do
  m="$(docker compose ps --format '{{.Health}}' mysql 2>/dev/null || echo starting)"
  [ "$m" = "healthy" ] && { echo "    MySQL healthy."; break; }
  sleep 2
done

m="$(docker compose ps --format '{{.Health}}' mysql 2>/dev/null || echo starting)"
if [ "$m" != "healthy" ]; then
  echo "ERROR: MySQL did not become healthy within 120s." >&2
  echo "  MySQL: $m" >&2
  exit 1
fi

echo "==> 5/6 Applying committed migrations (prisma migrate deploy)"
npm run db:deploy

echo "==> 6/6 Generating Prisma client"
npm run db:generate

echo; echo "Setup complete. Start the app with:  npm run dev"
