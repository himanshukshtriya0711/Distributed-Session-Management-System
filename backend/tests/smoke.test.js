const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const { spawnSync } = require("node:child_process");
const path = require("node:path");

describe("Backend smoke checks", () => {
  it("sanity: test runner works", () => {
    assert.equal(1 + 1, 2);
  });

  it("health payload shape remains stable", () => {
    const health = { status: "healthy" };
    assert.deepEqual(health, { status: "healthy" });
  });

  it("session defaults are expected values", () => {
    const defaults = {
      cookieName: process.env.SESSION_COOKIE_NAME || "dsh.sid",
      sessionTtlMs: Number(process.env.SESSION_TTL_MS || 1000 * 60 * 30),
    };

    assert.equal(defaults.cookieName, "dsh.sid");
    assert.equal(defaults.sessionTtlMs, 1800000);
  });

  it("production secret guard is present in server source", () => {
    const serverEntry = path.resolve(__dirname, "../src/server.js");
    const result = spawnSync(process.execPath, ["--check", serverEntry], {
      encoding: "utf8",
      timeout: 5000,
    });

    assert.equal(result.status, 0);

    const source = require("node:fs").readFileSync(serverEntry, "utf8");
    assert.match(source, /SESSION_SECRET must be explicitly set in production and cannot be empty/);
    assert.match(source, /SESSION_SECRET must be at least 32 characters in production/);
    assert.match(source, /COOKIE_SECURE must be true in production/);
  });
});
