#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PID_DIR="$ROOT_DIR/pids"
LOG_DIR="$ROOT_DIR/logs"
REDIS_URL="${REDIS_URL:-redis://localhost:6379}"

mkdir -p "$PID_DIR"
mkdir -p "$LOG_DIR"

check_redis() {
	if command -v redis-cli >/dev/null 2>&1; then
		if redis-cli -u "$REDIS_URL" ping >/dev/null 2>&1; then
			echo "Redis is reachable at $REDIS_URL"
			return
		fi

		echo "Redis is not reachable at $REDIS_URL"
		echo "Please start Redis and run scripts/start.sh again."
		exit 1
	fi

	echo "redis-cli not found. Skipping Redis health check."
	echo "Ensure Redis is running at $REDIS_URL before testing sessions."
}

start_backend_node() {
	local port="$1"
	local node_name="$2"

	cd "$ROOT_DIR/backend"
	PORT="$port" NODE_NAME="$node_name" npm run dev >"$LOG_DIR/${node_name}.log" 2>&1 &
	local pid=$!
	echo "$pid" > "$PID_DIR/${node_name}.pid"
	echo "Started $node_name on port $port (PID: $pid)"
}

start_load_balancer() {
	cd "$ROOT_DIR/backend"
	npm run dev:lb >"$LOG_DIR/load-balancer.log" 2>&1 &
	local pid=$!
	echo "$pid" > "$PID_DIR/load-balancer.pid"
	echo "Started load balancer on port 3000 (PID: $pid)"
}

start_frontend() {
	cd "$ROOT_DIR/frontend"
	npm run dev -- --host >"$LOG_DIR/frontend.log" 2>&1 &
	local pid=$!
	echo "$pid" > "$PID_DIR/frontend.pid"
	echo "Started frontend dev server on port 5173 (PID: $pid)"
}

echo "Starting Phase 10 services (Redis + 3 backend nodes + load balancer + frontend)..."
check_redis
start_backend_node 3001 node-1
start_backend_node 3002 node-2
start_backend_node 3003 node-3
start_load_balancer
start_frontend

echo "Phase 10 services started."
echo "Load balancer: http://localhost:3000"
echo "Backend node-1: http://localhost:3001"
echo "Backend node-2: http://localhost:3002"
echo "Backend node-3: http://localhost:3003"
echo "Frontend: http://localhost:5173"
echo "Logs directory: $LOG_DIR"
