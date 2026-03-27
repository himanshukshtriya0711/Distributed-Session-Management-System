import { useEffect, useMemo, useState } from "react"
import "./App.css"

const API_BASE = (import.meta.env.VITE_API_BASE_URL || "").trim()

const ROUTES = [
  { id: "/home", label: "Home" },
  { id: "/login", label: "Login" },
  { id: "/dashboard", label: "Dashboard" },
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

function App() {
  const [route, setRoute] = useState(() => normalizeRoute(window.location.hash))
  const [username, setUsername] = useState("")
  const [message, setMessage] = useState("Ready")
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
        `Dashboard refreshed from ${dashboardResult.response.headers.get("x-load-balancer-target") || "unknown"}. Session active: ${sessionState?.hasSession ? "yes" : "no"}`,
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
      setMessage("Login successful. New session created and loaded from Redis.")
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
        `Target ${targetKey} ${action === "drain" ? "drained" : "restored"} successfully.`,
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
        `Escalation ${escalationId} ${action === "acknowledge" ? "acknowledged" : "resolved"} successfully.`,
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

      setMessage(`Escalation ${escalationId} assigned to ${owner}.`)
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

  function renderHome() {
    return (
      <section className="content-card">
        <h2>Distributed Session Management System</h2>
        <p>
          This demo routes client requests through a custom load balancer and keeps
          session state in Redis so any backend node can serve authenticated traffic.
        </p>
        <p className="arch-line">
          Client Browser -&gt; Load Balancer -&gt; Node Pool -&gt; Redis Session Store
        </p>

        <div className="metric-grid">
          <article className="metric">
            <h3>Load Balancer</h3>
            <p>{API_BASE}</p>
            <p className="meta-text">
              Strategy: {lbHealth?.strategy || "unknown"}
              {lbHealth?.stickySessions ? " + sticky" : ""}
            </p>
          </article>
          <article className="metric">
            <h3>Session State</h3>
            <p>{isAuthenticated ? "Active" : "No active session"}</p>
            <p className="meta-text">
              Session ID: {sessionInfo?.sessionId || "not created"}
            </p>
          </article>
          <article className="metric">
            <h3>Traffic Metrics</h3>
            <p>{lbMetrics?.totalRequests ?? 0} requests</p>
            <p className="meta-text">
              Retries: {lbMetrics?.retryAttempts ?? 0} | Avg latency: {lbMetrics?.averageLatencyMs ?? 0} ms
            </p>
          </article>
          <article className="metric">
            <h3>Operational Status</h3>
            <p>{lbAlerts?.status || "unknown"}</p>
            <p className="meta-text">Active alerts: {activeAlertCount}</p>
          </article>
          <article className="metric">
            <h3>Incident State</h3>
            <p>{lbIncidents?.status || "unknown"}</p>
            <p className="meta-text">Timeline events: {recentIncidentCount}</p>
          </article>
          <article className="metric">
            <h3>Remediation</h3>
            <p>{lbRemediation?.enabled ? "enabled" : "disabled"}</p>
            <p className="meta-text">Active drains: {activeDrainCount}</p>
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
            <p>{(lbEscalations?.counters?.responseBreaches ?? 0) + (lbEscalations?.counters?.resolutionBreaches ?? 0)}</p>
            <p className="meta-text">
              response: {lbEscalations?.counters?.responseBreaches ?? 0} | resolution: {lbEscalations?.counters?.resolutionBreaches ?? 0}
            </p>
          </article>
        </div>

        <p className="meta-text">
          
        </p>
      </section>
    )
  }

  function renderLogin() {
    return (
      <section className="content-card narrow-card">
        <h2>Login</h2>
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
            {loading ? "Signing in..." : "Login"}
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

    return (
      <section className="content-card">
        <div className="dashboard-head">
          <h2>Dashboard</h2>
          <div className="action-row">
            <button type="button" onClick={refreshDashboard} disabled={loading}>
              {loading ? "Refreshing..." : "Refresh"}
            </button>
            <button type="button" className="ghost-button" onClick={handleLogout}>
              Logout
            </button>
          </div>
        </div>

        <div className="dashboard-section personal-section">
          <h3 className="section-title">User Session Info (personal)</h3>
          <p className="meta-text section-intro">
            These cards track your current logged-in session.
          </p>

        <div className="metric-grid metrics-grid-tight">
          <article className="metric">
            <h3>User</h3>
            <p>{dashboardInfo?.user?.username || sessionInfo?.user?.username || "unknown"}</p>
            <p className="meta-text">Login node: {dashboardInfo?.loginNode || sessionInfo?.loginNode || "unknown"}</p>
          </article>
          <article className="metric">
            <h3>Session</h3>
            <p>{dashboardInfo?.sessionId || sessionInfo?.sessionId || "unknown"}</p>
            <p className="meta-text">Requests in session: {dashboardInfo?.requestCount ?? sessionInfo?.requestCount ?? 0}</p>
          </article>
          <article className="metric">
            <h3>Served By</h3>
            <p>{dashboardInfo?.loadBalancerTarget || "refresh to load"}</p>
            <p className="meta-text">Strategy: {dashboardInfo?.loadBalancerStrategy || "unknown"}</p>
          </article>
        </div>

        </div>

        <div className="dashboard-section telemetry-section">
          <h3 className="section-title">System Telemetry (global)</h3>
          <p className="meta-text section-intro">
            These metrics are shared across the full system.
          </p>

        <h3 className="section-title">Node Health</h3>
        <div className="node-list">
          {(lbHealth?.targets || []).map((target) => (
            <div className="node-row" key={target.key}>
              <span>{target.key}</span>
              <span>{target.healthy ? "healthy" : "down"}</span>
              <span>{target.url}</span>
            </div>
          ))}
        </div>

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

        <h3 className="section-title">Remediation Controls</h3>
        <div className="metric-grid metrics-grid-tight">
          <article className="metric">
            <h3>Automation</h3>
            <p>{lbRemediation?.enabled ? "enabled" : "disabled"}</p>
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
                  {target.drained ? "Restore" : "Drain"}
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
            <p>{(lbEscalations?.counters?.responseBreaches ?? 0) + (lbEscalations?.counters?.resolutionBreaches ?? 0)}</p>
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
                  Acknowledge
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
                  Resolve
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

        <h3 className="section-title">Load Balancer Metrics</h3>
        <div className="metric-grid metrics-grid-tight">
          <article className="metric">
            <h3>Total Requests</h3>
            <p>{lbMetrics?.totalRequests ?? 0}</p>
            <p className="meta-text">Active: {lbMetrics?.activeRequests ?? 0}</p>
          </article>
          <article className="metric">
            <h3>Retries</h3>
            <p>{lbMetrics?.retryAttempts ?? 0}</p>
            <p className="meta-text">Proxy errors: {lbMetrics?.proxyErrors ?? 0}</p>
          </article>
          <article className="metric">
            <h3>Latency</h3>
            <p>{lbMetrics?.averageLatencyMs ?? 0} ms</p>
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

        <p className="meta-text">
          Failover demo: stop the currently active node process, then press Refresh.
          The dashboard should continue with the same session id while serving from another node.
        </p>

        </div>
      </section>
    )
  }

  return (
    <main className="page-shell">
      <header className="hero-section reveal">
        <p className="tag"></p>
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
