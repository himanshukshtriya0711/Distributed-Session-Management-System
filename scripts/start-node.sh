#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PID_DIR="$ROOT_DIR/pids"
LOG_DIR="$ROOT_DIR/logs"
NODE_NAME="${1:-}"

if [ -z "$NODE_NAME" ]; then
  echo "Usage: bash scripts/start-node.sh node-1|node-2|node-3"
  exit 1
fi

case "$NODE_NAME" in
  node-1)
    PORT=3001
    ;;
  node-2)
    PORT=3002
    ;;
  node-3)
    PORT=3003
    ;;
  *)
    echo "Unknown node name: $NODE_NAME"
    echo "Expected one of: node-1, node-2, node-3"
    exit 1
    ;;
esac

mkdir -p "$PID_DIR" "$LOG_DIR"

PID_FILE="$PID_DIR/${NODE_NAME}.pid"
if [ -f "$PID_FILE" ]; then
  OLD_PID="$(cat "$PID_FILE")"
  if kill -0 "$OLD_PID" 2>/dev/null; then
    echo "$NODE_NAME is already running (PID: $OLD_PID)"
    exit 0
  fi
  rm -f "$PID_FILE"
fi

cd "$ROOT_DIR/backend"
PORT="$PORT" NODE_NAME="$NODE_NAME" npm run dev >"$LOG_DIR/${NODE_NAME}.log" 2>&1 &
PID=$!

echo "$PID" > "$PID_FILE"
echo "Started $NODE_NAME on port $PORT (PID: $PID)"
