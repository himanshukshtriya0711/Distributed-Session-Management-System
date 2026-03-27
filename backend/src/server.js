const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const session = require("express-session");
const RedisStore = require("connect-redis").default;
const { createClient } = require("redis");

dotenv.config();

const port = Number(process.env.PORT || 3001);
const nodeName = process.env.NODE_NAME || `node-${port}`;
const clientOrigins = (process.env.CLIENT_ORIGINS || process.env.CLIENT_ORIGIN || "http://localhost:5173")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";
const sessionSecret = process.env.SESSION_SECRET || "change-me-in-production";
const sessionCookieName = process.env.SESSION_COOKIE_NAME || "dsh.sid";
const sessionTtlMs = Number(process.env.SESSION_TTL_MS || 1000 * 60 * 30);
const redisSessionPrefix = process.env.REDIS_SESSION_PREFIX || "dsh:sess:";
const trustProxy = process.env.TRUST_PROXY === "true";
const cookieSecure = process.env.COOKIE_SECURE === "true";

const app = express();

const redisClient = createClient({
  url: redisUrl,
  socket: {
    reconnectStrategy: false,
  },
});

redisClient.on("error", (error) => {
  console.error(`[${nodeName}] Redis client error`, error);
});

function isOriginAllowed(requestOrigin) {
  if (!requestOrigin) {
    return true;
  }

  if (clientOrigins.includes("*")) {
    return true;
  }

  if (clientOrigins.includes(requestOrigin)) {
    return true;
  }

  try {
    const parsedOrigin = new URL(requestOrigin);
    const hostname = parsedOrigin.hostname.toLowerCase();
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  } catch {
    return false;
  }
}

function requireSession(req, res, next) {
  if (!req.session || !req.session.user) {
    return res.status(401).json({
      message: "No active user session",
      node: nodeName,
      sessionId: req.sessionID || null,
    });
  }

  return next();
}

async function startServer() {
  await redisClient.connect();

  const redisStore = new RedisStore({
    client: redisClient,
    prefix: redisSessionPrefix,
  });

  app.set("trust proxy", trustProxy);

app.use(
  cors({
    origin: (origin, callback) => {
      if (isOriginAllowed(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error(`Origin not allowed by CORS: ${origin}`));
    },
    credentials: true,
  })
);
app.use(express.json());
app.use(
  session({
    name: sessionCookieName,
    store: redisStore,
    secret: sessionSecret,
    saveUninitialized: false,
    resave: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      secure: cookieSecure,
      sameSite: "lax",
      maxAge: sessionTtlMs,
    },
  })
);

app.get("/health", (_req, res) => {
  res.status(200).json({
    status: "ok",
    node: nodeName,
    port,
    redisConnected: redisClient.isReady,
    timestamp: new Date().toISOString(),
  });
});

app.get("/api/info", (_req, res) => {
  res.status(200).json({
    message: "Phase 2 Redis session node is running",
    stack: {
      frontend: "React",
      backend: "Express",
      sessionStore: "Redis",
    },
    node: nodeName,
    port,
  });
});

function handleLogin(req, res) {
  const username = typeof req.body?.username === "string" ? req.body.username.trim() : "";

  if (!username) {
    res.status(400).json({
      message: "username is required",
      node: nodeName,
    });
    return;
  }

  if (!req.session || typeof req.session.regenerate !== "function") {
    res.status(500).json({
      message: "Session middleware is unavailable",
      node: nodeName,
    });
    return;
  }

  const user = {
    username,
    loginAt: new Date().toISOString(),
  };

  req.session.regenerate((regenerateError) => {
    if (regenerateError) {
      res.status(500).json({
        message: "Failed to create new session",
        node: nodeName,
      });
      return;
    }

    req.session.user = user;
    req.session.loginNode = nodeName;
    req.session.requestCount = 0;

    req.session.save((saveError) => {
      if (saveError) {
        res.status(500).json({
          message: "Failed to persist session",
          node: nodeName,
        });
        return;
      }

      res.status(200).json({
        message: "Login successful",
        node: nodeName,
        sessionId: req.sessionID,
        user: req.session.user,
      });
    });
  });
}

function handleDashboard(req, res) {
  req.session.requestCount = (req.session.requestCount || 0) + 1;
  req.session.lastServedBy = nodeName;

  res.status(200).json({
    message: `Welcome ${req.session.user.username}`,
    node: nodeName,
    sessionId: req.sessionID,
    user: req.session.user,
    loginNode: req.session.loginNode,
    requestCount: req.session.requestCount,
  });
}

function handleSessionInfo(req, res) {
  if (!req.session || !req.session.user) {
    res.status(200).json({
      hasSession: false,
      node: nodeName,
      sessionId: req.sessionID || null,
    });
    return;
  }

  res.status(200).json({
    hasSession: true,
    node: nodeName,
    sessionId: req.sessionID,
    user: req.session.user,
    loginNode: req.session.loginNode,
    requestCount: req.session.requestCount || 0,
    cookieExpiresAt: req.session.cookie.expires,
  });
}

function handleLogout(req, res) {
  if (!req.session) {
    res.status(200).json({
      message: "No active session",
      node: nodeName,
    });
    return;
  }

  req.session.destroy((error) => {
    if (error) {
      res.status(500).json({
        message: "Failed to destroy session",
        node: nodeName,
      });
      return;
    }

    res.clearCookie(sessionCookieName);
    res.status(200).json({
      message: "Logged out",
      node: nodeName,
    });
  });
}

app.post("/login", handleLogin);
app.post("/api/login", handleLogin);

app.get("/dashboard", requireSession, handleDashboard);
app.get("/api/dashboard", requireSession, handleDashboard);

app.get("/session", handleSessionInfo);
app.get("/api/session", handleSessionInfo);

app.post("/logout", handleLogout);
app.post("/api/logout", handleLogout);

app.use((error, _req, res, _next) => {
  res.status(500).json({
    message: "Unhandled server error",
    node: nodeName,
    detail: error.message,
  });
});

  const server = app.listen(port, () => {
    console.log(`[${nodeName}] Express server listening on port ${port}`);
    console.log(`[${nodeName}] Redis session store connected at ${redisUrl}`);
  });

  async function shutdown() {
    console.log(`[${nodeName}] Shutting down...`);
    server.close(async () => {
      if (redisClient.isOpen) {
        await redisClient.quit();
      }
      process.exit(0);
    });
  }

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

startServer().catch((error) => {
  console.error(`[${nodeName}] Failed to start server`, error);
  process.exit(1);
});
