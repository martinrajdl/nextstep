#!/bin/sh
# Finds Node either from your normal PATH or the Codex desktop runtime.
set -eu
cd "$(dirname "$0")/.."
if command -v node >/dev/null 2>&1; then
  NEXTSTEP_NODE="$(command -v node)"
else
  NEXTSTEP_NODE="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"
fi
if [ ! -x "$NEXTSTEP_NODE" ]; then
  echo 'Node.js 22.13 or newer is required.'
  exit 1
fi
exec "$NEXTSTEP_NODE" scripts/background.mjs "${1:-start}"
