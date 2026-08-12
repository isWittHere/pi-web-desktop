import assert from "node:assert/strict";
import test from "node:test";

import { parseLaunchOptions } from "./pi-web-options.js";

test("defaults to port 30141 on loopback", () => {
  const options = parseLaunchOptions([], {});
  assert.equal(options.port, "30141");
  assert.equal(options.hostname, "127.0.0.1");
  assert.equal(options.openBrowser, true);
});

test("reads the port from the CLI flag or the environment", () => {
  assert.equal(parseLaunchOptions(["--port", "8123"], {}).port, "8123");
  assert.equal(parseLaunchOptions([], { PORT: "9000" }).port, "9000");
});

test("rejects invalid ports", () => {
  assert.throws(() => parseLaunchOptions(["--port", "abc"], {}), /non-negative integer/);
  assert.throws(() => parseLaunchOptions(["--port", "-1"], {}), /non-negative integer/);
  assert.throws(() => parseLaunchOptions(["--port", "65536"], {}), /between 0 and 65535/);
  assert.throws(() => parseLaunchOptions([], { PORT: "99999" }), /between 0 and 65535/);
});

test("honors the no-open flag and PI_WEB_NO_OPEN env", () => {
  assert.equal(parseLaunchOptions(["--no-open"], {}).openBrowser, false);
  assert.equal(parseLaunchOptions([], { PI_WEB_NO_OPEN: "1" }).openBrowser, false);
  assert.equal(parseLaunchOptions([], { PI_WEB_NO_OPEN: "true" }).openBrowser, false);
  assert.equal(parseLaunchOptions([], { PI_WEB_NO_OPEN: "0" }).openBrowser, true);
});
