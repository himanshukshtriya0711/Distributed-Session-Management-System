const http = require("http");
const https = require("https");
const httpProxy = require("http-proxy");
const dotenv = require("dotenv");

dotenv.config();

const loadBalancerPort = Number(process.env.LOAD_BALANCER_PORT || 3000);
const stickySessions = (process.env.STICKY_SESSIONS || "false").toLowerCase() === "true";
const stickyCookieName = process.env.STICKY_COOKIE_NAME || "dsh.lb";
const stickyCookieTtlSec = Number(process.env.STICKY_COOKIE_TTL_SEC || 1800);
const healthCheckPath = process.env.HEALTH_CHECK_PATH || "/health";
const healthCheckIntervalMs = Number(process.env.HEALTH_CHECK_INTERVAL_MS || 5000);
const healthCheckTimeoutMs = Number(process.env.HEALTH_CHECK_TIMEOUT_MS || 1500);
const proxyTimeoutMs = Number(process.env.PROXY_TIMEOUT_MS || 8000);
const proxyRetryCount = Number(process.env.PROXY_RETRY_COUNT || 1);
const alertMinSamples = Number(process.env.ALERT_MIN_SAMPLES || 20);
const alertErrorRateThreshold = Number(process.env.ALERT_ERROR_RATE_THRESHOLD || 0.2);
const alertRetryRateThreshold = Number(process.env.ALERT_RETRY_RATE_THRESHOLD || 0.3);
const alertAvgLatencyMsThreshold = Number(process.env.ALERT_AVG_LATENCY_MS_THRESHOLD || 500);
const alertWebhookUrl = (process.env.ALERT_WEBHOOK_URL || "").trim();
const alertWebhookTimeoutMs = Number(process.env.ALERT_WEBHOOK_TIMEOUT_MS || 4000);
const alertNotificationCooldownSec = Number(process.env.ALERT_NOTIFICATION_COOLDOWN_SEC || 120);
const incidentHistoryLimit = Number(process.env.INCIDENT_HISTORY_LIMIT || 100);
const remediationEnabled = (process.env.REMEDIATION_ENABLED || "true").toLowerCase() === "true";
const autoDrainFailureThreshold = Number(process.env.AUTO_DRAIN_FAILURE_THRESHOLD || 3);
const autoDrainCooldownSec = Number(process.env.AUTO_DRAIN_COOLDOWN_SEC || 90);
const remediationHistoryLimit = Number(process.env.REMEDIATION_HISTORY_LIMIT || 100);
const escalationEnabled = (process.env.ESCALATION_ENABLED || "true").toLowerCase() === "true";
const escalationCooldownSec = Number(process.env.ESCALATION_COOLDOWN_SEC || 180);
const escalationHistoryLimit = Number(process.env.ESCALATION_HISTORY_LIMIT || 100);
const escalationAutoResolveOnRecovery = (process.env.ESCALATION_AUTO_RESOLVE_ON_RECOVERY || "true").toLowerCase() === "true";
const escalationOnDrainedTargets = (process.env.ESCALATION_ON_DRAINED_TARGETS || "true").toLowerCase() === "true";
const escalationResponseSlaSec = Number(process.env.ESCALATION_RESPONSE_SLA_SEC || 120);
const escalationResolutionSlaSec = Number(process.env.ESCALATION_RESOLUTION_SLA_SEC || 600);
const escalationSlaBreachCooldownSec = Number(process.env.ESCALATION_SLA_BREACH_COOLDOWN_SEC || 120);

const backendTargets = (process.env.BACKEND_TARGETS || "http://localhost:3001,http://localhost:3002,http://localhost:3003")
  .split(",")
  .map((target) => target.trim())
  .filter(Boolean)
  .map((url, index) => ({
    key: `node-${index + 1}`,
    url,
    healthy: true,
    lastHealthCheck: null,
    lastError: null,
  }));

if (!backendTargets.length) {
  console.error("No backend targets configured for load balancer");
  process.exit(1);
}

const proxy = httpProxy.createProxyServer({
  changeOrigin: true,
  xfwd: true,
  timeout: proxyTimeoutMs,
  proxyTimeout: proxyTimeoutMs,
  ws: true,
});

let roundRobinIndex = 0;

const lbMetrics = {
  startedAt: new Date().toISOString(),
  totalRequests: 0,
  activeRequests: 0,
  completedRequests: 0,
  proxyAttempts: 0,
  retryAttempts: 0,
  proxyErrors: 0,
  noTargetResponses: 0,
  totalLatencyMs: 0,
  byMethod: {},
  byStatusCode: {},
  byStrategy: {
    sticky: 0,
    "round-robin": 0,
    "failover-retry": 0,
  },
  perTarget: Object.fromEntries(backendTargets.map((target) => [target.key, {
    selected: 0,
    proxyErrors: 0,
    lastSelectedAt: null,
    lastErrorAt: null,
  }])),

  
};
// Operational state tracks the current status of the load balancer based on defined alerts and indicators

const incidentState = {
  sequence: 0,
  status: "insufficient-data",
  history: [],
  notification: {
    webhookConfigured: Boolean(alertWebhookUrl),
    cooldownSeconds: alertNotificationCooldownSec,
    sent: 0,
    failed: 0,
    suppressed: 0,
    lastSentAt: null,
    lastFailedAt: null,
    lastSuppressedAt: null,
    lastError: null,
    lastStatusCode: null,
  },
  lastNotificationAtMs: 0,
};

const remediationState = {
  sequence: 0,
  actionCounts: {
    autoDrains: 0,
    manualDrains: 0,
    autoRestores: 0,
   
    manualRestores: 0,
  },
  history: [],
  targets: Object.fromEntries(backendTargets.map((target) => [target.key, {
    manualDrained: false,
    autoDrained: false,
    autoDrainUntilMs: 0,
    consecutiveProxyFailures: 0,
    lastFailureAt: null,
    lastDrainedAt: null,
    lastRestoredAt: null,
    drainReason: null,
  }])),
};

const escalationState = {
  sequence: 0,
  activeEscalationId: null,
  lastEscalationAtMs: 0,
  counters: {
    opened: 0,
    acknowledged: 0,
    resolved: 0,
    autoResolved: 0,
    assignments: 0,
    handoffs: 0,
    responseBreaches: 0,
    resolutionBreaches: 0,
  },
  lastResponseBreachAtMsByEscalation: {},
  lastResolutionBreachAtMsByEscalation: {},
  history: [],
};

function createIncidentEntry(type, detail = {}) {
  incidentState.sequence += 1;

  return {
    id: `inc-${incidentState.sequence}`,
    at: new Date().toISOString(),
    type,
    ...detail,
  };
}

function pushIncidentEntry(entry) {
  incidentState.history.unshift(entry);
  if (incidentState.history.length > incidentHistoryLimit) {
    incidentState.history.length = incidentHistoryLimit;
  }
}

function getTargetByKey(targetKey) {
  return backendTargets.find((target) => target.key === targetKey) || null;
}

function getRemediationTargetState(targetKey) {
  if (!targetKey) {
    return null;
  }

  return remediationState.targets[targetKey] || null;
}

function isTargetDrained(targetKey) {
  const targetState = getRemediationTargetState(targetKey);
  return Boolean(targetState && (targetState.manualDrained || targetState.autoDrained));
}

function createRemediationEntry(type, detail = {}) {
  remediationState.sequence += 1;

  return {
    id: `rem-${remediationState.sequence}`,
    at: new Date().toISOString(),
    type,
    ...detail,
  };
}

function pushRemediationEntry(entry) {
  remediationState.history.unshift(entry);
  if (remediationState.history.length > remediationHistoryLimit) {
    remediationState.history.length = remediationHistoryLimit;
  }
}

function recordRemediationEvent(type, detail = {}) {
  pushRemediationEntry(createRemediationEntry(type, detail));

  pushIncidentEntry(createIncidentEntry("remediation-event", {
    severity: detail.severity || "warning",
    targetKey: detail.targetKey || null,
    remediationType: type,
    message: detail.message || `Remediation event: ${type}`,
  }));
}

function resetProxyFailureCounter(targetKey) {
  const targetState = getRemediationTargetState(targetKey);
  if (!targetState) {
    return;
  }

  targetState.consecutiveProxyFailures = 0;
}

function drainTarget(targetKey, mode, reason) {
  const target = getTargetByKey(targetKey);
  const targetState = getRemediationTargetState(targetKey);

  if (!target || !targetState) {
    return {
      ok: false,
      changed: false,
      reason: "target-not-found",
    };
  }

  const now = Date.now();

  if (mode === "manual") {
    if (targetState.manualDrained) {
      return {
        ok: true,
        changed: false,
      };
    }

    targetState.manualDrained = true;
    targetState.lastDrainedAt = new Date(now).toISOString();
    targetState.drainReason = reason || "manual-drain";
    remediationState.actionCounts.manualDrains += 1;

    recordRemediationEvent("manual-drain", {
      targetKey,
      severity: "warning",
      message: `Target ${targetKey} manually drained from rotation`,
    });

    return {
      ok: true,
      changed: true,
    };
  }

  if (targetState.manualDrained || targetState.autoDrained) {
    return {
      ok: true,
      changed: false,
    };
  }

  targetState.autoDrained = true;
  targetState.autoDrainUntilMs = now + (autoDrainCooldownSec * 1000);
  targetState.lastDrainedAt = new Date(now).toISOString();
  targetState.drainReason = reason || "automatic-failure-threshold";
  remediationState.actionCounts.autoDrains += 1;

  recordRemediationEvent("auto-drain", {
    targetKey,
    severity: "critical",
    message: `Target ${targetKey} auto-drained after repeated proxy failures`,
  });

  return {
    ok: true,
    changed: true,
  };
}

function restoreTarget(targetKey, mode, reason) {
  const target = getTargetByKey(targetKey);
  const targetState = getRemediationTargetState(targetKey);

  if (!target || !targetState) {
    return {
      ok: false,
      changed: false,
      reason: "target-not-found",
    };
  }

  const wasDrained = targetState.manualDrained || targetState.autoDrained;
  if (!wasDrained) {
    return {
      ok: true,
      changed: false,
    };
  }

  targetState.manualDrained = false;
  targetState.autoDrained = false;
  targetState.autoDrainUntilMs = 0;
  targetState.lastRestoredAt = new Date().toISOString();
  targetState.drainReason = reason || null;
  targetState.consecutiveProxyFailures = 0;

  if (mode === "manual") {
    remediationState.actionCounts.manualRestores += 1;
    recordRemediationEvent("manual-restore", {
      targetKey,
      severity: "info",
      message: `Target ${targetKey} manually restored to rotation`,
    });
  } else {
    remediationState.actionCounts.autoRestores += 1;
    recordRemediationEvent("auto-restore", {
      targetKey,
      severity: "info",
      message: `Target ${targetKey} auto-restored after cooldown and healthy check`,
    });
  }

  return {
    ok: true,
    changed: true,
  };
}

function registerProxyFailure(target, error) {
  if (!target) {
    return;
  }

  const targetState = getRemediationTargetState(target.key);
  if (!targetState) {
    return;
  }

  targetState.consecutiveProxyFailures += 1;
  targetState.lastFailureAt = new Date().toISOString();
  targetState.drainReason = error?.message || "proxy-error";

  if (!remediationEnabled) {
    return;
  }

  if (targetState.consecutiveProxyFailures >= autoDrainFailureThreshold) {
    drainTarget(target.key, "auto", "failure-threshold-reached");
  }
}

function evaluateAutoRemediation(target) {
  if (!target) {
    return;
  }

  const targetState = getRemediationTargetState(target.key);
  if (!targetState) {
    return;
  }

  if (
    targetState.autoDrained
    && !targetState.manualDrained
    && targetState.autoDrainUntilMs > 0
    && Date.now() >= targetState.autoDrainUntilMs
    && target.healthy
  ) {
    restoreTarget(target.key, "auto", "cooldown-complete-and-healthy");
  }
}

function getRemediationSnapshot() {
  const targets = backendTargets.map((target) => {
    const targetState = getRemediationTargetState(target.key);
    const manualDrained = Boolean(targetState?.manualDrained);
    const autoDrained = Boolean(targetState?.autoDrained);
    const drained = manualDrained || autoDrained;

    return {
      key: target.key,
      url: target.url,
      healthy: target.healthy,
      manualDrained,
      autoDrained,
      drained,
      routable: target.healthy && !drained,
      consecutiveProxyFailures: targetState?.consecutiveProxyFailures || 0,
      lastFailureAt: targetState?.lastFailureAt || null,
      lastDrainedAt: targetState?.lastDrainedAt || null,
      lastRestoredAt: targetState?.lastRestoredAt || null,
      drainReason: targetState?.drainReason || null,
      autoDrainUntil: targetState?.autoDrainUntilMs
        ? new Date(targetState.autoDrainUntilMs).toISOString()
        : null,
    };
  });

  return {
    enabled: remediationEnabled,
    updatedAt: new Date().toISOString(),
    thresholds: {
      autoDrainFailureThreshold,
      autoDrainCooldownSec,
    },
    actionCounts: {
      ...remediationState.actionCounts,
    },
    activeDrains: targets.filter((target) => target.drained).length,
    historyLimit: remediationHistoryLimit,
    targets,
    history: remediationState.history.slice(),
  };
}

function getEscalationEntryById(escalationId) {
  if (!escalationId) {
    return null;
  }

  return escalationState.history.find((entry) => entry.id === escalationId) || null;
}

function getActiveEscalation() {
  return getEscalationEntryById(escalationState.activeEscalationId);
}

function createEscalationEntry({
  severity,
  reason,
  operational,
  remediation,
}) {
  escalationState.sequence += 1;

  const nowMs = Date.now();

  return {
    id: `esc-${escalationState.sequence}`,
    openedAt: new Date(nowMs).toISOString(),
    lastEvaluatedAt: new Date(nowMs).toISOString(),
    status: "open",
    severity,
    reason,
    operationalStatus: operational.status,
    activeAlertIds: operational.alerts.filter((alert) => alert.active).map((alert) => alert.id),
    activeDrains: remediation.activeDrains,
    owner: null,
    ownerUpdatedAt: null,
    responseDueAt: new Date(nowMs + (escalationResponseSlaSec * 1000)).toISOString(),
    resolutionDueAt: new Date(nowMs + (escalationResolutionSlaSec * 1000)).toISOString(),
    responseSlaBreachedAt: null,
    resolutionSlaBreachedAt: null,
    responseSlaBreachCount: 0,
    resolutionSlaBreachCount: 0,
    acknowledgedAt: null,
    acknowledgedBy: null,
    resolvedAt: null,
    resolutionMode: null,
    message: severity === "critical"
      ? "Critical escalation active due to load balancer degradation"
      : "Warning escalation active due to remediation pressure",
  };
}

function pushEscalationEntry(entry) {
  escalationState.history.unshift(entry);
  if (escalationState.history.length > escalationHistoryLimit) {
    escalationState.history.length = escalationHistoryLimit;
  }
}

function openEscalation(operational, remediation, severity, reason) {
  const entry = createEscalationEntry({
    severity,
    reason,
    operational,
    remediation,
  });

  pushEscalationEntry(entry);
  escalationState.activeEscalationId = entry.id;
  escalationState.lastEscalationAtMs = Date.now();
  escalationState.counters.opened += 1;

  pushIncidentEntry(createIncidentEntry("escalation-opened", {
    severity,
    escalationId: entry.id,
    message: `Escalation ${entry.id} opened (${reason})`,
  }));

  return entry;
}

function acknowledgeEscalation(escalationId, actor = "operator") {
  const entry = getEscalationEntryById(escalationId);
  if (!entry) {
    return {
      ok: false,
      changed: false,
      reason: "escalation-not-found",
    };
  }

  if (entry.status === "resolved") {
    return {
      ok: false,
      changed: false,
      reason: "escalation-resolved",
    };
  }

  if (entry.acknowledgedAt) {
    return {
      ok: true,
      changed: false,
      escalation: entry,
    };
  }

  entry.acknowledgedAt = new Date().toISOString();
  entry.acknowledgedBy = actor;
  entry.status = "acknowledged";
  escalationState.counters.acknowledged += 1;

  pushIncidentEntry(createIncidentEntry("escalation-acknowledged", {
    severity: "info",
    escalationId: entry.id,
    message: `Escalation ${entry.id} acknowledged by ${actor}`,
  }));

  return {
    ok: true,
    changed: true,
    escalation: entry,
  };
}

function assignEscalationOwner(escalationId, owner, actor = "operator") {
  const entry = getEscalationEntryById(escalationId);
  if (!entry) {
    return {
      ok: false,
      changed: false,
      reason: "escalation-not-found",
    };
  }

  if (entry.status === "resolved") {
    return {
      ok: false,
      changed: false,
      reason: "escalation-resolved",
    };
  }

  const normalizedOwner = String(owner || "").trim();
  if (!normalizedOwner) {
    return {
      ok: false,
      changed: false,
      reason: "invalid-owner",
    };
  }

  const previousOwner = entry.owner;
  if (previousOwner === normalizedOwner) {
    return {
      ok: true,
      changed: false,
      escalation: entry,
    };
  }

  entry.owner = normalizedOwner;
  entry.ownerUpdatedAt = new Date().toISOString();
  escalationState.counters.assignments += 1;

  if (previousOwner && previousOwner !== normalizedOwner) {
    escalationState.counters.handoffs += 1;
  }

  pushIncidentEntry(createIncidentEntry("escalation-assigned", {
    severity: "info",
    escalationId: entry.id,
    owner: normalizedOwner,
    previousOwner,
    actor,
    message: previousOwner
      ? `Escalation ${entry.id} reassigned from ${previousOwner} to ${normalizedOwner}`
      : `Escalation ${entry.id} assigned to ${normalizedOwner}`,
  }));

  return {
    ok: true,
    changed: true,
    escalation: entry,
  };
}

function resolveEscalation(escalationId, mode = "manual") {
  const entry = getEscalationEntryById(escalationId);
  if (!entry) {
    return {
      ok: false,
      changed: false,
      reason: "escalation-not-found",
    };
  }

  if (entry.status === "resolved") {
    return {
      ok: true,
      changed: false,
      escalation: entry,
    };
  }

  entry.status = "resolved";
  entry.resolvedAt = new Date().toISOString();
  entry.resolutionMode = mode;

  if (escalationState.activeEscalationId === entry.id) {
    escalationState.activeEscalationId = null;
  }

  escalationState.counters.resolved += 1;
  if (mode === "auto") {
    escalationState.counters.autoResolved += 1;
  }

  pushIncidentEntry(createIncidentEntry("escalation-resolved", {
    severity: "info",
    escalationId: entry.id,
    message: `Escalation ${entry.id} resolved (${mode})`,
  }));

  return {
    ok: true,
    changed: true,
    escalation: entry,
  };
}

function evaluateEscalationSla(activeEscalation) {
  if (!activeEscalation || activeEscalation.status === "resolved") {
    return;
  }

  const nowMs = Date.now();
  const cooldownMs = escalationSlaBreachCooldownSec * 1000;

  if (!activeEscalation.acknowledgedAt && activeEscalation.responseDueAt) {
    const responseDueAtMs = Date.parse(activeEscalation.responseDueAt);
    if (Number.isFinite(responseDueAtMs) && nowMs > responseDueAtMs) {
      const lastBreachAtMs = escalationState.lastResponseBreachAtMsByEscalation[activeEscalation.id] || 0;
      if (lastBreachAtMs === 0 || (nowMs - lastBreachAtMs) >= cooldownMs) {
        escalationState.lastResponseBreachAtMsByEscalation[activeEscalation.id] = nowMs;
        activeEscalation.responseSlaBreachCount += 1;
        if (!activeEscalation.responseSlaBreachedAt) {
          activeEscalation.responseSlaBreachedAt = new Date(nowMs).toISOString();
        }

        escalationState.counters.responseBreaches += 1;
        pushIncidentEntry(createIncidentEntry("escalation-sla-breached", {
          severity: "critical",
          escalationId: activeEscalation.id,
          slaType: "response",
          message: `Escalation ${activeEscalation.id} breached response SLA`,
        }));
      }
    }
  }

  if (activeEscalation.resolutionDueAt) {
    const resolutionDueAtMs = Date.parse(activeEscalation.resolutionDueAt);
    if (Number.isFinite(resolutionDueAtMs) && nowMs > resolutionDueAtMs) {
      const lastBreachAtMs = escalationState.lastResolutionBreachAtMsByEscalation[activeEscalation.id] || 0;
      if (lastBreachAtMs === 0 || (nowMs - lastBreachAtMs) >= cooldownMs) {
        escalationState.lastResolutionBreachAtMsByEscalation[activeEscalation.id] = nowMs;
        activeEscalation.resolutionSlaBreachCount += 1;
        if (!activeEscalation.resolutionSlaBreachedAt) {
          activeEscalation.resolutionSlaBreachedAt = new Date(nowMs).toISOString();
        }

        escalationState.counters.resolutionBreaches += 1;
        pushIncidentEntry(createIncidentEntry("escalation-sla-breached", {
          severity: "critical",
          escalationId: activeEscalation.id,
          slaType: "resolution",
          message: `Escalation ${activeEscalation.id} breached resolution SLA`,
        }));
      }
    }
  }
}

function evaluateEscalationPolicy(operational, remediation) {
  if (!escalationEnabled) {
    return;
  }

  const shouldEscalateCritical = operational.status === "critical";
  const shouldEscalateDrain = escalationOnDrainedTargets && remediation.activeDrains > 0;
  const shouldEscalate = shouldEscalateCritical || shouldEscalateDrain;

  const severity = shouldEscalateCritical
    ? "critical"
    : shouldEscalateDrain
      ? "warning"
      : null;
  const reason = shouldEscalateCritical
    ? "critical-operational-status"
    : shouldEscalateDrain
      ? "drained-targets-detected"
      : null;

  const activeEscalation = getActiveEscalation();

  if (shouldEscalate) {
    if (!activeEscalation) {
      const cooldownMs = escalationCooldownSec * 1000;
      if (escalationState.lastEscalationAtMs > 0 && (Date.now() - escalationState.lastEscalationAtMs) < cooldownMs) {
        return;
      }

      openEscalation(operational, remediation, severity, reason);
      return;
    }

    activeEscalation.lastEvaluatedAt = new Date().toISOString();
    activeEscalation.operationalStatus = operational.status;
    activeEscalation.activeAlertIds = operational.alerts.filter((alert) => alert.active).map((alert) => alert.id);
    activeEscalation.activeDrains = remediation.activeDrains;

    if (severity === "critical" && activeEscalation.severity !== "critical") {
      activeEscalation.severity = "critical";
      activeEscalation.reason = "critical-operational-status";
      activeEscalation.message = "Critical escalation active due to load balancer degradation";
    }

    evaluateEscalationSla(activeEscalation);

    return;
  }

  if (activeEscalation) {
    evaluateEscalationSla(activeEscalation);
    if (escalationAutoResolveOnRecovery) {
      resolveEscalation(activeEscalation.id, "auto");
    }
  }
}

function getEscalationSnapshot() {
  const activeEscalation = getActiveEscalation();

  return {
    enabled: escalationEnabled,
    updatedAt: new Date().toISOString(),
    settings: {
      escalationCooldownSec,
      escalationAutoResolveOnRecovery,
      escalationOnDrainedTargets,
      escalationResponseSlaSec,
      escalationResolutionSlaSec,
      escalationSlaBreachCooldownSec,
    },
    counters: {
      ...escalationState.counters,
    },
    activeEscalationId: activeEscalation?.id || null,
    active: activeEscalation,
    historyLimit: escalationHistoryLimit,
    history: escalationState.history.slice(),
  };
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let sizeBytes = 0;

    req.on("data", (chunk) => {
      sizeBytes += chunk.length;
      if (sizeBytes > 64 * 1024) {
        reject(new Error("payload-too-large"));
        req.destroy();
        return;
      }

      chunks.push(chunk);
    });

    req.on("end", () => {
      resolve(Buffer.concat(chunks).toString("utf8"));
    });

    req.on("error", (error) => {
      reject(error);
    });
  });
}

async function readRequestJson(req) {
  const rawBody = await readRequestBody(req);
  if (!rawBody) {
    return {};
  }

  try {
    return JSON.parse(rawBody);
  } catch (_error) {
    throw new Error("invalid-json-body");
  }
}

function evaluateOperationalControlLoop() {
  const operational = evaluateAndTrackIncidents();
  const remediation = getRemediationSnapshot();
  evaluateEscalationPolicy(operational, remediation);

  return {
    operational,
    remediation,
    escalations: getEscalationSnapshot(),
  };
}

function incrementCounter(bucket, key) {
  if (!key) {
    return;
  }

  bucket[key] = (bucket[key] || 0) + 1;
}

function buildTargetHealthAlert() {
  const unavailableTargets = backendTargets
    .filter((target) => !target.healthy || isTargetDrained(target.key))
    .map((target) => target.key);
  const unavailableCount = unavailableTargets.length;

  let severity = "ok";
  if (unavailableCount >= Math.ceil(backendTargets.length / 2) && unavailableCount > 0) {
    severity = "critical";
  } else if (unavailableCount > 0) {
    severity = "warning";
  }

  return {
    id: "target-health",
    title: "Backend Target Health",
    severity,
    active: severity !== "ok",
    unit: "targets",
    value: unavailableCount,
    threshold: 0,
    affectedTargets: unavailableTargets,
    message: unavailableCount === 0
      ? "All backend targets are healthy and routable"
      : `Detected ${unavailableCount} unavailable backend target(s)`,
  };
}

function getMetricsSnapshot() {
  const startedAtMs = Date.parse(lbMetrics.startedAt);
  const uptimeSeconds = Number.isNaN(startedAtMs)
    ? null
    : Math.max(0, Math.floor((Date.now() - startedAtMs) / 1000));
  const averageLatencyMs = lbMetrics.completedRequests > 0
    ? Number((lbMetrics.totalLatencyMs / lbMetrics.completedRequests).toFixed(2))
    : 0;

  return {
    startedAt: lbMetrics.startedAt,
    uptimeSeconds,
    totalRequests: lbMetrics.totalRequests,
    activeRequests: lbMetrics.activeRequests,
    completedRequests: lbMetrics.completedRequests,
    proxyAttempts: lbMetrics.proxyAttempts,
    retryAttempts: lbMetrics.retryAttempts,
    proxyErrors: lbMetrics.proxyErrors,
    noTargetResponses: lbMetrics.noTargetResponses,
    averageLatencyMs,
    byMethod: lbMetrics.byMethod,
    byStatusCode: lbMetrics.byStatusCode,
    byStrategy: lbMetrics.byStrategy,
    perTarget: backendTargets.map((target) => ({
      remediation: {
        drained: isTargetDrained(target.key),
        consecutiveProxyFailures: getRemediationTargetState(target.key)?.consecutiveProxyFailures || 0,
      },
      key: target.key,
      url: target.url,
      healthy: target.healthy,
      selected: lbMetrics.perTarget[target.key]?.selected || 0,
      proxyErrors: lbMetrics.perTarget[target.key]?.proxyErrors || 0,
      lastSelectedAt: lbMetrics.perTarget[target.key]?.lastSelectedAt || null,
      lastErrorAt: lbMetrics.perTarget[target.key]?.lastErrorAt || null,
    })),
  };
}

function sumStatusCodes(predicate) {
  return Object.entries(lbMetrics.byStatusCode).reduce((total, [statusCode, count]) => {
    const parsedCode = Number(statusCode);
    if (Number.isFinite(parsedCode) && predicate(parsedCode)) {
      return total + Number(count || 0);
    }

    return total;
  }, 0);
}

function evaluateAlertSeverity(value, threshold) {
  if (value >= threshold * 1.5) {
    return "critical";
  }

  if (value >= threshold) {
    return "warning";
  }

  return "ok";
}

function buildThresholdAlert({
  id,
  title,
  value,
  threshold,
  unit,
  hasEnoughSamples,
  sampleMessage,
}) {
  if (!hasEnoughSamples) {
    return {
      id,
      title,
      severity: "info",
      active: false,
      unit,
      value,
      threshold,
      message: sampleMessage,
    };
  }

  const severity = evaluateAlertSeverity(value, threshold);

  return {
    id,
    title,
    severity,
    active: severity !== "ok",
    unit,
    value,
    threshold,
    message: severity === "ok"
      ? "Metric is within threshold"
      : `Metric exceeded threshold (${threshold}${unit})`,
  };
}

function getOperationalAlertsSnapshot() {
  const metrics = getMetricsSnapshot();
  const completedRequests = metrics.completedRequests;
  const hasEnoughSamples = completedRequests >= alertMinSamples;
  const serverErrorResponses = sumStatusCodes((statusCode) => statusCode >= 500);
  const retryRate = metrics.totalRequests > 0 ? metrics.retryAttempts / metrics.totalRequests : 0;
  const errorRate = completedRequests > 0 ? serverErrorResponses / completedRequests : 0;
  const availabilityRate = completedRequests > 0 ? (1 - errorRate) * 100 : 100;
  const sampleMessage = `Waiting for at least ${alertMinSamples} completed requests`;
  const targetHealthAlert = buildTargetHealthAlert();

  const alerts = [
    targetHealthAlert,
    buildThresholdAlert({
      id: "error-rate",
      title: "Server Error Rate",
      value: Number(errorRate.toFixed(4)),
      threshold: alertErrorRateThreshold,
      unit: "",
      hasEnoughSamples,
      sampleMessage,
    }),
    buildThresholdAlert({
      id: "retry-rate",
      title: "Retry Rate",
      value: Number(retryRate.toFixed(4)),
      threshold: alertRetryRateThreshold,
      unit: "",
      hasEnoughSamples,
      sampleMessage,
    }),
    buildThresholdAlert({
      id: "average-latency",
      title: "Average Latency",
      value: Number(metrics.averageLatencyMs || 0),
      threshold: alertAvgLatencyMsThreshold,
      unit: "ms",
      hasEnoughSamples,
      sampleMessage,
    }),
  ];

  const hasCritical = alerts.some((alert) => alert.active && alert.severity === "critical");
  const hasWarning = alerts.some((alert) => alert.active && alert.severity === "warning");

  return {
    status: hasCritical
      ? "critical"
      : hasWarning
        ? "degraded"
        : hasEnoughSamples
          ? "ok"
          : "insufficient-data",
    updatedAt: new Date().toISOString(),
    minimumSamples: alertMinSamples,
    thresholds: {
      errorRate: alertErrorRateThreshold,
      retryRate: alertRetryRateThreshold,
      averageLatencyMs: alertAvgLatencyMsThreshold,
    },
    indicators: {
      totalRequests: metrics.totalRequests,
      completedRequests,
      serverErrorResponses,
      availabilityRate: Number(availabilityRate.toFixed(2)),
      errorRate: Number(errorRate.toFixed(4)),
      retryRate: Number(retryRate.toFixed(4)),
      averageLatencyMs: Number(metrics.averageLatencyMs || 0),
    },
    alerts,
  };
}

function hasActiveAlertWithSeverity(operational, severities) {
  const severitySet = new Set(severities);
  return operational.alerts.some((alert) => alert.active && severitySet.has(alert.severity));
}

function sendWebhookNotification(payload) {
  return new Promise((resolve, reject) => {
    if (!alertWebhookUrl) {
      reject(new Error("webhook-not-configured"));
      return;
    }

    let parsedUrl;
    try {
      parsedUrl = new URL(alertWebhookUrl);
    } catch (error) {
      reject(new Error(`invalid-webhook-url: ${error.message}`));
      return;
    }

    const client = parsedUrl.protocol === "https:" ? https : http;
    const body = JSON.stringify(payload);

    const request = client.request(parsedUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(body),
      },
      timeout: alertWebhookTimeoutMs,
    }, (response) => {
      const chunks = [];

      response.on("data", (chunk) => {
        chunks.push(chunk);
      });

      response.on("end", () => {
        const responseBody = Buffer.concat(chunks).toString("utf8");

        if (response.statusCode && response.statusCode >= 200 && response.statusCode < 300) {
          resolve({
            statusCode: response.statusCode,
            body: responseBody,
          });
          return;
        }

        reject(new Error(`webhook-http-${response.statusCode || "unknown"}`));
      });
    });

    request.on("timeout", () => {
      request.destroy(new Error("webhook-timeout"));
    });

    request.on("error", (error) => {
      reject(error);
    });

    request.write(body);
    request.end();
  });
}

function maybeSendOperationalNotification(operational, statusChanged) {
  if (!alertWebhookUrl) {
    return;
  }

  const hasWarningOrCritical = hasActiveAlertWithSeverity(operational, ["warning", "critical"]);
  if (!hasWarningOrCritical) {
    return;
  }

  const now = Date.now();
  const cooldownMs = alertNotificationCooldownSec * 1000;
  const cooldownActive = incidentState.lastNotificationAtMs > 0
    && (now - incidentState.lastNotificationAtMs) < cooldownMs;

  const hasCritical = hasActiveAlertWithSeverity(operational, ["critical"]);
  const shouldNotify = (statusChanged && operational.status !== "ok" && operational.status !== "insufficient-data")
    || hasCritical;

  if (!shouldNotify) {
    return;
  }

  if (cooldownActive) {
    incidentState.notification.suppressed += 1;
    incidentState.notification.lastSuppressedAt = new Date().toISOString();

    pushIncidentEntry(createIncidentEntry("notification-suppressed", {
      severity: hasCritical ? "critical" : "warning",
      status: operational.status,
      message: "Notification suppressed by cooldown policy",
    }));
    return;
  }

  const activeAlerts = operational.alerts
    .filter((alert) => alert.active)
    .map((alert) => ({
      id: alert.id,
      title: alert.title,
      severity: alert.severity,
      value: alert.value,
      threshold: alert.threshold,
      unit: alert.unit,
    }));

  const payload = {
    source: "distributed-session-hub",
    phase: "phase-7",
    eventType: "operational-alert",
    generatedAt: new Date().toISOString(),
    status: operational.status,
    indicators: operational.indicators,
    activeAlerts,
  };

  incidentState.lastNotificationAtMs = now;

  sendWebhookNotification(payload)
    .then((result) => {
      incidentState.notification.sent += 1;
      incidentState.notification.lastSentAt = new Date().toISOString();
      incidentState.notification.lastStatusCode = result.statusCode;
      incidentState.notification.lastError = null;

      pushIncidentEntry(createIncidentEntry("notification-sent", {
        severity: hasCritical ? "critical" : "warning",
        status: operational.status,
        statusCode: result.statusCode,
        message: "Operational alert notification sent",
      }));
    })
    .catch((error) => {
      incidentState.notification.failed += 1;
      incidentState.notification.lastFailedAt = new Date().toISOString();
      incidentState.notification.lastError = error.message;

      pushIncidentEntry(createIncidentEntry("notification-failed", {
        severity: hasCritical ? "critical" : "warning",
        status: operational.status,
        message: error.message,
      }));
    });
}

function evaluateAndTrackIncidents() {
  const operational = getOperationalAlertsSnapshot();
  const previousStatus = incidentState.status;
  const statusChanged = previousStatus !== operational.status;

  if (statusChanged) {
    incidentState.status = operational.status;

    pushIncidentEntry(createIncidentEntry("status-change", {
      severity: operational.status === "critical"
        ? "critical"
        : operational.status === "degraded"
          ? "warning"
          : "info",
      previousStatus,
      currentStatus: operational.status,
      activeAlertIds: operational.alerts.filter((alert) => alert.active).map((alert) => alert.id),
      message: `Operational status changed from ${previousStatus} to ${operational.status}`,
    }));
  }

  maybeSendOperationalNotification(operational, statusChanged);
  return operational;
}

function getIncidentsSnapshot(operationalSnapshot = null) {
  const operational = operationalSnapshot || evaluateAndTrackIncidents();

  return {
    status: incidentState.status,
    updatedAt: new Date().toISOString(),
    historyLimit: incidentHistoryLimit,
    operational,
    notification: {
      ...incidentState.notification,
    },
    history: incidentState.history.slice(),
  };
}

function parseCookies(rawCookieHeader) {
  if (!rawCookieHeader) {
    return {};
  }

  return rawCookieHeader.split(";").reduce((result, cookiePair) => {
    const separatorIndex = cookiePair.indexOf("=");
    if (separatorIndex === -1) {
      return result;
    }

    const key = cookiePair.slice(0, separatorIndex).trim();
    const value = cookiePair.slice(separatorIndex + 1).trim();

    if (!key) {
      return result;
    }

    try {
      result[key] = decodeURIComponent(value);
    } catch (_error) {
      result[key] = value;
    }

    return result;
  }, {});
}

function healthyTargets() {
  const healthy = backendTargets
    .filter((target) => !isTargetDrained(target.key))
    .filter((target) => target.healthy);
  if (healthy.length > 0) {
    return healthy;
  }

  return backendTargets.filter((target) => !isTargetDrained(target.key));
}

function chooseTarget(req, excludeTargetKeys = []) {
  const cookies = parseCookies(req.headers.cookie || "");
  const exclusionSet = new Set(excludeTargetKeys);

  const healthyPool = healthyTargets().filter((target) => !exclusionSet.has(target.key));
  const fallbackPool = backendTargets
    .filter((target) => !isTargetDrained(target.key))
    .filter((target) => !exclusionSet.has(target.key));
  const pool = healthyPool.length > 0 ? healthyPool : fallbackPool;

  if (pool.length === 0) {
    return null;
  }

  if (stickySessions) {
    const stickyValue = cookies[stickyCookieName];
    if (stickyValue) {
      const stickyTarget = pool.find((target) => target.key === stickyValue);
      if (stickyTarget) {
        return {
          target: stickyTarget,
          reason: "sticky",
        };
      }
    }
  }

  const target = pool[roundRobinIndex % pool.length];
  roundRobinIndex = (roundRobinIndex + 1) % pool.length;

  return {
    target,
    reason: "round-robin",
  };
}

function applyStickyCookie(proxyRes, target) {
  if (!stickySessions || !target) {
    return;
  }

  const stickyCookie = `${stickyCookieName}=${encodeURIComponent(target.key)}; Path=/; Max-Age=${stickyCookieTtlSec}; SameSite=Lax`;
  const existingSetCookie = proxyRes.headers["set-cookie"];

  if (!existingSetCookie) {
    proxyRes.headers["set-cookie"] = [stickyCookie];
    return;
  }

  if (Array.isArray(existingSetCookie)) {
    const retainedCookies = existingSetCookie.filter((cookie) => !cookie.startsWith(`${stickyCookieName}=`));
    retainedCookies.push(stickyCookie);
    proxyRes.headers["set-cookie"] = retainedCookies;
    return;
  }

  if (typeof existingSetCookie === "string") {
    proxyRes.headers["set-cookie"] = [existingSetCookie, stickyCookie];
  }
}

function healthStatusSummary() {
  return backendTargets.map((target) => ({
    key: target.key,
    url: target.url,
    healthy: target.healthy,
    drained: isTargetDrained(target.key),
    manualDrained: Boolean(getRemediationTargetState(target.key)?.manualDrained),
    autoDrained: Boolean(getRemediationTargetState(target.key)?.autoDrained),
    lastHealthCheck: target.lastHealthCheck,
    lastError: target.lastError,
  }));
}

function markTargetUnhealthy(target, error) {
  if (!target) {
    return;
  }

  target.healthy = false;
  target.lastHealthCheck = new Date().toISOString();
  target.lastError = error?.message || "proxy-target-unreachable";
}

function canRetryRequest(req, attemptedCount) {
  const method = String(req.method || "GET").toUpperCase();
  const isIdempotent = method === "GET" || method === "HEAD" || method === "OPTIONS";
  return isIdempotent && attemptedCount < proxyRetryCount;
}

function writeProxyErrorResponse(res, error, attemptedTargets) {
  if (res.headersSent) {
    return;
  }

  res.writeHead(502, {
    "content-type": "application/json",
  });

  res.end(JSON.stringify({
    message: "Load balancer could not proxy request",
    detail: error.message,
    attemptedTargets,
  }));
}

function routeHttpRequest(req, res, attemptedTargets = []) {
  const selection = chooseTarget(req, attemptedTargets);

  if (!selection) {
    lbMetrics.noTargetResponses += 1;

    if (!res.headersSent) {
      res.writeHead(503, {
        "content-type": "application/json",
      });
      res.end(JSON.stringify({
        message: "No backend target is currently available",
      }));
    }
    return;
  }

  const selectedTarget = selection.target;
  const nextAttemptedTargets = [...attemptedTargets, selectedTarget.key];
  req._selectedTarget = selectedTarget;
  req._selectionReason = attemptedTargets.length > 0 ? "failover-retry" : selection.reason;
  req._attemptedTargetKeys = nextAttemptedTargets;

  lbMetrics.proxyAttempts += 1;
  incrementCounter(lbMetrics.byStrategy, req._selectionReason);

  if (attemptedTargets.length > 0) {
    lbMetrics.retryAttempts += 1;
  }

  const targetMetrics = lbMetrics.perTarget[selectedTarget.key];
  if (targetMetrics) {
    targetMetrics.selected += 1;
    targetMetrics.lastSelectedAt = new Date().toISOString();
  }

  proxy.web(req, res, {
    target: selectedTarget.url,
  }, (error) => {
    markTargetUnhealthy(selectedTarget, error);
    registerProxyFailure(selectedTarget, error);
    lbMetrics.proxyErrors += 1;

    if (targetMetrics) {
      targetMetrics.proxyErrors += 1;
      targetMetrics.lastErrorAt = new Date().toISOString();
    }

    if (canRetryRequest(req, attemptedTargets.length)) {
      routeHttpRequest(req, res, nextAttemptedTargets);
      return;
    }

    writeProxyErrorResponse(res, error, nextAttemptedTargets);
  });
}

function checkTargetHealth(target) {
  return new Promise((resolve) => {
    const request = http.request(new URL(healthCheckPath, target.url), {
      method: "GET",
      timeout: healthCheckTimeoutMs,
    }, (response) => {
      const isHealthy = Boolean(response.statusCode && response.statusCode < 500);
      target.healthy = isHealthy;
      target.lastHealthCheck = new Date().toISOString();
      target.lastError = isHealthy ? null : `HTTP ${response.statusCode}`;
      if (isHealthy) {
        resetProxyFailureCounter(target.key);
        evaluateAutoRemediation(target);
      }
      response.resume();
      resolve();
    });

    request.on("timeout", () => {
      request.destroy(new Error("health-check-timeout"));
    });

    request.on("error", (error) => {
      target.healthy = false;
      target.lastHealthCheck = new Date().toISOString();
      target.lastError = error.message;
      resolve();
    });

    request.end();
  });
}

async function runHealthChecks() {
  await Promise.all(backendTargets.map((target) => checkTargetHealth(target)));
  evaluateOperationalControlLoop();
}

proxy.on("proxyRes", (proxyRes, req, res) => {
  const selectedTarget = req._selectedTarget;
  applyStickyCookie(proxyRes, selectedTarget);

  if (selectedTarget) {
    res.setHeader("x-load-balancer-target", selectedTarget.key);
    res.setHeader("x-load-balancer-strategy", req._selectionReason || "unknown");
  }
});

proxy.on("error", (error, req, res) => {
  if (req && req._selectedTarget) {
    markTargetUnhealthy(req._selectedTarget, error);
  }

  if (res && !res.headersSent) {
    writeProxyErrorResponse(res, error, req?._attemptedTargetKeys || []);
  }
});

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url, "http://localhost");
  const pathname = requestUrl.pathname;

  if (pathname === "/lb/health") {
    res.writeHead(200, {
      "content-type": "application/json",
    });

    res.end(JSON.stringify({
      status: "ok",
      stickySessions,
      strategy: "round-robin",
      targets: healthStatusSummary(),
    }));
    return;
  }

  if (pathname === "/lb/metrics") {
    res.writeHead(200, {
      "content-type": "application/json",
    });

    res.end(JSON.stringify({
      status: "ok",
      metrics: getMetricsSnapshot(),
    }));
    return;
  }

  if (pathname === "/lb/alerts") {
    const { operational } = evaluateOperationalControlLoop();

    res.writeHead(200, {
      "content-type": "application/json",
    });

    res.end(JSON.stringify({
      status: "ok",
      operational,
    }));
    return;
  }

  if (pathname === "/lb/incidents") {
    const { operational } = evaluateOperationalControlLoop();
    const incidents = getIncidentsSnapshot(operational);

    res.writeHead(200, {
      "content-type": "application/json",
    });

    res.end(JSON.stringify({
      status: "ok",
      incidents,
    }));
    return;
  }

  if (pathname === "/lb/remediation") {
    const { remediation } = evaluateOperationalControlLoop();

    res.writeHead(200, {
      "content-type": "application/json",
    });

    res.end(JSON.stringify({
      status: "ok",
      remediation,
    }));
    return;
  }

  if (pathname === "/lb/escalations") {
    const { escalations } = evaluateOperationalControlLoop();

    res.writeHead(200, {
      "content-type": "application/json",
    });

    res.end(JSON.stringify({
      status: "ok",
      escalations,
    }));
    return;
  }

  const remediationActionMatch = pathname.match(/^\/lb\/remediation\/targets\/([^/]+)\/(drain|restore)$/);
  if (remediationActionMatch) {
    if (String(req.method || "GET").toUpperCase() !== "POST") {
      res.writeHead(405, {
        "content-type": "application/json",
      });
      res.end(JSON.stringify({
        message: "Method not allowed",
      }));
      return;
    }

    const targetKey = decodeURIComponent(remediationActionMatch[1]);
    const action = remediationActionMatch[2];
    const target = getTargetByKey(targetKey);

    if (!target) {
      res.writeHead(404, {
        "content-type": "application/json",
      });
      res.end(JSON.stringify({
        message: `Unknown target: ${targetKey}`,
      }));
      return;
    }

    const result = action === "drain"
      ? drainTarget(targetKey, "manual", "operator-request")
      : restoreTarget(targetKey, "manual", "operator-request");

    res.writeHead(200, {
      "content-type": "application/json",
    });
    res.end(JSON.stringify({
      status: "ok",
      action,
      targetKey,
      changed: result.changed,
      remediation: getRemediationSnapshot(),
    }));
    return;
  }

  const escalationActionMatch = pathname.match(/^\/lb\/escalations\/([^/]+)\/(acknowledge|resolve|assign)$/);
  if (escalationActionMatch) {
    if (String(req.method || "GET").toUpperCase() !== "POST") {
      res.writeHead(405, {
        "content-type": "application/json",
      });
      res.end(JSON.stringify({
        message: "Method not allowed",
      }));
      return;
    }

    const escalationId = decodeURIComponent(escalationActionMatch[1]);
    const action = escalationActionMatch[2];

    if (action === "assign") {
      let payload;
      try {
        payload = await readRequestJson(req);
      } catch (error) {
        const statusCode = error.message === "payload-too-large" ? 413 : 400;
        res.writeHead(statusCode, {
          "content-type": "application/json",
        });
        res.end(JSON.stringify({
          status: "error",
          message: error.message,
        }));
        return;
      }

      const owner = String(payload?.owner || "").trim();
      const result = assignEscalationOwner(escalationId, owner, "operator");

      if (!result.ok && result.reason === "escalation-not-found") {
        res.writeHead(404, {
          "content-type": "application/json",
        });
        res.end(JSON.stringify({
          status: "error",
          message: `Unknown escalation: ${escalationId}`,
          escalations: getEscalationSnapshot(),
        }));
        return;
      }

      if (!result.ok && result.reason === "invalid-owner") {
        res.writeHead(400, {
          "content-type": "application/json",
        });
        res.end(JSON.stringify({
          status: "error",
          message: "owner is required",
          escalations: getEscalationSnapshot(),
        }));
        return;
      }

      if (!result.ok) {
        res.writeHead(409, {
          "content-type": "application/json",
        });
        res.end(JSON.stringify({
          status: "error",
          message: result.reason,
          escalations: getEscalationSnapshot(),
        }));
        return;
      }

      res.writeHead(200, {
        "content-type": "application/json",
      });
      res.end(JSON.stringify({
        status: "ok",
        action,
        escalationId,
        owner,
        changed: result.changed,
        escalations: getEscalationSnapshot(),
      }));
      return;
    }

    const result = action === "acknowledge"
      ? acknowledgeEscalation(escalationId, "operator")
      : resolveEscalation(escalationId, "manual");

    if (!result.ok && result.reason === "escalation-not-found") {
      res.writeHead(404, {
        "content-type": "application/json",
      });
      res.end(JSON.stringify({
        status: "error",
        message: `Unknown escalation: ${escalationId}`,
        escalations: getEscalationSnapshot(),
      }));
      return;
    }

    if (!result.ok) {
      res.writeHead(409, {
        "content-type": "application/json",
      });
      res.end(JSON.stringify({
        status: "error",
        message: result.reason,
        escalations: getEscalationSnapshot(),
      }));
      return;
    }

    res.writeHead(200, {
      "content-type": "application/json",
    });
    res.end(JSON.stringify({
      status: "ok",
      action,
      escalationId,
      changed: result.changed,
      escalations: getEscalationSnapshot(),
    }));
    return;
  }

  const requestStart = Date.now();
  lbMetrics.totalRequests += 1;
  lbMetrics.activeRequests += 1;
  incrementCounter(lbMetrics.byMethod, String(req.method || "UNKNOWN").toUpperCase());

  res.on("finish", () => {
    lbMetrics.activeRequests = Math.max(0, lbMetrics.activeRequests - 1);
    lbMetrics.completedRequests += 1;
    lbMetrics.totalLatencyMs += Date.now() - requestStart;
    incrementCounter(lbMetrics.byStatusCode, String(res.statusCode || 0));

    evaluateOperationalControlLoop();
  });

  routeHttpRequest(req, res, []);
});

server.on("upgrade", (req, socket, head) => {
  const selection = chooseTarget(req, []);
  if (!selection) {
    socket.destroy();
    return;
  }

  req._selectedTarget = selection.target;
  req._selectionReason = selection.reason;

  proxy.ws(req, socket, head, {
    target: selection.target.url,
  }, (error) => {
    markTargetUnhealthy(selection.target, error);
    socket.destroy();
  });
});

const healthCheckTimer = setInterval(() => {
  runHealthChecks().catch((error) => {
    console.error("Load balancer health check failed", error);
  });
}, healthCheckIntervalMs);
healthCheckTimer.unref();

runHealthChecks().catch((error) => {
  console.error("Initial load balancer health check failed", error);
});

server.listen(loadBalancerPort, () => {
  console.log(`Load balancer listening on port ${loadBalancerPort}`);
  console.log(`Routing strategy: round-robin${stickySessions ? " + sticky sessions" : ""}`);
  console.log(`Backend targets: ${backendTargets.map((target) => target.url).join(", ")}`);
  console.log(`Incident notifications: ${alertWebhookUrl ? "enabled" : "disabled"}`);
  console.log(`Remediation automation: ${remediationEnabled ? "enabled" : "disabled"} (threshold=${autoDrainFailureThreshold}, cooldown=${autoDrainCooldownSec}s)`);
  console.log(`Escalation workflow: ${escalationEnabled ? "enabled" : "disabled"} (cooldown=${escalationCooldownSec}s, responseSLA=${escalationResponseSlaSec}s, resolutionSLA=${escalationResolutionSlaSec}s)`);
});

function shutdown() {
  console.log("Shutting down load balancer...");
  clearInterval(healthCheckTimer);

  server.close(() => {
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
