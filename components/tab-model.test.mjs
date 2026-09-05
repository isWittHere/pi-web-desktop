import assert from "node:assert/strict";
import test from "node:test";

import {
  changesTabId,
  fileTabId,
  gitGraphTabId,
  openFileTab,
  openViewTab,
  saveFileViewerState,
} from "./tab-model.ts";

const tabA = {
  kind: "file",
  id: "file:/repo/a.ts",
  label: "a.ts",
  filePath: "/repo/a.ts",
  viewerRevision: 0,
  viewerState: {
    displayMode: "source",
    wrapLines: true,
    scrollTop: 240,
    scrollLeft: 16,
  },
};

const tabB = {
  kind: "file",
  id: "file:/repo/b.ts",
  label: "b.ts",
  filePath: "/repo/b.ts",
  viewerRevision: 0,
};

const openA = {
  fileName: "a.ts",
  filePath: "/repo/a.ts",
  tabId: "file:/repo/a.ts",
};

test("saving viewer state updates only the matching revision", () => {
  const tabs = [tabA, tabB];
  const nextState = { ...tabA.viewerState, scrollTop: 480 };
  const saved = saveFileViewerState(tabs, tabA.id, 0, nextState);

  assert.notStrictEqual(saved, tabs);
  assert.deepEqual(saved[0].viewerState, nextState);
  assert.strictEqual(saved[1], tabB);

  const stale = saveFileViewerState(saved, tabA.id, 9, tabA.viewerState);
  assert.strictEqual(stale, saved);
});

test("opening an existing tab normally preserves its state and revision", () => {
  const tabs = [tabA, tabB];
  assert.strictEqual(openFileTab(tabs, openA), tabs);
});

test("changing the source session remounts the viewer without losing its state", () => {
  const [next] = openFileTab([tabA], { ...openA, sourceSessionId: "session-2" });
  assert.equal(next.sourceSessionId, "session-2");
  assert.equal(next.viewerRevision, 1);
  assert.strictEqual(next.viewerState, tabA.viewerState);
});

test("opening from the same source session preserves the viewer revision", () => {
  const tab = { ...tabA, sourceSessionId: "session-1" };
  const tabs = [tab];
  assert.strictEqual(
    openFileTab(tabs, { ...openA, sourceSessionId: "session-1" }),
    tabs,
  );
});

test("changing source while forcing diff increments the revision once", () => {
  const [next] = openFileTab([tabA], {
    ...openA,
    sourceSessionId: "session-2",
    modeHint: "diff",
  });
  assert.equal(next.sourceSessionId, "session-2");
  assert.equal(next.viewerRevision, 1);
  assert.equal(next.viewerState.displayMode, "diff");
});

test("every explicit diff activation resets the mode and increments the revision", () => {
  const first = openFileTab([tabA, tabB], { ...openA, modeHint: "diff" });
  assert.equal(first[0].viewerRevision, 1);
  assert.deepEqual(first[0].viewerState, {
    displayMode: "diff",
    wrapLines: true,
    scrollTop: 0,
    scrollLeft: 0,
  });

  const returnedToSource = saveFileViewerState(first, tabA.id, 1, tabA.viewerState);
  const second = openFileTab(returnedToSource, { ...openA, modeHint: "diff" });
  assert.equal(second[0].viewerRevision, 2);
  assert.equal(second[0].viewerState.displayMode, "diff");
});

test("a remounted viewer ignores the previous revision's late cleanup", () => {
  const reopened = openFileTab([tabA], { ...openA, modeHint: "diff" });
  const stale = saveFileViewerState(reopened, tabA.id, 0, tabA.viewerState);
  assert.strictEqual(stale, reopened);
  assert.equal(stale[0].viewerState.displayMode, "diff");
});

test("file tab ids are prefixed with the file scheme", () => {
  assert.equal(fileTabId("/repo/a.ts"), "file:/repo/a.ts");
});

test("view tabs are workspace singletons", () => {
  const first = openViewTab([], { kind: "changes", cwd: "/repo" });
  assert.deepEqual(first, [{ kind: "changes", id: "changes:/repo", cwd: "/repo" }]);

  // Re-opening with the same cwd keeps the exact same array and tab.
  assert.strictEqual(openViewTab(first, { kind: "changes", cwd: "/repo" }), first);

  const both = openViewTab(first, { kind: "git-graph", cwd: "/repo" });
  assert.deepEqual(both, [
    { kind: "changes", id: "changes:/repo", cwd: "/repo" },
    { kind: "git-graph", id: "git-graph:/repo", cwd: "/repo" },
  ]);

  // A different workspace gets its own singleton instance.
  const otherWorkspace = openViewTab(both, { kind: "changes", cwd: "/other" });
  assert.equal(otherWorkspace.length, 3);
  assert.equal(changesTabId("/other"), "changes:/other");
  assert.equal(gitGraphTabId("/other"), "git-graph:/other");
});

test("re-opening an id that belongs to a view tab leaves the view tab untouched", () => {
  const viewTab = { kind: "changes", id: "changes:/repo", cwd: "/repo" };
  const tabs = [viewTab];
  assert.strictEqual(openFileTab(tabs, { ...openA, tabId: "changes:/repo" }), tabs);
});
