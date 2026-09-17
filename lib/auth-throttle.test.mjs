import assert from "node:assert/strict";
import { test } from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  backoffDelayMs,
  getAuthRetryAfterMs,
  recordAuthFailure,
  recordAuthSuccess,
} = await jiti.import("./auth-throttle.ts");

test("backoff doubles from a base delay up to a one-minute cap", () => {
  assert.equal(backoffDelayMs(1), 1_000);
  assert.equal(backoffDelayMs(2), 2_000);
  assert.equal(backoffDelayMs(3), 4_000);
  assert.equal(backoffDelayMs(60), 60_000);
  assert.equal(backoffDelayMs(0), 0);
});

test("failed attempts impose an increasing retry-after", () => {
  let now = 0;
  const state = { failures: 0, lastFailureAt: 0, blockedUntil: 0 };
  assert.equal(recordAuthFailure(now, state), 1_000);
  assert.equal(getAuthRetryAfterMs(now, state), 1_000);
  assert.equal(recordAuthFailure(now + 1, state), 2_000);
  assert.equal(getAuthRetryAfterMs(now + 1, state), 2_000);
});

test("a success resets the counter immediately", () => {
  let now = 0;
  const state = { failures: 0, lastFailureAt: 0, blockedUntil: 0 };
  recordAuthFailure(now, state);
  recordAuthFailure(now + 1, state);
  assert.ok(getAuthRetryAfterMs(now + 1, state) > 0);
  recordAuthSuccess(state);
  assert.equal(getAuthRetryAfterMs(now + 100, state), 0);
});

test("an idle window longer than the max delay forgets the counter", () => {
  let now = 0;
  const state = { failures: 0, lastFailureAt: 0, blockedUntil: 0 };
  recordAuthFailure(now, state);
  assert.equal(getAuthRetryAfterMs(now, state), 1_000);
  // Five full minutes idle (reset window) clears the block.
  assert.equal(getAuthRetryAfterMs(now + 5 * 60_000, state), 0);
});
