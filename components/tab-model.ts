import type { FileViewerState } from "@/lib/file-viewer-state";

/**
 * Right-panel tab model.
 *
 * The panel hosts different kinds of content, each represented by one variant
 * of the discriminated `Tab` union. Every variant carries a unique `id` whose
 * prefix (`file:`, `changes:`, `git-graph:`) doubles as the kind marker so
 * persistence and tab lookups never depend on the in-memory type alone.
 *
 * - `file` tabs are multi-instance: one per absolute file path, re-opening an
 *   open path activates it instead of duplicating it.
 * - `changes` and `git-graph` tabs are workspace singletons: re-opening one
 *   that already exists activates the existing tab.
 */

export interface FileTab {
  kind: "file";
  id: string;
  label: string;
  filePath: string;
  sourceSessionId?: string | null;
  initialDisplayMode?: "diff";
  /** Last viewer state, restored when the tab becomes active again. */
  viewerState?: FileViewerState;
  /** Bumped whenever the tab is re-opened with a fresh mode/source, so a stale
   *  save cannot overwrite newer state. */
  viewerRevision?: number;
}

export interface ChangesViewTab {
  kind: "changes";
  id: string;
  /** Working directory whose working-tree changes the tab reviews. */
  cwd: string;
}

export interface GitGraphViewTab {
  kind: "git-graph";
  id: string;
  /** Repository/worktree directory whose history the tab shows. */
  cwd: string;
}

export type Tab = FileTab | ChangesViewTab | GitGraphViewTab;

export function isFileTab(tab: Tab): tab is FileTab {
  return tab.kind === "file";
}

export function fileTabId(filePath: string): string {
  return `file:${filePath}`;
}

export function changesTabId(cwd: string): string {
  return `changes:${cwd}`;
}

export function gitGraphTabId(cwd: string): string {
  return `git-graph:${cwd}`;
}

interface OpenFileTabInput {
  fileName: string;
  filePath: string;
  modeHint?: "diff";
  sourceSessionId?: string | null;
  tabId: string;
}

export function openFileTab(tabs: Tab[], input: OpenFileTabInput): Tab[] {
  const existing = tabs.find((tab) => tab.id === input.tabId);
  if (!existing) {
    return [...tabs, {
      kind: "file",
      id: input.tabId,
      label: input.fileName,
      filePath: input.filePath,
      sourceSessionId: input.sourceSessionId,
      initialDisplayMode: input.modeHint,
      viewerState: input.modeHint ? {
        displayMode: input.modeHint,
        wrapLines: false,
        scrollTop: 0,
        scrollLeft: 0,
      } : undefined,
      viewerRevision: 0,
    }];
  }

  const existingFile = isFileTab(existing) ? existing : null;
  if (!existingFile) return tabs;

  const sourceChanged = Boolean(
    input.sourceSessionId && existingFile.sourceSessionId !== input.sourceSessionId,
  );
  const sourceUnchanged = !sourceChanged;
  if (sourceUnchanged && !input.modeHint) return tabs;

  return tabs.map((tab) => {
    if (tab.id !== input.tabId || !isFileTab(tab)) return tab;
    const next: FileTab = { ...tab };
    if (sourceChanged) next.sourceSessionId = input.sourceSessionId;
    if (input.modeHint) {
      next.initialDisplayMode = input.modeHint;
      next.viewerState = {
        displayMode: input.modeHint,
        wrapLines: tab.viewerState?.wrapLines ?? false,
        scrollTop: 0,
        scrollLeft: 0,
      };
      next.viewerRevision = (tab.viewerRevision ?? 0) + 1;
    } else if (sourceChanged) {
      next.viewerRevision = (tab.viewerRevision ?? 0) + 1;
    }
    return next;
  });
}

export interface OpenViewTabInput {
  kind: "changes" | "git-graph";
  cwd: string;
}

/** Open a workspace-singleton view tab; an existing one is left untouched. */
export function openViewTab(tabs: Tab[], input: OpenViewTabInput): Tab[] {
  const id = input.kind === "changes" ? changesTabId(input.cwd) : gitGraphTabId(input.cwd);
  if (tabs.some((tab) => tab.id === id)) return tabs;
  const tab: Tab = input.kind === "changes"
    ? { kind: "changes", id, cwd: input.cwd }
    : { kind: "git-graph", id, cwd: input.cwd };
  return [...tabs, tab];
}

export function saveFileViewerState(
  tabs: Tab[],
  tabId: string,
  viewerRevision: number,
  viewerState: FileViewerState,
): Tab[] {
  const index = tabs.findIndex((tab) => tab.id === tabId);
  if (index === -1 || !isFileTab(tabs[index]) || (tabs[index] as FileTab).viewerRevision !== viewerRevision) {
    return tabs;
  }

  // Bail out when the state is unchanged. Without this, every unmount of a
  // viewer (tab switch, panel close) produced a fresh Tab array, which flowed
  // into the FileViewer's initialState prop and re-ran its load effect, whose
  // cleanup saved again — an AppShell-level setState loop.
  const current = (tabs[index] as FileTab).viewerState;
  if (
    current
    && current.displayMode === viewerState.displayMode
    && current.wrapLines === viewerState.wrapLines
    && current.scrollTop === viewerState.scrollTop
    && current.scrollLeft === viewerState.scrollLeft
  ) {
    return tabs;
  }

  const next = [...tabs];
  next[index] = { ...(next[index] as FileTab), viewerState };
  return next;
}
