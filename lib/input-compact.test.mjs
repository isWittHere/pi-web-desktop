import test from "node:test";
import assert from "node:assert/strict";

const { scrollRemaining, nextInputCompactState, COMPACT_COLLAPSE_TRIGGER, COMPACT_RESTORE_TRIGGER } = await import("./input-compact.ts");

test("scrollRemaining reports the raw distance below the viewport", () => {
  assert.equal(scrollRemaining({ scrollHeight: 1000, scrollTop: 900, clientHeight: 100 }), 0);
  assert.equal(scrollRemaining({ scrollHeight: 1000, scrollTop: 891, clientHeight: 100 }), 9);
  // Content shorter than the container → negative (never at risk of collapse).
  assert.equal(scrollRemaining({ scrollHeight: 100, scrollTop: 0, clientHeight: 200 }), -100);
});

test("reaching the bottom restores only while actively scrolling down", () => {
  assert.equal(nextInputCompactState(true, { kind: "scroll", remaining: 0, direction: "down", userIntent: true }), false);
  assert.equal(nextInputCompactState(true, { kind: "scroll", remaining: 5, direction: "down", userIntent: false }), false);
  // Exactly at the restore trigger still counts as the bottom.
  assert.equal(nextInputCompactState(true, { kind: "scroll", remaining: COMPACT_RESTORE_TRIGGER, direction: "down", userIntent: true }), false);
});

test("an upward or directionless scroll at the bottom never restores", () => {
  // The collapse grows the reading area, the browser clamps the viewport back
  // to the bottom, and the ResizeObserver re-evaluates with no scroll delta —
  // none of these must re-expand the input, or leaving the bottom flickers.
  assert.equal(nextInputCompactState(true, { kind: "scroll", remaining: 0, direction: "up", userIntent: true }), true);
  assert.equal(nextInputCompactState(true, { kind: "scroll", remaining: 0, direction: "none", userIntent: true }), true);
});

test("just above the restore trigger is not the bottom anymore", () => {
  assert.equal(nextInputCompactState(true, { kind: "scroll", remaining: COMPACT_RESTORE_TRIGGER + 1, direction: "up", userIntent: true }), true);
});

test("collapsing requires a real upward user scroll far above the bottom", () => {
  const far = COMPACT_COLLAPSE_TRIGGER + 1;
  assert.equal(nextInputCompactState(false, { kind: "scroll", remaining: far, direction: "up", userIntent: true }), true);
  // Too close to the bottom: the collapse would pull the viewport back down.
  assert.equal(nextInputCompactState(false, { kind: "scroll", remaining: 40, direction: "up", userIntent: true }), false);
  // Programmatic scrolls must never collapse.
  assert.equal(nextInputCompactState(false, { kind: "scroll", remaining: far, direction: "up", userIntent: false }), false);
  // Wrong direction / no direction must never collapse.
  assert.equal(nextInputCompactState(false, { kind: "scroll", remaining: far, direction: "down", userIntent: true }), false);
  assert.equal(nextInputCompactState(false, { kind: "scroll", remaining: far, direction: "none", userIntent: true }), false);
});

test("staying above the bottom keeps the state", () => {
  const far = COMPACT_COLLAPSE_TRIGGER + 50;
  assert.equal(nextInputCompactState(true, { kind: "scroll", remaining: far, direction: "up", userIntent: true }), true);
  assert.equal(nextInputCompactState(false, { kind: "scroll", remaining: far, direction: "up", userIntent: true }), true);
});

test("focus always expands", () => {
  assert.equal(nextInputCompactState(true, { kind: "focus" }), false);
  assert.equal(nextInputCompactState(false, { kind: "focus" }), false);
});
