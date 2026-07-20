#!/usr/bin/env bash
# Vendor Node 24.x darwin-arm64 as a Tauri externalBin sidecar.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BIN_DIR="$ROOT/src-tauri/binaries"
mkdir -p "$BIN_DIR"
TARGET="${1:-aarch64-apple-darwin}"
OUT="$BIN_DIR/node-$TARGET"

if [[ -x "$OUT" ]]; then
  echo "Already present: $OUT"
  "$OUT" -v
  exit 0
fi

# Latest 24.x at time of writing; bump patch as needed.
NODE_VERSION="${NODE_VERSION:-24.4.1}"
ARCH="arm64"
if [[ "$TARGET" != "aarch64-apple-darwin" ]]; then
  echo "Only aarch64-apple-darwin is supported in this script (ticket 10 hard gate)." >&2
  exit 1
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
URL="https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-darwin-${ARCH}.tar.gz"
echo "Downloading $URL"
curl -fsSL "$URL" -o "$TMP/node.tgz"
tar -xzf "$TMP/node.tgz" -C "$TMP"
cp "$TMP/node-v${NODE_VERSION}-darwin-${ARCH}/bin/node" "$OUT"
chmod +x "$OUT"
echo "Wrote $OUT"
"$OUT" -v
