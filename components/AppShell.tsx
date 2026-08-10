"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { ArrowLeft } from "@phosphor-icons/react";
import { useRouter, useSearchParams } from "next/navigation";
import { useGlobalKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { SessionSidebar } from "./SessionSidebar";
import { ChatWindow } from "./ChatWindow";
import { FileViewer } from "./FileViewer";
import { TabBar, type Tab } from "./TabBar";
import { SettingsModal, type SettingsTab } from "./SettingsModal";
import { AppTitleBar } from "./AppTitleBar";
import { ProjectTrustDialog } from "./ProjectTrustDialog";
import { useTheme } from "@/hooks/useTheme";
import { useAudio } from "@/hooks/useAudio";
import { useI18n } from "@/hooks/useI18n";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useResizablePanel } from "@/hooks/useResizablePanel";
import {
  getDefaultRightPanelWidth,
  getRightPanelMaxWidth,
  getSidebarMaxWidth,
  RIGHT_PANEL_MAX_WIDTH,
  RIGHT_PANEL_MIN_WIDTH,
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
} from "@/lib/panel-layout";
import { copyText } from "@/lib/clipboard";
import { getFileName } from "@/lib/file-paths";
import { buildAtMentionText, buildFileAtMentionsText } from "@/lib/file-fuzzy";
import { clearDraft, getDraft } from "@/lib/draft-store";
import {
  createDraftSession,
  loadDraftSessions,
  removeDraftSession,
  renameDraftSession,
  saveDraftSessions,
  type DraftSession,
} from "@/lib/draft-sessions";
import { clearLastOpen, getLastOpen, setLastOpen, setLastWorkspace, workspaceKeyOf } from "@/lib/workspace-memory";
import { getSessionList } from "@/lib/session-list";
import { getSessionDisplayFirstMessage } from "@/lib/skill-block";
import type { SessionInfo } from "@/lib/types";
import type { ChatInputHandle } from "./ChatInput";
import type { SessionStatsInfo } from "@/lib/pi-types";
import type { ProjectTrustStatus } from "@/lib/api-types";

type SessionCopyField = "file" | "id";

export function AppShell() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isDark, toggleTheme } = useTheme();
  // Single shared audio instance: the completion sound is also played for
  // sessions that finish in the background (other workspaces, or a session
  // that is not the one open in the chat area). Sharing the instance means
  // the AudioContext unlocked by a ChatInput gesture is the same one the
  // sidebar plays through.
  const { soundEnabled, onSoundToggle, playDoneSound, unlockAudio, soundEnabledRef } = useAudio();
  const { t } = useI18n();
  const isMobile = useIsMobile();
  const [selectedSession, setSelectedSession] = useState<SessionInfo | null>(null);
  // When user clicks +, we only store the cwd — no fake session id
  const [newSessionCwd, setNewSessionCwd] = useState<string | null>(null);
  // Unsent "draft" sessions shown in the sidebar list (pure client-side, pi
  // knows nothing about them until the first message is sent).
  const [draftSessions, setDraftSessions] = useState<DraftSession[]>(() => loadDraftSessions());
  // The draft currently open in the composer (its id doubles as the ChatInput
  // draft key so typed text is keyed to the draft).
  const [activeDraftId, setActiveDraftId] = useState<string | null>(null);
  const activeDraftIdRef = useRef<string | null>(null);
  useEffect(() => { activeDraftIdRef.current = activeDraftId; }, [activeDraftId]);
  useEffect(() => { saveDraftSessions(draftSessions); }, [draftSessions]);

  // An empty new session is not a meaningful draft. Drop drafts that never
  // received any typed content on startup (they only clutter the list).
  useEffect(() => {
    setDraftSessions((prev) => {
      const meaningful = prev.filter((d) => getDraft(d.id) !== null);
      return meaningful.length === prev.length ? prev : meaningful;
    });
  }, []);

  // Drop the currently open draft when it never got any content (typed text
  // or attached images). Used when leaving a draft for another session.
  const cleanupEmptyActiveDraft = useCallback(() => {
    const id = activeDraftIdRef.current;
    if (!id) return;
    if (getDraft(id)) return; // has content — keep it
    setDraftSessions((prev) => removeDraftSession(prev, id));
    clearDraft(id);
  }, []);
  const [refreshKey, setRefreshKey] = useState(0);
  const [sessionKey, setSessionKey] = useState(0);
  // ── Startup splash (readiness signal) ──────────────────────────────────
  // The CSS-only body::before Pi logo stays visible until the whole startup
  // chain is ready: session list loaded + workspace auto-selected, and the
  // restored session's content rendered (or no session content to wait for).
  // Only then do we add html.pi-booted to fade it out, so the user sees a
  // fully prepared page. (The ready state lives here; the visual layer is
  // pure CSS in globals.css — there is no React overlay to unmount.)
  const [sessionsLoaded, setSessionsLoaded] = useState(false);
  const [contentReady, setContentReady] = useState<boolean | null>(null);
  const handleSessionsLoaded = useCallback(() => setSessionsLoaded(true), []);
  const waitForContent = useCallback(() => setContentReady(false), []);
  const contentDone = useCallback(() => setContentReady(true), []);
  const handleContentReady = useCallback(() => setContentReady(true), []);
  useEffect(() => {
    if (sessionsLoaded && contentReady === true) {
      // Keep the CSS splash visible for at least ~800ms total even when the
      // startup chain resolves quickly, so the user actually perceives the
      // logo, then fade it out via html.pi-booted.
      const t = setTimeout(() => document.documentElement.classList.add("pi-booted"), 800);
      return () => clearTimeout(t);
    }
  }, [sessionsLoaded, contentReady]);
  const [explorerRefreshKey, setExplorerRefreshKey] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("models");
  const [modelsRefreshKey, setModelsRefreshKey] = useState(0);
  const [projectTrust, setProjectTrust] = useState<ProjectTrustStatus | null>(null);
  const [projectTrustDialogOpen, setProjectTrustDialogOpen] = useState(false);
  const [projectTrustBusy, setProjectTrustBusy] = useState(false);
  const [projectTrustError, setProjectTrustError] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileSidebarReady, setMobileSidebarReady] = useState(false);
  // On mobile the sidebar is an overlay drawer; hide it by default so the chat
  // is visible on load. Runs once the breakpoint resolves after hydration.
  useEffect(() => {
    if (isMobile) setSidebarOpen(false);
  }, [isMobile]);
  useEffect(() => {
    setMobileSidebarReady(true);
  }, []);
  const chatInputRef = useRef<ChatInputHandle | null>(null);
  const topBarRef = useRef<HTMLDivElement>(null);
  const [titleWorkspaceControlsHost, setTitleWorkspaceControlsHost] = useState<HTMLDivElement | null>(null);
  const [welcomeWorkspaceControlsHost, setWelcomeWorkspaceControlsHost] = useState<HTMLDivElement | null>(null);

  const [systemPrompt, setSystemPrompt] = useState<string | null>(null);

  const handleSystemPromptChange = useCallback((prompt: string | null) => {
    setSystemPrompt(prompt);
  }, []);

  // Session stats (tokens + cost) — populated by ChatWindow, displayed in top bar
  const [sessionStats, setSessionStats] = useState<SessionStatsInfo | null>(null);
  const handleSessionStatsChange = useCallback((stats: SessionStatsInfo | null) => {
    setSessionStats(stats);
  }, []);
  const [copiedSessionField, setCopiedSessionField] = useState<SessionCopyField | null>(null);
  const sessionCopyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleCopySessionField = useCallback((field: SessionCopyField, value: string) => {
    void copyText(value).then(() => {
      if (sessionCopyTimerRef.current) clearTimeout(sessionCopyTimerRef.current);
      setCopiedSessionField(field);
      sessionCopyTimerRef.current = setTimeout(() => setCopiedSessionField(null), 1400);
    });
  }, []);

  useEffect(() => {
    return () => {
      if (sessionCopyTimerRef.current) clearTimeout(sessionCopyTimerRef.current);
    };
  }, []);

  // Context usage — populated by ChatWindow, displayed in top bar
  const [contextUsage, setContextUsage] = useState<{ percent: number | null; contextWindow: number; tokens: number | null } | null>(null);
  const handleContextUsageChange = useCallback((usage: { percent: number | null; contextWindow: number; tokens: number | null } | null) => {
    setContextUsage(usage);
  }, []);

  // Single active panel — only one dropdown open at a time
  const [activeTopPanel, setActiveTopPanel] = useState<"system" | "session" | null>(null);
  const [topPanelPos, setTopPanelPos] = useState<{ top: number; left: number; width: number } | null>(null);


  const openSessionStatsPanel = useCallback(() => {
    if (isMobile) setSidebarOpen(false);
    setActiveTopPanel("session");
  }, [isMobile]);

  const handleSidebarToggle = useCallback(() => {
    if (isMobile) setActiveTopPanel(null);
    setSidebarOpen((open) => !open);
  }, [isMobile]);

  useEffect(() => {
    if (!activeTopPanel || !topBarRef.current) return;
    const update = () => {
      const rect = topBarRef.current!.getBoundingClientRect();
      setTopPanelPos({ top: rect.bottom, left: rect.left, width: rect.width });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(topBarRef.current);
    return () => ro.disconnect();
  }, [activeTopPanel]);

  // Right panel — file tabs only
  const [fileTabs, setFileTabs] = useState<Tab[]>([]);
  const [activeFileTabId, setActiveFileTabId] = useState<string | null>(null);
  const [rightPanelOpen, setRightPanelOpen] = useState(false);
  const sidebarWidthRef = useRef(SIDEBAR_DEFAULT_WIDTH);
  const rightPanelWidthRef = useRef(getDefaultRightPanelWidth(1366));
  const getResponsiveRightPanelWidth = useCallback(
    () => typeof window === "undefined" ? getDefaultRightPanelWidth(1366) : getDefaultRightPanelWidth(window.innerWidth),
    [],
  );
  const getResponsiveSidebarMaxWidth = useCallback(
    () => typeof window === "undefined" ? SIDEBAR_MAX_WIDTH : getSidebarMaxWidth({
      viewportWidth: window.innerWidth,
      rightPanelOpen,
      rightPanelWidth: rightPanelWidthRef.current,
    }),
    [rightPanelOpen],
  );
  const getResponsiveRightPanelMaxWidth = useCallback(
    () => typeof window === "undefined" ? RIGHT_PANEL_MAX_WIDTH : getRightPanelMaxWidth({
      viewportWidth: window.innerWidth,
      sidebarOpen,
      sidebarWidth: sidebarWidthRef.current,
    }),
    [sidebarOpen],
  );
  const sidebarPanel = useResizablePanel({
    ariaLabel: t("desktop.resizeSidebar"),
    cssVariable: "--sidebar-width",
    defaultWidth: SIDEBAR_DEFAULT_WIDTH,
    getMaxWidth: getResponsiveSidebarMaxWidth,
    growthDirection: "right",
    maxWidth: SIDEBAR_MAX_WIDTH,
    minWidth: SIDEBAR_MIN_WIDTH,
    storageKey: "pi-sidebar-width",
    widthRef: sidebarWidthRef,
  });
  const rightPanel = useResizablePanel({
    ariaLabel: t("desktop.resizeFilePanel"),
    cssVariable: "--right-panel-width",
    defaultWidth: getDefaultRightPanelWidth(1366),
    getDefaultWidth: getResponsiveRightPanelWidth,
    getMaxWidth: getResponsiveRightPanelMaxWidth,
    growthDirection: "left",
    maxWidth: RIGHT_PANEL_MAX_WIDTH,
    minWidth: RIGHT_PANEL_MIN_WIDTH,
    storageKey: "pi-right-panel-width",
    widthRef: rightPanelWidthRef,
  });
  const reclampSidebarWidth = sidebarPanel.reclampWidth;
  const reclampRightPanelWidth = rightPanel.reclampWidth;
  useEffect(() => {
    if (!rightPanelOpen) return;
    reclampSidebarWidth();
    reclampRightPanelWidth();
  }, [reclampRightPanelWidth, reclampSidebarWidth, rightPanelOpen]);

  // Same @mention format as the chat input's @ autocomplete, so the agent's
  // read tool resolves it the same way (it strips the @ prefix).
  const handleAtMention = useCallback((relativePath: string, isDir: boolean) => {
    chatInputRef.current?.insertText(buildAtMentionText(relativePath, isDir));
  }, []);

  const handleAtMentions = useCallback((relativePaths: string[]) => {
    const mentions = buildFileAtMentionsText(relativePaths);
    if (mentions) chatInputRef.current?.insertText(mentions);
  }, []);

  const [initialSessionId] = useState<string | null>(() => searchParams.get("session"));
  const [activeCwd, setActiveCwd] = useState<string | null>(null);
  // True once the initial ?session= URL param has been resolved (or confirmed absent)
  const [initialSessionRestored, setInitialSessionRestored] = useState<boolean>(() => !searchParams.get("session"));
  // Suppresses sessionKey bump in handleCwdChange during the initial URL restore
  const suppressCwdBumpRef = useRef(false);
  // Guards the async session restore: a lookup started by an earlier workspace
  // switch must not land after the user already switched somewhere else.
  const workspaceRestoreTokenRef = useRef(0);

  // Open the new-session composer backed by a real draft row, matching the
  // "+" flow. Used when switching to a workspace with no remembered context.
  const openWelcomeDraft = useCallback((cwd: string, projectKey: string) => {
    const draft = createDraftSession(cwd);
    setDraftSessions((prev) => [draft, ...prev]);
    setActiveDraftId(draft.id);
    setNewSessionCwd(cwd);
    setLastOpen(projectKey, { kind: "draft", id: draft.id });
    // A welcome draft has no session content to wait for — mark readiness.
    contentDone();
    // A draft is not URL-representable — drop a stale ?session= so a refresh
    // does not yank back to the previous workspace's session.
    if (new URLSearchParams(window.location.search).has("session")) {
      router.replace("/", { scroll: false });
    }
  }, [router, contentDone]);

  // Restore the workspace's last open context after switching to it. Called
  // from handleCwdChange once the outgoing context has been reset. A draft
  // reopens synchronously; a session is looked up against the live list so a
  // deleted session falls back to a fresh welcome draft.
  const restoreWorkspaceContext = useCallback((cwd: string, projectKey: string) => {
    const token = ++workspaceRestoreTokenRef.current;
    const lastOpen = getLastOpen(projectKey);
    if (lastOpen?.kind === "draft") {
      const draft = draftSessions.find((d) => d.id === lastOpen.id);
      if (draft) {
        setActiveDraftId(draft.id);
        setNewSessionCwd(draft.cwd);
        setLastOpen(projectKey, { kind: "draft", id: draft.id });
        // A draft reopens with an empty composer — no session content to wait for.
        contentDone();
        if (new URLSearchParams(window.location.search).has("session")) {
          router.replace("/", { scroll: false });
        }
      } else {
        clearLastOpen(projectKey);
        openWelcomeDraft(cwd, projectKey);
      }
      return;
    }
    if (lastOpen?.kind === "session") {
      // Shared cache: SessionSidebar already fetches the same list at startup,
      // so this does not add a second /api/sessions round-trip.
      getSessionList()
        .then((d) => {
          if (token !== workspaceRestoreTokenRef.current) return; // stale switch
          const s = d.sessions.find((x) => x.id === lastOpen.id);
          if (!s) {
            // The list loaded but the remembered session is gone — forget it.
            // When the list itself failed keep the memory so a later switch
            // retries the restore.
            clearLastOpen(projectKey);
            openWelcomeDraft(cwd, projectKey);
            return;
          }
          if ((s.projectRoot ?? s.cwd) !== projectKey) {
            // Defensive: the remembered session drifted out of this workspace.
            clearLastOpen(projectKey);
            openWelcomeDraft(cwd, projectKey);
            return;
          }
          // Selecting the session must remount the chat with the session
          // present: useAgentSession loads content in a mount-only effect, so
          // the null-session welcome mount from the switch would never load
          // the restored session's messages.
          waitForContent();
          setSelectedSession(s);
          setSessionKey((k) => k + 1);
          if (new URLSearchParams(window.location.search).get("session") !== s.id) {
            router.replace(`?session=${encodeURIComponent(s.id)}`, { scroll: false });
          }
        })
        .catch(() => {
          // Network hiccup: keep the remembered session for a later retry.
          if (token === workspaceRestoreTokenRef.current) {
            openWelcomeDraft(cwd, projectKey);
            setLastOpen(projectKey, { kind: "session", id: lastOpen.id });
          }
        });
      return;
    }
    openWelcomeDraft(cwd, projectKey);
  }, [draftSessions, router, openWelcomeDraft, waitForContent, contentDone]);

  const handleCwdChange = useCallback((cwd: string | null, projectRoot?: string | null, isAutoSelect = false) => {
    setActiveCwd(cwd);
    // Skip if cwd is null (initial mount) or during the initial URL restore.
    if (!cwd) return;
    if (suppressCwdBumpRef.current) {
      suppressCwdBumpRef.current = false;
      return;
    }
    // Worktrees of one repo share a project root. Moving the effective cwd
    // within the same project (e.g. switching worktree, or clicking a session
    // that lives in another worktree) must not close the open session.
    const newProject = projectRoot ?? cwd;
    // Only user-driven workspace switches record the last-active workspace.
    // Startup auto-selection (isAutoSelect) — and the URL-restore path above
    // (suppress) — must not reinforce a stale/incorrect memory: otherwise a
    // bad pick (e.g. a quick-workspace draft outranking the real projects)
    // writes itself back and every restart repeats the same wrong workspace.
    if (!isAutoSelect) setLastWorkspace(newProject);
    if (selectedSession && (selectedSession.projectRoot ?? selectedSession.cwd) === newProject) {
      return;
    }
    // Leaving the draft for another project: an empty draft is meaningless.
    cleanupEmptyActiveDraft();
    // A cross-project switch must not keep the outgoing draft key bound to the
    // composer — it would silently write the new workspace's typing into the
    // old project's draft (and drop that draft on send).
    setActiveDraftId(null);
    // Close any session that belongs to a different project — it no longer
    // matches the selected project directory.
    setSelectedSession(null);
    setNewSessionCwd((prev) => {
      if (prev && prev !== cwd) return null;
      return prev;
    });
    setSessionKey((k) => k + 1);
    setSystemPrompt(null);
    setActiveTopPanel(null);
    // Restore the workspace we switched to: its last session or draft, or a
    // fresh welcome draft so the composer matches the "+" flow.
    restoreWorkspaceContext(cwd, newProject);
  }, [selectedSession, cleanupEmptyActiveDraft, restoreWorkspaceContext]);

  // Update browser tab title when workspace changes
  useEffect(() => {
    const name = activeCwd ? getFileName(activeCwd) || activeCwd : null;
    document.title = name ? `${name} — Pi Agent Web` : "Pi Agent Web";
  }, [activeCwd]);

  const handleSelectSession = useCallback((session: SessionInfo, isRestore = false) => {
    // Re-clicking the already-open session must not remount the chat and
    // re-run the full load/positioning cycle. Only skip when the effective
    // cwd context already matches — otherwise the pending cwd move needs
    // the full re-select flow.
    if (!isRestore && selectedSession) {
      const sameProject = (selectedSession.projectRoot ?? selectedSession.cwd) === (session.projectRoot ?? session.cwd);
      if (selectedSession.id === session.id && sameProject) {
        if (isMobile) setSidebarOpen(false);
        return;
      }
    }
    // Leaving a draft for a real session — drop it if it never got content.
    cleanupEmptyActiveDraft();
    setActiveDraftId(null);
    setNewSessionCwd(null);
    // Wait for the session content before hiding the startup splash (only
    // matters while the splash is still up; afterwards it is a no-op).
    waitForContent();
    setSelectedSession(session);
    // Remember this session as the workspace's last open context so switching
    // back to the workspace restores it.
    setLastOpen(workspaceKeyOf(session), { kind: "session", id: session.id });
    setSessionKey((k) => k + 1);
    setSystemPrompt(null);
    setInitialSessionRestored(true);
    // On mobile, collapse the overlay drawer so the chat is revealed after pick.
    if (isMobile && !isRestore) setSidebarOpen(false);
    if (isRestore) {
      // Suppress the redundant sessionKey bump that would come from the
      // onCwdChange effect firing after setSelectedCwd in the sidebar
      suppressCwdBumpRef.current = true;
    }
    // Skip router.replace when restoring from URL — the param is already correct
    // and calling replace in production Next.js triggers a Suspense remount loop
    if (!isRestore) {
      router.replace(`?session=${encodeURIComponent(session.id)}`, { scroll: false });
    }
  }, [router, isMobile, cleanupEmptyActiveDraft, selectedSession, waitForContent]);

  const handleNewSession = useCallback((_sessionId: string, cwd: string, projectRoot?: string | null) => {
    // An empty draft is meaningless: drop the current one (if it never got
    // content) before starting a new session.
    cleanupEmptyActiveDraft();
    // Register a client-side draft so the session shows up in the sidebar
    // list right away — pi has not created anything yet.
    const draft = createDraftSession(cwd);
    setDraftSessions((prev) => [draft, ...prev]);
    setActiveDraftId(draft.id);
    setSelectedSession(null);
    setNewSessionCwd(cwd);
    setLastOpen(projectRoot ?? cwd, { kind: "draft", id: draft.id });
    setSessionKey((k) => k + 1);
    setSystemPrompt(null);
    setActiveTopPanel(null);
    if (isMobile) setSidebarOpen(false);
    router.replace("/", { scroll: false });
  }, [router, isMobile, cleanupEmptyActiveDraft]);

  // Global keyboard shortcuts (handles Esc, Ctrl+Alt+N etc.)
  useGlobalKeyboardShortcuts({
    onNewSession: (cwd: string) => handleNewSession(`kb-${Date.now()}`, cwd),
    activeCwd,
  });

  // Client-built transient SessionInfo (new session / fork) lacks the
  // server-computed projectRoot, which the same-project check in
  // handleCwdChange relies on. Hydrate it from the session list so switching
  // worktrees right after creating a session doesn't close the chat.
  const hydrateSelectedSession = useCallback((sessionId: string) => {
    // Shared cache (see restoreWorkspaceContext) — no second /api/sessions trip.
    getSessionList()
      .then((d) => {
        const full = d.sessions.find((s) => s.id === sessionId);
        if (!full) return;
        setSelectedSession((prev) => (prev && prev.id === sessionId && !prev.projectRoot ? full : prev));
        // The server-resolved projectRoot may differ from the transient key the
        // memory was first written under — re-key it so worktree sessions are
        // found when their workspace is reopened.
        setLastOpen(workspaceKeyOf(full), { kind: "session", id: full.id });
      })
      .catch(() => {});
  }, []);

  // Called by ChatWindow when a new session gets its real id from pi
  const handleSessionCreated = useCallback((session: SessionInfo) => {
    setNewSessionCwd(null);
    // The new session now has real content (the first prompt already went out)
    // — mark readiness in case the splash is still up.
    contentDone();
    setSelectedSession(session);
    setLastOpen(workspaceKeyOf(session), { kind: "session", id: session.id });
    setRefreshKey((k) => k + 1);
    // The draft has been promoted to a real session: drop the draft record.
    // The server already persisted the session file on the prompt command, so
    // the next list refresh shows the real row.
    const draftId = activeDraftIdRef.current;
    if (draftId) {
      setDraftSessions((prev) => removeDraftSession(prev, draftId));
      clearDraft(draftId);
    }
    setActiveDraftId(null);
    hydrateSelectedSession(session.id);
    router.replace(`?session=${encodeURIComponent(session.id)}`, { scroll: false });
  }, [router, hydrateSelectedSession, contentDone]);

  const handleAgentEnd = useCallback(() => {
    setRefreshKey((k) => k + 1);
    setExplorerRefreshKey((k) => k + 1);
  }, []);

  // A session that finished while not open in the chat area (other workspace,
  // or a second session of the current workspace) — play the completion sound
  // when enabled, like the open session's own end tone.
  const handleBackgroundTaskDone = useCallback(() => {
    if (soundEnabledRef.current) playDoneSound();
  }, [playDoneSound, soundEnabledRef]);

  const handleSessionForked = useCallback((newSessionId: string) => {
    setRefreshKey((k) => k + 1);
    setSessionKey((k) => k + 1);
    setNewSessionCwd(null);
    // A fork already carries the parent's content — mark readiness.
    contentDone();
    const forkKey = selectedSession ? workspaceKeyOf(selectedSession) : null;
    setSelectedSession((prev) => ({
      ...(prev ?? { path: "", cwd: "", created: "", modified: "", messageCount: 0, firstMessage: "" }),
      id: newSessionId,
    }));
    if (forkKey) setLastOpen(forkKey, { kind: "session", id: newSessionId });
    hydrateSelectedSession(newSessionId);
    router.replace(`?session=${encodeURIComponent(newSessionId)}`, { scroll: false });
  }, [router, hydrateSelectedSession, selectedSession, contentDone]);

  const handleInitialRestoreDone = useCallback(() => {
    setInitialSessionRestored(true);
  }, []);

  // Reopen a draft in the composer (from a sidebar click).
  const handleSelectDraft = useCallback((draft: DraftSession, projectRoot?: string | null) => {
    const wasActive = activeDraftIdRef.current === draft.id;
    // Clicking the already-open draft only refocuses it — never treat that as
    // "leaving" (an empty draft is dropped only when switching to another
    // session). When switching to a different draft, first drop the previous
    // one if it never got any content.
    if (!wasActive) {
      cleanupEmptyActiveDraft();
    }
    setActiveDraftId(draft.id);
    setSelectedSession(null);
    setNewSessionCwd(draft.cwd);
    setLastOpen(projectRoot ?? draft.cwd, { kind: "draft", id: draft.id });
    setSessionKey((k) => k + 1);
    setSystemPrompt(null);
    setActiveTopPanel(null);
    if (isMobile) setSidebarOpen(false);
    router.replace("/", { scroll: false });
  }, [router, isMobile, cleanupEmptyActiveDraft]);

  const handleDeleteDraft = useCallback((draftId: string) => {
    setDraftSessions((prev) => removeDraftSession(prev, draftId));
    clearDraft(draftId);
    // If the deleted draft was the open composer, close the chat area.
    if (activeDraftIdRef.current === draftId) {
      setActiveDraftId(null);
      setNewSessionCwd(null);
      setSessionKey((k) => k + 1);
      setSystemPrompt(null);
      setActiveTopPanel(null);
      router.replace("/", { scroll: false });
    }
  }, [router]);

  const handleRenameDraft = useCallback((draftId: string, name: string) => {
    setDraftSessions((prev) => renameDraftSession(prev, draftId, name));
  }, []);

  const handleSessionRenamed = useCallback((id: string, name: string) => {
    setSelectedSession((prev) => (prev && prev.id === id ? { ...prev, name } : prev));
  }, []);

  const handleSessionDeleted = useCallback((sessionId: string) => {
    setRefreshKey((k) => k + 1);
    if (selectedSession?.id === sessionId) {
      const session = selectedSession;
      setActiveDraftId(null);
      setSelectedSession(null);
      setSessionKey((k) => k + 1);
      setSystemPrompt(null);
      setActiveTopPanel(null);
      // Back to a fresh composer backed by a draft row, consistent with the
      // "+" flow, instead of a bare welcome page with no listed session.
      openWelcomeDraft(session.cwd, workspaceKeyOf(session));
    }
  }, [selectedSession, openWelcomeDraft]);

  const handleOpenFile = useCallback((filePath: string, fileName: string, sourceOrOptions?: string | null | { initialDisplayMode?: "diff" }, options?: { initialDisplayMode?: "diff" }) => {
    const sourceSessionId = typeof sourceOrOptions === "string" || sourceOrOptions === null ? sourceOrOptions : undefined;
    const openOptions = typeof sourceOrOptions === "object" && sourceOrOptions !== null ? sourceOrOptions : options;
    const tabId = `file:${filePath}`;
    setFileTabs((prev) => {
      const existing = prev.find((t) => t.id === tabId);
      if (!existing) return [...prev, { id: tabId, label: fileName, filePath, sourceSessionId, initialDisplayMode: openOptions?.initialDisplayMode }];
      if ((!sourceSessionId || existing.sourceSessionId === sourceSessionId) && (!openOptions?.initialDisplayMode || existing.initialDisplayMode === openOptions.initialDisplayMode)) return prev;
      return prev.map((t) => t.id === tabId ? { ...t, sourceSessionId: sourceSessionId ?? t.sourceSessionId, initialDisplayMode: openOptions?.initialDisplayMode ?? t.initialDisplayMode } : t);
    });
    setActiveFileTabId(tabId);
    setRightPanelOpen(true);
    // On mobile the file panel is full-screen; close the drawer so it shows.
    if (isMobile) setSidebarOpen(false);
  }, [isMobile]);

  const handleOpenLinkedFile = useCallback((filePath: string, options?: { initialDisplayMode?: "diff" }) => {
    handleOpenFile(filePath, getFileName(filePath), selectedSession?.id ?? null, options);
  }, [handleOpenFile, selectedSession?.id]);

  const handleCloseFileTab = useCallback((tabId: string) => {
    setFileTabs((prev) => {
      const next = prev.filter((t) => t.id !== tabId);
      if (next.length === 0) setRightPanelOpen(false);
      return next;
    });
    setActiveFileTabId((cur) => {
      if (cur !== tabId) return cur;
      const remaining = fileTabs.filter((t) => t.id !== tabId);
      return remaining.length > 0 ? remaining[remaining.length - 1].id : null;
    });
  }, [fileTabs]);

  const sessionTitle = selectedSession
    ? selectedSession.name || getSessionDisplayFirstMessage(selectedSession.firstMessage).slice(0, 50) || selectedSession.id.slice(0, 12)
    : null;

  const handleViewFullHistory = useCallback(() => {
    if (!selectedSession) return;
    window.open(
      `/api/sessions/${encodeURIComponent(selectedSession.id)}/export?inline=1`,
      "_blank",
      "noopener,noreferrer",
    );
  }, [selectedSession]);

  // Show chat area if a session is selected, or if we have a cwd to start a new session in
  const effectiveNewSessionCwd = newSessionCwd ?? (selectedSession === null && activeCwd ? activeCwd : null);
  const showChat = selectedSession !== null || effectiveNewSessionCwd !== null;
  const projectTrustCwd = selectedSession?.cwd ?? effectiveNewSessionCwd;
  // While restoring initial session from URL, don't show the placeholder
  const showPlaceholder = initialSessionRestored && !showChat;

  useEffect(() => {
    setProjectTrust(null);
    setProjectTrustDialogOpen(false);
    setProjectTrustError(null);
    if (!projectTrustCwd) return;

    const controller = new AbortController();
    fetch(`/api/project-trust?cwd=${encodeURIComponent(projectTrustCwd)}`, { signal: controller.signal })
      .then(async (response) => {
        const data = await response.json() as ProjectTrustStatus & { error?: string };
        if (!response.ok || data.error) throw new Error(data.error ?? `HTTP ${response.status}`);
        setProjectTrust(data);
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        console.error("Failed to load project trust:", error);
      });
    return () => controller.abort();
  }, [projectTrustCwd]);

  const handleTrustProject = useCallback(async () => {
    if (!projectTrustCwd || projectTrustBusy) return;
    setProjectTrustBusy(true);
    setProjectTrustError(null);
    try {
      const response = await fetch("/api/project-trust", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd: projectTrustCwd }),
      });
      const data = await response.json() as ProjectTrustStatus & { error?: string };
      if (!response.ok || data.error) throw new Error(data.error ?? `HTTP ${response.status}`);
      setProjectTrust(data);
      setProjectTrustDialogOpen(false);
      setModelsRefreshKey((key) => key + 1);
      setSessionKey((key) => key + 1);
    } catch (error) {
      setProjectTrustError(error instanceof Error ? error.message : String(error));
    } finally {
      setProjectTrustBusy(false);
    }
  }, [projectTrustBusy, projectTrustCwd]);

  const activeFileTab = fileTabs.find((t) => t.id === activeFileTabId) ?? null;
  const settingsCwd = activeCwd ?? selectedSession?.cwd ?? newSessionCwd;
  const openSettings = useCallback((tab: SettingsTab) => {
    setSettingsTab(tab);
    setSettingsOpen(true);
  }, []);

  const sidebarContent = (
    <>
      <SessionSidebar
        selectedSessionId={selectedSession?.id ?? null}
        selectedDraftId={activeDraftId}
        onSelectSession={handleSelectSession}
        onNewSession={handleNewSession}
        draftSessions={draftSessions}
        onSelectDraft={handleSelectDraft}
        onDeleteDraft={handleDeleteDraft}
        onRenameDraft={handleRenameDraft}
        initialSessionId={initialSessionId}
        onInitialRestoreDone={handleInitialRestoreDone}
        onSessionsLoaded={handleSessionsLoaded}
        // A brand-new user has no sessions to restore and no workspace to
        // auto-select — the splash has nothing to wait for, so the sidebar
        // signals readiness directly and the first-run welcome screen shows.
        onNoContentToWaitFor={contentDone}
        refreshKey={refreshKey}
        onSessionDeleted={handleSessionDeleted}
        onSessionRenamed={handleSessionRenamed}
        selectedCwd={selectedSession?.cwd ?? newSessionCwd ?? null}
        onCwdChange={handleCwdChange}
        onOpenFile={handleOpenFile}
        explorerRefreshKey={explorerRefreshKey}
        onAtMention={handleAtMention}
        onAtMentions={handleAtMentions}
        workspaceControlsHosts={{
          title: titleWorkspaceControlsHost,
          welcome: welcomeWorkspaceControlsHost,
        }}
        // The title-bar workspace selector must be reachable on the first-run
        // welcome screen too (a brand-new user has no sessions/cwd yet), so it
        // is shown whenever a project is active OR the welcome placeholder is
        // on screen. The welcome-page variant still only renders once a chat
        // session mounts (which requires a cwd).
        showWorkspaceControls={Boolean(activeCwd ?? selectedSession?.cwd ?? newSessionCwd) || showPlaceholder}
        onBackgroundTaskDone={handleBackgroundTaskDone}
      />

    </>
  );

  return (
    <>
    <style>{`
      @media (max-width: 640px) {
        .sidebar-overlay-backdrop.sidebar-mobile-pending {
          opacity: 0 !important;
          pointer-events: none !important;
        }
        .sidebar-container.sidebar-mobile-pending.sidebar-open {
          transform: translateX(-100%);
          box-shadow: none;
        }
      }
    `}</style>
    <div style={{ display: "flex", flexDirection: "column", height: "calc(100dvh / var(--app-ui-scale, 1))", overflow: "hidden", background: "var(--bg)" }}>
      <AppTitleBar
        topBarRef={topBarRef}
        sidebarOpen={sidebarOpen}
        onSidebarToggle={handleSidebarToggle}
        isDark={isDark}
        toggleTheme={toggleTheme}
        isMobile={isMobile}
        showChat={showChat}
        systemPrompt={systemPrompt}
        activeTopPanel={activeTopPanel}
        topPanelPos={topPanelPos}
        sessionStats={sessionStats}
        contextUsage={contextUsage}
        copiedSessionField={copiedSessionField}
        onCopySessionField={handleCopySessionField}
        rightPanelOpen={rightPanelOpen}
        onToggleFilePanel={() => setRightPanelOpen((v) => !v)}
        onOpenSettings={() => openSettings("models")}
        sessionTitle={sessionTitle}
        onWorkspaceControlsHostChange={setTitleWorkspaceControlsHost}
      />
      {showChat && projectTrust?.requiresTrust && !projectTrust.trusted && (
        <button
          type="button"
          onClick={() => {
            setProjectTrustError(null);
            setProjectTrustDialogOpen(true);
          }}
          title={t("desktop.projectResourcesRestricted")}
          aria-label={t("desktop.projectResourcesRestricted")}
          style={{
            position: "fixed",
            top: isMobile ? 48 : 48,
            right: isMobile ? 12 : 20,
            zIndex: 700,
            display: "inline-flex",
            alignItems: "center",
            gap: 7,
            padding: "8px 11px",
            border: "1px solid color-mix(in srgb, var(--accent-orange) 52%, var(--border))",
            borderRadius: 7,
            background: "color-mix(in srgb, var(--accent-orange) 11%, var(--bg-panel))",
            color: "var(--accent-orange)",
            boxShadow: "0 8px 24px rgba(0, 0, 0, 0.16)",
            cursor: "pointer",
            fontSize: 12,
            fontWeight: 600,
          }}
        >
          <span aria-hidden="true">⚠</span>
          {t("desktop.trustProject")}
        </button>
      )}
      <div
        style={{
          "--right-panel-width": `${rightPanel.width}px`,
          flex: 1,
          display: "flex",
          overflow: "hidden",
          minWidth: 0,
          position: "relative",
        } as React.CSSProperties}
      >
      {/* Mobile overlay backdrop */}
      <div
        className={`sidebar-overlay-backdrop${mobileSidebarReady ? "" : " sidebar-mobile-pending"}`}
        onClick={() => setSidebarOpen(false)}
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 199,
          background: "rgba(0,0,0,0.4)",
          opacity: sidebarOpen ? 1 : 0,
          pointerEvents: sidebarOpen ? "auto" : "none",
          transition: "opacity 0.25s ease",
        }}
      />

      {/* Left sidebar */}
      <div
        ref={sidebarPanel.panelRef}
        className={`sidebar-container${sidebarOpen ? " sidebar-open" : " sidebar-closed"}${mobileSidebarReady ? "" : " sidebar-mobile-pending"}${sidebarPanel.isResizing ? " panel-is-resizing" : ""}`}
        style={{
          "--sidebar-width": `${sidebarPanel.width}px`,
          background: "var(--bg-panel)",
          borderRight: "1px solid var(--border)",
          display: "flex",
          flexDirection: "column",
          flexShrink: 0,
          zIndex: 200,
        } as React.CSSProperties}
      >
        {sidebarContent}
      </div>
      {sidebarOpen && (
        <div
          {...sidebarPanel.separatorProps}
          className="workspace-panel-splitter sidebar-panel-splitter"
        />
      )}

      {/* Center: chat */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minWidth: 0 }}>
        {/* Chat content */}
        <div style={{ flex: 1, overflow: "hidden", position: "relative" }}>
          {showChat ? (
            <ChatWindow
              key={sessionKey}
              session={selectedSession}
              newSessionCwd={effectiveNewSessionCwd}
              newSessionDraftId={activeDraftId}
              onAgentEnd={handleAgentEnd}
              onSessionCreated={handleSessionCreated}
              onSessionForked={handleSessionForked}
              modelsRefreshKey={modelsRefreshKey}
              chatInputRef={chatInputRef}
              onSystemPromptChange={handleSystemPromptChange}
              onSessionStatsChange={handleSessionStatsChange}
              onSessionStatsPanelOpen={openSessionStatsPanel}
              onContextUsageChange={handleContextUsageChange}
              onContentReady={handleContentReady}
              onOpenFile={handleOpenLinkedFile}
              onWorkspaceControlsHostChange={setWelcomeWorkspaceControlsHost}
              onViewFullHistory={handleViewFullHistory}
              systemPrompt={systemPrompt}
              soundEnabled={soundEnabled}
              onSoundToggle={onSoundToggle}
              playDoneSound={playDoneSound}
              unlockAudio={unlockAudio}
            />
          ) : showPlaceholder ? (
            activeCwd ? (
              <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)", fontSize: 15 }}>
                {t("desktop.selectSessionFromSidebar")}
              </div>
            ) : (
              <div style={{ position: "absolute", top: 12, left: 12, display: "flex", alignItems: "flex-start", gap: 8, userSelect: "none", pointerEvents: "none" }}>
                <ArrowLeft size={44} color="var(--accent)" aria-hidden="true" style={{ opacity: 0.7, flexShrink: 0 }} />
                <div>
                  <div style={{ fontSize: 18, fontWeight: 600, color: "var(--text)", marginBottom: 8 }}>{t("desktop.getStarted")}</div>
                  <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.8 }}>
                    <span style={{ color: "var(--text-dim)", marginRight: 6 }}>1.</span>{t("desktop.selectProjectDirectory")}<br />
                    <span style={{ color: "var(--text-dim)", marginRight: 6 }}>2.</span>{t("desktop.addModelsFromBottom")}
                  </div>
                </div>
              </div>
            )
          ) : null}
        </div>
      </div>

      {/* Right panel: file viewer — always mounted, width animated via CSS */}
      {rightPanelOpen && (
        <div
          {...rightPanel.separatorProps}
          className="workspace-panel-splitter right-panel-splitter"
        />
      )}
      <div
        ref={rightPanel.panelRef}
        className={`right-panel-container${rightPanelOpen ? " right-panel-open" : " right-panel-closed"}${rightPanel.isResizing ? " panel-is-resizing" : ""}`}
        style={{
          display: "flex",
          flexDirection: "column",
          borderLeft: "1px solid var(--border)",
          background: "var(--bg)",
        }}
      >
        {/* Right panel tab bar */}
        <div style={{ display: "flex", alignItems: "center", flexShrink: 0, background: "var(--bg-panel)", borderBottom: "1px solid var(--border)", height: 36 }}>
          <div style={{ flex: 1, overflow: "hidden" }}>
            <TabBar
              tabs={fileTabs}
              activeTabId={activeFileTabId ?? ""}
              onSelectTab={setActiveFileTabId}
              onCloseTab={handleCloseFileTab}
            />
          </div>

        </div>

        {/* File content */}
        <div style={{ flex: 1, overflow: "hidden" }}>
          {activeFileTab?.filePath ? (
            <FileViewer
              filePath={activeFileTab.filePath}
              cwd={activeCwd ?? undefined}
              sourceSessionId={activeFileTab.sourceSessionId}
              initialDisplayMode={activeFileTab.initialDisplayMode}
              onOpenFile={(filePath) => handleOpenFile(
                filePath,
                getFileName(filePath),
                activeFileTab.sourceSessionId,
              )}
            />
          ) : (
            <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-dim)", fontSize: 12 }}>
              No file open
            </div>
          )}
        </div>
      </div>
    </div>
    {projectTrustDialogOpen && projectTrustCwd && (
      <ProjectTrustDialog
        cwd={projectTrustCwd}
        busy={projectTrustBusy}
        error={projectTrustError}
        onCancelAction={() => {
          if (!projectTrustBusy) setProjectTrustDialogOpen(false);
        }}
        onConfirmAction={() => void handleTrustProject()}
      />
    )}
    {settingsOpen && (
      <SettingsModal
        initialTab={settingsTab}
        cwd={settingsCwd}
        sessionId={selectedSession?.id ?? null}
        onCloseAction={() => {
          setSettingsOpen(false);
          setModelsRefreshKey((k) => k + 1);
        }}
        onModelsSavedAction={() => setModelsRefreshKey((k) => k + 1)}
        onSessionReloadedAction={() => setSessionKey((k) => k + 1)}
      />
    )}
    </div>
  </>
  );
}
