import { useEffect, useMemo, useState } from "react"
import "./App.css"

const API_BASE = (import.meta.env.VITE_API_BASE_URL || "").trim()

const ROUTES = [
  { id: "/home", label: "⌂ Home" },
  { id: "/login", label: "⚡ Login" },
  { id: "/dashboard", label: "◉ Dashboard" },
]

function normalizeRoute(hashValue) {
  const raw = (hashValue || "").replace(/^#/, "")
  return ROUTES.some((route) => route.id === raw) ? raw : "/home"
}

function readJsonSafe(response) {
  return response
    .text()
    .then((text) => {
      if (!text) {
        return null
      }

      try {
        return JSON.parse(text)
      } catch {
        return null
      }
    })
}

async function apiRequest(path, options = {}) {
  const requestUrl = API_BASE ? `${API_BASE}${path}` : path
  const response = await fetch(requestUrl, {
    credentials: "include",
    ...options,
  })

  const payload = await readJsonSafe(response)
  if (!response.ok) {
    throw new Error(payload?.message || `Request failed (${response.status})`)
  }

  return {
    payload,
    response,
  }
}

/* ===== SVG Chart Components ===== */

function DonutChart({ segments, size = 140, strokeWidth = 14, centerLabel, centerSub }) {
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const total = segments.reduce((sum, s) => sum + s.value, 0) || 1

  let offset = 0

  return (
    <div className="donut-chart-wrapper">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {/* Background ring */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="rgba(148,163,184,0.08)"
          strokeWidth={strokeWidth}
        />
        {segments.map((seg, i) => {
          const segLen = (seg.value / total) * circumference
          const dashOffset = circumference - offset
          offset += segLen
          return (
            <circle
              key={i}
              className="donut-segment"
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke={seg.color}
              strokeWidth={strokeWidth}
              strokeDasharray={`${segLen} ${circumference - segLen}`}
              strokeDashoffset={dashOffset}
              strokeLinecap="round"
              transform={`rotate(-90 ${size / 2} ${size / 2})`}
              style={{ filter: `drop-shadow(0 0 4px ${seg.color}40)` }}
            />
          )
        })}
      </svg>
      <div className="donut-center-label">
        <span className="donut-value">{centerLabel}</span>
        <span className="donut-sub">{centerSub}</span>
      </div>
    </div>
  )
}

function BarChart({ data, maxHeight = 120 }) {
  const maxVal = Math.max(...data.map((d) => d.value), 1)

  return (
    <div className="bar-chart" style={{ height: maxHeight + 30 }}>
      {data.map((item, i) => (
        <div className="bar-column" key={i}>
          <span className="bar-value">{item.value}</span>
          <div
            className="bar-fill"
            style={{
              height: `${(item.value / maxVal) * maxHeight}px`,
              background: item.color || "var(--accent-cyan)",
            }}
          />
          <span className="bar-label">{item.label}</span>
        </div>
      ))}
    </div>
  )
}

function GaugeChart({ value, max, size = 130, label, color = "var(--accent-cyan)" }) {
  const pct = Math.min(value / (max || 1), 1)
  const radius = (size - 16) / 2
  const circumference = Math.PI * radius
  const dash = pct * circumference

  return (
    <div className="gauge-wrapper">
      <svg width={size} height={size / 2 + 10} viewBox={`0 0 ${size} ${size / 2 + 10}`}>
        {/* Background arc */}
        <path
          d={`M 8,${size / 2} A ${radius},${radius} 0 0 1 ${size - 8},${size / 2}`}
          fill="none"
          stroke="rgba(148,163,184,0.08)"
          strokeWidth="10"
          strokeLinecap="round"
        />
        {/* Value arc */}
        <path
          d={`M 8,${size / 2} A ${radius},${radius} 0 0 1 ${size - 8},${size / 2}`}
          fill="none"
          stroke={color}
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circumference}`}
          style={{ filter: `drop-shadow(0 0 6px ${color}60)`, transition: "stroke-dasharray 1s ease" }}
        />
        <text x={size / 2} y={size / 2 - 2} textAnchor="middle" fill="var(--text-primary)" fontSize="18" fontWeight="700" fontFamily="Inter">
          {typeof value === "number" ? value.toFixed(1) : value}
        </text>
        <text x={size / 2} y={size / 2 + 12} textAnchor="middle" fill="var(--text-muted)" fontSize="9" fontFamily="Inter" textTransform="uppercase">
          {label}
        </text>
      </svg>
    </div>
  )
}

function StatCard({ icon, value, label, color = "cyan" }) {
  return (
    <div className={`stat-card ${color}`}>
      <div className="stat-icon">{icon}</div>
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  )
}

/* ===== Main Application ===== */

function App() {
  const [route, setRoute] = useState(() => normalizeRoute(window.location.hash))
  const [username, setUsername] = useState("")
  const [message, setMessage] = useState("⚡ System Ready")
  const [messageTone, setMessageTone] = useState("neutral")
  const [loading, setLoading] = useState(false)
  const [escalationOwnerInput, setEscalationOwnerInput] = useState("")

  const [sessionInfo, setSessionInfo] = useState(null)
  const [dashboardInfo, setDashboardInfo] = useState(null)
  const [lbHealth, setLbHealth] = useState(null)
  const [lbMetrics, setLbMetrics] = useState(null)
  const [lbAlerts, setLbAlerts] = useState(null)
  const [lbIncidents, setLbIncidents] = useState(null)
  const [lbRemediation, setLbRemediation] = useState(null)
  const [lbEscalations, setLbEscalations] = useState(null)

  const isAuthenticated = useMemo(
    () => Boolean(sessionInfo && sessionInfo.hasSession),
    [sessionInfo],
  )
  const activeAlertCount = useMemo(
    () => (lbAlerts?.alerts || []).filter((alert) => alert.active).length,
    [lbAlerts],
  )
  const recentIncidentCount = useMemo(
    () => (lbIncidents?.history || []).length,
    [lbIncidents],
  )
  const activeDrainCount = useMemo(
    () => (lbRemediation?.targets || []).filter((target) => target.drained).length,
    [lbRemediation],
  )
  const activeEscalation = useMemo(
    () => lbEscalations?.active || null,
    [lbEscalations],
  )

  useEffect(() => {
    setEscalationOwnerInput(activeEscalation?.owner || "")
  }, [activeEscalation?.id, activeEscalation?.owner])

  useEffect(() => {
    const onHashChange = () => {
      setRoute(normalizeRoute(window.location.hash))
    }

    window.addEventListener("hashchange", onHashChange)
    if (!window.location.hash) {
      window.location.hash = "/home"
    }

    return () => {
      window.removeEventListener("hashchange", onHashChange)
    }
  }, [])

  useEffect(() => {
    const intervalId = setInterval(() => {
      refreshLoadBalancerTelemetry().catch(() => {
        // Keep UI responsive without noisy interval errors.
      })
    }, 8000)

    refreshLoadBalancerTelemetry().catch(() => {
      // Initial load can fail while services start.
    })

    return () => clearInterval(intervalId)
  }, [])

  useEffect(() => {
    loadSession().catch(() => {
      // Session load can fail if backend is restarting.
    })
  }, [])

  async function refreshLoadBalancerTelemetry() {
    const [healthResult, metricsResult, alertsResult, incidentsResult, remediationResult, escalationsResult] = await Promise.all([
      apiRequest("/lb/health"),
      apiRequest("/lb/metrics"),
      apiRequest("/lb/alerts"),
      apiRequest("/lb/incidents"),
      apiRequest("/lb/remediation"),
      apiRequest("/lb/escalations"),
    ])

    setLbHealth(healthResult.payload)
    setLbMetrics(metricsResult.payload?.metrics || null)
    setLbAlerts(alertsResult.payload?.operational || null)
    setLbIncidents(incidentsResult.payload?.incidents || null)
    setLbRemediation(remediationResult.payload?.remediation || null)
    setLbEscalations(escalationsResult.payload?.escalations || null)

    return {
      health: healthResult.payload,
      metrics: metricsResult.payload?.metrics || null,
      alerts: alertsResult.payload?.operational || null,
      incidents: incidentsResult.payload?.incidents || null,
      remediation: remediationResult.payload?.remediation || null,
      escalations: escalationsResult.payload?.escalations || null,
    }
  }

  async function loadSession() {
    const result = await apiRequest("/api/session")
    setSessionInfo(result.payload)
    return result.payload
  }

  function resetUserSessionState() {
    setSessionInfo(null)
    setDashboardInfo(null)
  }

  async function refreshDashboard() {
    setLoading(true)
    try {
      const [dashboardResult, telemetry] = await Promise.all([
        apiRequest("/api/dashboard"),
        refreshLoadBalancerTelemetry(),
      ])

      setDashboardInfo({
        ...dashboardResult.payload,
        loadBalancerTarget:
          dashboardResult.response.headers.get("x-load-balancer-target") || "unknown",
        loadBalancerStrategy:
          dashboardResult.response.headers.get("x-load-balancer-strategy") || "unknown",
      })
      setLbHealth(telemetry.health)
      setLbMetrics(telemetry.metrics)
      setLbAlerts(telemetry.alerts)
      setLbIncidents(telemetry.incidents)
      setLbRemediation(telemetry.remediation)
      setLbEscalations(telemetry.escalations)

      const sessionState = await loadSession()
      setMessage(
        `✓ Dashboard refreshed from ${dashboardResult.response.headers.get("x-load-balancer-target") || "unknown"}. Session active: ${sessionState?.hasSession ? "yes" : "no"}`,
      )
      setMessageTone("success")
    } catch (error) {
      setMessage(error.message)
      setMessageTone("error")
    } finally {
      setLoading(false)
    }
  }

  async function handleLogin(event) {
    event.preventDefault()

    const trimmed = username.trim()
    if (!trimmed) {
      setMessage("Username is required")
      setMessageTone("error")
      return
    }

    setLoading(true)
    try {
      await apiRequest("/api/login", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ username: trimmed }),
      })

      setUsername("")
      resetUserSessionState()
      await loadSession()
      await refreshDashboard()
      setMessage("✓ Login successful. New session created and loaded from Redis.")
      setMessageTone("success")
      window.location.hash = "/dashboard"
    } catch (error) {
      setMessage(error.message)
      setMessageTone("error")
    } finally {
      setLoading(false)
    }
  }

  async function handleLogout() {
    setLoading(true)
    try {
      await apiRequest("/api/logout", {
        method: "POST",
      })

      resetUserSessionState()
      setLbEscalations(null)
      setEscalationOwnerInput("")
      setMessage("Session destroyed. You are logged out.")
      setMessageTone("neutral")
      window.location.hash = "/login"
    } catch (error) {
      setMessage(error.message)
      setMessageTone("error")
    } finally {
      setLoading(false)
    }
  }

  async function updateTargetRemediation(targetKey, action) {
    setLoading(true)

    try {
      await apiRequest(`/lb/remediation/targets/${encodeURIComponent(targetKey)}/${action}`, {
        method: "POST",
      })

      const telemetry = await refreshLoadBalancerTelemetry()
      setLbRemediation(telemetry.remediation)

      setMessage(
        `✓ Target ${targetKey} ${action === "drain" ? "drained" : "restored"} successfully.`,
      )
      setMessageTone("success")
    } catch (error) {
      setMessage(error.message)
      setMessageTone("error")
    } finally {
      setLoading(false)
    }
  }

  async function updateEscalationAction(escalationId, action) {
    setLoading(true)

    try {
      await apiRequest(`/lb/escalations/${encodeURIComponent(escalationId)}/${action}`, {
        method: "POST",
      })

      const telemetry = await refreshLoadBalancerTelemetry()
      setLbEscalations(telemetry.escalations)

      setMessage(
        `✓ Escalation ${escalationId} ${action === "acknowledge" ? "acknowledged" : "resolved"} successfully.`,
      )
      setMessageTone("success")
    } catch (error) {
      setMessage(error.message)
      setMessageTone("error")
    } finally {
      setLoading(false)
    }
  }

  async function assignEscalationOwner(escalationId) {
    const owner = escalationOwnerInput.trim()
    if (!owner) {
      setMessage("Owner is required before assignment.")
      setMessageTone("error")
      return
    }

    setLoading(true)

    try {
      await apiRequest(`/lb/escalations/${encodeURIComponent(escalationId)}/assign`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ owner }),
      })

      const telemetry = await refreshLoadBalancerTelemetry()
      setLbEscalations(telemetry.escalations)

      setMessage(`✓ Escalation ${escalationId} assigned to ${owner}.`)
      setMessageTone("success")
    } catch (error) {
      setMessage(error.message)
      setMessageTone("error")
    } finally {
      setLoading(false)
    }
  }

  function formatAlertMetric(alert) {
    if (!alert) {
      return "n/a"
    }

    if (alert.unit === "ms") {
      return `${Number(alert.value || 0).toFixed(2)} ms`
    }

    if (alert.unit === "targets") {
      return `${Number(alert.value || 0).toFixed(0)} target(s)`
    }

    return `${(Number(alert.value || 0) * 100).toFixed(2)}%`
  }

  function formatAlertThreshold(alert) {
    if (!alert) {
      return "n/a"
    }

    if (alert.unit === "ms") {
      return `${Number(alert.threshold || 0).toFixed(0)} ms`
    }

    if (alert.unit === "targets") {
      return `${Number(alert.threshold || 0).toFixed(0)} target(s)`
    }

    return `${(Number(alert.threshold || 0) * 100).toFixed(0)}%`
  }

  function formatTimestamp(rawValue) {
    if (!rawValue) {
      return "n/a"
    }

    const parsed = new Date(rawValue)
    if (Number.isNaN(parsed.getTime())) {
      return String(rawValue)
    }

    return parsed.toLocaleString()
  }

  function summarizeIncident(incident) {
    if (!incident) {
      return ""
    }

    if (incident.message) {
      return incident.message
    }

    if (incident.type === "status-change") {
      return `Status changed to ${incident.currentStatus || "unknown"}`
    }

    if (incident.type === "notification-sent") {
      return `Notification sent with status ${incident.statusCode || "unknown"}`
    }

    if (incident.type === "notification-failed") {
      return "Notification delivery failed"
    }

    if (incident.type === "notification-suppressed") {
      return "Notification suppressed by cooldown"
    }

    if (incident.type === "escalation-opened") {
      return `Escalation opened (${incident.escalationId || "unknown"})`
    }

    if (incident.type === "escalation-acknowledged") {
      return `Escalation acknowledged (${incident.escalationId || "unknown"})`
    }

    if (incident.type === "escalation-resolved") {
      return `Escalation resolved (${incident.escalationId || "unknown"})`
    }

    if (incident.type === "escalation-assigned") {
      return `Escalation assigned (${incident.escalationId || "unknown"})`
    }

    if (incident.type === "escalation-sla-breached") {
      return `Escalation SLA breached (${incident.slaType || "unknown"})`
    }

    return "Incident event captured"
  }

  function summarizeRemediationEvent(event) {
    if (!event) {
      return ""
    }

    if (event.message) {
      return event.message
    }

    return `${event.type} event for ${event.targetKey || "target"}`
  }

  function summarizeEscalationEvent(event) {
    if (!event) {
      return ""
    }

    if (event.message) {
      return event.message
    }

    return `${event.id || "escalation"} is ${event.status || "unknown"}`
  }

  /* ===== Helper: Build chart data from live state ===== */

  function buildTargetBarData() {
    const targets = lbMetrics?.perTarget || []
    const colors = ["#00d4ff", "#a855f7", "#10b981", "#f59e0b", "#ec4899", "#3b82f6"]
    return targets.map((t, i) => ({
      label: t.key,
      value: t.selected || 0,
      color: colors[i % colors.length],
    }))
  }

  function buildHealthDonut() {
    const targets = lbHealth?.targets || []
    const healthy = targets.filter((t) => t.healthy).length
    const down = targets.length - healthy
    return {
      segments: [
        { value: healthy, color: "#10b981" },
        { value: down, color: "#f43f5e" },
      ],
      centerLabel: `${healthy}/${targets.length}`,
      centerSub: "Healthy",
    }
  }

  function buildAlertDonut() {
    const alerts = lbAlerts?.alerts || []
    const crit = alerts.filter((a) => a.severity === "critical").length
    const warn = alerts.filter((a) => a.severity === "warning").length
    const ok = alerts.length - crit - warn
    return {
      segments: [
        { value: ok || 0, color: "#00d4ff" },
        { value: warn, color: "#f59e0b" },
        { value: crit, color: "#f43f5e" },
      ],
      centerLabel: alerts.length,
      centerSub: "Alerts",
    }
  }

  /* ===== Renderers ===== */

  function renderHome() {
    const healthDonut = buildHealthDonut()
    const targetBars = buildTargetBarData()
    const totalReqs = lbMetrics?.totalRequests ?? 0
    const avgLatency = lbMetrics?.averageLatencyMs ?? 0

    return (
      <section className="content-card">
        <h2>Distributed Session Management System</h2>
        <p>
          This demo routes client requests through a custom load balancer and keeps
          session state in Redis so any backend node can serve authenticated traffic.
        </p>
        <p className="arch-line">
          Client Browser → Load Balancer → Node Pool → Redis Session Store
        </p>

        {/* Stats Row */}
        <div className="stats-row">
          <StatCard icon="🌐" value={API_BASE || "localhost"} label="Load Balancer" color="cyan" />
          <StatCard icon="🔒" value={isAuthenticated ? "Active" : "Inactive"} label="Session" color={isAuthenticated ? "green" : "amber"} />
          <StatCard icon="📊" value={totalReqs} label="Total Requests" color="purple" />
          <StatCard icon="⚡" value={`${avgLatency} ms`} label="Avg Latency" color="blue" />
          <StatCard icon="🛡️" value={lbAlerts?.status || "unknown"} label="Op Status" color={lbAlerts?.status === "healthy" ? "green" : "amber"} />
          <StatCard icon="🔧" value={lbRemediation?.enabled ? "Enabled" : "Disabled"} label="Remediation" color="cyan" />
        </div>

        {/* Charts */}
        <div className="charts-grid">
          <div className="chart-card">
            <h4>Node Health</h4>
            <div className="chart-container">
              <DonutChart
                segments={healthDonut.segments}
                centerLabel={healthDonut.centerLabel}
                centerSub={healthDonut.centerSub}
                size={150}
                strokeWidth={16}
              />
            </div>
            <div className="chart-legend">
              <span className="legend-item"><span className="legend-dot" style={{ background: "#10b981" }} /> Healthy</span>
              <span className="legend-item"><span className="legend-dot" style={{ background: "#f43f5e" }} /> Down</span>
            </div>
          </div>

          {targetBars.length > 0 && (
            <div className="chart-card">
              <h4>Traffic Distribution</h4>
              <BarChart data={targetBars} maxHeight={110} />
            </div>
          )}

          <div className="chart-card">
            <h4>System Performance</h4>
            <div className="chart-container">
              <GaugeChart
                value={avgLatency}
                max={Math.max(avgLatency * 2, 200)}
                label="Latency (ms)"
                color={avgLatency > 100 ? "#f59e0b" : "#00d4ff"}
                size={140}
              />
            </div>
            <div style={{ textAlign: "center", marginTop: 8 }}>
              <span className="meta-text">Retries: {lbMetrics?.retryAttempts ?? 0} | Active: {lbMetrics?.activeRequests ?? 0}</span>
            </div>
          </div>
        </div>

        {/* Detailed Metrics */}
        <div className="metric-grid">
          <article className="metric">
            <h3>Strategy</h3>
            <p className="metric-value-cyan">{lbHealth?.strategy || "unknown"}</p>
            <p className="meta-text">{lbHealth?.stickySessions ? "Sticky sessions enabled" : "No sticky sessions"}</p>
          </article>
          <article className="metric">
            <h3>Session State</h3>
            <p className={isAuthenticated ? "metric-value-green" : ""}>{isAuthenticated ? "Active" : "No active session"}</p>
            <p className="meta-text">
              ID: {sessionInfo?.sessionId || "not created"}
            </p>
          </article>
          <article className="metric">
            <h3>Active Alerts</h3>
            <p className={activeAlertCount > 0 ? "metric-value-red" : "metric-value-green"}>{activeAlertCount}</p>
            <p className="meta-text">Operational status: {lbAlerts?.status || "unknown"}</p>
          </article>
          <article className="metric">
            <h3>Incident Events</h3>
            <p className="metric-value-amber">{recentIncidentCount}</p>
            <p className="meta-text">Status: {lbIncidents?.status || "unknown"}</p>
          </article>
          <article className="metric">
            <h3>Active Drains</h3>
            <p className={activeDrainCount > 0 ? "metric-value-red" : "metric-value-green"}>{activeDrainCount}</p>
            <p className="meta-text">Remediation: {lbRemediation?.enabled ? "enabled" : "disabled"}</p>
          </article>
          <article className="metric">
            <h3>Escalations</h3>
            <p>{lbEscalations?.enabled ? "enabled" : "disabled"}</p>
            <p className="meta-text">
              Active: {activeEscalation ? `${activeEscalation.id} (${activeEscalation.severity})` : "none"}
            </p>
          </article>
          <article className="metric">
            <h3>SLA Breaches</h3>
            <p className={((lbEscalations?.counters?.responseBreaches ?? 0) + (lbEscalations?.counters?.resolutionBreaches ?? 0)) > 0 ? "metric-value-red" : "metric-value-green"}>
              {(lbEscalations?.counters?.responseBreaches ?? 0) + (lbEscalations?.counters?.resolutionBreaches ?? 0)}
            </p>
            <p className="meta-text">
              response: {lbEscalations?.counters?.responseBreaches ?? 0} | resolution: {lbEscalations?.counters?.resolutionBreaches ?? 0}
            </p>
          </article>
        </div>
      </section>
    )
  }

  function renderLogin() {
    return (
      <section className="content-card narrow-card">
        <h2>⚡ Login</h2>
        <p>Create a distributed session through the load balancer.</p>
        <form className="login-form" onSubmit={handleLogin}>
          <label htmlFor="username">Username</label>
          <input
            id="username"
            name="username"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            placeholder="alice"
            autoComplete="off"
          />
          <button type="submit" disabled={loading}>
            {loading ? "⏳ Signing in..." : "🚀 Login"}
          </button>
        </form>
      </section>
    )
  }

  function renderDashboard() {
    if (!isAuthenticated) {
      return (
        <section className="content-card narrow-card">
          <h2>Dashboard</h2>
          <p>No active session. Please login first.</p>
          <button
            type="button"
            onClick={() => {
              window.location.hash = "/login"
            }}
          >
            Go to Login
          </button>
        </section>
      )
    }

    const healthDonut = buildHealthDonut()
    const alertDonut = buildAlertDonut()
    const targetBars = buildTargetBarData()

    return (
      <section className="content-card">
        <div className="dashboard-head">
          <h2>◉ Dashboard</h2>
          <div className="action-row">
            <button type="button" onClick={refreshDashboard} disabled={loading}>
              {loading ? "⏳ Refreshing..." : "🔄 Refresh"}
            </button>
            <button type="button" className="ghost-button" onClick={handleLogout}>
              ⏏ Logout
            </button>
          </div>
        </div>

        {/* === Personal Section === */}
        <div className="dashboard-section personal-section">
          <h3 className="section-title">User Session Info</h3>
          <p className="meta-text section-intro">
            Your current logged-in session details.
          </p>

        <div className="metric-grid metrics-grid-tight">
          <article className="metric">
            <h3>User</h3>
            <p className="metric-value-cyan">{dashboardInfo?.user?.username || sessionInfo?.user?.username || "unknown"}</p>
            <p className="meta-text">Login node: {dashboardInfo?.loginNode || sessionInfo?.loginNode || "unknown"}</p>
          </article>
          <article className="metric">
            <h3>Session</h3>
            <p>{dashboardInfo?.sessionId || sessionInfo?.sessionId || "unknown"}</p>
            <p className="meta-text">Requests in session: {dashboardInfo?.requestCount ?? sessionInfo?.requestCount ?? 0}</p>
          </article>
          <article className="metric">
            <h3>Served By</h3>
            <p className="metric-value-purple">{dashboardInfo?.loadBalancerTarget || "refresh to load"}</p>
            <p className="meta-text">Strategy: {dashboardInfo?.loadBalancerStrategy || "unknown"}</p>
          </article>
        </div>

        </div>

        {/* === Telemetry Section === */}
        <div className="dashboard-section telemetry-section">
          <h3 className="section-title">System Telemetry</h3>
          <p className="meta-text section-intro">
            Real-time metrics across the distributed system.
          </p>

        {/* Charts Row */}
        <div className="charts-grid">
          <div className="chart-card">
            <h4>Node Health Overview</h4>
            <div className="chart-container">
              <DonutChart
                segments={healthDonut.segments}
                centerLabel={healthDonut.centerLabel}
                centerSub={healthDonut.centerSub}
                size={140}
                strokeWidth={14}
              />
            </div>
            <div className="chart-legend">
              <span className="legend-item"><span className="legend-dot" style={{ background: "#10b981" }} /> Healthy</span>
              <span className="legend-item"><span className="legend-dot" style={{ background: "#f43f5e" }} /> Down</span>
            </div>
          </div>

          <div className="chart-card">
            <h4>Alert Severity Breakdown</h4>
            <div className="chart-container">
              <DonutChart
                segments={alertDonut.segments}
                centerLabel={alertDonut.centerLabel}
                centerSub={alertDonut.centerSub}
                size={140}
                strokeWidth={14}
              />
            </div>
            <div className="chart-legend">
              <span className="legend-item"><span className="legend-dot" style={{ background: "#00d4ff" }} /> OK</span>
              <span className="legend-item"><span className="legend-dot" style={{ background: "#f59e0b" }} /> Warning</span>
              <span className="legend-item"><span className="legend-dot" style={{ background: "#f43f5e" }} /> Critical</span>
            </div>
          </div>

          {targetBars.length > 0 && (
            <div className="chart-card">
              <h4>Per-Target Request Distribution</h4>
              <BarChart data={targetBars} maxHeight={110} />
            </div>
          )}
        </div>

        {/* Node Health */}
        <h3 className="section-title">Node Health</h3>
        <div className="node-list">
          {(lbHealth?.targets || []).map((target) => (
            <div className="node-row" key={target.key}>
              <span>
                <span className={`health-dot ${target.healthy ? "healthy" : "down"}`} />
                {target.key}
              </span>
              <span style={{ color: target.healthy ? "var(--accent-green)" : "var(--accent-red)" }}>
                {target.healthy ? "● healthy" : "✕ down"}
              </span>
              <span>{target.url}</span>
            </div>
          ))}
        </div>

        {/* Operational Alerts */}
        <h3 className="section-title">Operational Alerts</h3>
        <div className="alert-list">
          {(lbAlerts?.alerts || []).map((alert) => (
            <article className={`alert-row ${alert.severity}`} key={alert.id}>
              <div className="alert-head">
                <strong>{alert.title}</strong>
                <span className="alert-chip">{alert.severity}</span>
              </div>
              <p className="meta-text">{alert.message}</p>
              <p className="meta-text">
                Value: {formatAlertMetric(alert)} | Threshold: {formatAlertThreshold(alert)}
              </p>
            </article>
          ))}
          {!lbAlerts?.alerts?.length && (
            <article className="alert-row info">
              <div className="alert-head">
                <strong>No alert data</strong>
                <span className="alert-chip">info</span>
              </div>
              <p className="meta-text">Alert telemetry is not available yet.</p>
            </article>
          )}
        </div>
        <p className="meta-text">
          Operational status: {lbAlerts?.status || "unknown"}.
          Minimum samples required: {lbAlerts?.minimumSamples ?? "n/a"}.
        </p>

        {/* Incident Timeline */}
        <h3 className="section-title">Incident Timeline</h3>
        <div className="incident-list">
          {(lbIncidents?.history || []).slice(0, 8).map((incident) => (
            <article className={`incident-row ${incident.severity || "info"}`} key={incident.id}>
              <div className="incident-head">
                <strong>{incident.type}</strong>
                <span className="incident-time">{formatTimestamp(incident.at)}</span>
              </div>
              <p className="meta-text">{summarizeIncident(incident)}</p>
            </article>
          ))}
          {!lbIncidents?.history?.length && (
            <article className="incident-row info">
              <div className="incident-head">
                <strong>no-events</strong>
                <span className="incident-time">n/a</span>
              </div>
              <p className="meta-text">No incident events have been recorded yet.</p>
            </article>
          )}
        </div>

        <div className="metric-grid metrics-grid-tight">
          <article className="metric">
            <h3>Notification Pipeline</h3>
            <p>{lbIncidents?.notification?.webhookConfigured ? "configured" : "disabled"}</p>
            <p className="meta-text">Cooldown: {lbIncidents?.notification?.cooldownSeconds ?? "n/a"} sec</p>
          </article>
          <article className="metric">
            <h3>Notification Counts</h3>
            <p>sent: {lbIncidents?.notification?.sent ?? 0}</p>
            <p className="meta-text">
              failed: {lbIncidents?.notification?.failed ?? 0} | suppressed: {lbIncidents?.notification?.suppressed ?? 0}
            </p>
          </article>
          <article className="metric">
            <h3>Last Delivery</h3>
            <p>{formatTimestamp(lbIncidents?.notification?.lastSentAt)}</p>
            <p className="meta-text">Last error: {lbIncidents?.notification?.lastError || "none"}</p>
          </article>
        </div>

        {/* Remediation Controls */}
        <h3 className="section-title">Remediation Controls</h3>
        <div className="metric-grid metrics-grid-tight">
          <article className="metric">
            <h3>Automation</h3>
            <p className={lbRemediation?.enabled ? "metric-value-green" : ""}>{lbRemediation?.enabled ? "enabled" : "disabled"}</p>
            <p className="meta-text">
              Threshold: {lbRemediation?.thresholds?.autoDrainFailureThreshold ?? "n/a"} failures
            </p>
          </article>
          <article className="metric">
            <h3>Cooldown</h3>
            <p>{lbRemediation?.thresholds?.autoDrainCooldownSec ?? "n/a"} sec</p>
            <p className="meta-text">Active drains: {lbRemediation?.activeDrains ?? 0}</p>
          </article>
          <article className="metric">
            <h3>Action Counts</h3>
            <p>auto drains: {lbRemediation?.actionCounts?.autoDrains ?? 0}</p>
            <p className="meta-text">
              manual drains: {lbRemediation?.actionCounts?.manualDrains ?? 0} | manual restores: {lbRemediation?.actionCounts?.manualRestores ?? 0}
            </p>
          </article>
        </div>

        <div className="remediation-list">
          {(lbRemediation?.targets || []).map((target) => (
            <article className={`remediation-row ${target.drained ? "drained" : "routable"}`} key={`${target.key}-remediation`}>
              <div className="remediation-main">
                <strong>{target.key}</strong>
                <p className="meta-text">
                  Health: {target.healthy ? "healthy" : "down"} | Routable: {target.routable ? "yes" : "no"}
                </p>
                <p className="meta-text">
                  Failures: {target.consecutiveProxyFailures ?? 0} | Auto drain until: {formatTimestamp(target.autoDrainUntil)}
                </p>
                <p className="meta-text">Reason: {target.drainReason || "n/a"}</p>
              </div>
              <div className="remediation-actions">
                <button
                  type="button"
                  className={target.drained ? "ghost-button" : "danger-button"}
                  onClick={() => {
                    updateTargetRemediation(target.key, target.drained ? "restore" : "drain")
                  }}
                  disabled={loading}
                >
                  {target.drained ? "↻ Restore" : "⊘ Drain"}
                </button>
              </div>
            </article>
          ))}
          {!lbRemediation?.targets?.length && (
            <article className="remediation-row routable">
              <div className="remediation-main">
                <strong>No remediation data</strong>
                <p className="meta-text">Remediation telemetry is not available yet.</p>
              </div>
            </article>
          )}
        </div>

        {/* Remediation Timeline */}
        <h3 className="section-title">Remediation Timeline</h3>
        <div className="remediation-event-list">
          {(lbRemediation?.history || []).slice(0, 8).map((event) => (
            <article className={`remediation-event-row ${event.severity || "info"}`} key={event.id}>
              <div className="incident-head">
                <strong>{event.type}</strong>
                <span className="incident-time">{formatTimestamp(event.at)}</span>
              </div>
              <p className="meta-text">{summarizeRemediationEvent(event)}</p>
            </article>
          ))}
          {!lbRemediation?.history?.length && (
            <article className="remediation-event-row info">
              <div className="incident-head">
                <strong>no-events</strong>
                <span className="incident-time">n/a</span>
              </div>
              <p className="meta-text">No remediation actions recorded yet.</p>
            </article>
          )}
        </div>

        {/* Escalation Workflow */}
        <h3 className="section-title">Escalation Workflow</h3>
        <div className="metric-grid metrics-grid-tight">
          <article className="metric">
            <h3>Workflow</h3>
            <p>{lbEscalations?.enabled ? "enabled" : "disabled"}</p>
            <p className="meta-text">Cooldown: {lbEscalations?.settings?.escalationCooldownSec ?? "n/a"} sec</p>
            <p className="meta-text">
              Response SLA: {lbEscalations?.settings?.escalationResponseSlaSec ?? "n/a"} sec
            </p>
          </article>
          <article className="metric">
            <h3>Active Escalation</h3>
            <p>{activeEscalation?.id || "none"}</p>
            <p className="meta-text">
              Status: {activeEscalation?.status || "n/a"} | Severity: {activeEscalation?.severity || "n/a"}
            </p>
          </article>
          <article className="metric">
            <h3>Escalation Counts</h3>
            <p>opened: {lbEscalations?.counters?.opened ?? 0}</p>
            <p className="meta-text">
              ack: {lbEscalations?.counters?.acknowledged ?? 0} | resolved: {lbEscalations?.counters?.resolved ?? 0}
            </p>
            <p className="meta-text">
              assignments: {lbEscalations?.counters?.assignments ?? 0} | handoffs: {lbEscalations?.counters?.handoffs ?? 0}
            </p>
          </article>
          <article className="metric">
            <h3>SLA Breaches</h3>
            <p className={((lbEscalations?.counters?.responseBreaches ?? 0) + (lbEscalations?.counters?.resolutionBreaches ?? 0)) > 0 ? "metric-value-red" : "metric-value-green"}>
              {(lbEscalations?.counters?.responseBreaches ?? 0) + (lbEscalations?.counters?.resolutionBreaches ?? 0)}
            </p>
            <p className="meta-text">
              response: {lbEscalations?.counters?.responseBreaches ?? 0} | resolution: {lbEscalations?.counters?.resolutionBreaches ?? 0}
            </p>
          </article>
        </div>

        {activeEscalation ? (
          <article className={`escalation-row ${activeEscalation.severity || "info"}`}>
            <div className="incident-head">
              <strong>{activeEscalation.id}</strong>
              <span className="alert-chip">
                {activeEscalation.status || "open"}
              </span>
            </div>
            <p className="meta-text">{summarizeEscalationEvent(activeEscalation)}</p>
            <p className="meta-text">
              Opened: {formatTimestamp(activeEscalation.openedAt)} | Last evaluated: {formatTimestamp(activeEscalation.lastEvaluatedAt)}
            </p>
            <p className="meta-text">
              Reason: {activeEscalation.reason || "n/a"} | Active drains: {activeEscalation.activeDrains ?? 0}
            </p>
            <p className="meta-text">
              Owner: {activeEscalation.owner || "unassigned"} | Updated: {formatTimestamp(activeEscalation.ownerUpdatedAt)}
            </p>
            <p className="meta-text">
              Response due: {formatTimestamp(activeEscalation.responseDueAt)} | Resolution due: {formatTimestamp(activeEscalation.resolutionDueAt)}
            </p>
            <p className="meta-text">
              Response breaches: {activeEscalation.responseSlaBreachCount ?? 0} | Resolution breaches: {activeEscalation.resolutionSlaBreachCount ?? 0}
            </p>
            <div className="escalation-owner-row">
              <input
                type="text"
                value={escalationOwnerInput}
                onChange={(event) => {
                  setEscalationOwnerInput(event.target.value)
                }}
                placeholder="assign owner (e.g. on-call-1)"
              />
              {activeEscalation.status !== "resolved" && (
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => {
                    assignEscalationOwner(activeEscalation.id)
                  }}
                  disabled={loading}
                >
                  Assign
                </button>
              )}
            </div>
            <div className="escalation-actions">
              {!activeEscalation.acknowledgedAt && activeEscalation.status !== "resolved" && (
                <button
                  type="button"
                  className="warning-button"
                  onClick={() => {
                    updateEscalationAction(activeEscalation.id, "acknowledge")
                  }}
                  disabled={loading}
                >
                  ⚡ Acknowledge
                </button>
              )}
              {activeEscalation.status !== "resolved" && (
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => {
                    updateEscalationAction(activeEscalation.id, "resolve")
                  }}
                  disabled={loading}
                >
                  ✓ Resolve
                </button>
              )}
            </div>
          </article>
        ) : (
          <article className="escalation-row info">
            <div className="incident-head">
              <strong>no-active-escalation</strong>
              <span className="incident-time">n/a</span>
            </div>
            <p className="meta-text">No active escalation is currently open.</p>
          </article>
        )}

        <div className="escalation-event-list">
          {(lbEscalations?.history || []).slice(0, 8).map((event) => (
            <article className={`escalation-event-row ${event.severity || "info"}`} key={event.id}>
              <div className="incident-head">
                <strong>{event.id}</strong>
                <span className="incident-time">{formatTimestamp(event.openedAt)}</span>
              </div>
              <p className="meta-text">{summarizeEscalationEvent(event)}</p>
              <p className="meta-text">
                Status: {event.status || "unknown"} | Resolved: {formatTimestamp(event.resolvedAt)}
              </p>
              <p className="meta-text">
                Owner: {event.owner || "unassigned"} | Response due: {formatTimestamp(event.responseDueAt)}
              </p>
            </article>
          ))}
          {!lbEscalations?.history?.length && (
            <article className="escalation-event-row info">
              <div className="incident-head">
                <strong>no-events</strong>
                <span className="incident-time">n/a</span>
              </div>
              <p className="meta-text">No escalations have been recorded yet.</p>
            </article>
          )}
        </div>

        {/* LB Metrics */}
        <h3 className="section-title">Load Balancer Metrics</h3>

        <div className="charts-grid">
          <div className="chart-card">
            <h4>Latency Gauge</h4>
            <div className="chart-container">
              <GaugeChart
                value={lbMetrics?.averageLatencyMs ?? 0}
                max={Math.max((lbMetrics?.averageLatencyMs ?? 0) * 2, 200)}
                label="Avg Latency (ms)"
                color={(lbMetrics?.averageLatencyMs ?? 0) > 100 ? "#f59e0b" : "#00d4ff"}
                size={150}
              />
            </div>
          </div>

          {targetBars.length > 0 && (
            <div className="chart-card">
              <h4>Target Selection Count</h4>
              <BarChart data={targetBars} maxHeight={100} />
            </div>
          )}

          <div className="chart-card">
            <h4>Error Distribution</h4>
            <div className="chart-container">
              <DonutChart
                segments={[
                  { value: lbMetrics?.completedRequests ?? 1, color: "#10b981" },
                  { value: lbMetrics?.proxyErrors ?? 0, color: "#f43f5e" },
                  { value: lbMetrics?.retryAttempts ?? 0, color: "#f59e0b" },
                ]}
                centerLabel={lbMetrics?.totalRequests ?? 0}
                centerSub="Total"
                size={140}
                strokeWidth={14}
              />
            </div>
            <div className="chart-legend">
              <span className="legend-item"><span className="legend-dot" style={{ background: "#10b981" }} /> Completed</span>
              <span className="legend-item"><span className="legend-dot" style={{ background: "#f43f5e" }} /> Errors</span>
              <span className="legend-item"><span className="legend-dot" style={{ background: "#f59e0b" }} /> Retries</span>
            </div>
          </div>
        </div>

        <div className="metric-grid metrics-grid-tight">
          <article className="metric">
            <h3>Total Requests</h3>
            <p className="metric-value-cyan">{lbMetrics?.totalRequests ?? 0}</p>
            <p className="meta-text">Active: {lbMetrics?.activeRequests ?? 0}</p>
          </article>
          <article className="metric">
            <h3>Retries</h3>
            <p className="metric-value-amber">{lbMetrics?.retryAttempts ?? 0}</p>
            <p className="meta-text">Proxy errors: {lbMetrics?.proxyErrors ?? 0}</p>
          </article>
          <article className="metric">
            <h3>Latency</h3>
            <p className="metric-value-purple">{lbMetrics?.averageLatencyMs ?? 0} ms</p>
            <p className="meta-text">Completed: {lbMetrics?.completedRequests ?? 0}</p>
          </article>
        </div>

        <div className="node-list">
          {(lbMetrics?.perTarget || []).map((target) => (
            <div className="node-row" key={`${target.key}-metrics`}>
              <span>{target.key}</span>
              <span>selected: {target.selected}</span>
              <span>proxy errors: {target.proxyErrors}</span>
            </div>
          ))}
        </div>

        <p className="meta-text" style={{ marginTop: 12 }}>
          💡 Failover demo: stop the currently active node process, then press Refresh.
          The dashboard should continue with the same session id while serving from another node.
        </p>

        </div>
      </section>
    )
  }

  return (
    <main className="page-shell">
      <header className="hero-section reveal">
        <p className="tag">distributed systems</p>
        <h1>Distributed Session Hub</h1>
      </header>

      <nav className="route-nav reveal delay-1" aria-label="Primary">
        {ROUTES.map((routeItem) => (
          <button
            key={routeItem.id}
            type="button"
            className={route === routeItem.id ? "active" : ""}
            onClick={() => {
              window.location.hash = routeItem.id
            }}
          >
            {routeItem.label}
          </button>
        ))}
      </nav>

      <p className={`status-pill ${messageTone} reveal delay-2`}>{message}</p>

      <section className="reveal delay-3">
        {route === "/home" && renderHome()}
        {route === "/login" && renderLogin()}
        {route === "/dashboard" && renderDashboard()}
      </section>
    </main>
  )
}

export default App
