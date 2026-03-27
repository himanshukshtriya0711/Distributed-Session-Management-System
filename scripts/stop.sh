#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PID_DIR="$ROOT_DIR/pids"

stop_pid_file() {
  local pid_file="$1"
  if [ -f "$pid_file" ]; then
    local pid
    pid=$(cat "$pid_file")
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid"
      echo "Stopped process $pid"
    fi
    rm -f "$pid_file"
  fi
}

echo "Stopping Phase 10 services..."
if [ -d "$PID_DIR" ]; then
  shopt -s nullglob
  for pid_file in "$PID_DIR"/*.pid; do
    stop_pid_file "$pid_file"
  done
  shopt -u nullglob
fi

echo "Done."
