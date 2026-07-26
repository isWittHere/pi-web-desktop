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
import { useTheme } from "@/hooks/useTheme";

import { useIsMobile } from "@/hooks/useIsMobile";
import { copyText } from "@/lib/clipboard";
import { getFileName } from "@/lib/file-paths";
import { buildAtMentionText, buildFileAtMentionsText } from "@/lib/file-fuzzy";
import type { SessionInfo, SessionTreeNode } from "@/lib/types";
import type { ChatInputHandle } from "./ChatInput";
import type { SessionStatsInfo } from "@/lib/pi-types";

type SessionCopyField = "file" | "id";

export function AppShell() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isDark, toggleTheme } = useTheme();

  const isMobile = useIsMobile();
  const [selectedSession, setSelectedSession] = useState<SessionInfo | null>(null);
  // When user clicks +, we only store the cwd — no fake session id
  const [newSessionCwd, setNewSessionCwd] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [sessionKey, setSessionKey] = useState(0);
  const [explorerRefreshKey, setExplorerRefreshKey] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("models");
  const [modelsRefreshKey, setModelsRefreshKey] = useState(0);
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
  const [workspaceControlsHost, setWorkspaceControlsHost] = useState<HTMLDivElement | null>(null);

  // Branch navigator state — populated by ChatWindow via onBranchDataChange
  const [branchTree, setBranchTree] = useState<SessionTreeNode[]>([]);
  const [branchActiveLeafId, setBranchActiveLeafId] = useState<string | null>(null);
  const branchLeafChangeFnRef = useRef<((leafId: string | null) => void) | null>(null);

  const handleBranchDataChange = useCallback((tree: SessionTreeNode[], activeLeafId: string | null, onLeafChange: (leafId: string | null) => void) => {
    setBranchTree(tree);
    setBranchActiveLeafId(activeLeafId);
    branchLeafChangeFnRef.current = onLeafChange;
  }, []);

  const handleBranchLeafChange = useCallback((leafId: string | null) => {
    branchLeafChangeFnRef.current?.(leafId);
  }, []);

  const [systemPrompt, setSystemPrompt] = useState<string | null>(null);
  const systemBtnRef = useRef<HTMLButtonElement>(null);

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
  const [activeTopPanel, setActiveTopPanel] = useState<"branches" | "system" | "session" | null>(null);
  const [topPanelPos, setTopPanelPos] = useState<{ top: number; left: number; width: number } | null>(null);

  const toggleTopPanel = useCallback((panel: "branches" | "system" | "session") => {
    if (isMobile) setSidebarOpen(false);
    setActiveTopPanel((cur) => cur === panel ? null : panel);
  }, [isMobile]);

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

  const handleCwdChange = useCallback((cwd: string | null, projectRoot?: string | null) => {
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
    if (selectedSession && (selectedSession.projectRoot ?? selectedSession.cwd) === newProject) {
      return;
    }
    // Close any session that belongs to a different project — it no longer
    // matches the selected project directory.
    setSelectedSession(null);
    setNewSessionCwd((prev) => {
      if (prev && prev !== cwd) return null;
      return prev;
    });
    setSessionKey((k) => k + 1);
    setBranchTree([]);
    setBranchActiveLeafId(null);
    setSystemPrompt(null);
    setActiveTopPanel(null);
    router.replace("/", { scroll: false });
  }, [router, selectedSession]);

  // Update browser tab title when workspace changes
  useEffect(() => {
    const name = activeCwd ? getFileName(activeCwd) || activeCwd : null;
    document.title = name ? `${name} — Pi Agent Web` : "Pi Agent Web";
  }, [activeCwd]);

  const handleSelectSession = useCallback((session: SessionInfo, isRestore = false) => {
    setNewSessionCwd(null);
    setSelectedSession(session);
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
  }, [router, isMobile]);

  const handleNewSession = useCallback((_sessionId: string, cwd: string) => {
    setSelectedSession(null);
    setNewSessionCwd(cwd);
    setSessionKey((k) => k + 1);
    setBranchTree([]);
    setBranchActiveLeafId(null);
    setSystemPrompt(null);
    setActiveTopPanel(null);
    if (isMobile) setSidebarOpen(false);
    router.replace("/", { scroll: false });
  }, [router, isMobile]);

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
    void fetch("/api/sessions")
      .then((r) => (r.ok ? (r.json() as Promise<{ sessions: SessionInfo[] }>) : null))
      .then((d) => {
        const full = d?.sessions.find((s) => s.id === sessionId);
        if (!full) return;
        setSelectedSession((prev) => (prev && prev.id === sessionId && !prev.projectRoot ? full : prev));
      })
      .catch(() => {});
  }, []);

  // Called by ChatWindow when a new session gets its real id from pi
  const handleSessionCreated = useCallback((session: SessionInfo) => {
    setNewSessionCwd(null);
    setSelectedSession(session);
    setRefreshKey((k) => k + 1);
    hydrateSelectedSession(session.id);
    router.replace(`?session=${encodeURIComponent(session.id)}`, { scroll: false });
  }, [router, hydrateSelectedSession]);

  const handleAgentEnd = useCallback(() => {
    setRefreshKey((k) => k + 1);
    setExplorerRefreshKey((k) => k + 1);
  }, []);

  const handleSessionForked = useCallback((newSessionId: string) => {
    setRefreshKey((k) => k + 1);
    setSessionKey((k) => k + 1);
    setNewSessionCwd(null);
    setSelectedSession((prev) => ({
      ...(prev ?? { path: "", cwd: "", created: "", modified: "", messageCount: 0, firstMessage: "" }),
      id: newSessionId,
    }));
    hydrateSelectedSession(newSessionId);
    router.replace(`?session=${encodeURIComponent(newSessionId)}`, { scroll: false });
  }, [router, hydrateSelectedSession]);

  const handleInitialRestoreDone = useCallback(() => {
    setInitialSessionRestored(true);
  }, []);

  const handleSessionDeleted = useCallback((sessionId: string) => {
    setRefreshKey((k) => k + 1);
    if (selectedSession?.id === sessionId) {
      const cwd = selectedSession.cwd;
      setSelectedSession(null);
      setNewSessionCwd(cwd ?? null);
      setSessionKey((k) => k + 1);
      setBranchTree([]);
      setBranchActiveLeafId(null);
      setSystemPrompt(null);
      setActiveTopPanel(null);
      router.replace("/", { scroll: false });
    }
  }, [selectedSession, router]);

  const handleOpenFile = useCallback((filePath: string, fileName: string, sourceSessionId?: string | null) => {
    const tabId = `file:${filePath}`;
    setFileTabs((prev) => {
      const existing = prev.find((t) => t.id === tabId);
      if (!existing) return [...prev, { id: tabId, label: fileName, filePath, sourceSessionId }];
      if (!sourceSessionId || existing.sourceSessionId === sourceSessionId) return prev;
      return prev.map((t) => t.id === tabId ? { ...t, sourceSessionId } : t);
    });
    setActiveFileTabId(tabId);
    setRightPanelOpen(true);
    // On mobile the file panel is full-screen; close the drawer so it shows.
    if (isMobile) setSidebarOpen(false);
  }, [isMobile]);

  const handleOpenLinkedFile = useCallback((filePath: string) => {
    handleOpenFile(filePath, getFileName(filePath), selectedSession?.id ?? null);
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

  const workspaceTitle = activeCwd ? (getFileName(activeCwd) || activeCwd) : null;

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
  // While restoring initial session from URL, don't show the placeholder
  const showPlaceholder = initialSessionRestored && !showChat;

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
        onSelectSession={handleSelectSession}
        onNewSession={handleNewSession}
        initialSessionId={initialSessionId}
        onInitialRestoreDone={handleInitialRestoreDone}
        refreshKey={refreshKey}
        onSessionDeleted={handleSessionDeleted}
        selectedCwd={selectedSession?.cwd ?? newSessionCwd ?? null}
        onCwdChange={handleCwdChange}
        onOpenFile={handleOpenFile}
        explorerRefreshKey={explorerRefreshKey}
        onAtMention={handleAtMention}
        onAtMentions={handleAtMentions}
        workspaceControlsHost={workspaceControlsHost}
      />

    </>
  );

  return (
    <>
    <style>{`
      @keyframes session-info-pop {
        0% {
          opacity: 0;
          transform: translateY(-24px);
          filter: blur(6px);
          box-shadow: 0 2px 8px rgba(0,0,0,0);
        }
        55% {
          opacity: 1;
          transform: translateY(0);
          filter: blur(0);
          background: color-mix(in srgb, var(--accent) 8%, var(--bg-panel));
          box-shadow: 0 18px 44px rgba(37,99,235,0.16);
        }
        100% {
          opacity: 1;
          transform: translateY(0);
          filter: blur(0);
          background: var(--bg-panel);
          box-shadow: 0 10px 28px rgba(0,0,0,0.10);
        }
      }
      @keyframes session-info-light-wash {
        0% {
          opacity: 0;
          transform: translateX(-110%) skewX(-16deg);
        }
        24% {
          opacity: 0.42;
        }
        100% {
          opacity: 0;
          transform: translateX(115%) skewX(-16deg);
        }
      }
      .session-info-popover {
        position: relative;
        overflow: hidden;
        transform-origin: top right;
        animation: session-info-pop 360ms ease-out both;
        will-change: transform, opacity, filter, background, box-shadow;
      }
      .session-info-popover::after {
        content: "";
        position: absolute;
        top: 0;
        bottom: 0;
        left: 0;
        width: 44%;
        pointer-events: none;
        background: linear-gradient(90deg, transparent, color-mix(in srgb, var(--accent) 24%, transparent), transparent);
        animation: session-info-light-wash 620ms ease-out both;
      }
      @media (prefers-reduced-motion: reduce) {
        .session-info-popover,
        .session-info-popover::after {
          animation: none;
        }
      }
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
    <div style={{ display: "flex", flexDirection: "column", height: "100dvh", overflow: "hidden", background: "var(--bg)" }}>
      <AppTitleBar
        topBarRef={topBarRef}
        sidebarOpen={sidebarOpen}
        onSidebarToggle={handleSidebarToggle}
        isDark={isDark}
        toggleTheme={toggleTheme}
        isMobile={isMobile}
        showChat={showChat}
        selectedSession={selectedSession}
        onViewFullHistory={handleViewFullHistory}
        branchTree={branchTree}
        branchActiveLeafId={branchActiveLeafId}
        onBranchLeafChange={handleBranchLeafChange}
        systemBtnRef={systemBtnRef}
        systemPrompt={systemPrompt}
        activeTopPanel={activeTopPanel}
        onToggleTopPanel={toggleTopPanel}
        topPanelPos={topPanelPos}
        sessionStats={sessionStats}
        contextUsage={contextUsage}
        copiedSessionField={copiedSessionField}
        onCopySessionField={handleCopySessionField}
        rightPanelOpen={rightPanelOpen}
        onToggleFilePanel={() => setRightPanelOpen((v) => !v)}
        onOpenSettings={() => openSettings("models")}
        workspaceTitle={workspaceTitle}
        onWorkspaceControlsHostChange={setWorkspaceControlsHost}
      />
      <div style={{ flex: 1, display: "flex", overflow: "hidden", minWidth: 0 }}>
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
        className={`sidebar-container${sidebarOpen ? " sidebar-open" : " sidebar-closed"}${mobileSidebarReady ? "" : " sidebar-mobile-pending"}`}
        style={{
          background: "var(--bg-panel)",
          borderRight: "1px solid var(--border)",
          display: "flex",
          flexDirection: "column",
          flexShrink: 0,
          zIndex: 200,
        }}
      >
        {sidebarContent}
      </div>

      {/* Center: chat */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minWidth: 0 }}>
        {/* Chat content */}
        <div style={{ flex: 1, overflow: "hidden", position: "relative" }}>
          {showChat ? (
            <ChatWindow
              key={sessionKey}
              session={selectedSession}
              newSessionCwd={effectiveNewSessionCwd}
              onAgentEnd={handleAgentEnd}
              onSessionCreated={handleSessionCreated}
              onSessionForked={handleSessionForked}
              modelsRefreshKey={modelsRefreshKey}
              chatInputRef={chatInputRef}
              onBranchDataChange={handleBranchDataChange}
              onSystemPromptChange={handleSystemPromptChange}
              onSessionStatsChange={handleSessionStatsChange}
              onSessionStatsPanelOpen={openSessionStatsPanel}
              onContextUsageChange={handleContextUsageChange}
              onOpenFile={handleOpenLinkedFile}
            />
          ) : showPlaceholder ? (
            activeCwd ? (
              <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)", fontSize: 15 }}>
                Select a session from the sidebar
              </div>
            ) : (
              <div style={{ position: "absolute", top: 12, left: 12, display: "flex", alignItems: "flex-start", gap: 8, userSelect: "none", pointerEvents: "none" }}>
                <ArrowLeft size={44} color="var(--accent)" aria-hidden="true" style={{ opacity: 0.7, flexShrink: 0 }} />
                <div>
                  <div style={{ fontSize: 18, fontWeight: 600, color: "var(--text)", marginBottom: 8 }}>Get Started</div>
                  <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.8 }}>
                    <span style={{ color: "var(--text-dim)", marginRight: 6 }}>1.</span>Select a project directory from the sidebar<br />
                    <span style={{ color: "var(--text-dim)", marginRight: 6 }}>2.</span>Add models via the <strong style={{ color: "var(--text)" }}>Models</strong> button at the bottom
                  </div>
                </div>
              </div>
            )
          ) : null}
        </div>
      </div>

      {/* Right panel: file viewer — always mounted, width animated via CSS */}
      <div
        className={`right-panel-container${rightPanelOpen ? " right-panel-open" : " right-panel-closed"}`}
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
