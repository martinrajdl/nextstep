#!/bin/sh
set -eu
NEXTSTEP_SCRIPT_DIR="$(CDPATH= cd "$(dirname "$0")" && pwd)"
if command -v node >/dev/null 2>&1; then
  NEXTSTEP_NODE="$(command -v node)"
else
  NEXTSTEP_NODE="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"
fi
if [ ! -x "$NEXTSTEP_NODE" ]; then
  echo 'Node.js 22.13 or newer is required.' >&2
  exit 1
fi
exec "$NEXTSTEP_NODE" "$NEXTSTEP_SCRIPT_DIR/job-finder.mjs" "$@"
