#!/usr/bin/env bash
# Stoppt die API (ganze Prozessgruppe) und mit Ausnahme von --api-only auch Postgres+Mailpit.
set -uo pipefail
cd "$(dirname "$0")/.."
if [ -f .run/api.pid ]; then
  PID="$(cat .run/api.pid)"
  kill -- -"$PID" 2>/dev/null || kill "$PID" 2>/dev/null || true
  rm -f .run/api.pid
fi
# Fallback: Prozess beenden, der noch auf dem API-Port lauscht
PORT="$(grep -E '^PORT=' .env 2>/dev/null | cut -d= -f2)"; PORT="${PORT:-4100}"
LPID="$(ss -ltnpH "sport = :$PORT" 2>/dev/null | grep -oP 'pid=\K[0-9]+' | head -1)"
[ -n "$LPID" ] && kill "$LPID" 2>/dev/null || true
for i in $(seq 1 10); do ss -ltnH "sport = :$PORT" | grep -q . || break; sleep 0.5; done
[ "${1:-}" = "--api-only" ] || docker compose -f infra/dev/compose.yml stop
exit 0
