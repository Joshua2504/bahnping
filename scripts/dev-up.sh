#!/usr/bin/env bash
# Startet die Testversion: Postgres+Mailpit (Docker), baut Web, startet API (Port aus .env) im Hintergrund.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$PWD"
mkdir -p .run
[ -f .env ] || cp .env.example .env
PORT="$(grep -E '^PORT=' .env | cut -d= -f2)"; PORT="${PORT:-4100}"
docker compose -f infra/dev/compose.yml up -d --wait
pnpm --filter @bahn/shared build
pnpm --filter @bahn/web build
scripts/dev-down.sh --api-only
cd apps/api
setsid nohup pnpm start > "$ROOT/.run/api.log" 2>&1 < /dev/null &
echo $! > "$ROOT/.run/api.pid"
cd "$ROOT"
for i in $(seq 1 90); do
  if curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then
    echo "API läuft auf Port $PORT (Mailpit unter /mailpit)"; exit 0
  fi
  sleep 1
done
echo "API nicht erreichbar, siehe .run/api.log"; tail -30 .run/api.log; exit 1
