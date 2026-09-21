#!/bin/sh
set -eu
cd "$(dirname "$0")"
./scripts/run.sh start
open http://127.0.0.1:4317
