"use client";

import { useEffect, useLayoutEffect, useState, useCallback, useRef, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ArrowClockwise, CaretDown, CaretRight, Check, Folder, GitBranch, PencilSimple, Plus, Trash, UploadSimple } from "@phosphor-icons/react";
import type { SessionInfo } from "@/lib/types";
import { useI18n } from "@/hooks/useI18n";
import { FileExplorer, type FileExplorerHandle } from "./FileExplorer";

declare global {
  interface Window {
    piDesktop?: {
      selectDirectory: () => Promise<string | null>;
    };
  }
}

interface Props {
  selectedSessionId: string | null;
  onSelectSession: (session: SessionInfo, isRestore?: boolean) => void;
  onNewSession?: (sessionId: string, cwd: string) => void;
  initialSessionId?: string | null;
  onInitialRestoreDone?: () => void;
  refreshKey?: number;
  onSessionDeleted?: (sessionId: string) => void;
  selectedCwd?: string | null;
  onCwdChange?: (cwd: string | null, projectRoot?: string | null) => void;
  onOpenFile?: (filePath: string, fileName: string) => void;
  explorerRefreshKey?: number;
  onAtMention?: (relativePath: string, isDir: boolean) => void;
  onAtMentions?: (relativePaths: string[]) => void;
  workspaceControlsHost?: HTMLElement | null;
  workspaceControlsSize?: "compact" | "large";
}

interface WorktreeEntry {
  path: string;
  branch: string | null;
  isMain: boolean;
}

interface WorktreeState {
  /** The cwd this data was fetched for — guards against stale responses */
  forCwd: string;
  projectRoot: string;
  isGit: boolean;
  /** False when forCwd is a repo subdirectory — the switcher is hidden there
   *  because subdir sessions keep their own project identity */
  isTopLevel: boolean;
  worktrees: WorktreeEntry[];
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



interface SessionTreeNode {
  session: SessionInfo;
  children: SessionTreeNode[];
}

function buildSessionTree(sessions: SessionInfo[]): SessionTreeNode[] {
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



export function SessionSidebar({ selectedSessionId, onSelectSession, onNewSession, initialSessionId, onInitialRestoreDone, refreshKey, onSessionDeleted, selectedCwd: selectedCwdProp, onCwdChange, onOpenFile, explorerRefreshKey, onAtMention, onAtMentions, workspaceControlsHost, workspaceControlsSize = "compact" }: Props) {
  const { t } = useI18n();
  const [allSessions, setAllSessions] = useState<SessionInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedCwd, setSelectedCwd] = useState<string | null>(null);
  const [homeDir, setHomeDir] = useState<string>("");
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [projectFilter, setProjectFilter] = useState("");
  const [customPathOpen, setCustomPathOpen] = useState(false);
  const [customPathValue, setCustomPathValue] = useState("");
  const [customPathError, setCustomPathError] = useState<string | null>(null);
  const [customPathValidating, setCustomPathValidating] = useState(false);
  const customPathInputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
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
  const [explorerOpen, setExplorerOpen] = useState(true);
  const [explorerKey, setExplorerKey] = useState(0);
  const [explorerUploadBusy, setExplorerUploadBusy] = useState(false);
  const [sessionRefreshDone, setSessionRefreshDone] = useState(false);
  const [explorerRefreshDone, setExplorerRefreshDone] = useState(false);
  const [runningSessionIds, setRunningSessionIds] = useState<Set<string>>(() => new Set());
  const [unreadSessionIds, setUnreadSessionIds] = useState<Set<string>>(() => loadUnreadSessionIds());
  const previousRunningSessionIdsRef = useRef<Set<string>>(new Set());
  // Once the SSE stream has delivered a frame it is the source of truth for
  // running state; late /api/sessions responses must not overwrite it.
  const sseAuthoritativeRef = useRef(false);
  const sessionRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const explorerRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileExplorerRef = useRef<FileExplorerHandle>(null);

  const loadSessions = useCallback(async (showLoading = false) => {
    try {
      if (showLoading) setLoading(true);
      const res = await fetch("/api/sessions");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { sessions: SessionInfo[]; runningSessionIds?: string[] };
      setAllSessions(data.sessions);
      // Treat the fetched running set as an initial fallback only. Once SSE is
      // live it owns this state, so a slow fetch can't revive a stale snapshot.
      if (!sseAuthoritativeRef.current) {
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
    } catch (e) {
      setError(String(e));
    } finally {
      if (showLoading) setLoading(false);
    }
  }, []);

  const initialLoadDone = useRef(false);
  useEffect(() => {
    const isFirst = !initialLoadDone.current;
    initialLoadDone.current = true;
    loadSessions(isFirst);
  }, [loadSessions, refreshKey]);

  // Persist unread markers so they survive a browser refresh before the user
  // has actually opened the completed session.
  useEffect(() => {
    saveUnreadSessionIds(unreadSessionIds);
  }, [unreadSessionIds]);

  useEffect(() => {
    // Live running status via SSE — no polling. The server pushes the current
    // set of running session ids whenever any session starts/stops working.
    const source = new EventSource("/api/agent/running/events");

    source.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data) as { type?: string; runningSessionIds?: string[] };
        if (data.type === "running") {
          sseAuthoritativeRef.current = true;
          setRunningSessionIds(new Set(data.runningSessionIds ?? []));
        }
      } catch {
        // ignore malformed frames
      }
    };

    // On error EventSource auto-reconnects; keep the last known state meanwhile.
    return () => source.close();
  }, []);

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

  // Notify parent only when the effective cwd actually changes (not when
  // projectRootFor identity changes due to session/worktree refreshes).
  const lastNotifiedCwdRef = useRef<string | null>(null);
  useEffect(() => {
    if (lastNotifiedCwdRef.current === selectedCwd) return;
    lastNotifiedCwdRef.current = selectedCwd;
    onCwdChange?.(selectedCwd, projectRootFor(selectedCwd));
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

  // Auto-select cwd and restore session from URL on first load
  useEffect(() => {
    if (allSessions.length === 0) return;

    if (selectedCwd === null) {
      // If restoring a session, set cwd to match that session
      if (initialSessionId && !restoredRef.current) {
        restoredRef.current = true;
        const target = allSessions.find((s) => s.id === initialSessionId);
        if (target) {
          setSelectedCwd(target.cwd);
          onSelectSession(target, true);
          return;
        }
        // Session not found — notify parent so it can show the placeholder
        onInitialRestoreDone?.();
      }
      const projects = getRecentProjects(allSessions);
      if (projects.length > 0) setSelectedCwd(projects[0]);
    }
  }, [allSessions, selectedCwd, initialSessionId, onSelectSession, onInitialRestoreDone]);

  const commitCustomPath = useCallback(async (candidate?: string) => {
    const path = (candidate ?? customPathValue).trim();
    if (!path || customPathValidating) return;

    setCustomPathValidating(true);
    setCustomPathError(null);
    try {
      const res = await fetch("/api/cwd/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd: path }),
      });
      const data = await res.json().catch(() => ({})) as { cwd?: string; error?: string };
      if (!res.ok || data.error) {
        setCustomPathError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      setSelectedCwd(data.cwd ?? path);
      setCustomPathOpen(false);
      setCustomPathValue("");
      setDropdownOpen(false);
    } catch (e) {
      setCustomPathError(e instanceof Error ? e.message : String(e));
    } finally {
      setCustomPathValidating(false);
    }
  }, [customPathValue, customPathValidating]);

  const handleCustomPathClick = useCallback(async () => {
    const desktop = window.piDesktop;
    if (!desktop) {
      setCustomPathOpen(true);
      setCustomPathError(null);
      setTimeout(() => customPathInputRef.current?.focus(), 0);
      return;
    }

    try {
      setCustomPathError(null);
      const path = await desktop.selectDirectory();
      if (path === null) return;

      setCustomPathValue(path);
      setCustomPathOpen(true);
      await commitCustomPath(path);
    } catch (e) {
      setCustomPathOpen(true);
      setCustomPathError(e instanceof Error ? e.message : String(e));
      setTimeout(() => customPathInputRef.current?.focus(), 0);
    }
  }, [commitCustomPath]);

  const handleDefaultCwd = useCallback(async () => {
    try {
      const res = await fetch("/api/default-cwd", { method: "POST" });
      const data = await res.json() as { cwd?: string; error?: string };
      if (data.cwd) {
        setSelectedCwd(data.cwd);
        setCustomPathOpen(false);
        setCustomPathValue("");
        setCustomPathError(null);
        setDropdownOpen(false);
      }
    } catch {
      // ignore
    }
  }, []);

  const handleCreateWorktree = useCallback(async () => {
    const branch = wtNewBranch.trim();
    if (!branch || wtBusy || !worktreeState) return;
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
        return;
      }
      setWtNewOpen(false);
      setWtNewBranch("");
      setWtDropdownOpen(false);
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
    } catch (e) {
      setWtError(e instanceof Error ? e.message : String(e));
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

  // Close dropdowns on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
        setProjectFilter("");
        setCustomPathOpen(false);
        setCustomPathValue("");
        setCustomPathError(null);
      }
      if (wtDropdownRef.current && !wtDropdownRef.current.contains(e.target as Node)) {
        setWtDropdownOpen(false);
        setWtNewOpen(false);
        setWtNewBranch("");
        setWtError(null);
        setWtConfirmRemove(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Clicking a session moves the effective cwd to that session's worktree.
  // Done on the click path (not via the selectedCwd prop sync) so it also
  // works when the prop value won't change — e.g. re-clicking the already
  // open session after manually switching worktrees.
  const handleSelectSessionFromList = useCallback((s: SessionInfo) => {
    if (s.cwd) setSelectedCwd(s.cwd);
    onSelectSession(s);
  }, [onSelectSession]);

  const handleNewSession = useCallback(() => {
    if (!selectedCwd) return;
    // Generate a temporary UUID client-side — no backend call needed.
    // Pi will be spawned lazily when the user sends the first message.
    const tempId = typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
    onNewSession?.(tempId, selectedCwd);
  }, [selectedCwd, onNewSession]);

  const recentProjects = getRecentProjects(allSessions);
  const showProjectFilter = recentProjects.length > 8;
  const visibleProjects = projectFilter.trim()
    ? recentProjects.filter((p) => p.toLowerCase().includes(projectFilter.trim().toLowerCase()))
    : recentProjects;

  // Sessions of every worktree in the selected project are shown together
  const selectedProject = projectRootFor(selectedCwd);
  const filteredSessions = selectedProject
    ? allSessions.filter((s) => (s.projectRoot ?? s.cwd) === selectedProject)
    : allSessions;
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

  // Build parent-child tree within the filtered set
  const sessionTree = buildSessionTree(filteredSessions);

  const currentWt = worktreeState?.worktrees.find((w) => w.path === selectedCwd)
    ?? worktreeState?.worktrees.find((w) => w.isMain)
    ?? null;
  const compactProjectLabel = selectedCwd
    ? pathBaseName(selectedProject ?? selectedCwd)
    : (initialSessionId && !restoredRef.current ? "" : `${t("desktop.selectProject")}…`);
  const compactWorktreeLabel = currentWt
    ? (currentWt.branch ?? pathBaseName(currentWt.path))
    : inactiveWorktreeSelector?.label;
  const isLargeWorkspaceControl = workspaceControlsSize === "large";
  const workspaceControls = workspaceControlsHost ? (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "flex-start", gap: isLargeWorkspaceControl ? 6 : 2, height: isLargeWorkspaceControl ? "auto" : "100%", minWidth: 0, width: isLargeWorkspaceControl ? "100%" : undefined }}>
      <div ref={dropdownRef} style={{ position: "relative", minWidth: 0, width: isLargeWorkspaceControl ? "fit-content" : undefined, maxWidth: isLargeWorkspaceControl ? "min(100%, 560px)" : undefined }}>
        <button
          className="app-no-drag app-titlebar-context-control"
          onClick={() => setDropdownOpen((v) => !v)}
          title={selectedProject ?? selectedCwd ?? t("desktop.selectProject")}
          aria-label={t("desktop.selectProject")}
          aria-expanded={dropdownOpen}
          style={{
            height: isLargeWorkspaceControl ? 48 : 36,
            width: isLargeWorkspaceControl ? "100%" : undefined,
            maxWidth: isLargeWorkspaceControl ? "100%" : 260,
            minWidth: 0,
            display: "flex",
            alignItems: "center",
            gap: isLargeWorkspaceControl ? 10 : 6,
            padding: isLargeWorkspaceControl ? "0 12px" : "0 8px",
            background: dropdownOpen ? "var(--bg-selected)" : "none",
            border: "none",
            borderRadius: isLargeWorkspaceControl ? 8 : 0,
            color: dropdownOpen ? "var(--text)" : selectedCwd ? (isLargeWorkspaceControl ? "var(--text)" : "var(--text-muted)") : "var(--text-dim)",
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
            e.currentTarget.style.background = dropdownOpen ? "var(--bg-selected)" : "none";
            e.currentTarget.style.color = dropdownOpen ? "var(--text)" : selectedCwd ? "var(--text-muted)" : "var(--text-dim)";
          }}
        >
          <PathLabel text={compactProjectLabel} style={{ flex: 1, minWidth: 0, color: "inherit", direction: "ltr", fontFamily: "inherit" }} />
          <CaretDown size={12} weight="regular" style={{ flexShrink: 0, transition: "transform 0.12s", transform: dropdownOpen ? "rotate(180deg)" : "none" }} aria-hidden="true" />
        </button>
        <AnimatedDropdown open={dropdownOpen} style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, width: 320, zIndex: 1000, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 8, boxShadow: "0 6px 20px rgba(0,0,0,0.16)", overflow: "hidden" }}>
          <div style={{ maxHeight: "min(50vh, 380px)", overflowY: "auto" }}>
            {visibleProjects.map((project) => (
              <button key={project} onClick={() => { setSelectedCwd(project); setProjectFilter(""); setCustomPathOpen(false); setCustomPathValue(""); setCustomPathError(null); setDropdownOpen(false); }} title={project} style={{ display: "flex", alignItems: "center", gap: 7, width: "100%", padding: "8px 10px", background: "var(--bg)", border: "none", color: project === selectedProject ? "var(--text)" : "var(--text-muted)", cursor: "pointer", textAlign: "left", fontSize: 11, fontFamily: "var(--font-mono)" }}>
                {project === selectedProject ? <Check size={10} color="var(--accent)" weight="regular" style={{ flexShrink: 0 }} aria-hidden="true" /> : <span style={{ width: 10, flexShrink: 0 }} />}
                <PathLabel text={displayCwd(project, homeDir)} style={{ flex: 1 }} />
              </button>
            ))}
            {visibleProjects.length === 0 && <div style={{ padding: "8px 10px", fontSize: 11, color: "var(--text-dim)" }}>{projectFilter.trim() ? t("desktop.noMatchingProjects") : t("desktop.noProjectsYet")}</div>}
          </div>
          <button onClick={(e) => { e.stopPropagation(); handleDefaultCwd(); }} style={{ display: "flex", alignItems: "center", gap: 7, width: "100%", padding: "8px 10px", background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", textAlign: "left", fontSize: 11 }}>
            <span>{t("desktop.useDefaultDirectory")}</span>
          </button>
          {!customPathOpen ? (
            <button onClick={(e) => { e.stopPropagation(); void handleCustomPathClick(); }} style={{ display: "flex", alignItems: "center", gap: 7, width: "100%", padding: "8px 10px", background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", textAlign: "left", fontSize: 11 }}>
              <span>{t("desktop.customPath")}</span>
            </button>
          ) : (
            <div style={{ padding: "6px 8px" }}>
              <input
                ref={customPathInputRef}
                value={customPathValue}
                onChange={(e) => { setCustomPathValue(e.target.value); setCustomPathError(null); }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") { e.preventDefault(); void commitCustomPath(); }
                  if (e.key === "Escape") { setCustomPathOpen(false); setCustomPathValue(""); setCustomPathError(null); }
                }}
                placeholder={t("desktop.projectPathPlaceholder")}
                style={{ width: "100%", fontSize: 11, fontFamily: "var(--font-mono)", padding: "5px 8px", border: "1px solid var(--accent)", borderRadius: 5, outline: "none", background: "var(--bg)", color: "var(--text)", boxSizing: "border-box" }}
              />
              {customPathError && <div style={{ marginTop: 5, color: "#dc2626", fontSize: 11, lineHeight: 1.35, overflowWrap: "anywhere" }}>{customPathError}</div>}
              <div style={{ display: "flex", gap: 5, marginTop: 5 }}>
                <button onClick={() => void commitCustomPath()} disabled={customPathValidating || !customPathValue.trim()} style={{ flex: 1, padding: "4px 0", background: "var(--accent)", border: "none", borderRadius: 5, color: "#fff", fontSize: 11, fontWeight: 600, cursor: customPathValidating || !customPathValue.trim() ? "not-allowed" : "pointer", opacity: customPathValidating || !customPathValue.trim() ? 0.65 : 1 }}>{customPathValidating ? t("desktop.checking") : t("desktop.open")}</button>
                <button onClick={() => { setCustomPathOpen(false); setCustomPathValue(""); setCustomPathError(null); }} style={{ flex: 1, padding: "4px 0", background: "var(--bg-hover)", border: "1px solid var(--border)", borderRadius: 5, color: "var(--text-muted)", fontSize: 11, cursor: "pointer" }}>{t("desktop.cancel")}</button>
              </div>
            </div>
          )}
        </AnimatedDropdown>
      </div>

      {(showWorktreeSwitcher || inactiveWorktreeSelector) && (
        <div ref={wtDropdownRef} style={{ position: "relative", minWidth: 0 }}>
          <button
            className="app-no-drag app-titlebar-context-control"
            onClick={() => { if (showWorktreeSwitcher) setWtDropdownOpen((v) => !v); }}
            aria-label={t("desktop.switchWorktree")}
            aria-expanded={showWorktreeSwitcher ? wtDropdownOpen : undefined}
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
              background: wtDropdownOpen ? "var(--bg-selected)" : "none",
              border: "none",
              color: wtDropdownOpen ? "var(--text)" : showWorktreeSwitcher ? "var(--text-muted)" : "var(--text-dim)",
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
              e.currentTarget.style.background = wtDropdownOpen ? "var(--bg-selected)" : "none";
              e.currentTarget.style.color = wtDropdownOpen ? "var(--text)" : showWorktreeSwitcher ? "var(--text-muted)" : "var(--text-dim)";
            }}
          >
            <GitBranch size={16} weight="regular" style={{ flexShrink: 0 }} aria-hidden="true" />
            <PathLabel text={compactWorktreeLabel ?? ""} style={{ flex: 1, minWidth: 0, color: "inherit", direction: "ltr", fontFamily: "inherit" }} />
            {showWorktreeSwitcher && <CaretDown size={12} weight="regular" style={{ flexShrink: 0, transition: "transform 0.12s", transform: wtDropdownOpen ? "rotate(180deg)" : "none" }} aria-hidden="true" />}
          </button>
          <AnimatedDropdown open={showWorktreeSwitcher && wtDropdownOpen} style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, width: 320, zIndex: 1000, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 8, boxShadow: "0 6px 20px rgba(0,0,0,0.16)", overflow: "hidden" }}>
            <div style={{ maxHeight: "min(40vh, 300px)", overflowY: "auto" }}>
              {worktreeState?.worktrees.map((wt) => {
                const isCurrent = wt.path === selectedCwd || (wt.isMain && !worktreeState.worktrees.some((w) => w.path === selectedCwd));
                return (
                  <button key={wt.path} onClick={() => { setSelectedCwd(wt.path); setWtDropdownOpen(false); setWtError(null); }} title={wt.path} style={{ display: "flex", alignItems: "center", gap: 7, width: "100%", padding: "8px 10px", background: "var(--bg)", border: "none", borderBottom: "1px solid var(--border)", color: isCurrent ? "var(--text)" : "var(--text-muted)", cursor: "pointer", textAlign: "left", fontSize: 11, fontFamily: "var(--font-mono)" }}>
                    {isCurrent ? <Check size={10} color="var(--accent)" weight="regular" style={{ flexShrink: 0 }} aria-hidden="true" /> : <span style={{ width: 10, flexShrink: 0 }} />}
                    <PathLabel text={wt.branch ?? displayCwd(wt.path, homeDir)} style={{ flex: 1 }} />
                    {wt.isMain && <span style={{ flexShrink: 0, color: "var(--text-dim)", fontSize: 10 }}>{t("desktop.main")}</span>}
                  </button>
                );
              })}
            </div>
            {!wtNewOpen ? (
              <button onClick={(e) => { e.stopPropagation(); setWtNewOpen(true); setWtError(null); setTimeout(() => wtNewInputRef.current?.focus(), 0); }} title={t("desktop.createWorktree")} style={{ display: "flex", alignItems: "center", gap: 7, width: "100%", padding: "8px 10px", background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", textAlign: "left", fontSize: 11 }}>
                <span>{t("desktop.newWorktree")}</span>
              </button>
            ) : (
              <div style={{ padding: "6px 8px" }}>
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
          </AnimatedDropdown>
        </div>
      )}
    </div>
  ) : null;

  return (
    <>
      {workspaceControlsHost && workspaceControls ? createPortal(workspaceControls, workspaceControlsHost) : null}
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* Header */}
      <div style={{ flexShrink: 0 }}>
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
            onClick={() => loadSessions(false)}
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

        {/* CWD picker */}
        {!workspaceControlsHost && <div ref={dropdownRef} style={{ position: "relative" }}>
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
            }}
          >
              {showProjectFilter && (
                <div style={{ padding: "6px 8px", borderBottom: "1px solid var(--border)" }}>
                  <input
                    value={projectFilter}
                    onChange={(e) => setProjectFilter(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") {
                        setProjectFilter("");
                        setDropdownOpen(false);
                      }
                    }}
                    placeholder={t("desktop.filterProjects")}
                    autoFocus
                    style={{
                      width: "100%",
                      fontSize: 11,
                      fontFamily: "var(--font-mono)",
                      padding: "5px 8px",
                      border: "1px solid var(--border)",
                      borderRadius: 5,
                      outline: "none",
                      background: "var(--bg)",
                      color: "var(--text)",
                      boxSizing: "border-box",
                    }}
                  />
                </div>
              )}
              <div style={{ maxHeight: "min(50vh, 380px)", overflowY: "auto" }}>
                {visibleProjects.map((project) => (
                  <button
                    key={project}
                    onClick={() => {
                      setSelectedCwd(project);
                      setProjectFilter("");
                      setCustomPathOpen(false);
                      setCustomPathValue("");
                      setCustomPathError(null);
                      setDropdownOpen(false);
                    }}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 7,
                      width: "100%",
                      padding: "8px 10px",
                      background: "var(--bg)",
                      border: "none",
                      color: project === selectedProject ? "var(--text)" : "var(--text-muted)",
                      cursor: "pointer",
                      textAlign: "left",
                      fontSize: 11,
                      fontFamily: "var(--font-mono)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                    title={project}
                  >
                    {project === selectedProject && (
                      <Check size={10} color="var(--accent)" weight="regular" style={{ flexShrink: 0 }} aria-hidden="true" />
                    )}
                    {project !== selectedProject && <span style={{ width: 10, flexShrink: 0 }} />}
                    <PathLabel text={displayCwd(project, homeDir)} style={{ flex: 1 }} />
                  </button>
                ))}
                {visibleProjects.length === 0 && projectFilter.trim() && (
                  <div style={{ padding: "8px 10px", fontSize: 11, color: "var(--text-dim)" }}>{t("desktop.noMatchingProjects")}</div>
                )}
              </div>

              {/* Default cwd shortcut */}
              {!customPathOpen && (
                <button
                  onClick={(e) => { e.stopPropagation(); handleDefaultCwd(); }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 7,
                    width: "100%",
                    padding: "8px 10px",
                    background: "none",
                    border: "none",
                    borderTop: "none",
                    color: "var(--text-muted)",
                    cursor: "pointer",
                    textAlign: "left",
                    fontSize: 11,
                  }}
                >
                  <Folder size={10} weight="regular" style={{ flexShrink: 0 }} aria-hidden="true" />
                  <span>{t("desktop.useDefaultDirectory")}</span>
                </button>
              )}

              {/* Custom path entry */}
              {!customPathOpen ? (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    void handleCustomPathClick();
                  }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 7,
                    width: "100%",
                    padding: "8px 10px",
                    background: "none",
                    border: "none",
                    color: "var(--text-muted)",
                    cursor: "pointer",
                    textAlign: "left",
                    fontSize: 11,
                  }}
                >
                  <Plus size={10} weight="regular" style={{ flexShrink: 0 }} aria-hidden="true" />
                  <span>{t("desktop.customPath")}</span>
                </button>
              ) : (
                <div style={{ padding: "6px 8px", borderTop: visibleProjects.length > 0 ? "none" : undefined }}>
                  <input
                    ref={customPathInputRef}
                    value={customPathValue}
                    onChange={(e) => {
                      setCustomPathValue(e.target.value);
                      setCustomPathError(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void commitCustomPath();
                      }
                      if (e.key === "Escape") {
                        setCustomPathOpen(false);
                        setCustomPathValue("");
                        setCustomPathError(null);
                      }
                    }}
                    placeholder={t("desktop.projectPathPlaceholder")}
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
                  {customPathError && (
                    <div style={{
                      marginTop: 5,
                      color: "#dc2626",
                      fontSize: 11,
                      lineHeight: 1.35,
                      overflowWrap: "anywhere",
                    }}>
                      {customPathError}
                    </div>
                  )}
                  <div style={{ display: "flex", gap: 5, marginTop: 5 }}>
                    <button
                      onClick={() => void commitCustomPath()}
                      disabled={customPathValidating || !customPathValue.trim()}
                      style={{
                        flex: 1,
                        padding: "4px 0",
                        background: "var(--accent)",
                        border: "none",
                        borderRadius: 5,
                        color: "#fff",
                        fontSize: 11,
                        fontWeight: 600,
                        cursor: customPathValidating || !customPathValue.trim() ? "not-allowed" : "pointer",
                        opacity: customPathValidating || !customPathValue.trim() ? 0.65 : 1,
                      }}
                    >
                      {customPathValidating ? t("desktop.checking") : t("desktop.open")}
                    </button>
                    <button
                      onClick={() => { setCustomPathOpen(false); setCustomPathValue(""); setCustomPathError(null); }}
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
          </AnimatedDropdown>
        </div>}

        {/* Worktree switcher — shown only for git projects at a checkout top
            level (repo subdirs keep their own project identity, so switching
            from them would jump projects). Rendered whenever the selected cwd
            belongs to the loaded project (not just when forCwd matches), so
            switching between worktrees of one project keeps the row mounted
            instead of flickering while data refetches: all worktrees of a
            project share the same list anyway. */}
        {!workspaceControlsHost && showWorktreeSwitcher && (() => {
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
                  height: 29,
                  boxSizing: "border-box",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "0 10px",
                  background: "var(--bg-hover)",
                  border: "1px solid var(--border)",
                  borderRadius: 7,
                  cursor: "pointer",
                  fontSize: 11,
                  lineHeight: 1.35,
                  color: "var(--text-muted)",
                  textAlign: "left",
                }}
              >
                <GitBranch size={11} weight="regular" style={{ flexShrink: 0, color: currentWt && !currentWt.isMain ? "var(--accent)" : "var(--text-dim)" }} aria-hidden="true" />
                <PathLabel
                  text={currentWt ? (currentWt.branch ?? displayCwd(currentWt.path, homeDir)) : "…"}
                  style={{ flex: 1, fontFamily: "var(--font-mono)", color: "var(--text)" }}
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
                }}
              >
                  <div style={{ maxHeight: "min(40vh, 300px)", overflowY: "auto" }}>
                    {worktreeState.worktrees.map((wt) => {
                      const isCurrent = wt.path === selectedCwd || (wt.isMain && !worktreeState.worktrees.some((w) => w.path === selectedCwd));
                      if (wtConfirmRemove === wt.path) {
                        return (
                          <div key={wt.path} style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 10px", borderBottom: "1px solid var(--border)", background: "rgba(239,68,68,0.06)" }}>
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
                          className="wt-row"
                          style={{ display: "flex", alignItems: "center", borderBottom: "1px solid var(--border)" }}
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
                              gap: 7,
                              padding: "8px 10px",
                              background: "var(--bg)",
                              border: "none",
                              color: isCurrent ? "var(--text)" : "var(--text-muted)",
                              cursor: "pointer",
                              textAlign: "left",
                              fontSize: 11,
                              fontFamily: "var(--font-mono)",
                            }}
                          >
                            {isCurrent ? (
                              <Check size={10} color="var(--accent)" weight="regular" style={{ flexShrink: 0 }} aria-hidden="true" />
                            ) : (
                              <span style={{ width: 10, flexShrink: 0 }} />
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
                                width: 34, height: 28, padding: 0, marginRight: 4,
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
                        gap: 7,
                        width: "100%",
                        padding: "8px 10px",
                        background: "none",
                        border: "none",
                        color: "var(--text-muted)",
                        cursor: "pointer",
                        textAlign: "left",
                        fontSize: 11,
                      }}
                    >
                      <Plus size={10} weight="regular" style={{ flexShrink: 0 }} aria-hidden="true" />
                      <span>{t("desktop.newWorktree")}</span>
                    </button>
                  ) : (
                    <div style={{ padding: "6px 8px" }}>
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
                      padding: "5px 10px 8px",
                      color: "#dc2626",
                      fontSize: 11,
                      lineHeight: 1.35,
                      overflowWrap: "anywhere",
                    }}>
                      {wtError}
                    </div>
                  )}
              </AnimatedDropdown>
            </div>
          );
        })()}
        {!workspaceControlsHost && inactiveWorktreeSelector && (
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
          {!loading && !error && filteredSessions.length === 0 && (
            <div style={{ padding: "16px 14px", color: "var(--text-muted)", fontSize: 12 }}>
              {t("desktop.noSessionsFound")}
            </div>
          )}
          {sessionTree.map((node) => (
            <SessionTreeItem
              key={node.session.id}
              node={node}
              selectedSessionId={selectedSessionId}
              runningSessionIds={runningSessionIds}
              unreadSessionIds={unreadSessionIds}
              onSelectSession={handleSelectSessionFromList}
              onRenamed={loadSessions}
              onSessionDeleted={(id) => {
                onSessionDeleted?.(id);
                loadSessions();
              }}
              depth={0}
            />
          ))}
        </div>
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
              onClick={() => setExplorerOpen((v) => !v)}
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
    </div>
    </>
  );
}

function SessionTreeItem({
  node,
  selectedSessionId,
  runningSessionIds,
  unreadSessionIds,
  onSelectSession,
  onRenamed,
  onSessionDeleted,
  depth,
}: {
  node: SessionTreeNode;
  selectedSessionId: string | null;
  runningSessionIds: Set<string>;
  unreadSessionIds: Set<string>;
  onSelectSession: (s: SessionInfo) => void;
  onRenamed?: () => void;
  onSessionDeleted?: (id: string) => void;
  depth: number;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const hasChildren = node.children.length > 0;

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
          isSelected={node.session.id === selectedSessionId}
          isRunning={runningSessionIds.has(node.session.id)}
          isUnread={unreadSessionIds.has(node.session.id)}
          onClick={() => onSelectSession(node.session)}
          onRenamed={onRenamed}
          onDeleted={(id) => onSessionDeleted?.(id)}
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
              runningSessionIds={runningSessionIds}
              unreadSessionIds={unreadSessionIds}
              onSelectSession={onSelectSession}
              onRenamed={onRenamed}
              onSessionDeleted={onSessionDeleted}
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

function SessionItem({
  session,
  isSelected,
  isRunning,
  isUnread,
  onClick,
  onRenamed,
  onDeleted,
  depth = 0,
  hasChildren = false,
  collapsed = false,
  onToggleCollapse,
}: {
  session: SessionInfo;
  isSelected: boolean;
  isRunning?: boolean;
  isUnread?: boolean;
  onClick: () => void;
  onRenamed?: () => void;
  onDeleted?: (id: string) => void;
  depth?: number;
  hasChildren?: boolean;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}) {
  const { t } = useI18n();
  const [hovered, setHovered] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [renameCaretIndex, setRenameCaretIndex] = useState(0);
  const [renameCaretLeft, setRenameCaretLeft] = useState(0);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const renameMeasureRef = useRef<HTMLSpanElement>(null);

  const title = session.name || session.firstMessage.slice(0, 50) || session.id.slice(0, 12);

  // A two-pixel overlay gives the otherwise native one-pixel input caret a
  // clearer visual weight while the title is edited in place.
  useLayoutEffect(() => {
    if (renaming) setRenameCaretLeft(renameMeasureRef.current?.getBoundingClientRect().width ?? 0);
  }, [renaming, renameValue, renameCaretIndex]);

  const startRename = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setRenameValue(title);
    setRenameCaretIndex(title.length);
    setRenaming(true);
    setTimeout(() => inputRef.current?.select(), 0);
  }, [title]);

  const commitRename = useCallback(async () => {
    const name = renameValue.trim();
    setRenaming(false);
    if (name === (session.name ?? "")) return;
    try {
      await fetch(`/api/sessions/${encodeURIComponent(session.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      onRenamed?.();
    } catch {
      // ignore
    }
  }, [renameValue, session.id, session.name, onRenamed]);

  const handleDeleteClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirmDelete(true);
  }, []);

  const handleDeleteConfirm = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirmDelete(false);
    setDeleting(true);
    try {
      await fetch(`/api/sessions/${encodeURIComponent(session.id)}`, { method: "DELETE" });
      onDeleted?.(session.id);
    } catch {
      setDeleting(false);
    }
  }, [session.id, onDeleted]);

  const handleDeleteCancel = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirmDelete(false);
  }, []);

  // Fixed-height outer wrapper — content swaps in place so the list never reflows
  const ITEM_HEIGHT = 50;

  return (
    <div
      onClick={confirmDelete || renaming ? undefined : onClick}
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
        borderLeft: confirmDelete
          ? "2px solid #ef4444"
          : isSelected ? "2px solid var(--accent)" : "2px solid transparent",
        transition: "background 0.1s",
        opacity: deleting ? 0.5 : 1,
        gap: 6,
        overflow: "hidden",
      }}
    >
      {confirmDelete ? (
        /* ── Delete confirmation: same height, two flat buttons ── */
        <>
          <div style={{ flex: 1, minWidth: 0, fontSize: 12, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {t("desktop.deleteSession", { title: `“${title.slice(0, 22)}${title.length > 22 ? "…" : ""}”` })}
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
                  <span
                    ref={renameMeasureRef}
                    aria-hidden="true"
                    style={{
                      position: "absolute",
                      visibility: "hidden",
                      whiteSpace: "pre",
                      font: "inherit",
                      lineHeight: "inherit",
                    }}
                  >
                    {renameValue.slice(0, renameCaretIndex)}
                  </span>
                  <span
                    aria-hidden="true"
                    style={{
                      position: "absolute",
                      top: 2,
                      bottom: 2,
                      left: renameCaretLeft,
                      width: 2,
                      background: "var(--accent)",
                      borderRadius: 1,
                      animation: "blink 1s step-end infinite",
                      pointerEvents: "none",
                    }}
                  />
                  <input
                  ref={inputRef}
                  value={renameValue}
                  onChange={(e) => {
                    setRenameValue(e.target.value);
                    setRenameCaretIndex(e.target.selectionStart ?? e.target.value.length);
                  }}
                  onSelect={(e) => setRenameCaretIndex(e.currentTarget.selectionEnd ?? 0)}
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
                    caretColor: "transparent",
                  }}
                  />
                </div>
              ) : (
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0, flex: 1 }}>
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
              <span title={session.modified}>{formatRelativeTime(session.modified, t)}</span>
              <span>{t("desktop.messagesCount", { count: session.messageCount })}</span>
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
