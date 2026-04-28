# Distributed Session Hub

This project demonstrates distributed session management where user session data is persisted in Redis and can be retrieved by any backend node.

## Architecture (Target)
Client Browser -> Load Balancer -> Multiple Node.js Backend Servers -> Redis Session Store.

## Current Stack
- Frontend: React (Vite)
- Backend: Express (Node.js)
- Session management: express-session + connect-redis
- Session database: Redis.
- Load balancing: Node.js + http-proxy (round-robin + sticky sessions)
- Failover: health-check-driven target filtering + idempotent retry on proxy failure
- Observability: live load balancer metrics endpoint + frontend metrics panels
- Operational alerts: threshold-based SLO indicators and alert severity reporting
- Incident response: status-change timeline and webhook notification workflow
- Automated remediation: target drain/restore controls and failure-threshold auto-drain
- Escalation workflow: active escalation lifecycle with operator acknowledge/resolve
- Escalation SLA and ownership: assignment handoffs and response/resolution SLA breach tracking.

## Phase Status
- Phase 1: React + Express baseline setup
- Phase 2: Redis-backed session management and multi-node backend setup
- Phase 3: Custom load balancer with round-robin and sticky sessions
- Phase 4: Failover handling and frontend session continuity demonstration
- Phase 5: Runtime observability and traffic metrics visualization
- Phase 6: Operational alerting and SLO guardrails
- Phase 7: Incident lifecycle tracking and operational notifications
- Phase 8: Automated remediation and traffic protection controls
- Phase 9: Escalation workflow and operator escalation handling
- Phase 10 (current): Escalation SLA governance and ownership handoff workflow

## Backend API (Phase 2)
Each backend node exposes the same routes:

- POST /login or /api/login
   - Body: { "username": "alice" }
   - Creates session in Redis
- GET /dashboard or /api/dashboard
   - Requires active session
   - Returns user, session id, request count, and serving node
- GET /session or /api/session
   - Returns current session state
- POST /logout or /api/logout
   - Destroys the session in Redis
- GET /health
   - Returns node and Redis connection status

## Local Run
1. Ensure Redis is running on redis://localhost:6379.
2. Start Phase 10 services:
    - bash scripts/start.sh
3. Stop all services:
    - bash scripts/stop.sh

Phase 10 start script launches:
- Load balancer on port 3000
- Backend node-1 on port 3001
- Backend node-2 on port 3002
- Backend node-3 on port 3003
- Frontend on port 5173

## Load Balancer Routes
- LB health: GET /lb/health on http://localhost:3000
- LB metrics: GET /lb/metrics on http://localhost:3000
- LB alerts: GET /lb/alerts on http://localhost:3000
- LB incidents: GET /lb/incidents on http://localhost:3000
- LB remediation snapshot: GET /lb/remediation on http://localhost:3000
- LB target drain: POST /lb/remediation/targets/:targetKey/drain
- LB target restore: POST /lb/remediation/targets/:targetKey/restore
- LB escalations: GET /lb/escalations on http://localhost:3000
- LB escalation acknowledge: POST /lb/escalations/:escalationId/acknowledge
- LB escalation resolve: POST /lb/escalations/:escalationId/resolve
- LB escalation assign: POST /lb/escalations/:escalationId/assign
- Proxied backend APIs: use http://localhost:3000/api/*
- Sticky behavior: LB cookie `dsh.lb` pins a client to one node when enabled.
- Round-robin behavior: requests without sticky cookie rotate across healthy nodes.
- Failover behavior: GET/HEAD/OPTIONS requests are retried on another healthy node when proxying fails.

## Observability (Phase 5)
- Live metrics include total requests, active requests, retries, proxy errors, and average latency.
- Per-target metrics include selection counts and proxy-error counts per backend node.
- Dashboard now displays load balancer telemetry alongside session and node-health details.

## Operational Alerts (Phase 6)
- Alert engine evaluates runtime indicators (error rate, retry rate, average latency).
- Alert severities are reported as `ok`, `warning`, `critical`, or `info`.
- Dashboard surfaces active alerts with current value and configured threshold.

## Incident Response Automation (Phase 7)
- Incident engine tracks operational status transitions and stores an in-memory timeline.
- Optional webhook notifications can be enabled with `ALERT_WEBHOOK_URL`.
- Cooldown suppression prevents duplicate notifications using `ALERT_NOTIFICATION_COOLDOWN_SEC`.
- Incident and notification state is exposed by `GET /lb/incidents`.

## Automated Remediation Controls (Phase 8)
- Remediation engine tracks per-target drain state and consecutive proxy failures.
- Targets are auto-drained when `AUTO_DRAIN_FAILURE_THRESHOLD` is reached.
- Auto-drained targets are restored after cooldown when healthy.
- Operators can manually drain/restore targets through `/lb/remediation/targets/:targetKey/*`.
- Full remediation telemetry and action history are exposed by `GET /lb/remediation`.

## Escalation Workflow (Phase 9)
- Escalation policy opens an active escalation when operational status is critical.
- Optional escalation-on-drain behavior can trigger warning escalation on active drains.
- Operators can acknowledge and resolve active escalations via dedicated endpoints.
- Escalation events are injected into the incident timeline for shared visibility.
- Escalation state and history are exposed by `GET /lb/escalations`.

## Escalation SLA and Ownership (Phase 10)
- Active escalations now track ownership and support explicit assignment/handoff actions.
- Response and resolution SLA timers are attached to each escalation at open time.
- SLA breach detection emits incident events and increments breach counters with cooldown protection.
- Operators can assign escalation ownership through `/lb/escalations/:escalationId/assign`.
- Escalation snapshots include owner metadata, SLA due timestamps, and breach counts.

## Frontend Pages
- Home: project architecture and current system status
- Login: session creation through load balancer
- Dashboard: user, session id, serving node, LB strategy, and node health

## Failover Helpers
- Stop one node (simulate crash): bash scripts/stop-node.sh node-1
- Start one node again: bash scripts/start-node.sh node-1

## Docs
- Phase 1 architecture: docs/phase-1-architecture.md
- Phase 2 details: docs/phase-2-session-management.md
- Phase 3 details: docs/phase-3-load-balancer.md
- Phase 4 details: docs/phase-4-failover.md
- Phase 5 details: docs/phase-5-observability.md
- Phase 6 details: docs/phase-6-operational-alerts.md
- Phase 7 details: docs/phase-7-incident-response.md
- Phase 8 details: docs/phase-8-automated-remediation.md
- Phase 9 details: docs/phase-9-escalation-workflow.md
- Phase 10 details: docs/phase-10-escalation-sla-ownership.md
