import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");

function handleSessionDeletedBody() {
  const start = source.indexOf("  const handleSessionDeleted = useCallback");
  const end = source.indexOf("  const handleOpenFile = useCallback", start);
  assert.notEqual(start, -1, "handleSessionDeleted callback not found");
  assert.notEqual(end, -1, "handleOpenFile callback not found after handleSessionDeleted");
  const whole = source.slice(start, end);
  // `const handleSessionDeleted = useCallback(<arrow>, [deps]);` -> the arrow alone.
  const arrow = whole.slice(whole.indexOf("useCallback(") + "useCallback(".length, whole.lastIndexOf(", ["));
  return arrow.trim();
}

// Runs the actual callback in a vm sandbox. `capturedSelectedSession` models the
// stale state the closure captured at the delete click; `active` is what the
// render-synced ref holds when the DELETE finally completes.
function runHandleSessionDeleted(capturedSelectedSession, active) {
  const state = {
    refreshBumped: 0,
    sessionKey: 0,
    selectedSession: [],
    activeDraftId: [],
    systemPrompt: [],
    activeTopPanel: [],
    welcomeDrafts: [],
  };
  const context = vm.createContext({
    console,
    setRefreshKey: (fn) => { state.refreshBumped = fn(state.refreshBumped); },
    setSessionKey: (fn) => { state.sessionKey = fn(state.sessionKey); },
    setSelectedSession: (value) => state.selectedSession.push(value),
    setActiveDraftId: (value) => state.activeDraftId.push(value),
    setSystemPrompt: (value) => state.systemPrompt.push(value),
    setActiveTopPanel: (value) => state.activeTopPanel.push(value),
    openWelcomeDraft: (cwd, workspaceKey) => state.welcomeDrafts.push([cwd, workspaceKey]),
    workspaceKeyOf: (session) => session.cwd,
    // The stale closure value, if the code reads it.
    selectedSession: capturedSelectedSession,
    selectedSessionRef: { current: active },
  });
  vm.runInContext(`const handleSessionDeleted = (${stripTypeScriptTypes(handleSessionDeletedBody())});`, context);
  const callback = vm.runInContext("handleSessionDeleted", context);
  callback("session-1");
  return state;
}

const session = (id, cwd) => ({ id, cwd, projectRoot: cwd, name: id });

test("deleting the session you are still on falls back to a fresh composer", () => {
  const active = session("session-1", "/repo");
  const state = runHandleSessionDeleted(active, active);
  assert.equal(state.refreshBumped, 1);
  assert.deepEqual(state.selectedSession, [null]);
  assert.deepEqual(state.welcomeDrafts, [["/repo", "/repo"]]);
  assert.equal(state.sessionKey, 1);
});

test("a delete that completes after you navigated away does not force an empty chat", () => {
  // The closure still holds the deleted session; the ref holds where the user
  // actually is by the time the removal completes.
  const deleted = session("session-1", "/repo");
  const elsewhere = session("session-2", "/other");
  const state = runHandleSessionDeleted(deleted, elsewhere);

  // The list still refreshes, but nothing is navigated away from.
  assert.equal(state.refreshBumped, 1);
  assert.deepEqual(state.selectedSession, []);
  assert.deepEqual(state.welcomeDrafts, []);
  assert.equal(state.sessionKey, 0);
});

test("a delete of a session that was never selected touches nothing but the list", () => {
  const active = session("session-2", "/other");
  const state = runHandleDeletedNeverSelected(active);
  assert.equal(state.refreshBumped, 1);
  assert.deepEqual(state.selectedSession, []);
  assert.deepEqual(state.welcomeDrafts, []);
});

function runHandleDeletedNeverSelected(active) {
  // The closure captured null (nothing was selected at the click), the ref
  // holds a different session now.
  return runHandleSessionDeleted(null, active);
}

test("the callback reads the render-synced ref, not its captured selection", () => {
  const body = handleSessionDeletedBody();
  assert.match(body, /const active = selectedSessionRef\.current;/);
  assert.match(body, /if \(active\?\.id === sessionId\)/);
  // The captured value must not decide the branch any more.
  assert.doesNotMatch(body, /selectedSession\?\.id === sessionId/);
  // The ref is kept in step on every render.
  assert.match(source, /const selectedSessionRef = useRef\(selectedSession\);/);
  assert.match(source, /selectedSessionRef\.current = selectedSession;/);
});
