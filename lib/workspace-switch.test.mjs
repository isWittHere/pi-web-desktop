import assert from "node:assert/strict";
import test from "node:test";

import { shouldNotifyCwdChange } from "./workspace-switch.ts";

const IDLE_STATE = { lastNotifiedCwd: null, lastConsumedToken: 0 };

test("no state change and no request: no notification", () => {
  const d = shouldNotifyCwdChange(null, null, IDLE_STATE);
  assert.equal(d.notify, false);
  assert.equal(d.lastConsumedToken, 0);
});

test("initial mirror state (cwd null, no request): no notification on mount", () => {
  const d = shouldNotifyCwdChange(null, null, IDLE_STATE);
  assert.equal(d.notify, false);
});

test("sidebar-internal cwd change notifies without consuming a token", () => {
  const d = shouldNotifyCwdChange("/projA", null, IDLE_STATE);
  assert.equal(d.notify, true);
  assert.equal(d.lastNotifiedCwd, "/projA");
  assert.equal(d.lastConsumedToken, 0);
});

test("re-issued request for the already-effective cwd re-notifies and consumes its token", () => {
  const request = { cwd: "/projA", projectKey: "/projA", token: 7 };
  const state = { lastNotifiedCwd: "/projA", lastConsumedToken: 6 };
  const d = shouldNotifyCwdChange("/projA", request, state);
  assert.equal(d.notify, true);
  assert.equal(d.lastConsumedToken, 7);
});

test("an already-consumed request does not re-notify", () => {
  const request = { cwd: "/projA", projectKey: "/projA", token: 7 };
  const state = { lastNotifiedCwd: "/projA", lastConsumedToken: 7 };
  const d = shouldNotifyCwdChange("/projA", request, state);
  assert.equal(d.notify, false);
});

test("a request whose cwd is not applied yet waits (no notify, not consumed)", () => {
  // The notify effect can observe the request before the apply effect has
  // committed the new selectedCwd; the notification must then ride on the
  // changed-cwd pass that follows.
  const request = { cwd: "/projB", projectKey: "/projB", token: 3 };
  const state = { lastNotifiedCwd: "/projA", lastConsumedToken: 2 };
  const d = shouldNotifyCwdChange("/projA", request, state);
  assert.equal(d.notify, false);
  assert.equal(d.lastConsumedToken, 2);
});

test("after the apply lands, a pending request notifies with its token consumed", () => {
  const request = { cwd: "/projB", projectKey: "/projB", token: 3 };
  const state = { lastNotifiedCwd: "/projA", lastConsumedToken: 2 };
  const d = shouldNotifyCwdChange("/projB", request, state);
  assert.equal(d.notify, true);
  assert.equal(d.lastNotifiedCwd, "/projB");
  assert.equal(d.lastConsumedToken, 3);
});

test("a null-cwd request (last tab closed) notifies once when the cwd cleared", () => {
  const request = { cwd: null, token: 9 };
  const d = shouldNotifyCwdChange(null, request, { lastNotifiedCwd: "/projA", lastConsumedToken: 8 });
  assert.equal(d.notify, true);
  assert.equal(d.lastConsumedToken, 9);
  const again = shouldNotifyCwdChange(null, request, { lastNotifiedCwd: null, lastConsumedToken: 9 });
  assert.equal(again.notify, false);
});
