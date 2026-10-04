#!/usr/bin/env bash
# Baut die Companion-CLI (tools/cli) als statische Single-Binaries für macOS/Linux,
# amd64/arm64, nach .run/dist/ (wird später unter /dl/ ausgeliefert).
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$PWD"
CLI_DIR="$ROOT/tools/cli"
DIST_DIR="$ROOT/.run/dist"

mkdir -p "$DIST_DIR"

VERSION="$(git describe --tags --always --dirty 2>/dev/null || echo dev)"
echo "Baue bahnping $VERSION ..."
# Für "bahnping update": Server liefert /dl/VERSION, die CLI vergleicht mit ihrer eigenen.
printf '%s\n' "$VERSION" > "$DIST_DIR/VERSION"

cd "$CLI_DIR"
go vet ./...
go test ./...

build() {
  local goos="$1" goarch="$2" out="$3"
  echo "  -> $out"
  CGO_ENABLED=0 GOOS="$goos" GOARCH="$goarch" go build \
    -trimpath \
    -ldflags "-s -w -X main.version=$VERSION" \
    -o "$DIST_DIR/$out" \
    ./cmd/bahnping
}

build darwin arm64 bahnping-darwin-arm64
build darwin amd64 bahnping-darwin-amd64
build linux  amd64 bahnping-linux-amd64
build linux  arm64 bahnping-linux-arm64

cd "$ROOT"
echo "Fertig: $DIST_DIR"
ls -la "$DIST_DIR"
