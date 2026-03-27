#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PID_DIR="$ROOT_DIR/pids"
NODE_NAME="${1:-}"

if [ -z "$NODE_NAME" ]; then
  echo "Usage: bash scripts/stop-node.sh node-1|node-2|node-3"
  exit 1
fi

PID_FILE="$PID_DIR/${NODE_NAME}.pid"
if [ ! -f "$PID_FILE" ]; then
  echo "No PID file found for $NODE_NAME at $PID_FILE"
  echo "Start services with scripts/start.sh so PID files are created."
  exit 1
fi

PID="$(cat "$PID_FILE")"
if kill -0 "$PID" 2>/dev/null; then
  kill "$PID"
  echo "Stopped $NODE_NAME (PID: $PID)"
else
  echo "$NODE_NAME process is not running (PID: $PID)"
fi

rm -f "$PID_FILE"
