import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

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

const jiti = createJiti(import.meta.url);
const { getLastOpen, setLastOpen, clearLastOpen, workspaceKeyOf, getLastWorkspace, setLastWorkspace, clearLastWorkspace, getWelcomeState, setWelcomeState, clearWelcomeState } = await jiti.import("./workspace-memory.ts");

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

test("looks up keys case-insensitively on Windows (drive-letter spelling)", () => {
  setLastOpen("E:/Dev/pi-web-main", { kind: "session", id: "s1" });
  const lower = getLastOpen("e:/dev/pi-web-main");
  const upper = getLastOpen("E:/Dev/pi-web-main");
  if (process.platform === "win32") {
    assert.deepEqual(lower, { kind: "session", id: "s1" });
    assert.deepEqual(upper, { kind: "session", id: "s1" });
  } else {
    assert.equal(lower, null);
    assert.deepEqual(upper, { kind: "session", id: "s1" });
  }
  // Normalized writes land on the uppercase key.
  setLastOpen("e:/dev/other", { kind: "draft", id: "d9" });
  assert.deepEqual(getLastOpen("E:/Dev/other"), { kind: "draft", id: "d9" });
  clearLastOpen("e:/dev/other");
  assert.equal(getLastOpen("E:/Dev/other"), null);
});

test("matches keys across separator styles on Windows (backslash records)", () => {
  if (process.platform !== "win32") return; // Windows-only concern
  // pi session records use backslashes; lobby detection uses forward slashes.
  setLastOpen("E:\\Dev\\pi-web-main", { kind: "session", id: "s-bs" });
  assert.deepEqual(getLastOpen("E:/Dev/pi-web-main"), { kind: "session", id: "s-bs" });
  // Writes fold to the canonical forward-slash key; the old record is cleared.
  clearLastOpen("E:\\Dev\\pi-web-main");
  assert.equal(getLastOpen("E:/Dev/pi-web-main"), null);
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

test("last workspace round-trips and clears independently", () => {
  setLastWorkspace("/repo");
  assert.equal(getLastWorkspace(), "/repo");
  clearLastWorkspace();
  assert.equal(getLastWorkspace(), null);
  // Clearing the last workspace must not disturb the welcome flag.
  setWelcomeState();
  clearLastWorkspace();
  assert.equal(getWelcomeState(), true);
  clearWelcomeState();
});

test("welcome state arms, reads and disarms", () => {
  assert.equal(getWelcomeState(), false);
  setWelcomeState();
  assert.equal(getWelcomeState(), true);
  setWelcomeState(); // idempotent
  assert.equal(getWelcomeState(), true);
  clearWelcomeState();
  assert.equal(getWelcomeState(), false);
  // Disarming must not disturb the last-workspace memory.
  setLastWorkspace("/repo");
  clearWelcomeState();
  assert.equal(getLastWorkspace(), "/repo");
});
