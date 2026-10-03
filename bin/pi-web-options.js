"use strict";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { parseArgs } = require("util");

// Environment variables recognized by the server (passed through untouched):
//   PI_WEB_PASSWORD               Enable browser password login
//   PI_WEB_ALLOWED_HOSTS          Extra exact proxy/custom hostnames, comma-separated
//   PI_WEB_IDLE_TIMEOUT_MS        Session idle timeout in ms (0 disables; default 600000)
//   PI_WEB_SHUTDOWN_DEADLINE_MS   Shutdown wait for extensions in ms (default 5000)
//   PI_WEB_MCP_IDLE_MS            Idle MCP connection teardown in ms (0 keeps connections until the session closes; default 600000)
//   PI_WEB_DISABLE_MCP            Set to 1 to disable MCP servers for the whole server

const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);

function isEnabled(value) {
  return typeof value === "string" && TRUE_VALUES.has(value.trim().toLowerCase());
}

function normalizePort(value) {
  if (typeof value !== "string" || !/^\d+$/.test(value)) {
    throw new Error("Port must be a non-negative integer.");
  }

  const port = Number(value);
  if (!Number.isSafeInteger(port) || port > 65535) {
    throw new Error("Port must be between 0 and 65535.");
  }

  return String(port);
}

function parseLaunchOptions(args = process.argv.slice(2), env = process.env) {
  const { values: cliArgs } = parseArgs({
    args,
    options: {
      port:      { type: "string", short: "p" },
      hostname:  { type: "string", short: "H" },
      "no-open": { type: "boolean" },
    },
    strict: false,
  });

  return {
    port: normalizePort(cliArgs.port ?? env.PORT ?? "30141"),
    hostname: cliArgs.hostname ?? env.PI_WEB_HOSTNAME ?? "127.0.0.1",
    openBrowser: !cliArgs["no-open"] && !isEnabled(env.PI_WEB_NO_OPEN),
  };
}

module.exports = { parseLaunchOptions };
