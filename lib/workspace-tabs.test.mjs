import test from "node:test";
import assert from "node:assert/strict";
import {
  EMPTY_WORKSPACE_TABS,
  activateTab,
  closeTab,
  openWorkspace,
  reorderTab,
  resetToSingle,
  updateTabCwd,
} from "./workspace-tabs.ts";

test("openWorkspace appends a new tab and activates it", () => {
  const s1 = openWorkspace(EMPTY_WORKSPACE_TABS, "proj-a", "/a");
  assert.deepEqual(s1.tabs, [{ key: "proj-a", cwd: "/a" }]);
  assert.equal(s1.activeKey, "proj-a");

  const s2 = openWorkspace(s1, "proj-b", "/b");
  assert.deepEqual(s2.tabs.map((t) => t.key), ["proj-a", "proj-b"]);
  assert.equal(s2.activeKey, "proj-b");
  assert.equal(s2.tabs[1].cwd, "/b");
});

test("openWorkspace focuses an existing tab instead of duplicating", () => {
  const s1 = openWorkspace(openWorkspace(EMPTY_WORKSPACE_TABS, "proj-a", "/a"), "proj-b", "/b");
  const s2 = openWorkspace(s1, "proj-a", "/a");
  assert.deepEqual(s2.tabs.map((t) => t.key), ["proj-a", "proj-b"]);
  assert.equal(s2.activeKey, "proj-a");
  // Re-opening the already-active tab is a no-op (same reference).
  assert.equal(openWorkspace(s2, "proj-a", "/a"), s2);
});

test("closeTab removes a non-active tab without touching the active key", () => {
  const s = openWorkspace(openWorkspace(EMPTY_WORKSPACE_TABS, "proj-a", "/a"), "proj-b", "/b");
  const closed = closeTab(s, "proj-a");
  assert.deepEqual(closed.tabs.map((t) => t.key), ["proj-b"]);
  assert.equal(closed.activeKey, "proj-b");
});

test("closeTab on the active tab activates the right neighbour", () => {
  const s = openWorkspace(
    openWorkspace(openWorkspace(EMPTY_WORKSPACE_TABS, "a", "/a"), "b", "/b"),
    "c",
    "/c",
  );
  // active = c (last). Close b? b is not active → active stays c.
  const closedB = closeTab(s, "b");
  assert.deepEqual(closedB.tabs.map((t) => t.key), ["a", "c"]);
  assert.equal(closedB.activeKey, "c");
  // Close the active (c) → right neighbour does not exist → left neighbour (a).
  const closedC = closeTab(closedB, "c");
  assert.deepEqual(closedC.tabs.map((t) => t.key), ["a"]);
  assert.equal(closedC.activeKey, "a");
});

test("closeTab on an active middle tab activates its right neighbour", () => {
  const s = openWorkspace(
    openWorkspace(openWorkspace(EMPTY_WORKSPACE_TABS, "a", "/a"), "b", "/b"),
    "c",
    "/c",
  );
  const focused = activateTab(s, "b");
  const closed = closeTab(focused, "b");
  assert.deepEqual(closed.tabs.map((t) => t.key), ["a", "c"]);
  assert.equal(closed.activeKey, "c");
});

test("closeTab on the last tab empties the state", () => {
  const s = openWorkspace(EMPTY_WORKSPACE_TABS, "a", "/a");
  const closed = closeTab(s, "a");
  assert.deepEqual(closed, EMPTY_WORKSPACE_TABS);
});

test("closeTab ignores unknown keys", () => {
  const s = openWorkspace(EMPTY_WORKSPACE_TABS, "a", "/a");
  assert.equal(closeTab(s, "nope"), s);
});

test("activateTab focuses an existing tab and ignores unknown ones", () => {
  const s = openWorkspace(openWorkspace(EMPTY_WORKSPACE_TABS, "a", "/a"), "b", "/b");
  const focused = activateTab(s, "a");
  assert.equal(focused.activeKey, "a");
  assert.equal(activateTab(s, "nope"), s);
});

test("updateTabCwd updates cwd of an existing tab only", () => {
  const s = openWorkspace(openWorkspace(EMPTY_WORKSPACE_TABS, "a", "/a"), "b", "/b/main");
  const updated = updateTabCwd(s, "b", "/b/worktree");
  assert.equal(updated.tabs[1].cwd, "/b/worktree");
  // The other tab is untouched and the active key is preserved.
  assert.equal(updated.tabs[0].cwd, "/a");
  assert.equal(updated.activeKey, "b");
  assert.equal(updateTabCwd(s, "nope", "/x"), s);
});

test("resetToSingle seeds the tabs state from the current workspace", () => {
  const s = resetToSingle("/proj", "proj-a");
  assert.deepEqual(s.tabs, [{ key: "proj-a", cwd: "/proj" }]);
  assert.equal(s.activeKey, "proj-a");
});

test("reorderTab moves a tab before the target", () => {
  const s = openWorkspace(
    openWorkspace(openWorkspace(openWorkspace(EMPTY_WORKSPACE_TABS, "a", "/a"), "b", "/b"), "c", "/c"),
    "d",
    "/d",
  );
  const moved = reorderTab(s, "d", "b", "before");
  assert.deepEqual(moved.tabs.map((t) => t.key), ["a", "d", "b", "c"]);
});

test("reorderTab moves a tab after the target", () => {
  const s = openWorkspace(
    openWorkspace(openWorkspace(EMPTY_WORKSPACE_TABS, "a", "/a"), "b", "/b"),
    "c",
    "/c",
  );
  const moved = reorderTab(s, "a", "c", "after");
  assert.deepEqual(moved.tabs.map((t) => t.key), ["b", "c", "a"]);
});

test("reorderTab moving backwards lands after the target's final slot", () => {
  const s = openWorkspace(
    openWorkspace(openWorkspace(EMPTY_WORKSPACE_TABS, "a", "/a"), "b", "/b"),
    "c",
    "/c",
  );
  // b moves after c: [a, b, c] → [a, c, b]
  const moved = reorderTab(s, "b", "c", "after");
  assert.deepEqual(moved.tabs.map((t) => t.key), ["a", "c", "b"]);
});

test("reorderTab onto the tab itself is a no-op", () => {
  const s = openWorkspace(openWorkspace(EMPTY_WORKSPACE_TABS, "a", "/a"), "b", "/b");
  assert.equal(reorderTab(s, "a", "a", "before"), s);
  assert.equal(reorderTab(s, "a", "a", "after"), s);
});

test("reorderTab ignores unknown keys and preserves the active key", () => {
  const s = openWorkspace(
    openWorkspace(openWorkspace(EMPTY_WORKSPACE_TABS, "a", "/a"), "b", "/b"),
    "c",
    "/c",
  );
  const focused = activateTab(s, "b");
  assert.equal(reorderTab(focused, "nope", "b", "before"), focused);
  assert.equal(reorderTab(focused, "b", "nope", "after"), focused);
  const moved = reorderTab(focused, "a", "c", "after");
  assert.deepEqual(moved.tabs.map((t) => t.key), ["b", "c", "a"]);
  assert.equal(moved.activeKey, "b"); // reordering never changes the active tab
});
