import assert from "node:assert/strict";
import test from "node:test";

// workspace-memory reads window.localStorage at call time — provide a minimal
// mock before exercising the functions (consistent with the pure-node test
// environment; the module only touches window inside its own try/catch).
const store = new Map();
globalThis.window = {
  localStorage: {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  },
};

const { getLastOpen, setLastOpen, clearLastOpen, workspaceKeyOf } = await import("./workspace-memory.ts");

test("round-trips the remembered context per workspace", () => {
  setLastOpen("/repo-a", { kind: "session", id: "s1" });
  setLastOpen("/repo-b", { kind: "draft", id: "d2" });
  assert.deepEqual(getLastOpen("/repo-a"), { kind: "session", id: "s1" });
  assert.deepEqual(getLastOpen("/repo-b"), { kind: "draft", id: "d2" });
  assert.equal(getLastOpen("/repo-c"), null);
});

test("clears only the targeted workspace", () => {
  setLastOpen("/repo-a", { kind: "session", id: "s1" });
  setLastOpen("/repo-b", { kind: "session", id: "s2" });
  clearLastOpen("/repo-a");
  assert.equal(getLastOpen("/repo-a"), null);
  assert.deepEqual(getLastOpen("/repo-b"), { kind: "session", id: "s2" });
});

test("rejects malformed or empty entries", () => {
  store.set(
    "pi-web:last-open-by-workspace",
    JSON.stringify({
      "/repo-a": { kind: "bogus", id: "x" },
      "/repo-b": { kind: "session" },
      "/repo-c": { kind: "session", id: "" },
    })
  );
  assert.equal(getLastOpen("/repo-a"), null);
  assert.equal(getLastOpen("/repo-b"), null);
  assert.equal(getLastOpen("/repo-c"), null);
  store.clear();
});

test("clearLastOpen drops the whole key when the map becomes empty", () => {
  setLastOpen("/repo-a", { kind: "session", id: "s1" });
  clearLastOpen("/repo-a");
  assert.equal(store.has("pi-web:last-open-by-workspace"), false);
});

test("workspaceKeyOf prefers the resolved project root", () => {
  assert.equal(workspaceKeyOf({ cwd: "/repo/wt", projectRoot: "/repo" }), "/repo");
  assert.equal(workspaceKeyOf({ cwd: "/plain", projectRoot: undefined }), "/plain");
  assert.equal(workspaceKeyOf({ cwd: "/plain", projectRoot: null }), "/plain");
});
