#!/usr/bin/env bash
# Setzt PUBLIC_URL in .env (für Magic Links, Cookie-Secure-Flag, Origin-Prüfung) und startet die API neu.
# Beispiel: scripts/set-public-url.sh https://bahnping.treudler.net
set -euo pipefail
cd "$(dirname "$0")/.."
URL="${1:?Aufruf: scripts/set-public-url.sh <url>}"
sed -i "s#^PUBLIC_URL=.*#PUBLIC_URL=$URL#" .env
scripts/dev-down.sh --api-only
ROOT="$PWD"
cd apps/api
setsid nohup pnpm start > "$ROOT/.run/api.log" 2>&1 < /dev/null &
echo $! > "$ROOT/.run/api.pid"
cd "$ROOT"
for i in $(seq 1 60); do
  curl -fsS http://127.0.0.1:4100/api/health >/dev/null 2>&1 && { echo "API neu gestartet mit PUBLIC_URL=$URL"; exit 0; }
  sleep 1
done
echo "API nicht erreichbar, siehe .run/api.log"; exit 1
