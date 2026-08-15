/**
 * Workspace tab state — pure logic, no React dependency.
 *
 * A workspace tab is a bookmark + switch entry for one workspace (project
 * root when known, else cwd — the same key `workspaceKeyOf()` produces).
 * Closing a tab never touches sessions/tasks: it only removes the bookmark.
 * The chat area is driven by the same single-workspace state machine as the
 * classic view; the tab list only remembers which workspaces were opened and
 * which one is active.
 */

export interface WorkspaceTab {
  /** Workspace identity: projectRoot ?? cwd (see workspaceKeyOf()). */
  key: string;
  /** Effective cwd — may be a worktree path inside the project. */
  cwd: string;
}

export interface WorkspaceTabsState {
  tabs: WorkspaceTab[];
  /** Key of the active tab, or null when no tab is open. */
  activeKey: string | null;
}

export const EMPTY_WORKSPACE_TABS: WorkspaceTabsState = {
  tabs: [],
  activeKey: null,
};

/**
 * Open a workspace as a tab (or focus the existing one — dedupe semantics).
 * New tabs are appended to the right and activated.
 */
export function openWorkspace(
  state: WorkspaceTabsState,
  key: string,
  cwd: string,
): WorkspaceTabsState {
  const existing = state.tabs.find((t) => t.key === key);
  if (existing) {
    return state.activeKey === key ? state : { tabs: state.tabs, activeKey: key };
  }
  return {
    tabs: [...state.tabs, { key, cwd }],
    activeKey: key,
  };
}

/**
 * Close a tab. When the active tab is closed, the right neighbour becomes
 * active (or the left neighbour when it was the last). An empty tab list has
 * no active key. Never touches sessions or tasks.
 */
export function closeTab(state: WorkspaceTabsState, key: string): WorkspaceTabsState {
  const idx = state.tabs.findIndex((t) => t.key === key);
  if (idx === -1) return state;
  const tabs = state.tabs.filter((t) => t.key !== key);
  let activeKey = state.activeKey;
  if (state.activeKey === key) {
    if (tabs.length === 0) {
      activeKey = null;
    } else if (idx < tabs.length) {
      activeKey = tabs[idx].key; // right neighbour
    } else {
      activeKey = tabs[tabs.length - 1].key; // was the last — left neighbour
    }
  }
  return { tabs, activeKey };
}

/** Activate an existing tab (no-op for unknown keys or the active tab). */
export function activateTab(state: WorkspaceTabsState, key: string): WorkspaceTabsState {
  if (state.activeKey === key) return state;
  if (!state.tabs.some((t) => t.key === key)) return state;
  return { tabs: state.tabs, activeKey: key };
}

/** Update the cwd of an existing tab (worktree switch inside a repo). */
export function updateTabCwd(
  state: WorkspaceTabsState,
  key: string,
  cwd: string,
): WorkspaceTabsState {
  if (!state.tabs.some((t) => t.key === key)) return state;
  return {
    tabs: state.tabs.map((t) => (t.key === key ? { ...t, cwd } : t)),
    activeKey: state.activeKey,
  };
}

/**
 * Move a tab to the position of another tab (browser-style reorder).
 * `position` picks the slot relative to the target tab. The active tab stays
 * active — reordering never changes the visible workspace. Unknown keys or a
 * move onto the tab itself are no-ops.
 */
export function reorderTab(
  state: WorkspaceTabsState,
  fromKey: string,
  targetKey: string,
  position: "before" | "after",
): WorkspaceTabsState {
  if (fromKey === targetKey) return state;
  const fromIdx = state.tabs.findIndex((t) => t.key === fromKey);
  const targetIdx = state.tabs.findIndex((t) => t.key === targetKey);
  if (fromIdx === -1 || targetIdx === -1) return state;
  const tabs = [...state.tabs];
  const [moved] = tabs.splice(fromIdx, 1);
  // Removal may have shifted the target index one slot left.
  let insertAt = position === "after" ? targetIdx + 1 : targetIdx;
  if (fromIdx < targetIdx) insertAt -= 1;
  tabs.splice(Math.min(insertAt, tabs.length), 0, moved);
  return { tabs, activeKey: state.activeKey };
}

/** Classic → tabs migration: the current workspace becomes the only tab. */
export function resetToSingle(cwd: string, key: string): WorkspaceTabsState {
  return { tabs: [{ key, cwd }], activeKey: key };
}
