import { foldWindowsKey, isWindowsPlatform, normalizePathKey } from "./path-match";
import type { FileViewerState } from "./file-viewer-state";
import type { ChangesViewTab, FileTab, GitGraphViewTab, Tab } from "@/components/tab-model";

/**
 * Per-workspace right-panel tab memory.
 *
 * The right panel's tabs used to live only in React state, so an app restart
 * or reload lost the open file tabs — inconsistent with the rest of the
 * workspace context (last session, drafts, panel widths), which is persisted.
 * Tabs are stored per workspace key (resolved project root when known, else
 * cwd) so switching workspaces swaps the tab set instead of mixing them, and
 * every worktree of one repo shares a single slot.
 *
 * Stored in localStorage; best-effort (silently ignored if unavailable).
 * Restored data is sanitized: tabs saved by older builds, hand-edited storage,
 * or partially written JSON must never reach the panel as a malformed tab.
 */

export interface RightTabsEntry {
  tabs: Tab[];
  activeTabId: string | null;
  open: boolean;
}

const STORAGE_KEY = "pi-web:right-tabs-by-workspace";

const FILE_DISPLAY_MODES = new Set(["source", "preview", "diff"]);

function sanitizeViewerState(raw: unknown): FileViewerState | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const value = raw as Record<string, unknown>;
  if (typeof value.displayMode !== "string" || !FILE_DISPLAY_MODES.has(value.displayMode)) return undefined;
  if (typeof value.wrapLines !== "boolean") return undefined;
  if (typeof value.scrollTop !== "number" || !Number.isFinite(value.scrollTop)) return undefined;
  if (typeof value.scrollLeft !== "number" || !Number.isFinite(value.scrollLeft)) return undefined;
  return {
    displayMode: value.displayMode as FileViewerState["displayMode"],
    wrapLines: value.wrapLines,
    scrollTop: value.scrollTop,
    scrollLeft: value.scrollLeft,
  };
}

function sanitizeFileTab(raw: Record<string, unknown>): FileTab | null {
  if (typeof raw.id !== "string" || raw.id.length === 0) return null;
  if (typeof raw.filePath !== "string" || raw.filePath.length === 0) return null;
  if (typeof raw.label !== "string" || raw.label.length === 0) return null;
  const tab: FileTab = { kind: "file", id: raw.id, label: raw.label, filePath: raw.filePath };
  if (typeof raw.sourceSessionId === "string" || raw.sourceSessionId === null) {
    tab.sourceSessionId = raw.sourceSessionId;
  }
  if (raw.initialDisplayMode === "diff") tab.initialDisplayMode = "diff";
  const viewerState = sanitizeViewerState(raw.viewerState);
  if (viewerState) tab.viewerState = viewerState;
  if (typeof raw.viewerRevision === "number" && Number.isFinite(raw.viewerRevision)) {
    tab.viewerRevision = raw.viewerRevision;
  }
  return tab;
}

function sanitizeViewTab(raw: Record<string, unknown>, kind: "changes" | "git-graph"): ChangesViewTab | GitGraphViewTab | null {
  if (typeof raw.id !== "string" || raw.id.length === 0) return null;
  if (typeof raw.cwd !== "string" || raw.cwd.length === 0) return null;
  return kind === "changes"
    ? { kind, id: raw.id, cwd: raw.cwd }
    : { kind, id: raw.id, cwd: raw.cwd };
}

/** Structural validation for persisted tabs; unknown shapes are dropped. */
export function sanitizeTabs(raw: unknown): Tab[] {
  if (!Array.isArray(raw)) return [];
  const tabs: Tab[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const record = item as Record<string, unknown>;
    if (record.kind === "file") {
      const tab = sanitizeFileTab(record);
      if (tab) tabs.push(tab);
    } else if (record.kind === "changes" || record.kind === "git-graph") {
      const tab = sanitizeViewTab(record, record.kind);
      if (tab) tabs.push(tab);
    }
  }
  return tabs;
}

export function sanitizeRightTabsEntry(raw: unknown): RightTabsEntry | null {
  if (typeof raw !== "object" || raw === null) return null;
  const record = raw as Record<string, unknown>;
  return {
    tabs: sanitizeTabs(record.tabs),
    activeTabId: typeof record.activeTabId === "string" ? record.activeTabId : null,
    open: record.open === true,
  };
}

function readMap(): Record<string, RightTabsEntry | undefined> {
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, RightTabsEntry | undefined>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

/** The remembered tab set for a workspace, or null when none/stale. */
export function loadRightTabs(workspaceKey: string): RightTabsEntry | null {
  try {
    const map = readMap();
    // Stored keys are normalized (forward slashes, uppercase drive letter) the
    // same way workspace-memory does it; fall back to a folded scan for legacy
    // spellings.
    const raw = map[workspaceKey] ?? map[normalizePathKey(workspaceKey)];
    if (raw) return sanitizeRightTabsEntry(raw);
    if (!isWindowsPlatform()) return null;
    const folded = foldWindowsKey(workspaceKey);
    const keys = Object.keys(map);
    for (let i = keys.length - 1; i >= 0; i--) {
      if (foldWindowsKey(keys[i]) === folded) {
        return sanitizeRightTabsEntry(map[keys[i]]);
      }
    }
    return null;
  } catch {
    return null;
  }
}

export function saveRightTabs(workspaceKey: string, entry: RightTabsEntry): void {
  try {
    const map = readMap();
    const key = normalizePathKey(workspaceKey);
    // Collapse folded-equivalent duplicates so one workspace keeps exactly one
    // slot (same policy as workspace-memory).
    if (isWindowsPlatform()) {
      const folded = foldWindowsKey(key);
      for (const existing of Object.keys(map)) {
        if (existing !== key && foldWindowsKey(existing) === folded) delete map[existing];
      }
    }
    map[key] = entry;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // storage unavailable — memory is best-effort
  }
}

export function clearRightTabs(workspaceKey: string): void {
  try {
    const map = readMap();
    const key = normalizePathKey(workspaceKey);
    if (!(key in map)) {
      if (!isWindowsPlatform()) return;
      const folded = foldWindowsKey(key);
      const found = Object.keys(map).find((k) => foldWindowsKey(k) === folded);
      if (!found) return;
      delete map[found];
    } else {
      delete map[key];
    }
    if (Object.keys(map).length === 0) window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // ignore
  }
}
