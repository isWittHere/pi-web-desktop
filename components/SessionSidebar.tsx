"use client";

import { useEffect, useLayoutEffect, useState, useCallback, useRef, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ArrowClockwise, CaretDown, CaretRight, ChatCircle, Check, CircleDashed, ClockCounterClockwise, ClockCountdown, FunnelSimple, GitBranch, MagnifyingGlass, PencilSimple, Plus, PushPin, SealCheck, Tag, TextAa, Trash, UploadSimple, X, XCircle } from "@phosphor-icons/react";
import type { SessionInfo, SessionMark, TimeBucket } from "@/lib/types";
import type { DraftSession } from "@/lib/draft-sessions";
import { draftToSessionInfo } from "@/lib/draft-sessions";
import { getDraft } from "@/lib/draft-store";
import { getLastWorkspace } from "@/lib/workspace-memory";
import { getSessionList } from "@/lib/session-list";
import { getSessionDisplayFirstMessage } from "@/lib/skill-block";
import { loadExplorerOpen, saveExplorerOpen } from "@/lib/file-explorer-state";
import { getTitleModel } from "@/lib/title-settings";
import { bucketOf, TIME_BUCKET_ORDER, timeBucketKey } from "@/lib/time-groups";
import { loadCollapsedTimeGroups, saveCollapsedTimeGroups, type CollapsedTimeGroups } from "@/lib/time-group-state";
import { useI18n } from "@/hooks/useI18n";
import { useContextMenu, type ContextMenuItem } from "./ContextMenu";
import { FileExplorer, type FileExplorerHandle } from "./FileExplorer";
import { QuickChangesPanel } from "./QuickChangesPanel";
import { WorkspacePickerMenu } from "./WorkspacePickerMenu";
import { TitleBarDismissOverlay } from "./TitleBarDismissOverlay";
import { WorktreePanel } from "./WorktreePanel";
import type { ViewMode } from "@/hooks/useViewMode";

interface Props {
  selectedSessionId: string | null;
  /** Active draft id — draft rows highlight against this (they have no server
   *  session, so selectedSessionId alone never matches them). */
  selectedDraftId?: string | null;
  onSelectSession: (session: SessionInfo, isRestore?: boolean) => void;
  onNewSession?: (sessionId: string, cwd: string, projectRoot?: string | null) => void;
  /** Client-side unsent drafts rendered alongside real sessions. */
  draftSessions?: DraftSession[];
  onSelectDraft?: (draft: DraftSession, projectRoot?: string | null) => void;
  onDeleteDraft?: (draftId: string) => void;
  onRenameDraft?: (draftId: string, name: string) => void;
  initialSessionId?: string | null;
  onInitialRestoreDone?: () => void;
  /** Fired once the session list has loaded (startup readiness signal). */
  onSessionsLoaded?: () => void;
  /** Fired when the session list has loaded and contains no real sessions
   *  (brand-new user, or draft-only rows): there is no workspace to
   *  auto-select and no session content for the startup splash to wait for,
   *  so the parent can fade it to the first-run welcome screen. */
  onNoContentToWaitFor?: () => void;
  refreshKey?: number;
  onSessionDeleted?: (sessionId: string) => void;
  selectedCwd?: string | null;
  /**
   * Fired when the effective cwd changes. isAutoSelect is true when the
   * change comes from the startup auto-select/URL restore (not a user click),
   * so the parent can avoid recording it as the "last active workspace".
   */
  onCwdChange?: (cwd: string | null, projectRoot?: string | null, isAutoSelect?: boolean) => void;
  /** Fired when a session is renamed, so the top bar title can update. */
  onSessionRenamed?: (id: string, name: string) => void;
  /** Fired when a session title is regenerated via the context menu. */
  onRegenerateTitle?: (sessionId: string) => void;
  /** Session id currently having its title regenerated (disables the menu item). */
  titleGeneratingId?: string | null;
  onOpenFile?: (filePath: string, fileName: string, options?: { initialDisplayMode?: "diff" }) => void;
  explorerRefreshKey?: number;
  onAtMention?: (relativePath: string, isDir: boolean) => void;
  onAtMentions?: (relativePaths: string[]) => void;
  /** Reports the current set of running session ids (from the poll). */
  onRunningSessionIdsChange?: (ids: Set<string>) => void;
  /** Tabs view mode: the shell asks the sidebar to move the effective cwd
   *  (null clears it — last tab closed). The token makes repeated requests
   *  with the same cwd apply again (e.g. re-activating a tab). */
  requestedCwd?: { cwd: string | null; token: number } | null;
  /** How a picked project is opened. When provided, every workspace picker
   *  menu (title bar / welcome / sidebar) calls this instead of switching
   *  the cwd directly, so the shell can open a workspace tab instead. */
  onOpenProject?: (project: string) => void;
  /** Reports the workspace project list + per-project running/unread counts
   *  (tabs view mode: the title-bar tab bar needs both for dots and for the
   *  picker list). Only fires when the data actually changed. */
  onWorkspaceActivityChange?: (snapshot: { projects: string[]; activity: Map<string, { running: number; unread: number }> }) => void;
  /** View mode: tabs mode hides the sidebar CWD picker / inline worktree
   *  switcher (replaced by the WorktreePanel) and the title-bar worktree
   *  button. Classic mode keeps every existing entry point. */
  viewMode?: ViewMode;
  workspaceControlsHosts?: {
    title?: HTMLElement | null;
    welcome?: HTMLElement | null;
  };
  /** Hide both workspace controls on the empty welcome page. */
  showWorkspaceControls?: boolean;
  /** Fired when a session that is not open in the chat area finishes running
   *  (other workspace, or a second session of the current workspace). Carries
   *  the finished session so the shell can surface its workspace/branch. */
  onBackgroundTaskDone?: (session: SessionInfo) => void;
}

export interface WorktreeEntry {
  path: string;
  branch: string | null;
  isMain: boolean;
}

export interface WorktreeState {
  /** The cwd this data was fetched for — guards against stale responses */
  forCwd: string;
  projectRoot: string;
  isGit: boolean;
  /** False when forCwd is a repo subdirectory — the switcher is hidden there
   *  because subdir sessions keep their own project identity */
  isTopLevel: boolean;
  worktrees: WorktreeEntry[];
}

/** How often the worktree list is re-polled while the current workspace is a
 *  git top-level, so branch switches made outside this app (via the agent or
 *  another terminal) are reflected in the switcher label without a manual
 *  refresh. Generous interval keeps git invocations cheap. */
const WORKTREE_POLL_MS = 5000;

function sameWorktrees(a: WorktreeEntry[], b: WorktreeEntry[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].path !== b[i].path || a[i].branch !== b[i].branch || a[i].isMain !== b[i].isMain) return false;
  }
  return true;
}

const UNREAD_SESSIONS_STORAGE_KEY = "pi-web:unread-session-ids";

function loadUnreadSessionIds(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(UNREAD_SESSIONS_STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) return new Set(parsed.filter((id): id is string => typeof id === "string"));
    return new Set();
  } catch {
    return new Set();
  }
}

function saveUnreadSessionIds(ids: Set<string>): void {
  if (typeof window === "undefined") return;
  try {
    if (ids.size === 0) window.localStorage.removeItem(UNREAD_SESSIONS_STORAGE_KEY);
    else window.localStorage.setItem(UNREAD_SESSIONS_STORAGE_KEY, JSON.stringify([...ids]));
  } catch {
    // ignore storage quota / privacy-mode errors
  }
}

function formatRelativeTime(dateStr: string, t: (key: string, params?: Record<string, string | number>) => string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (mins < 1) return t("desktop.justNow");
  if (mins < 60) return t("desktop.minutesAgo", { count: mins });
  if (hours < 24) return t("desktop.hoursAgo", { count: hours });
  if (days < 7) return t("desktop.daysAgo", { count: days });
  return date.toLocaleDateString();
}

/**
 * Return all projects (deduped by projectRoot so worktrees collapse into their
 * main repo) sorted by most recent session activity.
 */
function getRecentProjects(sessions: SessionInfo[]): string[] {
  const latestByRoot = new Map<string, string>(); // projectRoot -> most recent modified
  for (const s of sessions) {
    const root = s.projectRoot ?? s.cwd;
    if (!root) continue;
    const prev = latestByRoot.get(root);
    if (!prev || s.modified > prev) {
      latestByRoot.set(root, s.modified);
    }
  }
  return [...latestByRoot.entries()]
    .sort((a, b) => b[1].localeCompare(a[1]))
    .map(([root]) => root);
}

/** Substitute the home dir prefix with ~ (no path truncation — see PathLabel) */
function displayCwd(cwd: string, homeDir?: string): string {
  return (homeDir && cwd.startsWith(homeDir)) ? "~" + cwd.slice(homeDir.length) : cwd;
}

function pathBaseName(path: string): string {
  return path.replace(/[\\/]+$/, "").split(/[\\/]/).filter(Boolean).pop() ?? path;
}

/**
 * Path label that ellipsizes on the LEFT, keeping the (most relevant) trailing
 * segments visible: "…orkspace/pi-web". Shows as much of the path as fits
 * instead of a fixed number of segments. The rtl container moves the ellipsis
 * to the left edge; the inner plaintext bidi isolation keeps the path itself
 * rendered strictly left-to-right (no punctuation reordering).
 */
function PathLabel({ text, style }: { text: string; style?: CSSProperties }) {
  return (
    <span
      style={{
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        display: "block",
        minWidth: 0,
        lineHeight: 1.35,
        direction: "rtl",
        textAlign: "left",
        ...style,
      }}
    >
      <span style={{ unicodeBidi: "plaintext" }}>{text}</span>
    </span>
  );
}

const DROPDOWN_ANIMATION_MS = 140;

function AnimatedDropdown({ open, children, style }: { open: boolean; children: ReactNode; style: CSSProperties }) {
  const [mounted, setMounted] = useState(open);
  const [visible, setVisible] = useState(open);

  useEffect(() => {
    let frame: number | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;

    if (open) {
      setMounted(true);
      setVisible(false);
      frame = window.requestAnimationFrame(() => {
        frame = window.requestAnimationFrame(() => setVisible(true));
      });
    } else {
      setVisible(false);
      timeout = setTimeout(() => setMounted(false), DROPDOWN_ANIMATION_MS);
    }

    return () => {
      if (frame !== undefined) window.cancelAnimationFrame(frame);
      if (timeout) clearTimeout(timeout);
    };
  }, [open]);

  if (!mounted) return null;

  return (
    <div
      style={{
        ...style,
        opacity: visible ? 1 : 0,
        transform: visible ? "translateY(0) scale(1)" : "translateY(-8px) scale(0.96)",
        transformOrigin: "top center",
        transition: `opacity ${DROPDOWN_ANIMATION_MS}ms ease, transform ${DROPDOWN_ANIMATION_MS}ms ease`,
        pointerEvents: open ? "auto" : "none",
      }}
    >
      {children}
    </div>
  );
}



/** A sidebar row: a real server session, or a client-side draft flagged isDraft. */
interface SessionRow extends SessionInfo {
  isDraft?: boolean;
}

interface SessionTreeNode {
  session: SessionRow;
  children: SessionTreeNode[];
}

function buildSessionTree(sessions: SessionRow[]): SessionTreeNode[] {
  const byId = new Map<string, SessionTreeNode>();
  for (const s of sessions) {
    byId.set(s.id, { session: s, children: [] });
  }

  // Build a map of parentSessionId chains so we can resolve missing ancestors
  const parentOf = new Map<string, string>();
  for (const s of sessions) {
    if (s.parentSessionId) parentOf.set(s.id, s.parentSessionId);
  }

  // Walk up the parentSessionId chain to find the nearest ancestor that exists in byId
  function resolveAncestor(id: string): string | null {
    let cur = parentOf.get(id);
    const visited = new Set<string>();
    while (cur) {
      if (visited.has(cur)) return null; // cycle guard
      visited.add(cur);
      if (byId.has(cur)) return cur;
      cur = parentOf.get(cur);
    }
    return null;
  }

  const roots: SessionTreeNode[] = [];
  for (const node of byId.values()) {
    const ancestor = resolveAncestor(node.session.id);
    if (ancestor) {
      byId.get(ancestor)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  // Sort each level by modified desc
  const sort = (nodes: SessionTreeNode[]) => {
    nodes.sort((a, b) => b.session.modified.localeCompare(a.session.modified));
    nodes.forEach((n) => sort(n.children));
  };
  sort(roots);
  return roots;
}



export function SessionSidebar({ selectedSessionId, selectedDraftId, onSelectSession, onNewSession, draftSessions, onSelectDraft, onDeleteDraft, onRenameDraft, initialSessionId, onInitialRestoreDone, refreshKey, onSessionDeleted, selectedCwd: selectedCwdProp, onCwdChange, onOpenFile, explorerRefreshKey, onAtMention, onAtMentions, onRunningSessionIdsChange, requestedCwd, onOpenProject, onWorkspaceActivityChange, workspaceControlsHosts, showWorkspaceControls = true, onBackgroundTaskDone, onSessionRenamed, onRegenerateTitle, titleGeneratingId, onSessionsLoaded, onNoContentToWaitFor, viewMode = "classic" }: Props) {
  const { t } = useI18n();
  const { openMenu } = useContextMenu();
  const [allSessions, setAllSessions] = useState<SessionInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedCwd, setSelectedCwd] = useState<string | null>(null);
  const [homeDir, setHomeDir] = useState<string>("");
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [workspaceProjectDropdownOpen, setWorkspaceProjectDropdownOpen] = useState<"title" | "welcome" | null>(null);
  const [workspaceWorktreeDropdownOpen, setWorkspaceWorktreeDropdownOpen] = useState<"title" | "welcome" | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  // Wrapper nodes of the two workspace-control portals (title bar / welcome).
  // One ref per location: it contains both dropdowns of that location, so a
  // single outside-click check covers the project and worktree menus.
  const workspaceDropdownRefs = useRef<Record<"title" | "welcome", HTMLDivElement | null>>({ title: null, welcome: null });
  // Worktree switcher state
  const [worktreeState, setWorktreeState] = useState<WorktreeState | null>(null);
  const [wtDropdownOpen, setWtDropdownOpen] = useState(false);
  const [wtNewOpen, setWtNewOpen] = useState(false);
  const [wtNewBranch, setWtNewBranch] = useState("");
  const [wtError, setWtError] = useState<string | null>(null);
  const [wtBusy, setWtBusy] = useState(false);
  const [wtConfirmRemove, setWtConfirmRemove] = useState<string | null>(null);
  const [worktreeLoadingCwd, setWorktreeLoadingCwd] = useState<string | null>(null);
  const wtDropdownRef = useRef<HTMLDivElement>(null);
  const wtNewInputRef = useRef<HTMLInputElement>(null);
  const [sessionsOpen, setSessionsOpen] = useState(true);
  // Session-list quick-search: searchOpen swaps the header for a filter box,
  // and sessionSearch drives live filtering of the visible session rows.
  const [searchOpen, setSearchOpen] = useState(false);
  const [sessionSearch, setSessionSearch] = useState("");
  // null = show every mark; otherwise only sessions carrying this mark.
  const [markFilter, setMarkFilter] = useState<SessionMark | null>(null);
  // Collapsed state of the session-list time-group headers. "earlier" starts
  // collapsed (its rows are not rendered until the user expands it) and the
  // whole set persists across reloads.
  const [collapsedGroups, setCollapsedGroups] = useState<CollapsedTimeGroups>(() => loadCollapsedTimeGroups());
  const toggleGroup = useCallback((bucket: TimeBucket) => {
    setCollapsedGroups((prev) => {
      const next = { ...prev, [bucket]: !prev[bucket] };
      saveCollapsedTimeGroups(next);
      return next;
    });
  }, []);
  const [explorerOpen, setExplorerOpen] = useState(true);
  const [explorerKey, setExplorerKey] = useState(0);
  const [explorerUploadBusy, setExplorerUploadBusy] = useState(false);
  const [sessionRefreshDone, setSessionRefreshDone] = useState(false);
  const [explorerRefreshDone, setExplorerRefreshDone] = useState(false);
  const [runningSessionIds, setRunningSessionIds] = useState<Set<string>>(() => new Set());
  const [unreadSessionIds, setUnreadSessionIds] = useState<Set<string>>(() => loadUnreadSessionIds());
  const previousRunningSessionIdsRef = useRef<Set<string>>(new Set());
  // Latest session list, kept in a ref so the running-completion effect can
  // resolve a finished session id to its SessionInfo without depending on
  // allSessions identity in its deps array.
  const allSessionsRef = useRef<SessionInfo[]>(allSessions);
  useEffect(() => { allSessionsRef.current = allSessions; }, [allSessions]);
  // Holds the latest onBackgroundTaskDone so the effect below can keep its
  // deps array identical to the pre-feature version — a changing callback
  // reference must not resize/reshuffle the deps (React errors on that).
  const onBackgroundTaskDoneRef = useRef(onBackgroundTaskDone);
  useEffect(() => { onBackgroundTaskDoneRef.current = onBackgroundTaskDone; });
  // Clicking a notification card asks the shell to jump to the session that
  // finished. The main process raised/focused the window already; we only
  // need to select the target conversation (it may not be the open one).
  const onSelectSessionRef = useRef(onSelectSession);
  useEffect(() => { onSelectSessionRef.current = onSelectSession; });
  useEffect(() => {
    if (typeof window === "undefined" || !window.piDesktop?.onNotificationNavigate) return;
    return window.piDesktop.onNotificationNavigate((sessionId) => {
      const session = allSessionsRef.current.find((s) => s.id === sessionId);
      if (session) onSelectSessionRef.current?.(session);
    });
  }, []);
  // Once a lightweight running snapshot arrives it owns the dynamic state;
  // late /api/sessions responses cannot revive an older embedded snapshot.
  const runningSnapshotAuthoritativeRef = useRef(false);
  const sessionRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const explorerRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileExplorerRef = useRef<FileExplorerHandle>(null);

  const loadSessions = useCallback(async (showLoading = false, force = false) => {
    try {
      if (showLoading) setLoading(true);
      // Shared cache: startup also fetches the list from the workspace-restore
      // path, so dedupe onto one request (force refreshes on explicit reload).
      const data = await getSessionList(force);
      setAllSessions(data.sessions);
      // The real list has now been scanned (mount's initial empty array does
      // not count) — the auto-select effect may make first-screen decisions.
      sessionsLoadedRef.current = true;
      // This is only an initial fallback. The dedicated snapshot route owns
      // running state once it has responded, so a slow list reload stays stale.
      if (!runningSnapshotAuthoritativeRef.current) {
        setRunningSessionIds(new Set(data.runningSessionIds ?? []));
      }
      // Drop unread markers for sessions that no longer exist (e.g. deleted).
      const existingIds = new Set(data.sessions.map((s) => s.id));
      setUnreadSessionIds((prev) => {
        if (prev.size === 0) return prev;
        const next = new Set([...prev].filter((id) => existingIds.has(id)));
        return next.size === prev.size ? prev : next;
      });
      setError(null);
      if (!showLoading) {
        setSessionRefreshDone(true);
        if (sessionRefreshTimerRef.current) clearTimeout(sessionRefreshTimerRef.current);
        sessionRefreshTimerRef.current = setTimeout(() => setSessionRefreshDone(false), 2000);
      }
      // Startup readiness: the list is usable now (auto-select runs right
      // after setAllSessions on the next render).
      onSessionsLoaded?.();
    } catch (e) {
      setError(String(e));
    } finally {
      if (showLoading) setLoading(false);
    }
  }, [onSessionsLoaded]);

  const initialLoadDone = useRef(false);
  useEffect(() => {
    const isFirst = !initialLoadDone.current;
    initialLoadDone.current = true;
    // Refresh forces the shared cache on explicit reloads (refreshKey bumps);
    // the first load may reuse a list already fetched by the restore path.
    loadSessions(isFirst, !isFirst);
  }, [loadSessions, refreshKey]);

  // Browser storage is unavailable during server rendering. Restore the panel
  // preference after hydration so a collapsed explorer stays collapsed on reload.
  useEffect(() => {
    setExplorerOpen(loadExplorerOpen());
  }, []);

  // Persist unread markers so they survive a browser refresh before the user
  // has actually opened the completed session.
  useEffect(() => {
    saveUnreadSessionIds(unreadSessionIds);
  }, [unreadSessionIds]);

  useEffect(() => {
    let active = true;
    let controller: AbortController | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      if (!active || document.visibilityState !== "visible") return;
      controller?.abort();
      const currentController = new AbortController();
      controller = currentController;
      try {
        const response = await fetch("/api/agent/running", {
          cache: "no-store",
          signal: currentController.signal,
        });
        if (!response.ok || !active || controller !== currentController) return;
        const data = await response.json() as { runningSessionIds?: string[] };
        if (!active || controller !== currentController) return;
        runningSnapshotAuthoritativeRef.current = true;
        setRunningSessionIds(new Set(data.runningSessionIds ?? []));
      } catch (error) {
        if ((error as DOMException).name !== "AbortError") console.warn("Failed to poll running sessions", error);
      } finally {
        if (active && controller === currentController && document.visibilityState === "visible") {
          timer = setTimeout(poll, 2500);
        }
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void poll();
      } else {
        controller?.abort();
        if (timer) clearTimeout(timer);
        timer = null;
      }
    };

    void poll();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      active = false;
      controller?.abort();
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  useEffect(() => {
    onRunningSessionIdsChange?.(runningSessionIds);
  }, [onRunningSessionIdsChange, runningSessionIds]);

  useEffect(() => {
    const previous = previousRunningSessionIdsRef.current;
    const completedInBackground = [...previous].filter((id) => !runningSessionIds.has(id) && id !== selectedSessionId);
    const newlyRunning = [...runningSessionIds];

    if (completedInBackground.length > 0 || newlyRunning.length > 0) {
      setUnreadSessionIds((prev) => {
        const next = new Set(prev);
        newlyRunning.forEach((id) => next.delete(id));
        completedInBackground.forEach((id) => next.add(id));
        return next;
      });
    }

    // A background completion should also ring — the open session's own end
    // tone is handled by ChatWindow, so anything else that finished counts.
    if (completedInBackground.length > 0) {
      // Surface the most recently finished background session (in completion
      // order, the last of the batch) so the shell can show its context.
      const finished = completedInBackground[completedInBackground.length - 1];
      const session = allSessionsRef.current.find((s) => s.id === finished);
      if (session) onBackgroundTaskDoneRef.current?.(session);
    }

    previousRunningSessionIdsRef.current = runningSessionIds;
  }, [runningSessionIds, selectedSessionId]);

  useEffect(() => {
    if (!selectedSessionId) return;
    setUnreadSessionIds((prev) => {
      if (!prev.has(selectedSessionId)) return prev;
      const next = new Set(prev);
      next.delete(selectedSessionId);
      return next;
    });
  }, [selectedSessionId]);

  useEffect(() => {
    if (explorerRefreshKey !== undefined) setExplorerKey((k) => k + 1);
  }, [explorerRefreshKey]);

  useEffect(() => {
    fetch("/api/home").then((r) => r.json()).then((d: { home?: string }) => {
      if (d.home) setHomeDir(d.home);
    }).catch(() => {});
  }, []);

  const restoredRef = useRef(false);
  // True once loadSessions() has actually returned a list (vs. the mount-time
  // initial empty array). Gates the empty-list branch of the auto-select
  // effect so a brand-new user is only detected after the scan really ran.
  const sessionsLoadedRef = useRef(false);

  /** Resolve the project root for a cwd from the freshest data available */
  const projectRootFor = useCallback((cwd: string | null): string | null => {
    if (!cwd) return null;
    if (worktreeState && worktreeState.forCwd === cwd) return worktreeState.projectRoot;
    // Any path in the loaded worktree list belongs to that project — covers
    // worktrees without sessions, so switching to them keeps the row mounted.
    if (worktreeState?.worktrees.some((w) => w.path === cwd)) return worktreeState.projectRoot;
    const match = allSessions.find((s) => s.cwd === cwd);
    return match?.projectRoot ?? cwd;
  }, [worktreeState, allSessions]);

  // Draft rows are merged with server sessions: they appear under their cwd's
  // project, sorted by their modifiedAt timestamp. Real sessions dedupe by id.
  // The content preview is read from the draft store on each render so a draft
  // row reflects the latest typed text after a refresh/switch (the draft store
  // is not React state, so it cannot participate in memo deps).
  const draftRows: SessionRow[] = draftSessions && draftSessions.length > 0
    ? draftSessions.map((d) => {
        const draftText = getDraft(d.id)?.value ?? "";
        return {
          ...draftToSessionInfo(d),
          firstMessage: draftText,
          projectRoot: projectRootFor(d.cwd) ?? d.cwd,
          isDraft: true,
        };
      })
    : [];
  const allRows: SessionRow[] = [...draftRows, ...allSessions];

  // Notify parent only when the effective cwd actually changes (not when
  // projectRootFor identity changes due to session/worktree refreshes). The
  // isAutoSelect flag is consumed here so startup auto-selection (restore of
  // the remembered workspace) is not mistaken for user activity.
  const lastNotifiedCwdRef = useRef<string | null>(null);
  const autoSelectRef = useRef(false);
  useEffect(() => {
    if (lastNotifiedCwdRef.current === selectedCwd) return;
    lastNotifiedCwdRef.current = selectedCwd;
    const isAutoSelect = autoSelectRef.current;
    autoSelectRef.current = false;
    onCwdChange?.(selectedCwd, projectRootFor(selectedCwd), isAutoSelect);
  }, [selectedCwd, onCwdChange, projectRootFor]);

  // Sync the worktree switcher to the selected session's cwd. Sessions of all
  // worktrees in a project share one list, so clicking a session from another
  // worktree should move the effective cwd there. Only fires when the prop
  // value changes, so a manual switcher change is not snapped back.
  const lastSyncedCwdPropRef = useRef<string | null>(null);
  useEffect(() => {
    if (selectedCwdProp && selectedCwdProp !== lastSyncedCwdPropRef.current) {
      lastSyncedCwdPropRef.current = selectedCwdProp;
      setSelectedCwd(selectedCwdProp);
    }
  }, [selectedCwdProp]);

  // Tabs view mode: apply a cwd switch requested by the shell (tab
  // activation / project pick / last-tab-closed). Null clears the cwd. The
  // token makes a repeated request for the same cwd apply again.
  useEffect(() => {
    if (!requestedCwd) return;
    setSelectedCwd(requestedCwd.cwd);
  }, [requestedCwd]);

  // Load worktrees for the current effective cwd
  const [wtRefreshKey, setWtRefreshKey] = useState(0);
  useLayoutEffect(() => {
    if (!selectedCwd) {
      setWorktreeState(null);
      setWorktreeLoadingCwd(null);
      return;
    }
    let cancelled = false;
    setWorktreeLoadingCwd(selectedCwd);
    fetch(`/api/worktrees?cwd=${encodeURIComponent(selectedCwd)}`)
      .then((r) => r.json())
      .then((d: { projectRoot?: string; isGit?: boolean; isTopLevel?: boolean; worktrees?: WorktreeEntry[]; error?: string }) => {
        if (cancelled) return;
        setWorktreeLoadingCwd(null);
        if (d.error || !d.projectRoot) {
          setWorktreeState(null);
          return;
        }
        setWorktreeState({
          forCwd: selectedCwd,
          projectRoot: d.projectRoot,
          isGit: d.isGit ?? false,
          isTopLevel: d.isTopLevel ?? false,
          worktrees: d.worktrees ?? [],
        });
      })
      .catch(() => {
        if (!cancelled) {
          setWorktreeLoadingCwd(null);
          setWorktreeState(null);
        }
      });
    return () => { cancelled = true; };
  }, [selectedCwd, wtRefreshKey, refreshKey]);

  // Poll the worktree list so branch switches made outside this app (the agent
  // running `git checkout`, or another terminal) are reflected in the switcher
  // label without a manual refresh. Mirrors the running-sessions poll: pauses
  // while the tab is hidden, dedupes in-flight requests, and only writes state
  // when the data actually changed so the whole sidebar does not re-render on
  // every tick. Depends on worktreeState so a data change re-arms promptly.
  useEffect(() => {
    let active = true;
    let controller: AbortController | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      if (!active || document.visibilityState !== "visible") return;
      // Only poll while the current workspace is a loaded git top-level;
      // otherwise there is no worktree list to refresh.
      const st = worktreeState;
      if (!selectedCwd || !st || st.forCwd !== selectedCwd || !st.isGit || !st.isTopLevel) return;
      controller?.abort();
      const currentController = new AbortController();
      controller = currentController;
      try {
        const response = await fetch(`/api/worktrees?cwd=${encodeURIComponent(selectedCwd)}`, {
          cache: "no-store",
          signal: currentController.signal,
        });
        if (!response.ok || !active || controller !== currentController) return;
        const data = await response.json() as {
          projectRoot?: string; isGit?: boolean; isTopLevel?: boolean;
          worktrees?: WorktreeEntry[]; error?: string;
        };
        if (!active || controller !== currentController) return;
        // Ignore responses that no longer belong to the same project.
        if (data.error || !data.projectRoot || data.projectRoot !== st.projectRoot) return;
        const next: WorktreeState = {
          forCwd: selectedCwd,
          projectRoot: data.projectRoot,
          isGit: data.isGit ?? false,
          isTopLevel: data.isTopLevel ?? false,
          worktrees: data.worktrees ?? [],
        };
        setWorktreeState((prev) =>
          prev && prev.forCwd === next.forCwd
            && prev.projectRoot === next.projectRoot
            && prev.isGit === next.isGit
            && prev.isTopLevel === next.isTopLevel
            && sameWorktrees(prev.worktrees, next.worktrees)
            ? prev
            : next
        );
      } catch (error) {
        if ((error as DOMException).name !== "AbortError") console.warn("Failed to poll worktrees", error);
      } finally {
        if (active && controller === currentController && document.visibilityState === "visible") {
          timer = setTimeout(poll, WORKTREE_POLL_MS);
        }
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void poll();
      } else {
        controller?.abort();
        if (timer) clearTimeout(timer);
        timer = null;
      }
    };

    void poll();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      active = false;
      controller?.abort();
      if (timer) clearTimeout(timer);
      timer = null;
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [selectedCwd, worktreeState]);

  // Auto-select cwd and restore session from URL on first load
  useEffect(() => {
    // Drafts and server sessions both contribute rows; build the combined list
    // here (not in render) so the effect deps stay stable references.
    const rows: SessionRow[] = [
      ...(draftSessions ?? []).map((d) => ({ ...draftToSessionInfo(d), isDraft: true as const })),
      ...allSessions,
    ];
    // Wait for the real session list. Drafts alone must not drive the initial
    // workspace choice: a stale draft in a quick workspace (pi-cwd-*) ranks
    // that workspace first (getRecentProjects sorts by modifiedAt) and, when
    // the remembered last workspace is not among the draft-only projects, the
    // fallback below would lock the app onto that workspace before the real
    // sessions have even loaded.
    // Only decide once loadSessions() has returned: the mount-time empty
    // array is not "no sessions", it is "not loaded yet".
    if (!sessionsLoadedRef.current) return;
    if (allSessions.length === 0) {
      // Brand-new user (or draft-only rows): no real session exists, so there
      // is no workspace to auto-select and nothing to restore. A ?session=
      // URL param is necessarily invalid here — end the restore flow so the
      // parent can show the first-run welcome placeholder. The splash also
      // has no session content to wait for: tell the parent to mark readiness.
      if (initialSessionId && !restoredRef.current) {
        restoredRef.current = true;
        onInitialRestoreDone?.();
      }
      onNoContentToWaitFor?.();
      return;
    }
    if (rows.length === 0) return;

    if (selectedCwd === null) {
      // If restoring a session, set cwd to match that session
      if (initialSessionId && !restoredRef.current) {
        restoredRef.current = true;
        const target = allSessions.find((s) => s.id === initialSessionId);
        if (target) {
          autoSelectRef.current = true;
          setSelectedCwd(target.cwd);
          onSelectSession(target, true);
          return;
        }
        // Session not found — notify parent so it can show the placeholder
        onInitialRestoreDone?.();
      }
      // Include drafts so a project that only has drafts is still selected.
      const projects = getRecentProjects(rows);
      // Real sessions alone decide the fallback ordering: a pure-draft project
      // (e.g. a stale quick-workspace draft) must not outrank every real
      // session's workspace just because its draft was touched recently.
      const sessionProjects = getRecentProjects(allSessions);
      // Prefer the workspace that was active when the app last closed over the
      // most-recently-*modified*-session ordering (which drifts when a session
      // elsewhere was merely touched or ran in the background). Fall back to
      // the recency ordering among real sessions only — never to a pure-draft
      // project (allSessions is guaranteed non-empty above).
      const lastWorkspace = getLastWorkspace();
      const initialTarget = lastWorkspace && projects.includes(lastWorkspace)
        ? lastWorkspace
        : (sessionProjects[0] ?? null);
      if (initialTarget) {
        // Startup auto-selection must not be recorded as the user's last
        // active workspace — otherwise a stale/incorrect pick reinforces
        // itself across restarts (the pi-cwd-* quick-workspace loop).
        autoSelectRef.current = true;
        setSelectedCwd(initialTarget);
      }
    }
  }, [draftSessions, allSessions, selectedCwd, initialSessionId, onSelectSession, onInitialRestoreDone, onNoContentToWaitFor]);

  // Create a worktree. The panel passes its own branch input; the classic
  // title-bar/sidebar menus pass nothing and use the wtNewBranch state.
  // Resolves true on success so the panel keeps its input open on failure.
  const handleCreateWorktree = useCallback(async (branchInput?: string): Promise<boolean> => {
    const branch = (branchInput ?? wtNewBranch).trim();
    if (!branch || wtBusy || !worktreeState) return false;
    setWtBusy(true);
    setWtError(null);
    try {
      const res = await fetch("/api/worktrees", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd: worktreeState.projectRoot, branch }),
      });
      const data = await res.json().catch(() => ({})) as { path?: string; error?: string };
      if (!res.ok || data.error || !data.path) {
        setWtError(data.error ?? `HTTP ${res.status}`);
        return false;
      }
      setWtNewOpen(false);
      setWtNewBranch("");
      setWtDropdownOpen(false);
      setWorkspaceWorktreeDropdownOpen(null);
      // Optimistically register the new worktree so projectRootFor() resolves
      // it to the main repo before the refetch lands (keeps AppShell from
      // treating the new cwd as a different project).
      setWorktreeState((prev) => prev ? {
        ...prev,
        forCwd: data.path!,
        worktrees: [...prev.worktrees, { path: data.path!, branch, isMain: false }],
      } : prev);
      setSelectedCwd(data.path);
      setWtRefreshKey((k) => k + 1);
      return true;
    } catch (e) {
      setWtError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setWtBusy(false);
    }
  }, [wtNewBranch, wtBusy, worktreeState]);

  const handleRemoveWorktree = useCallback(async (path: string, force: boolean) => {
    if (!worktreeState || wtBusy) return;
    setWtBusy(true);
    setWtError(null);
    try {
      const res = await fetch("/api/worktrees", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd: worktreeState.projectRoot, path, force }),
      });
      const data = await res.json().catch(() => ({})) as { error?: string; dirty?: boolean };
      if (!res.ok) {
        if (data.dirty && !force) {
          // Dirty worktree — ask the user to confirm a force removal
          setWtConfirmRemove(path);
          return;
        }
        setWtError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      setWtConfirmRemove(null);
      if (selectedCwd === path) setSelectedCwd(worktreeState.projectRoot);
      setWtRefreshKey((k) => k + 1);
    } catch (e) {
      setWtError(e instanceof Error ? e.message : String(e));
    } finally {
      setWtBusy(false);
    }
  }, [worktreeState, wtBusy, selectedCwd]);

  // Worktree panel (tabs mode): switching a worktree moves the effective cwd.
  const handlePanelSelectWorktree = useCallback((path: string) => {
    setSelectedCwd(path);
    setWtError(null);
  }, []);

  // Close dropdowns on outside click — the project and worktree menus of the
  // sidebar and of both workspace-control portals all share one rule.
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      const inAnyDropdown = dropdownRef.current?.contains(target)
        || wtDropdownRef.current?.contains(target)
        || Object.values(workspaceDropdownRefs.current).some((node) => node?.contains(target));
      if (inAnyDropdown) return;
      setDropdownOpen(false);
      setWorkspaceProjectDropdownOpen(null);
      setWtDropdownOpen(false);
      setWorkspaceWorktreeDropdownOpen(null);
      setWtNewOpen(false);
      setWtNewBranch("");
      setWtError(null);
      setWtConfirmRemove(null);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // While any dropdown is open, cover the Electron title bar with a
  // non-drag overlay: Chromium swallows mousedown on -webkit-app-region:
  // drag areas, so outside-click dismissal would never fire for clicks on
  // the empty title bar. The overlay dispatches the click normally and
  // forwards it to buttons underneath (see TitleBarDismissOverlay).
  const anyTitleBarDropdownOpen = Boolean(
    workspaceProjectDropdownOpen || workspaceWorktreeDropdownOpen
    || dropdownOpen || wtDropdownOpen || wtNewOpen
  );

  // Clicking a session moves the effective cwd to that session's worktree.
  // Done on the click path (not via the selectedCwd prop sync) so it also
  // works when the prop value won't change — e.g. re-clicking the already
  // open session after manually switching worktrees.
  const handleSelectSessionFromList = useCallback((s: SessionRow) => {
    if (s.isDraft) {
      const draft = draftSessions?.find((d) => d.id === s.id);
      if (draft) {
        onSelectDraft?.(draft, s.projectRoot);
        return;
      }
    }
    if (s.cwd) setSelectedCwd(s.cwd);
    onSelectSession(s);
  }, [onSelectSession, onSelectDraft, draftSessions]);

  const handleNewSession = useCallback(() => {
    if (!selectedCwd) return;
    // Generate a temporary UUID client-side — no backend call needed.
    // Pi will be spawned lazily when the user sends the first message.
    const tempId = typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
    onNewSession?.(tempId, selectedCwd, projectRootFor(selectedCwd));
  }, [selectedCwd, onNewSession, projectRootFor]);

  const recentProjects = getRecentProjects(allRows);
  // Per-project running/unread counts for the workspace selector list items
  // and the collapsed-caret dot (activity in other workspaces). Iterated per
  // render — the session list is small, so no memo is needed.
  const projectActivity = new Map<string, { running: number; unread: number }>();
  for (const s of allRows) {
    const key = s.projectRoot ?? s.cwd;
    if (!key) continue;
    let entry = projectActivity.get(key);
    if (!entry) { entry = { running: 0, unread: 0 }; projectActivity.set(key, entry); }
    if (runningSessionIds.has(s.id)) entry.running++;
    if (unreadSessionIds.has(s.id)) entry.unread++;
  }

  // Sessions of every worktree in the selected project are shown together
  const selectedProject = projectRootFor(selectedCwd);
  const filteredSessions = selectedProject
    ? allRows.filter((s) => (s.projectRoot ?? s.cwd) === selectedProject)
    : allRows;
  // Narrow by status mark before the text search (null filter = all marks).
  const markFilteredSessions = markFilter
    ? filteredSessions.filter((s) => s.mark === markFilter)
    : filteredSessions;
  const showWorktreeSwitcher = Boolean(
    worktreeState?.isGit
    && worktreeState.isTopLevel
    && selectedCwd
    && selectedProject === worktreeState.projectRoot
  );
  const worktreeGuide = selectedCwd
    && worktreeState
    && selectedProject === worktreeState.projectRoot
    && !showWorktreeSwitcher
    ? (worktreeState.isGit
        ? {
            label: t("desktop.openRepoRoot"),
            title: t("desktop.openRepoRootDescription"),
          }
        : {
            label: t("desktop.gitRepoRootOnly"),
            title: t("desktop.gitRepoRootOnlyDescription"),
          })
    : null;
  const worktreeLoading = Boolean(selectedCwd && worktreeLoadingCwd === selectedCwd);
  const inactiveWorktreeSelector = worktreeGuide
    ?? (worktreeLoading && !showWorktreeSwitcher
      ? {
          label: t("desktop.worktreesLoading"),
          title: t("desktop.checkingWorktrees"),
        }
      : null);

  // Live quick-search: filters against the exact title shown in the list
  // (a user-set name, else the first-message preview, else a short id).
  // Applied after the project scope so search only ever narrows the currently
  // visible project's sessions, never crosses into other workspaces.
  const searchQuery = sessionSearch.trim().toLowerCase();
  const searchScopedSessions = searchQuery
    ? markFilteredSessions.filter((s) => {
        const title = s.name
          || (s.isDraft
              ? (getSessionDisplayFirstMessage(s.firstMessage).slice(0, 50) || t("desktop.newSessionDraft"))
              : getSessionDisplayFirstMessage(s.firstMessage).slice(0, 50))
          || s.id.slice(0, 12);
        return title.toLowerCase().includes(searchQuery);
      })
    : markFilteredSessions;

  // Build parent-child tree within the filtered set
  const sessionTree = buildSessionTree(searchScopedSessions);

  // Time-group the tree roots. Root nodes are bucketed by their own `modified`
  // time (pinned rows first); fork children always stay inside their parent's
  // group so a tree never splits across headers. Search / mark filtering keeps
  // the same grouped view (groups are force-expanded while filtering so the
  // narrowed results stay visible); pinning still floats to the top because it
  // is an explicit user intent.
  const isFilteredView = Boolean(searchQuery || markFilter);
  const sessionGroups = (() => {
    const byBucket = new Map<TimeBucket, SessionTreeNode[]>();
    for (const bucket of TIME_BUCKET_ORDER) byBucket.set(bucket, []);
    for (const node of sessionTree) {
      const bucket = node.session.pinned ? "pinned" : bucketOf(node.session.modified);
      byBucket.get(bucket)!.push(node);
    }
    return TIME_BUCKET_ORDER
      .filter((bucket) => byBucket.get(bucket)!.length > 0)
      .map((bucket) => ({ bucket, nodes: byBucket.get(bucket)! }));
  })();

  // Shared row renderer for every session row in a time group.
  const renderTreeItem = (node: SessionTreeNode) => (
    <SessionTreeItem
      key={node.session.id}
      node={node}
      selectedSessionId={selectedSessionId}
      selectedDraftId={selectedDraftId}
      runningSessionIds={runningSessionIds}
      unreadSessionIds={unreadSessionIds}
      onSelectSession={handleSelectSessionFromList}
      onRenamed={(id, name) => {
        // Force a refresh: the shared session-list cache would otherwise
        // serve the stale pre-rename list and the sidebar row would
        // keep showing the old name.
        loadSessions(false, true);
        onSessionRenamed?.(id, name);
      }}
      onSessionDeleted={(id) => {
        onSessionDeleted?.(id);
        loadSessions();
      }}
      onMarked={() => loadSessions(false, true)}
      onPinned={() => loadSessions(false, true)}
      onRegenerateTitle={onRegenerateTitle}
      titleGeneratingId={titleGeneratingId}
      onDeleteDraft={onDeleteDraft}
      onRenameDraft={onRenameDraft}
      depth={0}
    />
  );

  // Mark-filter picker anchored to the filter button (not the pointer).
  // Counts reflect the sessions the filter will actually narrow — the
  // current project's rows (filteredSessions), matching markFilteredSessions.
  const openMarkFilterMenu = useCallback((e: React.MouseEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const counts = new Map<SessionMark, number>();
    for (const s of filteredSessions) {
      if (s.mark) counts.set(s.mark, (counts.get(s.mark) ?? 0) + 1);
    }
    openMenu(rect.left, rect.bottom + 4, [
      {
        label: t("desktop.markFilterAll"),
        icon: <CircleDashed size={13} weight="regular" aria-hidden="true" />,
        checked: markFilter === null,
        hint: filteredSessions.length,
        onSelect: () => setMarkFilter(null),
      },
      ...markMenuEntries(t, markFilter, (m) => setMarkFilter(m), counts),
    ]);
  }, [markFilter, openMenu, t, filteredSessions]);

  const currentWt = worktreeState?.worktrees.find((w) => w.path === selectedCwd)
    ?? worktreeState?.worktrees.find((w) => w.isMain)
    ?? null;
  const compactProjectLabel = selectedCwd
    ? pathBaseName(selectedProject ?? selectedCwd)
    : (initialSessionId && !restoredRef.current ? "" : `${t("desktop.selectProject")}…`);
  // Chosen from the shared WorkspacePickerMenu (title/welcome/sidebar):
  // switch the effective cwd and close every project dropdown. The shell
  // decides how a picked project opens (tabs mode: as a tab).
  const handleSelectProjectFromMenu = useCallback((project: string) => {
    setDropdownOpen(false);
    setWorkspaceProjectDropdownOpen(null);
    if (onOpenProject) onOpenProject(project);
    else setSelectedCwd(project);
  }, [onOpenProject]);

  // Report workspace activity (projects + running/unread counts) so the
  // shell's title-bar tab bar can render dots and the picker list without
  // duplicating the session list. Built from the raw session lists (not the
  // render-scope allRows/recentProjects, whose identities change every
  // render) and compared structurally so the shell only re-renders when the
  // data actually changed.
  const activitySnapshotRef = useRef<{ projects: string[]; activity: Map<string, { running: number; unread: number }> } | null>(null);
  useEffect(() => {
    if (!onWorkspaceActivityChange) return;
    const latestByRoot = new Map<string, string>();
    const activity = new Map<string, { running: number; unread: number }>();
    const visit = (s: SessionInfo) => {
      const root = s.projectRoot ?? s.cwd;
      if (!root) return;
      const prev = latestByRoot.get(root);
      if (!prev || s.modified > prev) latestByRoot.set(root, s.modified);
      let entry = activity.get(root);
      if (!entry) { entry = { running: 0, unread: 0 }; activity.set(root, entry); }
      if (runningSessionIds.has(s.id)) entry.running++;
      if (unreadSessionIds.has(s.id)) entry.unread++;
    };
    for (const s of allSessions) visit(s);
    for (const d of draftSessions ?? []) visit({ ...draftToSessionInfo(d), projectRoot: projectRootFor(d.cwd) ?? d.cwd });
    const projects = [...latestByRoot.entries()]
      .sort((a, b) => b[1].localeCompare(a[1]))
      .map(([root]) => root);
    const prev = activitySnapshotRef.current;
    const same = prev
      && prev.projects.length === projects.length
      && prev.projects.every((p, i) => p === projects[i])
      && sameActivity(prev.activity, activity);
    if (same) return;
    activitySnapshotRef.current = { projects, activity };
    onWorkspaceActivityChange(activitySnapshotRef.current);
  }, [onWorkspaceActivityChange, allSessions, draftSessions, runningSessionIds, unreadSessionIds, projectRootFor]);
  const compactWorktreeLabel = currentWt
    ? (currentWt.branch ?? pathBaseName(currentWt.path))
    : inactiveWorktreeSelector?.label;
  const hasWorkspaceControlsHosts = Boolean(workspaceControlsHosts?.title || workspaceControlsHosts?.welcome);
  const workspaceControls = (location: "title" | "welcome") => {
    const isLargeWorkspaceControl = location === "welcome";
    const isProjectDropdownOpen = workspaceProjectDropdownOpen === location;
    const isWorktreeDropdownOpen = workspaceWorktreeDropdownOpen === location;
    // Activity in any *other* workspace (running or unread) lights a dot on
    // the collapsed caret so it is visible without opening the list.
    const hasOtherWorkspaceActivity = recentProjects.some((p) => {
      if (p === selectedProject) return false;
      const a = projectActivity.get(p);
      return (a?.running ?? 0) > 0 || (a?.unread ?? 0) > 0;
    });
    return showWorkspaceControls ? (
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "flex-start", gap: isLargeWorkspaceControl ? 6 : 0, height: isLargeWorkspaceControl ? "auto" : "100%", minWidth: 0, width: isLargeWorkspaceControl ? "100%" : undefined }}>
        <div style={{ position: "relative", minWidth: 0, width: isLargeWorkspaceControl ? "fit-content" : undefined, maxWidth: isLargeWorkspaceControl ? "min(100%, 560px)" : undefined }}>
          <button
            className="app-no-drag app-titlebar-context-control"
            onClick={() => setWorkspaceProjectDropdownOpen((open) => open === location ? null : location)}
            title={selectedProject ?? selectedCwd ?? t("desktop.selectProject")}
            aria-label={t("desktop.selectProject")}
            aria-expanded={isProjectDropdownOpen}
            style={{
              height: isLargeWorkspaceControl ? 48 : 36,
              width: isLargeWorkspaceControl ? "100%" : undefined,
              maxWidth: isLargeWorkspaceControl ? "100%" : 260,
              minWidth: 0,
              display: "flex",
              alignItems: "center",
              gap: isLargeWorkspaceControl ? 10 : 6,
              padding: isLargeWorkspaceControl ? "0 12px" : "0 8px",
              background: isProjectDropdownOpen ? "var(--bg-selected)" : "none",
              border: "none",
              borderRadius: isLargeWorkspaceControl ? 8 : 0,
              color: isProjectDropdownOpen ? "var(--text)" : selectedCwd ? (isLargeWorkspaceControl ? "var(--text)" : "var(--text-muted)") : "var(--text-dim)",
              cursor: "pointer",
              fontSize: isLargeWorkspaceControl ? 24 : 12,
              fontWeight: 500,
              fontFamily: "var(--font-mono)",
              lineHeight: 1,
              letterSpacing: 0,
              textAlign: "left",
              transition: "background 0.12s, color 0.12s, border-color 0.12s",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "var(--bg-hover)";
              e.currentTarget.style.color = selectedCwd ? "var(--text)" : "var(--text-muted)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = isProjectDropdownOpen ? "var(--bg-selected)" : "none";
              e.currentTarget.style.color = isProjectDropdownOpen ? "var(--text)" : selectedCwd ? "var(--text-muted)" : "var(--text-dim)";
            }}
          >
            <PathLabel text={compactProjectLabel} style={{ flex: 1, minWidth: 0, color: "inherit", direction: "ltr", fontFamily: "inherit" }} />
            <span style={{ position: "relative", display: "inline-flex", flexShrink: 0 }}>
              <CaretDown size={12} weight="regular" style={{ transition: "transform 0.12s", transform: isProjectDropdownOpen ? "rotate(180deg)" : "none" }} aria-hidden="true" />
              {hasOtherWorkspaceActivity && (
                <span style={{ position: "absolute", right: -4, bottom: -4, width: 6, height: 6, borderRadius: "50%", background: "var(--accent)", pointerEvents: "none" }} aria-hidden="true" />
              )}
            </span>
          </button>
          <AnimatedDropdown open={isProjectDropdownOpen} style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, width: 320, zIndex: 1000, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 8, boxShadow: "0 6px 20px rgba(0,0,0,0.16)", overflow: "hidden", display: "flex", flexDirection: "column", maxHeight: "min(calc(38vh / var(--app-ui-scale, 1)), 300px)" }}>
            <WorkspacePickerMenu
              projects={recentProjects}
              selectedProject={selectedProject}
              activity={projectActivity}
              homeDir={homeDir}
              onSelectProject={handleSelectProjectFromMenu}
              onRequestClose={() => setWorkspaceProjectDropdownOpen(null)}
            />
          </AnimatedDropdown>
        </div>

        {(viewMode === "classic" && (showWorktreeSwitcher || inactiveWorktreeSelector)) && (
          <div style={{ position: "relative", minWidth: 0 }}>
            <button
              className="app-no-drag app-titlebar-context-control"
              onClick={() => { if (showWorktreeSwitcher) setWorkspaceWorktreeDropdownOpen((open) => open === location ? null : location); }}
              aria-label={t("desktop.switchWorktree")}
              aria-expanded={showWorktreeSwitcher ? isWorktreeDropdownOpen : undefined}
              aria-disabled={!showWorktreeSwitcher}
              tabIndex={showWorktreeSwitcher ? 0 : -1}
              title={showWorktreeSwitcher && currentWt ? t("desktop.switchWorktreeWithPath", { path: currentWt.path }) : inactiveWorktreeSelector?.title}
              style={{
                height: 36,
                maxWidth: 220,
                minWidth: 0,
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "0 8px",
                background: isWorktreeDropdownOpen ? "var(--bg-selected)" : "none",
                border: "none",
                borderRadius: isLargeWorkspaceControl ? 8 : 0,
                color: isWorktreeDropdownOpen ? "var(--text)" : showWorktreeSwitcher ? "var(--text-muted)" : "var(--text-dim)",
                cursor: showWorktreeSwitcher ? "pointer" : "default",
                fontSize: 12,
                fontWeight: 500,
                fontFamily: "var(--font-mono)",
                lineHeight: 1,
                letterSpacing: 0,
                opacity: showWorktreeSwitcher ? 1 : 0.82,
                transition: "background 0.12s, color 0.12s",
              }}
              onMouseEnter={(e) => {
                if (!showWorktreeSwitcher) return;
                e.currentTarget.style.background = "var(--bg-hover)";
                e.currentTarget.style.color = "var(--text)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = isWorktreeDropdownOpen ? "var(--bg-selected)" : "none";
                e.currentTarget.style.color = isWorktreeDropdownOpen ? "var(--text)" : showWorktreeSwitcher ? "var(--text-muted)" : "var(--text-dim)";
              }}
            >
              <GitBranch size={16} weight="regular" style={{ flexShrink: 0 }} aria-hidden="true" />
              <PathLabel text={compactWorktreeLabel ?? ""} style={{ flex: 1, minWidth: 0, color: "inherit", direction: "ltr", fontFamily: "inherit" }} />
              {showWorktreeSwitcher && <CaretDown size={12} weight="regular" style={{ flexShrink: 0, transition: "transform 0.12s", transform: isWorktreeDropdownOpen ? "rotate(180deg)" : "none" }} aria-hidden="true" />}
            </button>
            <AnimatedDropdown open={showWorktreeSwitcher && isWorktreeDropdownOpen} style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, width: 320, zIndex: 1000, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 8, boxShadow: "0 6px 20px rgba(0,0,0,0.16)", overflow: "hidden", display: "flex", flexDirection: "column", maxHeight: "min(calc(38vh / var(--app-ui-scale, 1)), 300px)" }}>
              <div style={{ maxHeight: "min(calc(32vh / var(--app-ui-scale, 1)), 240px)", overflowY: "auto", flex: 1, minHeight: 0, padding: "4px" }}>
                {worktreeState?.worktrees.map((wt) => {
                  const isCurrent = wt.path === selectedCwd || (wt.isMain && !worktreeState.worktrees.some((w) => w.path === selectedCwd));
                  return (
                    <button key={wt.path} onClick={() => { setSelectedCwd(wt.path); setWtDropdownOpen(false); setWorkspaceWorktreeDropdownOpen(null); setWtError(null); }} title={wt.path} style={{ display: "flex", alignItems: "center", gap: 6, width: "100%", padding: "3px 8px", background: isCurrent ? "var(--bg-selected)" : "transparent", border: "none", borderRadius: 5, color: isCurrent ? "var(--accent)" : "var(--text)", cursor: "pointer", textAlign: "left", fontSize: 12, fontFamily: "var(--font-mono)", minWidth: 0 }} onMouseEnter={(e) => { if (!isCurrent) e.currentTarget.style.background = "var(--bg-hover)"; }} onMouseLeave={(e) => { if (!isCurrent) e.currentTarget.style.background = "transparent"; }}>
                      {isCurrent ? <Check size={12} color="var(--accent)" weight="bold" style={{ flexShrink: 0 }} aria-hidden="true" /> : <span style={{ width: 12, flexShrink: 0 }} />}
                      <PathLabel text={wt.branch ?? displayCwd(wt.path, homeDir)} style={{ flex: 1 }} />
                      {wt.isMain && <span style={{ flexShrink: 0, color: "var(--text-dim)", fontSize: 10 }}>{t("desktop.main")}</span>}
                    </button>
                  );
                })}
              </div>
              <div style={{ borderTop: "1px solid var(--border)", padding: "4px", flexShrink: 0 }}>
              {!wtNewOpen ? (
                <button onClick={(e) => { e.stopPropagation(); setWtNewOpen(true); setWtError(null); setTimeout(() => wtNewInputRef.current?.focus(), 0); }} title={t("desktop.createWorktree")} style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "7px 8px", background: "transparent", border: "none", borderRadius: 5, color: "var(--text-muted)", cursor: "pointer", textAlign: "left", fontSize: 12 }} onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; e.currentTarget.style.color = "var(--text)"; }} onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--text-muted)"; }}>
                  <Plus size={14} weight="regular" style={{ flexShrink: 0 }} aria-hidden="true" />
                  <span>{t("desktop.newWorktree")}</span>
                </button>
              ) : (
                <div style={{ padding: "6px 4px 4px" }}>
                  <input
                    ref={wtNewInputRef}
                    value={wtNewBranch}
                    onChange={(e) => { setWtNewBranch(e.target.value); setWtError(null); }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") { e.preventDefault(); void handleCreateWorktree(); }
                      if (e.key === "Escape") { setWtNewOpen(false); setWtNewBranch(""); setWtError(null); }
                    }}
                    placeholder={t("desktop.branchName")}
                    style={{ width: "100%", fontSize: 11, fontFamily: "var(--font-mono)", padding: "5px 8px", border: "1px solid var(--accent)", borderRadius: 5, outline: "none", background: "var(--bg)", color: "var(--text)", boxSizing: "border-box" }}
                  />
                  <div style={{ display: "flex", gap: 5, marginTop: 5 }}>
                    <button onClick={() => void handleCreateWorktree()} disabled={wtBusy || !wtNewBranch.trim()} style={{ flex: 1, padding: "4px 0", background: "var(--accent)", border: "none", borderRadius: 5, color: "#fff", fontSize: 11, fontWeight: 600, cursor: wtBusy || !wtNewBranch.trim() ? "not-allowed" : "pointer", opacity: wtBusy || !wtNewBranch.trim() ? 0.65 : 1 }}>{wtBusy ? t("desktop.creating") : t("desktop.create")}</button>
                    <button onClick={() => { setWtNewOpen(false); setWtNewBranch(""); setWtError(null); }} style={{ flex: 1, padding: "4px 0", background: "var(--bg-hover)", border: "1px solid var(--border)", borderRadius: 5, color: "var(--text-muted)", fontSize: 11, cursor: "pointer" }}>{t("desktop.cancel")}</button>
                  </div>
                  {wtError && <div style={{ marginTop: 5, color: "#dc2626", fontSize: 11, lineHeight: 1.35, overflowWrap: "anywhere" }}>{wtError}</div>}
                </div>
              )}
              </div>
            </AnimatedDropdown>
          </div>
        )}
      </div>
    ) : null;
  };

  return (
    <>
      {anyTitleBarDropdownOpen && <TitleBarDismissOverlay />}
      {(Object.entries(workspaceControlsHosts ?? {}) as Array<["title" | "welcome", HTMLElement | null | undefined]>).map(([location, host]) => host && createPortal(
        <div ref={(node) => { workspaceDropdownRefs.current[location] = node; }}>
          {workspaceControls(location)}
        </div>,
        host,
        location,
      ))}
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* Header */}
      <div style={{ flexShrink: 0 }}>
        {searchOpen ? (
          /* ── Search mode: the header becomes a quick-filter box ── */
          /* height matches the natural section-header row (11px text at the
             inherited line-height 1.5 + 6px padding) so toggling does not jump. */
          <div style={{ display: "flex", alignItems: "center", gap: 4, height: 28.5, boxSizing: "border-box", padding: "0 8px" }}>
            <div style={{ position: "relative", flex: 1, minWidth: 0 }}>
              <MagnifyingGlass size={13} color="var(--text-dim)" style={{ position: "absolute", left: 9, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }} aria-hidden="true" />
              <input
                value={sessionSearch}
                onChange={(e) => setSessionSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    if (sessionSearch) setSessionSearch("");
                    else setSearchOpen(false);
                  }
                }}
                placeholder={t("desktop.searchSessionsPlaceholder")}
                aria-label={t("desktop.searchSessions")}
                autoFocus
                style={{
                  width: "100%", height: 24, boxSizing: "border-box",
                  padding: "0 8px 0 27px", background: "var(--bg-hover)",
                  border: "1px solid var(--accent)", borderRadius: 6,
                  outline: "none", color: "var(--text)", fontSize: 12,
                  fontFamily: "var(--font-mono)",
                }}
              />
            </div>
            <button
              onClick={openMarkFilterMenu}
              title={t("desktop.markFilter")}
              aria-label={t("desktop.markFilter")}
              style={{
                display: "flex", alignItems: "center", justifyContent: "center",
                width: 24, height: 24, padding: 0,
                background: "none", border: "none",
                color: markFilter ? SESSION_MARK_COLORS[markFilter] : "var(--text-dim)",
                cursor: "pointer", borderRadius: 5, flexShrink: 0,
                transition: "color 0.12s, background 0.12s",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "none"; }}
            >
              {markFilter ? (
                (() => {
                  const Icon = SESSION_MARK_ICONS[markFilter];
                  return (
                    <Icon size={13} weight={markFilter === "completed" ? "fill" : "regular"} aria-hidden="true" />
                  );
                })()
              ) : (
                <FunnelSimple size={13} weight="regular" aria-hidden="true" />
              )}
            </button>
            <button
              onClick={() => { setSearchOpen(false); setSessionSearch(""); }}
              title={t("desktop.exitSearch")}
              aria-label={t("desktop.exitSearch")}
              style={{
                display: "flex", alignItems: "center", justifyContent: "center",
                width: 24, height: 24, padding: 0,
                background: "none", border: "none",
                color: "var(--text-dim)", cursor: "pointer",
                borderRadius: 5, flexShrink: 0,
                transition: "color 0.12s, background 0.12s",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text-muted)"; e.currentTarget.style.background = "var(--bg-hover)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-dim)"; e.currentTarget.style.background = "none"; }}
            >
              <X size={13} weight="regular" aria-hidden="true" />
            </button>
          </div>
        ) : (
        <div style={{ display: "flex", alignItems: "center" }}>
          <button
            onClick={() => setSessionsOpen((v) => !v)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              flex: 1,
              padding: "6px 10px",
              background: "none",
              border: "none",
              color: "var(--text-muted)",
              cursor: "pointer",
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: "0.05em",
              textTransform: "uppercase",
              textAlign: "left",
            }}
          >
            <CaretRight size={9} weight="regular" style={{ transform: sessionsOpen ? "rotate(90deg)" : "none", transition: "transform 0.15s", flexShrink: 0 }} aria-hidden="true" />
            {t("desktop.sessions")}
          </button>
          <button
            onClick={() => {
              setSessionsOpen(true);
              setSearchOpen(true);
            }}
            title={t("desktop.searchSessions")}
            aria-label={t("desktop.searchSessions")}
            style={{
              display: "flex", alignItems: "center", justifyContent: "center",
              width: 26, height: 26, padding: 0,
              background: "none",
              border: "none",
              color: "var(--text-dim)",
              cursor: "pointer",
              borderRadius: 5,
              flexShrink: 0,
              transition: "color 0.3s, background 0.3s",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text-muted)"; e.currentTarget.style.background = "var(--bg-hover)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-dim)"; e.currentTarget.style.background = "none"; }}
          >
            <MagnifyingGlass size={13} weight="regular" aria-hidden="true" />
          </button>
          <button
            onClick={openMarkFilterMenu}
            title={t("desktop.markFilter")}
            aria-label={t("desktop.markFilter")}
            style={{
              display: "flex", alignItems: "center", justifyContent: "center",
              width: 26, height: 26, padding: 0,
              background: "none",
              border: "none",
              color: markFilter ? SESSION_MARK_COLORS[markFilter] : "var(--text-dim)",
              cursor: "pointer",
              borderRadius: 5,
              flexShrink: 0,
              transition: "color 0.3s, background 0.3s",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "none"; }}
          >
            {markFilter ? (
              (() => {
                const Icon = SESSION_MARK_ICONS[markFilter];
                return (
                  <Icon size={13} weight={markFilter === "completed" ? "fill" : "regular"} aria-hidden="true" />
                );
              })()
            ) : (
              <FunnelSimple size={13} weight="regular" aria-hidden="true" />
            )}
          </button>
          <button
            onClick={handleNewSession}
            disabled={!selectedCwd}
            title={selectedCwd ? t("desktop.newSessionIn", { cwd: selectedCwd }) : t("desktop.selectProjectFirst")}
            aria-label={t("desktop.newSession")}
            style={{
              display: "flex", alignItems: "center", justifyContent: "center",
              width: 26, height: 26, padding: 0,
              background: "none",
              border: "none",
              color: selectedCwd ? "var(--text-dim)" : "var(--text-dim)",
              cursor: selectedCwd ? "pointer" : "default",
              borderRadius: 5,
              flexShrink: 0,
              opacity: selectedCwd ? 1 : 0.6,
              transition: "color 0.3s, background 0.3s",
            }}
            onMouseEnter={(e) => { if (selectedCwd) { e.currentTarget.style.color = "var(--text-muted)"; e.currentTarget.style.background = "var(--bg-hover)"; } }}
            onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-dim)"; e.currentTarget.style.background = "none"; }}
          >
            <Plus size={13} weight="regular" aria-hidden="true" />
          </button>
          <button
            onClick={() => loadSessions(false, true)}
            title={t("desktop.refresh")}
            aria-label={t("desktop.refresh")}
            style={{
              display: "flex", alignItems: "center", justifyContent: "center",
              width: 26, height: 26, padding: 0, marginRight: 6,
              background: sessionRefreshDone ? "rgba(74,222,128,0.18)" : "none",
              border: "none",
              color: sessionRefreshDone ? "#4ade80" : "var(--text-dim)",
              cursor: "pointer",
              borderRadius: 5,
              flexShrink: 0,
              transition: "color 0.3s, background 0.3s",
            }}
            onMouseEnter={(e) => { if (!sessionRefreshDone) { e.currentTarget.style.color = "var(--text-muted)"; e.currentTarget.style.background = "var(--bg-hover)"; } }}
            onMouseLeave={(e) => { if (!sessionRefreshDone) { e.currentTarget.style.color = "var(--text-dim)"; e.currentTarget.style.background = "none"; } }}
          >
            {sessionRefreshDone ? (
              <Check size={13} color="#4ade80" weight="regular" aria-hidden="true" />
            ) : (
              <ArrowClockwise size={13} weight="regular" aria-hidden="true" />
            )}
          </button>
        </div>
        )}

        {/* CWD picker */}
        {viewMode === "classic" && !hasWorkspaceControlsHosts && <div ref={dropdownRef} style={{ position: "relative" }}>
          <button
            onClick={() => setDropdownOpen((v) => !v)}
            title={selectedProject ?? selectedCwd ?? ""}
            style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              padding: "6px 10px",
              background: selectedCwd ? "var(--bg-hover)" : "rgba(37,99,235,0.06)",
              border: selectedCwd ? "1px solid var(--border)" : "1px solid rgba(37,99,235,0.4)",
              borderRadius: 7,
              cursor: "pointer",
              fontSize: 12,
              color: "var(--text)",
              textAlign: "left",
              transition: "border-color 0.15s, background 0.15s",
            }}
          >
            {selectedCwd ? (
              <PathLabel
                text={displayCwd(selectedProject ?? selectedCwd, homeDir)}
                style={{
                  flex: 1,
                  fontFamily: "var(--font-mono)",
                  fontSize: 11,
                  color: "var(--text)",
                }}
              />
            ) : (
              <span
                style={{
                  flex: 1,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  fontFamily: "var(--font-mono)",
                  fontSize: 11,
                  color: "var(--text-dim)",
                }}
              >
                {initialSessionId && !restoredRef.current ? "" : "Select project…"}
              </span>
            )}
          </button>

          <AnimatedDropdown
            open={dropdownOpen}
            style={{
              position: "absolute",
              top: "calc(100% + 4px)",
              left: 0,
              right: 0,
              zIndex: 100,
              background: "var(--bg)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              boxShadow: "0 6px 20px rgba(0,0,0,0.10)",
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
              maxHeight: "min(calc(38vh / var(--app-ui-scale, 1)), 300px)",
            }}
          >
            <WorkspacePickerMenu
              projects={recentProjects}
              selectedProject={selectedProject}
              activity={projectActivity}
              homeDir={homeDir}
              onSelectProject={handleSelectProjectFromMenu}
              onRequestClose={() => setDropdownOpen(false)}
            />
          </AnimatedDropdown>
        </div>}

        {/* Worktree switcher — shown only for git projects at a checkout top
            level (repo subdirs keep their own project identity, so switching
            from them would jump projects). Rendered whenever the selected cwd
            belongs to the loaded project (not just when forCwd matches), so
            switching between worktrees of one project keeps the row mounted
            instead of flickering while data refetches: all worktrees of a
            project share the same list anyway. */}
        {viewMode === "classic" && !hasWorkspaceControlsHosts && showWorktreeSwitcher && (() => {
          if (!worktreeState) return null;
          const currentWt = worktreeState.worktrees.find((w) => w.path === selectedCwd)
            ?? worktreeState.worktrees.find((w) => w.isMain);
          return (
            <div ref={wtDropdownRef} style={{ position: "relative", marginTop: 6 }}>
              <button
                onClick={() => setWtDropdownOpen((v) => !v)}
                title={currentWt ? t("desktop.switchWorktreeWithPath", { path: currentWt.path }) : t("desktop.switchWorktree")}
                style={{
                  width: "100%",
                  display: "flex",
                  alignItems: "center",
                  padding: "6px 10px",
                  background: currentWt ? "var(--bg-hover)" : "rgba(37,99,235,0.06)",
                  border: currentWt ? "1px solid var(--border)" : "1px solid rgba(37,99,235,0.4)",
                  borderRadius: 7,
                  cursor: "pointer",
                  fontSize: 12,
                  color: "var(--text)",
                  textAlign: "left",
                  transition: "border-color 0.15s, background 0.15s",
                }}
              >
                <GitBranch size={11} weight="regular" style={{ flexShrink: 0, color: currentWt && !currentWt.isMain ? "var(--accent)" : "var(--text-dim)" }} aria-hidden="true" />
                <PathLabel
                  text={currentWt ? (currentWt.branch ?? displayCwd(currentWt.path, homeDir)) : "…"}
                  style={{ flex: 1, fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text)" }}
                />
                {currentWt?.isMain && (
                  <span style={{ flexShrink: 0, color: "var(--text-dim)", fontSize: 10 }}>{t("desktop.main")}</span>
                )}
                {worktreeState.worktrees.length > 1 && (
                  <span style={{ flexShrink: 0, color: "var(--text-dim)", fontSize: 10 }}>
                    {worktreeState.worktrees.length}
                  </span>
                )}
                <CaretDown size={9} weight="regular" style={{ flexShrink: 0 }} aria-hidden="true" />
              </button>

              <AnimatedDropdown
                open={wtDropdownOpen}
                style={{
                  position: "absolute",
                  top: "calc(100% + 4px)",
                  left: 0,
                  right: 0,
                  zIndex: 100,
                  background: "var(--bg)",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  boxShadow: "0 6px 20px rgba(0,0,0,0.10)",
                  overflow: "hidden",
                  display: "flex",
                  flexDirection: "column",
                  maxHeight: "min(calc(38vh / var(--app-ui-scale, 1)), 300px)",
                }}
              >
                  <div style={{ maxHeight: "min(calc(32vh / var(--app-ui-scale, 1)), 240px)", overflowY: "auto", flex: 1, minHeight: 0, padding: "4px" }}>
                    {worktreeState.worktrees.map((wt) => {
                      const isCurrent = wt.path === selectedCwd || (wt.isMain && !worktreeState.worktrees.some((w) => w.path === selectedCwd));
                      if (wtConfirmRemove === wt.path) {
                        return (
                          <div key={wt.path} style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 8px", background: "rgba(239,68,68,0.06)" }}>
                            <span style={{ flex: 1, fontSize: 11, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {t("desktop.uncommittedChanges")}
                            </span>
                            <button
                              onClick={() => void handleRemoveWorktree(wt.path, true)}
                              disabled={wtBusy}
                              style={{ padding: "3px 9px", background: "#ef4444", border: "none", borderRadius: 5, color: "#fff", fontSize: 11, fontWeight: 600, cursor: "pointer", flexShrink: 0 }}
                            >
                              {t("desktop.force")}
                            </button>
                            <button
                              onClick={() => setWtConfirmRemove(null)}
                              style={{ padding: "3px 9px", background: "var(--bg-hover)", border: "1px solid var(--border)", borderRadius: 5, color: "var(--text-muted)", fontSize: 11, cursor: "pointer", flexShrink: 0 }}
                            >
                              {t("desktop.cancel")}
                            </button>
                          </div>
                        );
                      }
                      return (
                        <div
                          key={wt.path}
                          style={{ display: "flex", alignItems: "center" }}
                        >
                          <button
                            onClick={() => {
                              setSelectedCwd(wt.path);
                              setWtDropdownOpen(false);
                              setWtError(null);
                            }}
                            title={wt.path}
                            style={{
                              flex: 1,
                              minWidth: 0,
                              display: "flex",
                              alignItems: "center",
                              gap: 6,
                              padding: "3px 8px",
                              background: isCurrent ? "var(--bg-selected)" : "transparent",
                              border: "none",
                              borderRadius: 5,
                              color: isCurrent ? "var(--accent)" : "var(--text)",
                              cursor: "pointer",
                              textAlign: "left",
                              fontSize: 12,
                              fontFamily: "var(--font-mono)",
                            }}
                            onMouseEnter={(e) => { if (!isCurrent) e.currentTarget.style.background = "var(--bg-hover)"; }}
                            onMouseLeave={(e) => { if (!isCurrent) e.currentTarget.style.background = "transparent"; }}
                          >
                            {isCurrent ? (
                              <Check size={12} color="var(--accent)" weight="bold" style={{ flexShrink: 0 }} aria-hidden="true" />
                            ) : (
                              <span style={{ width: 12, flexShrink: 0 }} />
                            )}
                            <PathLabel text={wt.branch ?? displayCwd(wt.path, homeDir)} style={{ flex: 1 }} />
                            {wt.isMain && <span style={{ flexShrink: 0, color: "var(--text-dim)", fontSize: 10 }}>{t("desktop.main")}</span>}
                          </button>
                          {!wt.isMain && (
                            <button
                              onClick={() => void handleRemoveWorktree(wt.path, false)}
                              disabled={wtBusy}
                              title={t("desktop.removeWorktree", { path: wt.path })}
                              style={{
                                display: "flex", alignItems: "center", justifyContent: "center",
                                width: 24, height: 20, padding: 0, marginRight: 4,
                                background: "none", border: "none",
                                color: "var(--text-dim)", cursor: "pointer",
                                borderRadius: 5, flexShrink: 0,
                                transition: "color 0.12s, background 0.12s",
                              }}
                              onMouseEnter={(e) => { e.currentTarget.style.color = "#ef4444"; e.currentTarget.style.background = "rgba(239,68,68,0.08)"; }}
                              onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-dim)"; e.currentTarget.style.background = "none"; }}
                            >
                              <Trash size={12} weight="regular" aria-hidden="true" />
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  <div style={{ borderTop: "1px solid var(--border)", padding: "4px", flexShrink: 0 }}>
                  {!wtNewOpen ? (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setWtNewOpen(true);
                        setWtError(null);
                        setTimeout(() => wtNewInputRef.current?.focus(), 0);
                      }}
                      title={t("desktop.createWorktree")}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        width: "100%",
                        padding: "7px 8px",
                        background: "transparent",
                        border: "none",
                        borderRadius: 5,
                        color: "var(--text-muted)",
                        cursor: "pointer",
                        textAlign: "left",
                        fontSize: 12,
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; e.currentTarget.style.color = "var(--text)"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--text-muted)"; }}
                    >
                      <Plus size={14} weight="regular" style={{ flexShrink: 0 }} aria-hidden="true" />
                      <span>{t("desktop.newWorktree")}</span>
                    </button>
                  ) : (
                    <div style={{ padding: "6px 4px 4px" }}>
                      <input
                        ref={wtNewInputRef}
                        value={wtNewBranch}
                        onChange={(e) => {
                          setWtNewBranch(e.target.value);
                          setWtError(null);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            void handleCreateWorktree();
                          }
                          if (e.key === "Escape") {
                            setWtNewOpen(false);
                            setWtNewBranch("");
                            setWtError(null);
                          }
                        }}
                        placeholder={t("desktop.branchName")}
                        style={{
                          width: "100%",
                          fontSize: 11,
                          fontFamily: "var(--font-mono)",
                          padding: "5px 8px",
                          border: "1px solid var(--accent)",
                          borderRadius: 5,
                          outline: "none",
                          background: "var(--bg)",
                          color: "var(--text)",
                          boxSizing: "border-box",
                        }}
                      />
                      <div style={{ display: "flex", gap: 5, marginTop: 5 }}>
                        <button
                          onClick={() => void handleCreateWorktree()}
                          disabled={wtBusy || !wtNewBranch.trim()}
                          style={{
                            flex: 1,
                            padding: "4px 0",
                            background: "var(--accent)",
                            border: "none",
                            borderRadius: 5,
                            color: "#fff",
                            fontSize: 11,
                            fontWeight: 600,
                            cursor: wtBusy || !wtNewBranch.trim() ? "not-allowed" : "pointer",
                            opacity: wtBusy || !wtNewBranch.trim() ? 0.65 : 1,
                          }}
                        >
                          {wtBusy ? t("desktop.creating") : t("desktop.create")}
                        </button>
                        <button
                          onClick={() => { setWtNewOpen(false); setWtNewBranch(""); setWtError(null); }}
                          style={{
                            flex: 1,
                            padding: "4px 0",
                            background: "var(--bg-hover)",
                            border: "1px solid var(--border)",
                            borderRadius: 5,
                            color: "var(--text-muted)",
                            fontSize: 11,
                            cursor: "pointer",
                          }}
                        >
                          {t("desktop.cancel")}
                        </button>
                      </div>
                    </div>
                  )}
                  {wtError && (
                    <div style={{
                      marginTop: 5,
                      padding: "0 4px 2px",
                      color: "#dc2626",
                      fontSize: 11,
                      lineHeight: 1.35,
                      overflowWrap: "anywhere",
                    }}>
                      {wtError}
                    </div>
                  )}
                  </div>
              </AnimatedDropdown>
            </div>
          );
        })()}
        {viewMode === "classic" && !hasWorkspaceControlsHosts && inactiveWorktreeSelector && (
          <button
            type="button"
            aria-disabled="true"
            tabIndex={-1}
            title={inactiveWorktreeSelector.title}
            style={{
              width: "100%",
              height: 29,
              boxSizing: "border-box",
              marginTop: 6,
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "0 10px",
              border: "1px solid var(--border)",
              borderRadius: 7,
              background: "var(--bg-hover)",
              color: "var(--text-dim)",
              fontSize: 11,
              lineHeight: 1.35,
              whiteSpace: "nowrap",
              textAlign: "left",
              cursor: "default",
              opacity: 0.82,
            }}
          >
            <GitBranch size={11} weight="regular" style={{ flexShrink: 0 }} aria-hidden="true" />
            <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{inactiveWorktreeSelector.label}</span>
          </button>
        )}
      </div>

      {/* Session list — when both panels open, uses intelligent max-height;
           when explorer is collapsed, expands to fill remaining space. */}
      {sessionsOpen && (
        <div style={{ flex: explorerOpen ? "0 1 auto" : "1 1 0", overflowY: "auto", padding: "0", minHeight: 0, maxHeight: explorerOpen ? "min(40%, 360px)" : "none" }}>
          {loading && (
            <div style={{ padding: "16px 14px", color: "var(--text-muted)", fontSize: 12 }}>
              {t("desktop.loading")}
            </div>
          )}
          {error && (
            <div style={{ padding: "12px 14px", color: "#f87171", fontSize: 12 }}>
              {error}
            </div>
          )}
          {!loading && !error && searchScopedSessions.length === 0 && (
            <div style={{ padding: "16px 14px", color: "var(--text-muted)", fontSize: 12 }}>
              {searchQuery || markFilter ? t("desktop.noMatchingSessions") : t("desktop.noSessionsFound")}
            </div>
          )}
          {sessionGroups.map(({ bucket, nodes }) => (
            <div key={bucket}>
              <TimeGroupHeader
                bucket={bucket}
                count={countSessionRows(nodes)}
                collapsed={isFilteredView ? false : collapsedGroups[bucket]}
                onToggle={() => toggleGroup(bucket)}
              />
              {(isFilteredView || !collapsedGroups[bucket]) && nodes.map((node) => renderTreeItem(node))}
            </div>
          ))}
        </div>
      )}

      {/* Worktree panel — tabs view mode replaces the title-bar/sidebar
          switchers with a dedicated sidebar panel (requirement 6). */}
      {viewMode === "tabs" && (selectedCwdProp || selectedCwd) && (
        <WorktreePanel
          worktreeState={worktreeState}
          selectedCwd={selectedCwd}
          loading={worktreeLoading}
          guide={worktreeGuide}
          homeDir={homeDir}
          onSelect={handlePanelSelectWorktree}
          onCreate={handleCreateWorktree}
          onRemove={handleRemoveWorktree}
          busy={wtBusy}
          error={wtError}
          confirmRemove={wtConfirmRemove}
          onConfirmRemoveChange={setWtConfirmRemove}
        />
      )}

      {/* File Explorer section */}
      {(selectedCwdProp || selectedCwd) && (
        <div
          style={{
            borderTop: "1px solid var(--border)",
            display: "flex",
            flexDirection: "column",
            flex: explorerOpen ? "1 1 0" : "0 0 auto",
            minHeight: 0,
            overflow: "hidden",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", flexShrink: 0 }}>
            <button
              onClick={() => setExplorerOpen((open) => {
                const next = !open;
                saveExplorerOpen(next);
                return next;
              })}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                flex: 1,
                padding: "6px 10px",
                background: "none",
                border: "none",
                color: "var(--text-muted)",
                cursor: "pointer",
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: "0.05em",
                textTransform: "uppercase",
                textAlign: "left",
              }}
            >
              <CaretRight size={9} weight="regular" style={{ transform: explorerOpen ? "rotate(90deg)" : "none", transition: "transform 0.15s", flexShrink: 0 }} aria-hidden="true" />
              {t("desktop.explorer")}
            </button>
            {explorerOpen && (
              <button
                onClick={() => fileExplorerRef.current?.openUploadPicker()}
                disabled={explorerUploadBusy}
                title={t("desktop.uploadFilesToProjectRoot")}
                aria-label={t("desktop.uploadFiles")}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "center",
                  width: 26, height: 26, padding: 0,
                  background: "none",
                  border: "none",
                  color: "var(--text-dim)",
                  cursor: explorerUploadBusy ? "default" : "pointer",
                  borderRadius: 5,
                  flexShrink: 0,
                  opacity: explorerUploadBusy ? 0.6 : 1,
                  transition: "color 0.3s, background 0.3s",
                }}
                onMouseEnter={(e) => { if (explorerUploadBusy) return; e.currentTarget.style.color = "var(--text-muted)"; e.currentTarget.style.background = "var(--bg-hover)"; }}
                onMouseLeave={(e) => { if (explorerUploadBusy) return; e.currentTarget.style.color = "var(--text-dim)"; e.currentTarget.style.background = "none"; }}
              >
                <UploadSimple size={13} weight="regular" aria-hidden="true" />
              </button>
            )}
            <button
              onClick={() => {
                setExplorerKey((k) => k + 1);
                setExplorerRefreshDone(true);
                if (explorerRefreshTimerRef.current) clearTimeout(explorerRefreshTimerRef.current);
                explorerRefreshTimerRef.current = setTimeout(() => setExplorerRefreshDone(false), 2000);
              }}
              title={t("desktop.refreshExplorer")}
              style={{
                display: "flex", alignItems: "center", justifyContent: "center",
                width: 26, height: 26, padding: 0, marginRight: 6,
                background: explorerRefreshDone ? "rgba(74,222,128,0.18)" : "none",
                border: "none",
                color: explorerRefreshDone ? "#4ade80" : "var(--text-dim)",
                cursor: "pointer",
                borderRadius: 5,
                flexShrink: 0,
                transition: "color 0.3s, background 0.3s",
              }}
              onMouseEnter={(e) => { if (explorerRefreshDone) return; e.currentTarget.style.color = "var(--text-muted)"; e.currentTarget.style.background = "var(--bg-hover)"; }}
              onMouseLeave={(e) => { if (explorerRefreshDone) return; e.currentTarget.style.color = "var(--text-dim)"; e.currentTarget.style.background = "none"; }}
            >
              {explorerRefreshDone ? (
                <Check size={13} color="#4ade80" weight="regular" aria-hidden="true" />
              ) : (
                <ArrowClockwise size={13} weight="regular" aria-hidden="true" />
              )}
            </button>
          </div>
          {explorerOpen && (
            <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden" }}>
              <FileExplorer
                ref={fileExplorerRef}
                cwd={selectedCwd ?? selectedCwdProp!}
                onOpenFile={onOpenFile ?? (() => {})}
                refreshKey={explorerKey}
                onAtMention={onAtMention}
                onAtMentions={onAtMentions}
                onUploadBusyChange={setExplorerUploadBusy}
              />
            </div>
          )}
        </div>
      )}

      {(selectedCwdProp || selectedCwd) && (
        <QuickChangesPanel
          cwd={selectedCwd ?? selectedCwdProp!}
          refreshKey={explorerKey}
          onOpenFile={onOpenFile ?? (() => {})}
        />
      )}
    </div>
    </>
  );
}

/** Total number of session rows in a tree, including fork children. */
function countSessionRows(nodes: SessionTreeNode[]): number {
  let count = 0;
  for (const node of nodes) {
    count += 1 + countSessionRows(node.children);
  }
  return count;
}

/** Structural equality for the workspace activity maps reported upward. */
function sameActivity(
  a: Map<string, { running: number; unread: number }>,
  b: Map<string, { running: number; unread: number }>,
): boolean {
  if (a.size !== b.size) return false;
  for (const [key, value] of a) {
    const other = b.get(key);
    if (!other || other.running !== value.running || other.unread !== value.unread) return false;
  }
  return true;
}

/**
 * Sticky, collapsible header for a session-list time group. Sticks to the top
 * of the scroll container — its opaque panel background covers rows scrolling
 * underneath — and shows the row count next to the label. When collapsed, the
 * group's rows are not rendered at all (render-level lazy loading).
 */
function TimeGroupHeader({
  bucket,
  count,
  collapsed,
  onToggle,
}: {
  bucket: TimeBucket;
  count: number;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const { t } = useI18n();
  const [stuck, setStuck] = useState(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  // Detect the sticky state via a 1px sentinel right above the header in
  // the same scroll container: it goes out of view exactly when the header
  // sticks to the container top. While stuck the header paints its panel
  // background (masking rows scrolling beneath); in normal flow it stays
  // transparent and matches the list rows — same behavior in wallpaper
  // mode, where the panel's frosted glass shows through either way.
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const scroll = sentinel.closest(
      '[style*="overflow-y"], .overflow-y-auto, [class*="overflow-y-auto"]'
    );
    if (!scroll) return;
    const io = new IntersectionObserver(
      ([entry]) => setStuck(!entry.isIntersecting),
      { root: scroll, threshold: 0 }
    );
    io.observe(sentinel);
    return () => io.disconnect();
  }, []);

  return (
    <>
      <div ref={sentinelRef} aria-hidden="true" style={{ height: 1 }} />
      <div
        className="sidebar-time-group-header"
        role="button"
        tabIndex={0}
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onToggle();
          }
        }}
        aria-expanded={!collapsed}
        title={collapsed ? t("desktop.expandGroup") : t("desktop.collapseGroup")}
      style={{
        position: "sticky",
        top: 0,
        zIndex: 1,
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "5px 8px 3px",
        cursor: "pointer",
        userSelect: "none",
        fontSize: 10,
        fontWeight: 600,
        color: "var(--text-dim)",
        textTransform: "uppercase",
        letterSpacing: "0.07em",
        background: stuck ? "var(--bg-panel)" : "transparent",
        transition: "background 0.15s",
      }}
    >
      <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {t(timeBucketKey(bucket), { count })}
      </span>
    </div>
    </>
  );
}

function SessionTreeItem({
  node,
  selectedSessionId,
  selectedDraftId,
  runningSessionIds,
  unreadSessionIds,
  onSelectSession,
  onRenamed,
  onSessionDeleted,
  onMarked,
  onPinned,
  onRegenerateTitle,
  titleGeneratingId,
  onDeleteDraft,
  onRenameDraft,
  depth,
}: {
  node: SessionTreeNode;
  selectedSessionId: string | null;
  selectedDraftId?: string | null;
  runningSessionIds: Set<string>;
  unreadSessionIds: Set<string>;
  onSelectSession: (s: SessionRow) => void;
  onRenamed?: (id: string, name: string) => void;
  onSessionDeleted?: (id: string) => void;
  onMarked?: () => void;
  onPinned?: () => void;
  onRegenerateTitle?: (sessionId: string) => void;
  titleGeneratingId?: string | null;
  onDeleteDraft?: (id: string) => void;
  onRenameDraft?: (id: string, name: string) => void;
  depth: number;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const hasChildren = node.children.length > 0;

  const isSelected = node.session.id === selectedSessionId
    || (node.session.isDraft === true && node.session.id === selectedDraftId);

  return (
    <div>
      <div style={{ position: "relative" }}>
        {/* Indent line for child sessions */}
        {depth > 0 && (
          <div style={{
            position: "absolute",
            left: depth * 12 + 6,
            top: 0, bottom: 0,
            width: 1,
            background: "var(--border)",
            pointerEvents: "none",
          }} />
        )}
        <SessionItem
          session={node.session}
          isSelected={isSelected}
          isRunning={runningSessionIds.has(node.session.id)}
          isUnread={unreadSessionIds.has(node.session.id)}
          onClick={() => onSelectSession(node.session)}
          onRenamed={onRenamed}
          onDeleted={(id) => onSessionDeleted?.(id)}
          onMarked={onMarked}
          onPinned={onPinned}
          onRegenerateTitle={onRegenerateTitle}
          titleGeneratingId={titleGeneratingId}
          onDeleteDraft={onDeleteDraft}
          onRenameDraft={onRenameDraft}
          depth={depth}
          hasChildren={hasChildren}
          collapsed={collapsed}
          onToggleCollapse={() => setCollapsed((v) => !v)}
        />
      </div>
      {hasChildren && !collapsed && (
        <div>
          {node.children.map((child) => (
            <SessionTreeItem
              key={child.session.id}
              node={child}
              selectedSessionId={selectedSessionId}
              selectedDraftId={selectedDraftId}
              runningSessionIds={runningSessionIds}
              unreadSessionIds={unreadSessionIds}
              onSelectSession={onSelectSession}
              onRenamed={onRenamed}
              onSessionDeleted={onSessionDeleted}
              onMarked={onMarked}
              onPinned={onPinned}
              onRegenerateTitle={onRegenerateTitle}
              titleGeneratingId={titleGeneratingId}
              onDeleteDraft={onDeleteDraft}
              onRenameDraft={onRenameDraft}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function RunningSessionIndicator() {
  const { t } = useI18n();

  return (
    <span
      title={t("desktop.agentRunning")}
      aria-label={t("desktop.agentRunningLabel")}
      style={{
        width: 14,
        height: 14,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        color: "var(--accent)",
      }}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ display: "block" }}>
        <g>
          <path
            d="M21 12a9 9 0 1 1-3.8-7.4"
            stroke="currentColor"
            strokeWidth="2.8"
            strokeLinecap="round"
          />
          <animateTransform
            attributeName="transform"
            type="rotate"
            from="0 12 12"
            to="360 12 12"
            dur="0.9s"
            repeatCount="indefinite"
          />
        </g>
      </svg>
    </span>
  );
}

function UnreadSessionIndicator() {
  const { t } = useI18n();

  return (
    <span
      title={t("desktop.newActivity")}
      aria-label={t("desktop.newSessionActivity")}
      style={{
        width: 14,
        height: 14,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        color: "var(--accent)",
      }}
    >
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true" style={{ display: "block" }}>
        <circle cx="7" cy="7" r="3" fill="currentColor">
          <animate attributeName="opacity" values="1;0.25;1" dur="1.6s" repeatCount="indefinite" />
        </circle>
      </svg>
    </span>
  );
}

/** Visual + label metadata for the four session status marks. */
const SESSION_MARK_ICONS = {
  completed: SealCheck,
  discussion: ChatCircle,
  pending: ClockCountdown,
  abandoned: XCircle,
} as const;

const SESSION_MARK_COLORS = {
  completed: "var(--accent-green)",
  discussion: "var(--accent-blue)",
  pending: "var(--accent-orange)",
  abandoned: "var(--text-dim)",
} as const;

const SESSION_MARK_LABEL_KEYS = {
  completed: "desktop.markCompleted",
  discussion: "desktop.markDiscussion",
  pending: "desktop.markPending",
  abandoned: "desktop.markAbandoned",
} as const;

const SESSION_MARK_ORDER: SessionMark[] = ["completed", "discussion", "pending", "abandoned"];

/**
 * Build the four mark options for a context menu (row mark submenu and the
 * search filter picker share the same labels/icons/checked state). When
 * `counts` is provided (filter picker), each entry shows how many sessions
 * in the current scope carry that mark.
 */
function markMenuEntries(
  t: (key: string) => string,
  activeMark: SessionMark | null,
  onPick: (mark: SessionMark) => void,
  counts?: Map<SessionMark, number>,
): ContextMenuItem[] {
  return SESSION_MARK_ORDER.map((mark) => {
    const Icon = SESSION_MARK_ICONS[mark];
    return {
      label: t(SESSION_MARK_LABEL_KEYS[mark]),
      icon: <Icon size={13} weight="regular" aria-hidden="true" />,
      checked: activeMark === mark,
      hint: counts ? (counts.get(mark) ?? 0) : undefined,
      onSelect: () => onPick(mark),
    };
  });
}

/** Small icon + text badge shown after the message count in a session row. */
function SessionMarkBadge({ mark }: { mark: SessionMark }) {
  const { t } = useI18n();
  const Icon = SESSION_MARK_ICONS[mark];
  const label = t(SESSION_MARK_LABEL_KEYS[mark]);
  return (
    <span
      title={label}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 4,
        color: SESSION_MARK_COLORS[mark],
        flexShrink: 0,
      }}
    >
      <Icon size={11} weight={mark === "completed" ? "fill" : "regular"} aria-hidden="true" />
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
    </span>
  );
}

function SessionItem({
  session,
  isSelected,
  isRunning,
  isUnread,
  onClick,
  onRenamed,
  onDeleted,
  onMarked,
  onPinned,
  onRegenerateTitle,
  titleGeneratingId,
  onDeleteDraft,
  onRenameDraft,
  depth = 0,
  hasChildren = false,
  collapsed = false,
  onToggleCollapse,
}: {
  session: SessionRow;
  isSelected: boolean;
  isRunning?: boolean;
  isUnread?: boolean;
  onClick: () => void;
  onRenamed?: (id: string, name: string) => void;
  onDeleted?: (id: string) => void;
  /** Called after a mark change is persisted so the parent can refresh the list. */
  onMarked?: () => void;
  /** Called after a pin change is persisted so the parent can refresh the list. */
  onPinned?: () => void;
  /** Called to trigger title regeneration for this session (context menu). */
  onRegenerateTitle?: (sessionId: string) => void;
  /** Session id currently having its title regenerated (disables the menu item). */
  titleGeneratingId?: string | null;
  onDeleteDraft?: (id: string) => void;
  onRenameDraft?: (id: string, name: string) => void;
  depth?: number;
  hasChildren?: boolean;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}) {
  const { t } = useI18n();
  const [hovered, setHovered] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const title = session.name
    || (session.isDraft
        ? (getSessionDisplayFirstMessage(session.firstMessage).slice(0, 50) || t("desktop.newSessionDraft"))
        : getSessionDisplayFirstMessage(session.firstMessage).slice(0, 50))
    || session.id.slice(0, 12);

  const startRename = useCallback((e?: React.MouseEvent) => {
    e?.stopPropagation();
    setRenameValue(title);
    setRenaming(true);
    setTimeout(() => inputRef.current?.select(), 0);
  }, [title]);

  const commitRename = useCallback(async () => {
    const name = renameValue.trim();
    setRenaming(false);
    if (name === (session.name ?? "")) return;
    if (session.isDraft) {
      onRenameDraft?.(session.id, name);
      return;
    }
    try {
      await fetch(`/api/sessions/${encodeURIComponent(session.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      onRenamed?.(session.id, name);
    } catch {
      // ignore
    }
  }, [renameValue, session.id, session.name, session.isDraft, onRenamed, onRenameDraft]);

  const handleDeleteClick = useCallback((e?: React.MouseEvent) => {
    e?.stopPropagation();
    setConfirmDelete(true);
  }, []);

  const handleDeleteConfirm = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirmDelete(false);
    setDeleting(true);
    if (session.isDraft) {
      onDeleteDraft?.(session.id);
      return;
    }
    try {
      await fetch(`/api/sessions/${encodeURIComponent(session.id)}`, { method: "DELETE" });
      onDeleted?.(session.id);
    } catch {
      setDeleting(false);
    }
  }, [session.id, session.isDraft, onDeleted, onDeleteDraft]);

  const handleDeleteCancel = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirmDelete(false);
  }, []);

  // Persist a status mark (or clear it with null); the row then refreshes via
  // onMarked. Appends a custom entry, so it is safe while the session runs.
  const setMark = useCallback(async (mark: SessionMark | null) => {
    try {
      await fetch(`/api/sessions/${encodeURIComponent(session.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mark }),
      });
      onMarked?.();
    } catch {
      // ignore
    }
  }, [session.id, onMarked]);

  // Toggle the pin flag; the row then refreshes via onPinned, which re-buckets
  // it into (or out of) the pinned group. Appends a custom entry, so it is
  // safe while the session runs. Drafts have no saved .jsonl to persist to.
  const togglePin = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (session.isDraft) return;
    try {
      await fetch(`/api/sessions/${encodeURIComponent(session.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin: !session.pinned }),
      });
      onPinned?.();
    } catch {
      // ignore
    }
  }, [session.id, session.pinned, session.isDraft, onPinned]);

  const { openMenu } = useContextMenu();

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Inline rename / delete-confirm / delete-in-flight take over the row:
    // don't let a stray right-click open a menu on top of them.
    if (confirmDelete || renaming || deleting) return;
    // A title model must be configured before titles can be generated; the
    // menu item is disabled (with a tooltip) until one is picked in Settings.
    const titleModelConfigured = getTitleModel() !== null;
    openMenu(e.clientX, e.clientY, [
      {
        label: t("desktop.rename"),
        icon: <PencilSimple size={13} weight="regular" aria-hidden="true" />,
        onSelect: () => startRename(),
      },
      {
        label: t("desktop.regenerateTitle"),
        icon: <TextAa size={13} weight="regular" aria-hidden="true" />,
        // Drafts have no saved .jsonl yet, so there is no history to name.
        disabled: session.isDraft === true
          || !titleModelConfigured
          || titleGeneratingId === session.id,
        title: !titleModelConfigured
          ? t("desktop.titleModelMissing")
          : session.isDraft === true
            ? t("desktop.regenerateTitleDraft")
            : undefined,
        onSelect: () => onRegenerateTitle?.(session.id),
      },
      { type: "separator" },
      {
        label: t("desktop.viewFullHistory"),
        icon: <ClockCounterClockwise size={13} weight="regular" aria-hidden="true" />,
        // Drafts have no saved .jsonl yet, so the HTML export has nothing to read.
        disabled: session.isDraft === true,
        onSelect: () => {
          window.open(
            `/api/sessions/${encodeURIComponent(session.id)}/export?inline=1`,
            "_blank",
            "noopener,noreferrer",
          );
        },
      },
      {
        label: t("desktop.mark"),
        icon: <Tag size={13} weight="regular" aria-hidden="true" />,
        // Drafts have no saved .jsonl yet, so a mark cannot be persisted.
        disabled: session.isDraft === true,
        submenu: markMenuEntries(t, session.mark ?? null, (mark) => setMark(mark === session.mark ? null : mark)),
      },
      { type: "separator" },
      {
        label: t("desktop.delete"),
        icon: <Trash size={13} weight="regular" aria-hidden="true" />,
        danger: true,
        onSelect: () => handleDeleteClick(),
      },
    ]);
  }, [confirmDelete, renaming, deleting, openMenu, session.id, session.isDraft, session.mark, titleGeneratingId, startRename, handleDeleteClick, setMark, onRegenerateTitle, t]);

  // Fixed-height outer wrapper — content swaps in place so the list never reflows
  const ITEM_HEIGHT = 50;
  // Marked rows (completed/pending) grow their accent line on hover/selection.
  // The line is a non-layout overlay scaled with transform, so the text never
  // shifts when it grows.
  const markLineActive = !confirmDelete
    && (session.mark === "completed" || session.mark === "pending")
    && (isSelected || hovered);
  // Unified left line: delete-confirm red, completed green, pending orange,
  // otherwise none. Rendered as a borderless overlay so it hugs the edge.
  const lineColor = confirmDelete
    ? "#ef4444"
    : session.mark === "completed"
      ? "var(--accent-green)"
      : session.mark === "pending"
        ? "var(--accent-orange)"
        : null;

  return (
    <div
      onClick={confirmDelete || renaming ? undefined : onClick}
      onContextMenu={handleContextMenu}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => { setHovered(false); }}
      style={{
        height: ITEM_HEIGHT,
        display: "flex",
        alignItems: "center",
        paddingLeft: depth > 0 ? depth * 12 + 14 : 14,
        paddingRight: 8,
        cursor: confirmDelete || renaming ? "default" : "pointer",
        background: confirmDelete
          ? "rgba(239,68,68,0.06)"
          : isSelected ? "var(--bg-selected)" : hovered ? "var(--bg-hover)" : "transparent",
        borderLeft: "none",
        transition: "background 0.1s",
        position: "relative",
        opacity: deleting ? 0.5 : 1,
        gap: 6,
        overflow: "hidden",
      }}
    >
      {/* Left accent line overlay: absolute at the row edge (no border on the
          row itself), scaleX(0.5) for the 2px resting width, scaleX(1) for the
          4px hover/selection width. Dashed only for pending marks. */}
      {lineColor && (
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            width: 4,
            borderLeft: `${session.mark === "pending" && !confirmDelete ? "dashed" : "solid"} 4px ${lineColor}`,
            transform: `scaleX(${markLineActive ? 1 : 0.5})`,
            transformOrigin: "left center",
            transition: "transform 0.15s ease",
            pointerEvents: "none",
          }}
        />
      )}
      {confirmDelete ? (
        /* ── Delete confirmation: same height, two flat buttons ── */
        <>
          <div style={{ flex: 1, minWidth: 0, fontSize: 12, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {session.isDraft
              ? t("desktop.deleteDraft", { title: `“${title.slice(0, 22)}${title.length > 22 ? "…" : ""}”` })
              : t("desktop.deleteSession", { title: `“${title.slice(0, 22)}${title.length > 22 ? "…" : ""}”` })}
          </div>
          <div style={{ display: "flex", gap: 5, flexShrink: 0 }}>
            <button
              onClick={handleDeleteConfirm}
              style={{
                display: "flex", alignItems: "center", justifyContent: "center", gap: 4,
                height: 30, padding: "0 11px",
                background: "#ef4444", border: "none",
                borderRadius: 6, color: "#fff",
                cursor: "pointer", fontSize: 12, fontWeight: 600,
                whiteSpace: "nowrap",
              }}
            >
              <Trash size={12} weight="regular" aria-hidden="true" />
              {t("desktop.delete")}
            </button>
            <button
              onClick={handleDeleteCancel}
              style={{
                display: "flex", alignItems: "center", justifyContent: "center",
                height: 30, padding: "0 11px",
                background: "var(--bg)", border: "1px solid var(--border)",
                borderRadius: 6, color: "var(--text-muted)",
                cursor: "pointer", fontSize: 12, fontWeight: 500,
                whiteSpace: "nowrap",
              }}
            >
              {t("desktop.cancel")}
            </button>
          </div>
        </>
      ) : (
        /* ── Session content; renaming swaps only the title text in place ── */
        <>
          {/* Fork indicator for child sessions */}
          {depth > 0 && (
            <GitBranch size={10} color="var(--text-dim)" weight="regular" style={{ flexShrink: 0 }} aria-hidden="true" />
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            {/* Title row: indicator + text + collapse + action buttons — all inline, same height */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 5,
                minWidth: 0,
                height: 20,
                fontSize: 12,
                fontWeight: isSelected ? 500 : 400,
                lineHeight: "20px",
                color: "var(--text)",
              }}
              title={isRunning ? `${title} · ${t("desktop.agentRunning")}` : isUnread ? `${title} · ${t("desktop.newActivity")}` : title}
            >
              {/* Draft placeholder icon — same slot as the running/unread
                  indicators, aligned with the title text line. */}
              {session.isDraft && (
                <span
                  title={t("desktop.unsent")}
                  aria-label={t("desktop.unsent")}
                  style={{
                    width: 14,
                    height: 14,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                    color: "var(--text-dim)",
                  }}
                >
                  <CircleDashed size={14} weight="regular" aria-hidden="true" />
                </span>
              )}
              {isRunning ? <RunningSessionIndicator /> : isUnread ? <UnreadSessionIndicator /> : null}
              {renaming ? (
                <div
                  style={{
                    position: "relative",
                    flex: "1 1 0",
                    alignSelf: "stretch",
                    width: "100%",
                    minWidth: 0,
                    height: 20,
                    background: "color-mix(in srgb, var(--accent) 18%, var(--bg))",
                    borderRadius: 3,
                  }}
                >
                  <input
                  ref={inputRef}
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onBlur={commitRename}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      commitRename();
                    }
                    if (e.key === "Escape") {
                      e.preventDefault();
                      setRenaming(false);
                    }
                  }}
                  aria-label={t("desktop.rename")}
                  autoFocus
                  style={{
                    width: "100%",
                    minWidth: 0,
                    height: 20,
                    margin: 0,
                    padding: 0,
                    border: "none",
                    outline: "none",
                    background: "transparent",
                    borderRadius: "inherit",
                    color: "inherit",
                    font: "inherit",
                    lineHeight: "inherit",
                    caretColor: "var(--text)",
                  }}
                  />
                </div>
              ) : (
                <span
                  style={{
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0, flex: 1,
                    // Completed/abandoned sessions read as settled: fade the title.
                    ...(session.mark === "completed" || session.mark === "abandoned"
                      ? { color: "var(--text-muted)" }
                      : {}),
                    // Abandoned sessions additionally get a strikethrough.
                    ...(session.mark === "abandoned" ? { textDecoration: "line-through" } : {}),
                  }}
                  className={titleGeneratingId === session.id ? "session-title-generating" : undefined}
                >
                  {title}
                </span>
              )}
              {/* Collapse toggle — always visible when has children */}
              {hasChildren && (
                <button
                  onClick={(e) => { e.stopPropagation(); onToggleCollapse?.(); }}
                  title={collapsed ? t("desktop.expandForks") : t("desktop.collapseForks")}
                  style={{
                    display: "flex", alignItems: "center", justifyContent: "center",
                    width: 20, height: 20, padding: 0, flexShrink: 0,
                    background: "none", border: "none",
                    color: "var(--text-dim)", cursor: "pointer",
                    transform: collapsed ? "rotate(-90deg)" : "none",
                    transition: "transform 0.15s",
                  }}
                >
                  <CaretDown size={10} weight="regular" aria-hidden="true" />
                </button>
              )}
              {/* Action buttons — shown on hover */}
              {hovered && !renaming && (
                <div style={{ display: "flex", gap: 2, flexShrink: 0 }}>
                <button
                  onClick={togglePin}
                  title={session.pinned ? t("desktop.unpin") : t("desktop.pin")}
                  style={{
                    display: "flex", alignItems: "center", justifyContent: "center",
                    width: 20, height: 20, padding: 0,
                    background: "none", border: "none",
                    borderRadius: 4, color: session.pinned ? "var(--accent)" : "var(--text-dim)",
                    cursor: "pointer", flexShrink: 0,
                    transition: "color 0.12s",
                  }}
                  onMouseEnter={(e) => {
                    if (!session.pinned) e.currentTarget.style.color = "var(--accent)";
                  }}
                  onMouseLeave={(e) => {
                    if (!session.pinned) e.currentTarget.style.color = "var(--text-dim)";
                  }}
                >
                  <PushPin size={13} weight={session.pinned ? "fill" : "regular"} aria-hidden="true" />
                </button>
                <button
                  onClick={startRename}
                  title={t("desktop.rename")}
                  style={{
                    display: "flex", alignItems: "center", justifyContent: "center",
                    width: 20, height: 20, padding: 0,
                    background: "none", border: "none",
                    borderRadius: 4, color: "var(--text-dim)",
                    cursor: "pointer", flexShrink: 0,
                    transition: "color 0.12s",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.color = "var(--accent)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.color = "var(--text-dim)";
                  }}
                >
                  <PencilSimple size={13} weight="regular" aria-hidden="true" />
                </button>
                <button
                  onClick={handleDeleteClick}
                  title={t("desktop.delete")}
                  style={{
                    display: "flex", alignItems: "center", justifyContent: "center",
                    width: 20, height: 20, padding: 0,
                    background: "none", border: "none",
                    borderRadius: 4, color: "var(--text-dim)",
                    cursor: "pointer", flexShrink: 0,
                    transition: "color 0.12s",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.color = "#ef4444";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.color = "var(--text-dim)";
                  }}
                >
                  <Trash size={13} weight="regular" aria-hidden="true" />
                </button>
                </div>
              )}
            </div>
            {/* Metadata row */}
            <div style={{ marginTop: 2, display: "flex", gap: 8, color: "var(--text-dim)", fontSize: 11, minWidth: 0 }}>
              {session.pinned && (
                <span
                  title={t("desktop.pinned")}
                  aria-label={t("desktop.pinned")}
                  style={{ display: "inline-flex", alignItems: "center", color: "var(--accent)", flexShrink: 0 }}
                >
                  <PushPin size={10} weight="fill" aria-hidden="true" />
                </span>
              )}
              <span title={session.modified}>{formatRelativeTime(session.modified, t)}</span>
              {session.isDraft
                ? <span>{t("desktop.unsent")}</span>
                : <span>{t("desktop.messagesCount", { count: session.messageCount })}</span>}
              {!session.isDraft && session.mark && (
                <SessionMarkBadge mark={session.mark} />
              )}
              {session.worktreeBranch && (
                <span
                  title={t("desktop.worktree", { cwd: session.cwd })}
                  style={{ display: "flex", alignItems: "center", gap: 3, color: "var(--accent)", minWidth: 0, overflow: "hidden" }}
                >
                  <GitBranch size={9} weight="regular" style={{ flexShrink: 0 }} aria-hidden="true" />
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{session.worktreeBranch}</span>
                </span>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
