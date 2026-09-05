import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

// right-tabs-memory reads window.localStorage at call time — provide a minimal
// mock before exercising the functions (same pattern as workspace-memory).
const store = new Map();
globalThis.window = {
  localStorage: {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  },
};

const jiti = createJiti(import.meta.url);
const { loadRightTabs, saveRightTabs, sanitizeTabs } = await jiti.import("./right-tabs-memory.ts");

const fileTab = {
  kind: "file",
  id: "file:/repo/a.ts",
  label: "a.ts",
  filePath: "/repo/a.ts",
  sourceSessionId: "session-1",
  viewerState: { displayMode: "diff", wrapLines: true, scrollTop: 12, scrollLeft: 0 },
  viewerRevision: 2,
};

test("round-trips the tab set per workspace", () => {
  saveRightTabs("/repo-a", {
    tabs: [fileTab, { kind: "changes", id: "changes:/repo-a", cwd: "/repo-a" }],
    activeTabId: "file:/repo/a.ts",
    open: true,
  });
  const restored = loadRightTabs("/repo-a");
  assert.deepEqual(restored, {
    tabs: [fileTab, { kind: "changes", id: "changes:/repo-a", cwd: "/repo-a" }],
    activeTabId: "file:/repo/a.ts",
    open: true,
  });
  assert.equal(loadRightTabs("/repo-b"), null);

  saveRightTabs("/repo-b", { tabs: [], activeTabId: null, open: false });
  assert.deepEqual(loadRightTabs("/repo-b"), { tabs: [], activeTabId: null, open: false });
});

test("sanitizes malformed stored tabs instead of failing the restore", () => {
  const tabs = sanitizeTabs([
    fileTab,
    null,
    "junk",
    { kind: "unknown-kind", id: "x" },
    { kind: "file", id: "", filePath: "/repo/b.ts", label: "b.ts" },
    { kind: "file", filePath: "/repo/b.ts", label: "b.ts" },
    { kind: "file", id: "file:/repo/b.ts", label: "", filePath: "/repo/b.ts" },
    { kind: "file", id: "file:/repo/c.ts", label: "c.ts", filePath: "/repo/c.ts", viewerState: { displayMode: "bogus" } },
    { kind: "git-graph", id: "git-graph:/repo", cwd: "/repo" },
  ]);
  // An invalid viewerState drops the state but keeps the tab.
  assert.deepEqual(tabs, [
    fileTab,
    { kind: "file", id: "file:/repo/c.ts", label: "c.ts", filePath: "/repo/c.ts" },
    { kind: "git-graph", id: "git-graph:/repo", cwd: "/repo" },
  ]);
});

test("sanitizeTabs rejects non-array input", () => {
  assert.deepEqual(sanitizeTabs(null), []);
  assert.deepEqual(sanitizeTabs({}), []);
  assert.deepEqual(sanitizeTabs("tabs"), []);
});

test("an entry whose JSON was truncated loads as null", () => {
  store.set("pi-web:right-tabs-by-workspace", '{"repo-a":{"tabs":[{');
  assert.equal(loadRightTabs("/repo-a"), null);
});

test("overwrites the targeted workspace without touching others", () => {
  saveRightTabs("/repo-a", { tabs: [fileTab], activeTabId: null, open: false });
  saveRightTabs("/repo-b", { tabs: [], activeTabId: null, open: false });
  saveRightTabs("/repo-a", { tabs: [], activeTabId: null, open: true });
  assert.deepEqual(loadRightTabs("/repo-a"), { tabs: [], activeTabId: null, open: true });
  assert.deepEqual(loadRightTabs("/repo-b"), { tabs: [], activeTabId: null, open: false });
});
