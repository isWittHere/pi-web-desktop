import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  return import("./session-cache.ts");
}

const { setCachedSession, getCachedSession, clearSessionCache } = await loadSubject();

function snapshot(id, count = 1) {
  return {
    sessionId: id,
    context: {
      messages: Array.from({ length: count }, (_, i) => ({ content: `msg-${i}-${"x".repeat(10)}` })),
      entryIds: Array.from({ length: count }, (_, i) => `entry-${i}`),
    },
  };
}

test("set and get round-trips a snapshot with its mtime anchor", () => {
  clearSessionCache();
  setCachedSession("a", snapshot("a"), "2026-01-01T00:00:00.000Z");
  const entry = getCachedSession("a");
  assert.ok(entry);
  assert.equal(entry.infoModified, "2026-01-01T00:00:00.000Z");
  assert.equal(entry.data.context.entryIds.length, 1);
  assert.equal(entry.data.context.messages[0].content.startsWith("msg-"), true);
});

test("rejects snapshots without an mtime anchor", () => {
  clearSessionCache();
  setCachedSession("a", snapshot("a"), "");
  assert.equal(getCachedSession("a"), null);
});

test("re-setting the same id replaces the previous snapshot", () => {
  clearSessionCache();
  setCachedSession("a", snapshot("a", 1), "t1");
  setCachedSession("a", snapshot("a", 3), "t2");
  const entry = getCachedSession("a");
  assert.equal(entry.data.context.entryIds.length, 3);
  assert.equal(entry.infoModified, "t2");
});

test("LRU evicts the oldest entry when over the entry cap", () => {
  clearSessionCache();
  for (let i = 0; i < 10; i++) setCachedSession(`s${i}`, snapshot(`s${i}`), `t${i}`);
  // 10 writes with a cap of 8 → the two oldest (s0, s1) are evicted.
  assert.equal(getCachedSession("s0"), null);
  assert.equal(getCachedSession("s1"), null);
  assert.ok(getCachedSession("s9"));
  // Touching s2 makes s3 the next eviction candidate instead.
  getCachedSession("s2");
  setCachedSession("s10", snapshot("s10"), "t10");
  assert.ok(getCachedSession("s2"));
  assert.equal(getCachedSession("s3"), null);
});

test("missing sessions return null", () => {
  clearSessionCache();
  assert.equal(getCachedSession("nope"), null);
});
